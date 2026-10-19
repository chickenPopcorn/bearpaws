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
import {
  addDays,
  HISTORY_DAYS,
  localDay,
  storedSessions,
  type PracticeSession,
} from "./practiceLog";

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
 * Each entry names the version it stands for, so a tab clears only what it
 * uploaded, never a newer save another tab made since.
 */
interface Unsynced {
  /** A fingerprint of the unconfirmed settings. */
  settings?: string;
  /** Song id to the `updated` stamp of its unconfirmed progress. */
  progress: Record<string, string>;
  /** Song id to when its progress was removed. A song is in one list only. */
  deleted: Record<string, string>;
  /** Practice session id to the version of its unconfirmed copy. */
  practice: Record<string, string>;
}
const EMPTY_UNSYNCED: Unsynced = { progress: {}, deleted: {}, practice: {} };

/** A practice_sessions row as the Data API returns it. */
interface PracticeRow {
  id: string;
  day: string;
  started_at: string;
  seconds: number;
  songs: Record<string, number>;
}

/** A short fingerprint of some text (FNV-1a). */
function fingerprint(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}
const settingsVersion = (settings: Settings) =>
  fingerprint(JSON.stringify(settings));
const progressVersion = (progress: Partial<Progress>) =>
  typeof progress.updated === "string" ? progress.updated : "";
/** A session only grows, so its time orders its copies; padded to compare as text. */
const practiceVersion = (session: PracticeSession) =>
  String(session.seconds).padStart(6, "0");
/** Ids saved by earlier builds, without versions, as a versioned record. */
const unversioned = (ids: unknown[]) =>
  Object.fromEntries(ids.map((id) => [String(id), ""]));

/** The marker in browser storage, including the plainer form earlier builds wrote. */
function readUnsynced(): Unsynced {
  const stored = read<Record<string, unknown>>("unsynced", {});
  const { progress, practice } = stored;
  return {
    settings:
      typeof stored.settings === "string"
        ? stored.settings
        : stored.settings
          ? "?"
          : undefined,
    progress: Array.isArray(progress)
      ? unversioned(progress)
      : progress && typeof progress === "object"
        ? (progress as Record<string, string>)
        : {},
    deleted: Array.isArray(stored.deleted)
      ? unversioned(stored.deleted)
      : stored.deleted && typeof stored.deleted === "object"
        ? (stored.deleted as Record<string, string>)
        : {},
    practice: Array.isArray(practice)
      ? unversioned(practice)
      : practice && typeof practice === "object"
        ? (practice as Record<string, string>)
        : {},
  };
}

/** What the studio reports so the signed-in account stays current. */
export interface SyncHooks {
  settings(settings: Settings): void;
  progress(songId: string, progress: Progress): void;
  /** The song was removed from this browser, so its progress goes too. */
  forgetProgress(songId: string): void;
  /** A practice session gained time; `saved` is false if storage refused it. */
  practice(session: PracticeSession, saved: boolean): void;
}

/**
 * Keeps one user's settings, practice progress and practice time in their
 * Supabase account.
 * Imported MIDI files never leave the browser. This browser's storage stays
 * the working copy: pull() fills it from the account at sign-in, and later
 * changes upload shortly after they happen, one upload at a time.
 */
