import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearAccountData,
  localProgress,
  read,
  removeProgress,
  write,
  type Progress,
  type Settings,
} from "./storage";

/** A burst of saves within this time becomes one upload. */
const DEBOUNCE_MS = 2000;
/** A failed upload is tried again after this long. */
const RETRY_MS = 15000;
/** A request that takes longer than this is aborted and treated as failed. */
const TIMEOUT_MS = 30000;
const NO_RESPONSE = "The account service did not respond.";
const STORAGE_FULL =
  "This browser's storage is full, so changes are uploading now. Free up site storage to keep them safe.";
/** The Data API returns at most this many rows per request (Supabase's default). */
const PAGE = 1000;

/**
 * A record's content for comparison: keys sorted, and without `updated`, which
 * every save rewrites even when nothing else changed.
 */
function canon(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [
                key,
                sort((item as Record<string, unknown>)[key]),
              ]),
          )
        : item;
  const { updated: _updated, ...rest } = (value ?? {}) as Record<
    string,
    unknown
  >;
  return JSON.stringify(sort(rest));
}

/** This browser cannot store the account's data, so the studio cannot open. */
export class BrowserStorageError extends Error {
  constructor() {
    super(
      "This browser is blocking site storage, so your account cannot load here. Allow site data for this page and try again.",
    );
  }
}

/** Run a request with a time limit. Past it, the request is aborted. */
async function timed<T>(
  start: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(NO_RESPONSE));
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      Promise.resolve(start(controller.signal)),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Changes this browser has not confirmed with the account, kept in browser
 * storage so they survive a reload. pull() lets these win over the account's
 * copy; everything else follows the account, whatever each device's clock says.
 */
interface Unsynced {
  settings?: boolean;
  progress?: string[];
  deleted?: string[];
}

/** What the studio reports so the signed-in account stays current. */
export interface SyncHooks {
  settings(settings: Settings): void;
  progress(songId: string, progress: Progress): void;
  /** The song was removed from this browser, so its progress goes too. */
  forgetProgress(songId: string): void;
}

/**
 * Keeps one user's settings and practice progress in their Supabase account.
 * Imported MIDI files never leave the browser. This browser's storage stays
 * the working copy: pull() fills it from the account at sign-in, and later
 * changes upload shortly after they happen, one upload at a time.
 */
export class CloudSync implements SyncHooks {
  private pendingSettings: Settings | null = null;
  private pendingProgress = new Map<string, Progress>();
  private pendingDeletes = new Set<string>();
  /** What the upload in progress carries, until the account confirms it. */
  private inFlight: Required<Unsynced> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The upload under way, shared by every CloudSync: a sync that replaces
   * another, such as after signing back in, waits for the old one's request
   * to settle, so that request cannot land after newer data and undo it.
   */
  private static flushing: Promise<void> | null = null;
  private stopped = false;
  /**
   * What this browser last loaded from or confirmed with the account. A save
   * that matches it is not a change, so an idle page closing cannot upload a
   * stale copy over newer practice from another device.
   */
  private syncedSettings = "";
  private syncedProgress = new Map<string, string>();
  error = "";
  /** Called when error changes. */
  onChange = () => {};
  constructor(
    private client: SupabaseClient,
    readonly userId: string,
  ) {}

  private setError(error: string) {
    if (error === this.error) return;
    this.error = error;
    this.onChange();
  }

