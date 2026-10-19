import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearAccountData,
  localProgress,
  read,
  remove,
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
const RETRYING = "Changes could not be saved to your account. Retrying.";
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

/** Signing out now would lose changes the account has not received. */
export class UnsentChangesError extends Error {
  constructor() {
    super("Some of your practice has not reached your account yet.");
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
 * Changes waiting to upload, kept in browser storage (`pending`) so a reload
 * or a failed request does not lose them. Only one tab runs the studio (see
 * src/studioClaim.ts), so no other tab writes them meanwhile.
 */
interface Queue {
  owner: string;
  settings?: Settings;
  progress: Record<string, Progress>;
}

/** What the studio reports so the signed-in account stays current. */
export interface SyncHooks {
  settings(settings: Settings): void;
  /** `loaded`: the save made as the song opens, before any practice. */
  progress(songId: string, progress: Progress, loaded?: boolean): void;
}

/**
 * Keeps one user's settings and practice progress in their Supabase account.
 * The account is the record, and it merges each upload (see the
 * progress_merge trigger): the best score and the number of starts only grow,
 * so a late upload from one device never undoes practice from another. This
 * browser keeps a copy for the next load, and a queue of changes to upload.
 */
export class CloudSync implements SyncHooks {
  private queue: Queue;
  /** What the account holds, as far as this browser knows: no need to send it. */
  private syncedSettings = "";
  private syncedProgress = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private uploading: Promise<void> | null = null;
  private stopped = false;
  error = "";
  /** Called when error changes. */
  onChange = () => {};

  constructor(
    private client: SupabaseClient,
    readonly userId: string,
  ) {
    const stored = read<Queue | null>("pending", null);
    this.queue =
      stored?.owner === userId && stored.progress
        ? stored
        : { owner: userId, progress: {} };
  }

  private setError(error: string) {
    if (error === this.error) return;
    this.error = error;
    this.onChange();
  }

  /** Whether changes are waiting to upload. */
  get pending() {
    return !!this.queue.settings || Object.keys(this.queue.progress).length > 0;
  }

  /**
   * Load the account into this browser before the studio opens. Changes left
   * waiting by an earlier visit upload first, so the account includes them.
   */
  async pull() {
    const store = (key: string, value: unknown) => {
      if (!write(key, value)) throw new BrowserStorageError();
    };
    // Another account's settings and progress must not show in, or upload
    // to, this one.
    const owner = read<string | null>("owner", null);
    if (owner && owner !== this.userId) clearAccountData();
    // The first account on this browser takes what was saved here before
    // sign-in existed, where the account has nothing for it.
    const adopting = !owner;
    if (this.pending) {
      await this.flush();
      if (this.pending) throw new Error(RETRYING);
    }
    const [settings, rows] = await Promise.all([
      timed(() => this.client.from("settings").select("data").maybeSingle()),
      this.allProgress(),
    ]);
    if (settings.error) throw settings.error;
    // A newer sign-in replaced this one while it loaded: change nothing.
    if (this.stopped) throw new Error("This sign-in was replaced.");

    const localSettings = read<Settings | null>("settings", null);
    if (settings.data) {
      this.syncedSettings = canon(settings.data.data);
      store("settings", settings.data.data);
    } else if (localSettings) this.queue.settings = localSettings;

    const remote = new Map(rows.map((row) => [row.song_id, row.data]));
    const missing = localProgress().filter(({ id }) => !remote.has(id));
    // A scan over several pages is no snapshot: a row another device added
    // behind it meanwhile would look missing. Ask for those songs directly.
    if (!adopting && missing.length && rows.length >= PAGE) {
      const found = await timed(() =>
        this.client
          .from("progress")
          .select("song_id, data")
          .in(
            "song_id",
            missing.map(({ id }) => id),
          ),
      );
      if (found.error) throw found.error;
      if (this.stopped) throw new Error("This sign-in was replaced.");
      for (const row of found.data as typeof rows)
        remote.set(row.song_id, row.data);
    }
    for (const { id, progress } of missing)
      if (remote.has(id)) continue;
      else if (adopting) this.queue.progress[id] = progress as Progress;
      else
        try {
          // Not in the account, so not this account's.
          removeProgress(id);
        } catch {
          throw new BrowserStorageError();
        }
    for (const [id, data] of remote) {
      this.syncedProgress.set(id, canon(data));
      store(`progress:${id}`, data);
    }
    // The queue goes first: once the owner is recorded, the next pull no
    // longer adopts, and only the queue would keep what this one adopted.
    if (!this.savePending()) throw new BrowserStorageError();
    store("owner", this.userId);
    if (this.pending) this.schedule(0);
  }

  /** Every progress row of the account, a page at a time by song id. */
  private async allProgress() {
    const rows: { song_id: string; data: Partial<Progress> }[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await timed(() => {
        const query = this.client
          .from("progress")
          .select("song_id, data")
          .order("song_id")
          .limit(PAGE);
        return after === null ? query : query.gt("song_id", after);
      });
      if (page.error) throw page.error;
      const data = page.data as typeof rows;
      rows.push(...data);
      if (data.length < PAGE || this.stopped) return rows;
      after = data[data.length - 1].song_id;
    }
  }

  settings(settings: Settings) {
    if (this.stopped) return;
    if (!this.queue.settings && canon(settings) === this.syncedSettings) return;
    this.queue.settings = { ...settings };
    this.queued();
  }

  progress(songId: string, progress: Progress, loaded = false) {
    if (this.stopped) return;
    // Opening a song is not practice: its save only says where it stands.
    if (loaded) {
      if (!this.syncedProgress.has(songId))
        this.syncedProgress.set(songId, canon(progress));
      return;
    }
    if (
      !(songId in this.queue.progress) &&
      canon(progress) === this.syncedProgress.get(songId)
    )
      return;
    this.queue.progress[songId] = { ...progress };
    this.queued();
  }

  /** Keep the queue in browser storage. False if it is full. */
  private savePending(): boolean {
    if (this.pending) return write("pending", this.queue);
    try {
      remove("pending");
    } catch {}
    return true;
  }

  /**
   * Schedule the queued change's upload. If browser storage cannot hold the
   * queue, a reload before the upload lands would lose it, so upload at once
   * and say so.
   */
  private queued() {
    if (this.savePending()) return this.schedule();
    this.setError(STORAGE_FULL);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.schedule(0);
  }

  private schedule(delay = DEBOUNCE_MS) {
    if (this.stopped || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  /** Upload what is queued now. A failure keeps it queued and retries later. */
  async flush(): Promise<void> {
    // One upload at a time: a newer change never overtakes an older request.
    while (this.uploading) await this.uploading;
    if (!this.pending || this.stopped) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const settings = this.queue.settings,
      progress = Object.entries(this.queue.progress);
    this.uploading = (async () => {
      // Aborting at the time limit settles the request, so it cannot land
      // after the retry that replaces it.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const sent = async (
        request: PromiseLike<{ error: unknown }> | false | undefined,
      ) => {
        if (!request) return true;
        try {
          return !(await request).error;
        } catch {
          return false;
        }
      };
      const [settingsOk, progressOk] = await Promise.all([
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
      ]);
      clearTimeout(timer);
      // What landed leaves the queue, unless a newer save replaced it since.
      if (settings && settingsOk) {
        this.syncedSettings = canon(settings);
        if (this.queue.settings === settings) delete this.queue.settings;
      }
      if (progressOk)
        for (const [id, data] of progress) {
          this.syncedProgress.set(id, canon(data));
          if (this.queue.progress[id] === data) delete this.queue.progress[id];
        }
      if (this.stopped) return;
      this.savePending();
      if (settingsOk && progressOk) this.setError("");
      else {
        this.setError(RETRYING);
        this.schedule(RETRY_MS);
      }
    })().finally(() => {
      this.uploading = null;
    });
    await this.uploading;
  }

  /** Stop syncing, such as when the session ended elsewhere. Nothing more is sent. */
  stop() {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Upload what is queued, then sign out this browser and clear its copy of
   * the account. Close the studio first, so its final save is in the upload.
   * Throws UnsentChangesError, still signed in, if some changes could not
   * upload, unless `force` says to drop them; throws, still signed in, if
   * Supabase cannot end the session.
   */
  async signOut({ force = false } = {}) {
    // A forced sign-out follows one that already tried to upload.
    if (!force) await this.flush();
    if (this.pending && !force) throw new UnsentChangesError();
    // No time limit: the request cannot be cancelled, so a timeout could
    // report failure and then sign out later anyway. Only this browser signs
    // out; other devices keep their sessions.
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw error;
    this.stop();
    clearAccountData();
  }
}