export class CloudSync implements SyncHooks {
  private pendingSettings: Settings | null = null;
  private pendingProgress = new Map<string, Progress>();
  /** Song id to when its progress was removed. */
  private pendingDeletes = new Map<string, string>();
  private pendingPractice = new Map<string, PracticeSession>();
  /** What the upload in progress carries, until the account confirms it. */
  private inFlight: Unsynced | null = null;
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
    const since = addDays(localDay(new Date()), -HISTORY_DAYS);
    const [settings, rows, practiceRows] = await Promise.all([
      timed(() => this.client.from("settings").select("data").maybeSingle()),
      this.allRows<{ song_id: string; data: Partial<Progress> }>(
        "progress",
        "song_id, data",
        "song_id",
      ),
      this.allRows<PracticeRow>(
        "practice_sessions",
        "id, day, started_at, seconds, songs",
        "id",
        since,
      ),
    ]);
    if (settings.error) throw settings.error;
    // A newer sign-in replaced this one while it loaded: change nothing.
    if (this.stopped) throw new Error("This sign-in was replaced.");
    // Read now, not before the requests: another tab of this account may
    // have saved changes while they were under way.
    const unsynced = adopting ? EMPTY_UNSYNCED : readUnsynced();

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
    const changed = new Set(Object.keys(unsynced.progress));
    for (const [id, at] of Object.entries(unsynced.deleted)) {
      // A marker from an earlier build can list a song both ways; the save
      // came after the removal, or the progress would be gone.
      if (id in unsynced.progress) continue;
      this.pendingDeletes.set(id, at);
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

    // Practice: the account's sessions, with this browser's copy wherever it
    // has more time. A session only grows, so the larger copy is the newer
    // one, whichever tab or upload made it.
    const sessions = new Map<string, PracticeSession>(
      practiceRows.map((row) => [
        row.id,
        {
          id: row.id,
          day: row.day,
          startedAt: row.started_at,
          seconds: row.seconds,
          songs: row.songs,
        },
      ]),
    );
    for (const session of storedSessions()) {
      const remote = sessions.get(session.id);
      if (
        remote
          ? session.seconds > remote.seconds
          : session.id in unsynced.practice || adopting
      ) {
        sessions.set(session.id, session);
        this.pendingPractice.set(session.id, session);
      }
    }
    store(
      "practice",
      [...sessions.values()].filter((session) => session.day >= since),
    );
    // The marker goes first: once the owner is recorded, the next pull no
    // longer adopts, and only the marker would keep what this one adopted.
    if (!this.saveUnsynced({ exact: true })) throw new BrowserStorageError();
    store("owner", this.userId);
    this.error = "";
    if (this.pending) this.schedule(0);
  }

  /**
   * Every row of an account table, from day `since` on if given, a page at a
   * time. Each page starts after the last `key` of the one before: with
   * offsets, a row another device removed meanwhile would shift a later row
   * out of view, and this browser would then drop its copy as if the account
   * had.
   */
  private async allRows<T extends object>(
    table: string,
    columns: string,
    key: keyof T & string,
    since?: string,
  ) {
    const rows: T[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await timed(() => {
        const select = this.client.from(table).select(columns);
        const query = (since ? select.gte("day", since) : select)
          .order(key)
          .limit(PAGE);
        return after === null ? query : query.gt(key, after);
      });
      if (page.error) throw page.error;
      const data = page.data as unknown as T[];
      rows.push(...data);
      if (data.length < PAGE || this.stopped) return rows;
      after = String(data[data.length - 1][key]);
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
    this.pendingDeletes.set(songId, new Date().toISOString());
    this.queued();
  }

  practice(session: PracticeSession, saved: boolean) {
    if (this.stopped) return;
    this.pendingPractice.set(session.id, { ...session });
    // Without its stored copy, a reload before the upload would lose this
    // time, so upload at once.
    if (saved) this.queued();
    else {
      this.saveUnsynced();
      this.uploadNow();
    }
  }

  /**
   * Remember a queued change and schedule its upload. If browser storage
   * cannot hold the marker, a reload before the upload lands would let the
   * account's older copy win, so upload at once and say so.
   */
  private queued() {
    if (this.saveUnsynced()) return this.schedule();
    this.setError(STORAGE_FULL);
    this.uploadNow();
  }

  private uploadNow() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.schedule(0);
  }