  /** Make this browser's storage match the account before the studio opens. */
  async pull() {
    const store = (key: string, value: unknown) => {
      if (!write(key, value)) throw new BrowserStorageError();
    };
    // Another account's settings and progress must not show in, or upload
    // to, this one. Imported songs belong to the browser and stay.
    const owner = read<string | null>("owner", null);
    if (owner && owner !== this.userId) clearAccountData();
    // The first account on this browser adopts what was saved here before.
    // The owner mark is written only once the pull succeeds, so a failed
    // first pull still adopts on the next try.
    const adopting = owner !== this.userId;
    const [settings, rows] = await Promise.all([
      timed(() => this.client.from("settings").select("data").maybeSingle()),
      this.allProgress(),
    ]);
    if (settings.error) throw settings.error;
    // A newer sign-in replaced this one while it loaded: change nothing.
    if (this.stopped) throw new Error("This sign-in was replaced.");
    // Read now, not before the requests: another tab of this account may
    // have saved changes while they were under way.
    const unsynced = adopting ? {} : read<Unsynced>("unsynced", {});

    // Settings: this browser's unconfirmed change wins, then the account's.
    const localSettings = read<Settings | null>("settings", null);
    if (settings.data) this.syncedSettings = canon(settings.data.data);
    if (localSettings && (unsynced.settings || !settings.data))
      this.pendingSettings = localSettings;
    else if (settings.data) store("settings", settings.data.data);

    // Progress: this browser's unconfirmed changes win; otherwise the account
    // is the record. Adopted progress fills in songs the account lacks.
    const remote = new Map(rows.map((row) => [row.song_id, row.data]));
    for (const [id, data] of remote) this.syncedProgress.set(id, canon(data));
    const changed = new Set(unsynced.progress);
    for (const id of unsynced.deleted ?? []) {
      this.pendingDeletes.add(id);
      remote.delete(id);
    }
    for (const { id, progress: local } of localProgress()) {
      if (changed.has(id) || (adopting && !remote.has(id))) {
        this.pendingProgress.set(id, local as Progress);
        remote.delete(id);
      } else if (!remote.has(id) && !this.pendingDeletes.has(id)) {
        // Uploaded before, and since removed from the account.
        try {
          removeProgress(id);
        } catch {
          throw new BrowserStorageError();
        }
      }
    }
    for (const [id, data] of remote) store(`progress:${id}`, data);
    // The marker goes first: once the owner is recorded, the next pull no
    // longer adopts, and only the marker would keep what this one adopted.
    if (!this.saveUnsynced({ exact: true })) throw new BrowserStorageError();
    store("owner", this.userId);
    this.error = "";
    if (this.pending) this.schedule(0);
  }

  /** Every progress row of the account, a page at a time. */
  private async allProgress() {
    const rows: { song_id: string; data: Partial<Progress> }[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = await timed(() =>
        this.client
          .from("progress")
          .select("song_id, data")
          .order("song_id")
          .range(from, from + PAGE - 1),
      );
      if (page.error) throw page.error;
      rows.push(...(page.data as typeof rows));
      if (page.data.length < PAGE || this.stopped) return rows;
    }
  }

  settings(settings: Settings) {
    if (this.stopped) return;
    if (!this.pendingSettings && canon(settings) === this.syncedSettings)
      return;
    this.pendingSettings = { ...settings };
    this.queued();
  }

  progress(songId: string, progress: Progress) {
    if (this.stopped) return;
    if (
      !this.pendingProgress.has(songId) &&
      !this.pendingDeletes.has(songId) &&
      canon(progress) === this.syncedProgress.get(songId)
    )
      return;
    this.pendingDeletes.delete(songId);
    this.pendingProgress.set(songId, { ...progress });
    this.queued();
  }

  forgetProgress(songId: string) {
    if (this.stopped) return;
    // Deletes join the upload queue, so an upload already under way cannot
    // land after the delete and bring the progress back.
    this.pendingProgress.delete(songId);
    this.pendingDeletes.add(songId);
    this.queued();
  }

  /**
   * Remember a queued change and schedule its upload. If browser storage
   * cannot hold the marker, a reload before the upload lands would let the
   * account's older copy win, so upload at once and say so.
   */
  private queued() {
    if (this.saveUnsynced()) return this.schedule();
    this.setError(STORAGE_FULL);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.schedule(0);
  }

  /**
   * Keep the unconfirmed changes in browser storage. False if it is full.
   * Other tabs signed in to the same account share the marker, so this adds
   * what this sync holds and removes only what it has just `confirmed`;
   * `exact` replaces it, for pull(), which decides what is unconfirmed.
   */
  private saveUnsynced({
    confirmed,
    exact = false,
  }: { confirmed?: Required<Unsynced>; exact?: boolean } = {}): boolean {
    const flight = this.inFlight;
    const stored: Unsynced = exact ? {} : read<Unsynced>("unsynced", {});
    const kept = (ids: string[] | undefined, done: string[] | undefined) =>
      (ids ?? []).filter((id) => !done?.includes(id));
    return write("unsynced", {
      settings:
        !!this.pendingSettings ||
        !!flight?.settings ||
        (!!stored.settings && !confirmed?.settings),
      progress: [
        ...new Set([
          ...kept(stored.progress, confirmed?.progress),
          ...this.pendingProgress.keys(),
          ...(flight?.progress ?? []),
        ]),
      ],
      deleted: [
        ...new Set([
          ...kept(stored.deleted, confirmed?.deleted),
          ...this.pendingDeletes,
          ...(flight?.deleted ?? []),
        ]),
      ],
    } satisfies Unsynced);
  }