  /**
   * Keep the unconfirmed changes in browser storage. False if it is full.
   * Other tabs signed in to the same account share the marker, so this adds
   * what this sync holds and removes only the versions it has just
   * `confirmed`; a newer save from another tab stays. `exact` replaces the
   * marker, for pull(), which decides what is unconfirmed.
   */
  private saveUnsynced({
    confirmed,
    exact = false,
  }: { confirmed?: Unsynced; exact?: boolean } = {}): boolean {
    const flight = this.inFlight;
    const stored = exact ? EMPTY_UNSYNCED : readUnsynced();
    const settings = this.pendingSettings
      ? settingsVersion(this.pendingSettings)
      : (flight?.settings ??
        (stored.settings !== confirmed?.settings
          ? stored.settings
          : undefined));
    // Of two saves of a song, or a save and a removal, the later one is the
    // one to keep: a song is either saved or removed, never both.
    const progress: Record<string, string> = {};
    const deleted: Record<string, string> = {};
    for (const [id, version] of Object.entries(stored.progress))
      if (confirmed?.progress[id] !== version) progress[id] = version;
    for (const [id, at] of Object.entries(stored.deleted))
      if (confirmed?.deleted[id] !== at) deleted[id] = at;
    const keep = (
      into: Record<string, string>,
      id: string,
      version: string,
    ) => {
      if (!(id in into) || version > into[id]) into[id] = version;
    };
    for (const [id, version] of Object.entries(flight?.progress ?? {}))
      keep(progress, id, version);
    for (const [id, at] of Object.entries(flight?.deleted ?? {}))
      keep(deleted, id, at);
    for (const [id, data] of this.pendingProgress)
      keep(progress, id, progressVersion(data));
    for (const [id, at] of this.pendingDeletes) keep(deleted, id, at);
    // Sessions only grow, so the larger copy is the later one.
    const practice: Record<string, string> = {};
    for (const [id, version] of Object.entries(stored.practice))
      if (confirmed?.practice[id] !== version) practice[id] = version;
    for (const [id, version] of Object.entries(flight?.practice ?? {}))
      keep(practice, id, version);
    for (const [id, session] of this.pendingPractice)
      keep(practice, id, practiceVersion(session));
    for (const id of Object.keys(deleted))
      if (id in progress) {
        if (deleted[id] > progress[id]) delete progress[id];
        else delete deleted[id];
      }
    return write("unsynced", {
      settings,
      progress,
      deleted,
      practice,
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
      this.pendingDeletes.size > 0 ||
      this.pendingPractice.size > 0
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
      deleted = [...this.pendingDeletes],
      practice = [...this.pendingPractice.values()];
    const deletedIds = deleted.map(([id]) => id);
    const practiceVersions = Object.fromEntries(
      practice.map((session) => [session.id, practiceVersion(session)]),
    );
    this.pendingSettings = null;
    this.pendingProgress.clear();
    this.pendingDeletes.clear();
    this.pendingPractice.clear();
    this.inFlight = {
      settings: settings ? settingsVersion(settings) : undefined,
      progress: Object.fromEntries(
        progress.map(([id, data]) => [id, progressVersion(data)]),
      ),
      deleted: Object.fromEntries(deleted),
      practice: practiceVersions,
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
      const [settingsOk, progressOk, deletesOk, practiceOk] = await Promise.all(
        [
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
            deletedIds.length > 0 &&
              this.client
                .from("progress")
                .delete()
                .in("song_id", deletedIds)
                .abortSignal(controller.signal),
          ),
          sent(
            practice.length > 0 &&
              this.client
                .from("practice_sessions")
                .upsert(
                  practice.map((session) => ({
                    id: session.id,
                    user_id: this.userId,
                    day: session.day,
                    started_at: session.startedAt,
                    seconds: session.seconds,
                    songs: session.songs,
                  })),
                )
                .abortSignal(controller.signal),
          ),
        ],
      );
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
      for (const [id, at] of deleted)
        if (deletesOk) this.syncedProgress.delete(id);
        else if (!this.pendingProgress.has(id) && !this.pendingDeletes.has(id))
          this.pendingDeletes.set(id, at);
      if (!practiceOk)
        for (const session of practice)
          if (!this.pendingPractice.has(session.id))
            this.pendingPractice.set(session.id, session);
      const ok = settingsOk && progressOk && deletesOk && practiceOk;
      if (this.stopped) return;
      this.saveUnsynced({
        confirmed: {
          settings:
            settings && settingsOk ? settingsVersion(settings) : undefined,
          progress: progressOk
            ? Object.fromEntries(
                progress.map(([id, data]) => [id, progressVersion(data)]),
              )
            : {},
          deleted: deletesOk ? Object.fromEntries(deleted) : {},
          practice: practiceOk ? practiceVersions : {},
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
    this.pendingPractice.clear();
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
    const marker = readUnsynced();
    const unsent =
      this.pending ||
      !!marker.settings ||
      Object.keys(marker.progress).length > 0 ||
      Object.keys(marker.deleted).length > 0 ||
      Object.keys(marker.practice).length > 0;
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