  private schedule(delay = DEBOUNCE_MS) {
    if (this.stopped || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  get pending() {
    return (
      !!this.pendingSettings ||
      this.pendingProgress.size > 0 ||
      this.pendingDeletes.size > 0
    );
  }

  /** Upload waiting changes now. Failures stay queued and retry later. */
  async flush(): Promise<void> {
    // One upload at a time: a newer change never overtakes an older request.
    while (CloudSync.flushing) await CloudSync.flushing;
    if (!this.pending || this.stopped) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const settings = this.pendingSettings,
      progress = [...this.pendingProgress],
      deleted = [...this.pendingDeletes];
    this.pendingSettings = null;
    this.pendingProgress.clear();
    this.pendingDeletes.clear();
    this.inFlight = {
      settings: !!settings,
      progress: progress.map(([id]) => id),
      deleted,
    };
    CloudSync.flushing = (async () => {
      // Aborting at the time limit settles the request, so it cannot land
      // after the retry that replaces it.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      // Each request lands or fails on its own, so only a failed one is
      // retried: retrying one that landed could overwrite a newer row.
      const sent = async (
        request: PromiseLike<{ error: unknown }> | false | null,
      ) => {
        if (!request) return true;
        try {
          return !(await request).error;
        } catch {
          return false;
        }
      };
      const [settingsOk, progressOk, deletesOk] = await Promise.all([
        sent(
          settings &&
            this.client
              .from("settings")
              .upsert({ user_id: this.userId, data: settings })
              .abortSignal(controller.signal),
        ),
        sent(
          progress.length > 0 &&
            this.client
              .from("progress")
              .upsert(
                progress.map(([song_id, data]) => ({
                  user_id: this.userId,
                  song_id,
                  data,
                })),
              )
              .abortSignal(controller.signal),
        ),
        sent(
          deleted.length > 0 &&
            this.client
              .from("progress")
              .delete()
              .in("song_id", deleted)
              .abortSignal(controller.signal),
        ),
      ]);
      clearTimeout(timer);
      this.inFlight = null;
      // Requeue what failed, unless a newer change arrived meanwhile.
      if (settings) {
        if (settingsOk) this.syncedSettings = canon(settings);
        else if (!this.pendingSettings) this.pendingSettings = settings;
      }
      for (const [id, data] of progress)
        if (progressOk) this.syncedProgress.set(id, canon(data));
        else if (!this.pendingProgress.has(id) && !this.pendingDeletes.has(id))
          this.pendingProgress.set(id, data);
      for (const id of deleted)
        if (deletesOk) this.syncedProgress.delete(id);
        else if (!this.pendingProgress.has(id)) this.pendingDeletes.add(id);
      const ok = settingsOk && progressOk && deletesOk;
      if (this.stopped) return;
      this.saveUnsynced({
        confirmed: {
          settings: !!settings && settingsOk,
          progress: progressOk ? progress.map(([id]) => id) : [],
          deleted: deletesOk ? deleted : [],
        },
      });
      if (ok) this.setError("");
      else {
        this.setError("Changes could not be saved to your account. Retrying.");
        this.schedule(RETRY_MS);
      }
    })().finally(() => {
      CloudSync.flushing = null;
    });
    await CloudSync.flushing;
  }

  /** Stop syncing, such as when the session ended elsewhere. Nothing more is sent. */
  stop() {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pendingSettings = null;
    this.pendingProgress.clear();
    this.pendingDeletes.clear();
  }

  /**
   * Upload what is waiting, then sign out; this also ends a sign-in whose
   * pull failed. Close the studio first, so its final save is in the upload
   * and nothing changes during sign-out. Throws,
   * still signed in and still syncing, if Supabase cannot end the session.
   * Once signed out, syncing stops and this browser's copy of the account's
   * settings and progress is cleared, unless some changes could not be
   * uploaded: the next sign-in by the same account uploads them then.
   * Imported songs stay on the browser.
   */
  async signOut() {
    await this.flush();
    // The marker also covers changes from before a sign-in that never
    // finished loading, which this sync has not queued.
    const marker = read<Unsynced>("unsynced", {});
    const unsent =
      this.pending ||
      !!marker.settings ||
      !!marker.progress?.length ||
      !!marker.deleted?.length;
    // What this browser held before its first successful pull is kept too,
    // for that sign-in to adopt.
    const owned = read<string | null>("owner", null) === this.userId;
    // No time limit: the request cannot be cancelled, so a timeout could
    // report failure and then sign out later anyway. Supabase answers with an
    // error when it cannot reach the server. Only this browser signs out;
    // other devices keep their sessions.
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw error;
    this.stop();
    if (!unsent && owned) clearAccountData();
  }
}
