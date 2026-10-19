import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearAccountData,
  localProgress,
  read,
  remove,
  removeProgress,
  storedKeys,
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

/**
 * Run `upload` holding a lock that every tab of this site shares, so uploads
 * from different tabs land one at a time, in order: a slow, older request from
 * one tab cannot land after a newer one from another. Browsers without Web
 * Locks run it at once.
 */
async function withUploadLock(upload: () => Promise<void>) {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks) await locks.request("pawpal-account-upload", upload);
  else await upload();
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
  /** The account whose changes these are. */
  owner?: string;
  /** A fingerprint of the unconfirmed settings. */
  settings?: string;
  /** Song id to the `updated` stamp of its unconfirmed progress. */
  progress: Record<string, string>;
  /** Song id to when its progress was removed. A song is in one list only. */
  deleted: Record<string, string>;
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

/**
 * Each marker entry is stored under its own key, named for its account and
 * what it marks (unsynced:<user id>:settings, unsynced:<user id>:progress:<song
 * id>, unsynced:<user id>:deleted:<song id>). Tabs saving different songs, or
 * tabs of two accounts during a switch, never overwrite each other's entries.
 */
const MARKER = "unsynced:";
interface MarkerEntry {
  /** The account it belongs to; entries from earlier builds may name none. */
  owner?: string;
  version: string;
}
/** A stored entry: its storage key, account and what it marks. */
interface StoredEntry {
  key: string;
  owner?: string;
  /** "settings", "progress:<song id>" or "deleted:<song id>". */
  kind: string;
  version: string;
}
const KINDS = ["settings", "progress", "deleted"];
/** The storage key of an entry; one without an account is an earlier build's. */
const entryKey = (owner: string | undefined, kind: string) =>
  owner ? `${MARKER}${owner}:${kind}` : MARKER + kind;

/** The single marker earlier builds kept, as a marker. */
function legacyMarker(stored: Record<string, unknown>): Unsynced {
  const progress = stored.progress;
  return {
    owner: typeof stored.owner === "string" ? stored.owner : undefined,
    settings:
      typeof stored.settings === "string"
        ? stored.settings
        : stored.settings
          ? "?"
          : undefined,
    progress: Array.isArray(progress)
      ? Object.fromEntries(progress.map((id) => [String(id), ""]))
      : progress && typeof progress === "object"
        ? (progress as Record<string, string>)
        : {},
    deleted: Array.isArray(stored.deleted)
      ? Object.fromEntries(stored.deleted.map((id) => [String(id), ""]))
      : stored.deleted && typeof stored.deleted === "object"
        ? (stored.deleted as Record<string, string>)
        : {},
  };
}

/** Store `marker`'s entries for `owner`. False if storage refused one. */
function putMarker(marker: Unsynced, owner: string | undefined): boolean {
  const put = (kind: string, version: string) =>
    write(entryKey(owner, kind), { owner, version } satisfies MarkerEntry);
  let ok = marker.settings === undefined || put("settings", marker.settings);
  for (const [id, version] of Object.entries(marker.progress))
    ok = put(`progress:${id}`, version) && ok;
  for (const [id, at] of Object.entries(marker.deleted))
    ok = put(`deleted:${id}`, at) && ok;
  return ok;
}

/** Every stored marker entry. */
function markerEntries(): StoredEntry[] {
  // An earlier build's single marker moves into entries first.
  const legacy = read<Record<string, unknown> | null>("unsynced", null);
  if (legacy) {
    const marker = legacyMarker(legacy);
    if (putMarker(marker, marker.owner))
      try {
        remove("unsynced");
      } catch {}
  }
  const entries: StoredEntry[] = [];
  for (const key of storedKeys(MARKER)) {
    const entry = read<MarkerEntry | null>(key, null);
    if (!entry || typeof entry.version !== "string") continue;
    const rest = key.slice(MARKER.length);
    const [first, ...more] = rest.split(":");
    // Keys without an account come from an earlier build.
    const owned = !KINDS.includes(first);
    entries.push({
      key,
      owner: owned ? first : entry.owner,
      kind: owned ? more.join(":") : rest,
      version: entry.version,
    });
  }
  return entries;
}

/** The marker entries of `owner`, with any that name no account. */
function readUnsynced(owner: string): Unsynced {
  const marker: Unsynced = { owner, progress: {}, deleted: {} };
  const later = (a: string | undefined, b: string) =>
    a !== undefined && a > b ? a : b;
  for (const entry of markerEntries()) {
    if (entry.owner && entry.owner !== owner) continue;
    const { kind, version } = entry;
    if (kind === "settings") marker.settings = version;
    else if (kind.startsWith("progress:")) {
      const id = kind.slice("progress:".length);
      marker.progress[id] = later(marker.progress[id], version);
    } else if (kind.startsWith("deleted:")) {
      const id = kind.slice("deleted:".length);
      marker.deleted[id] = later(marker.deleted[id], version);
    }
  }
  return marker;
}

/** The accounts that marker entries name. */
function markerOwners(): Set<string> {
  const owners = new Set<string>();
  for (const entry of markerEntries()) if (entry.owner) owners.add(entry.owner);
  return owners;
}

/**
 * Remove `owner`'s marker entries, or just its entry for `kind`, which also
 * takes an earlier build's entry for it that names no account.
 */
function dropMarker(owner: string, kind?: string) {
  for (const entry of markerEntries())
    if (
      kind === undefined
        ? entry.owner === owner
        : entry.kind === kind && (entry.owner === owner || !entry.owner)
    )
      remove(entry.key);
}

/**
 * One account's changes its account has not confirmed, set aside when another
 * account signs in on this browser, until the first signs in again.
 */
interface Stash {
  marker: Unsynced;
  settings: Settings | null;
  progress: Record<string, Partial<Progress> | null>;
}

/**
 * Set aside what `owner` has not uploaded, added to anything already set aside
 * for it (the later save of a song wins). False if storage refused it.
 */
function stashUnsent(owner: string): boolean {
  const marker = readUnsynced(owner);
  const songs = Object.keys(marker.progress);
  if (!marker.settings && !songs.length && !Object.keys(marker.deleted).length)
    return true;
  const earlier = read<Stash | null>(`stash:${owner}`, null);
  const progress = { ...earlier?.progress };
  const versions = { ...earlier?.marker.progress };
  for (const id of songs) {
    const data = read<Partial<Progress> | null>(`progress:${id}`, null);
    if (!data || (id in versions && versions[id] > marker.progress[id]))
      continue;
    progress[id] = data;
    versions[id] = marker.progress[id];
  }
  const deleted = { ...earlier?.marker.deleted };
  for (const [id, at] of Object.entries(marker.deleted))
    if (!(id in deleted) || at > deleted[id]) deleted[id] = at;
  // A song is either saved or removed: the later of the two stays.
  for (const id of Object.keys(deleted))
    if (id in versions) {
      if (deleted[id] > versions[id]) {
        delete versions[id];
        delete progress[id];
      } else delete deleted[id];
    }
  return write(`stash:${owner}`, {
    marker: {
      owner,
      settings: marker.settings ?? earlier?.marker.settings,
      progress: versions,
      deleted,
    },
    settings: marker.settings
      ? read<Settings | null>("settings", null)
      : (earlier?.settings ?? null),
    progress,
  } satisfies Stash);
}

/** What the studio reports so the signed-in account stays current. */
export interface SyncHooks {
  /** `stored`: false if browser storage refused the settings. */
  settings(settings: Settings, stored?: boolean): void;
  /**
   * `loaded`: the save made as the song opens, before any practice.
   * `stored`: false if browser storage refused the record.
   */
  progress(
    songId: string,
    progress: Progress,
    loaded?: boolean,
    stored?: boolean,
  ): void;
}

/**
 * Keeps one user's settings and practice progress in their Supabase account.
 * This browser's storage stays the working copy: pull() fills it from the
 * account at sign-in, and later changes upload shortly after they happen, one
 * upload at a time.
 */
export class CloudSync implements SyncHooks {
  private pendingSettings: Settings | null = null;
  /** False while the queued settings exist only in memory. */
  private pendingSettingsStored = true;
  private pendingProgress = new Map<string, Progress>();
  /** Song id to when its progress was removed. */
  private pendingDeletes = new Map<string, string>();
  /** What the upload in progress carries, until the account confirms it. */
  private inFlight: Unsynced | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The upload under way, shared by every CloudSync in this tab (tabs share
   * a Web Lock, see withUploadLock): a sync that replaces
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
    // to, this one: what it has not uploaded is set aside for it, and the rest
    // cleared.
    const owner = read<string | null>("owner", null);
    if (owner && owner !== this.userId) {
      if (!stashUnsent(owner)) throw new BrowserStorageError();
      clearAccountData();
      // This browser is now this account's: nothing a tab of the other
      // account still writes is adopted, even if this pull fails.
      store("owner", this.userId);
    }
    // Changes this account had not uploaded when another signed in here come
    // back first, marked unconfirmed, so they win over the account's copy.
    const stash =
      owner === this.userId
        ? null
        : read<Stash | null>(`stash:${this.userId}`, null);
    if (stash) {
      if (stash.settings) store("settings", stash.settings);
      for (const [id, data] of Object.entries(stash.progress))
        if (data) store(`progress:${id}`, data);
      if (!putMarker(stash.marker, this.userId))
        throw new BrowserStorageError();
      store("owner", this.userId);
      // Now in the working copy, marked unconfirmed, where a failed pull
      // retries from: the stash must not come back later and win again.
      try {
        remove(`stash:${this.userId}`);
      } catch {
        throw new BrowserStorageError();
      }
    }
    // The first account on this browser adopts what was saved here before.
    // The owner mark is written only once the pull succeeds, so a failed
    // first pull still adopts on the next try.
    const adopting = !owner && !stash;
    const [settings, rows] = await Promise.all([
      timed(() => this.client.from("settings").select("data").maybeSingle()),
      this.allProgress(),
    ]);
    if (settings.error) throw settings.error;
    // A newer sign-in replaced this one while it loaded: change nothing.
    if (this.stopped) throw new Error("This sign-in was replaced.");
    // Read now, not before the requests: another tab of this account may
    // have saved changes while they were under way.
    const own = adopting ? { progress: {}, deleted: {} } : this.ownMarker();
    if (!own) throw new BrowserStorageError();
    const unsynced: Unsynced = own;

    // A marker entry newer than the record it names is for a save this
    // browser could not store, so the record is not that change.
    const unconfirmed = (id: string, local: Partial<Progress>) =>
      id in unsynced.progress &&
      progressVersion(local) >= unsynced.progress[id];

    // Settings: this browser's unconfirmed change wins, then the account's.
    let localSettings = read<Settings | null>("settings", null);
    if (settings.data) this.syncedSettings = canon(settings.data.data);
    let keepSettings =
      !!localSettings && (!!unsynced.settings || (adopting && !settings.data));

    // Progress: this browser's unconfirmed changes win; otherwise the account
    // is the record. Adopted progress fills in songs the account lacks.
    const remote = new Map(rows.map((row) => [row.song_id, row.data]));
    for (const [id, data] of remote) this.syncedProgress.set(id, canon(data));
    for (const [id, at] of Object.entries(unsynced.deleted)) {
      // A marker from an earlier build can list a song both ways; the save
      // came after the removal, or the progress would be gone.
      if (id in unsynced.progress) continue;
      this.pendingDeletes.set(id, at);
      remote.delete(id);
    }
    const removals = new Set<string>();
    for (const { id, progress: local } of localProgress()) {
      if (unconfirmed(id, local) || (adopting && !remote.has(id))) {
        this.pendingProgress.set(id, local as Progress);
        remote.delete(id);
      } else if (!remote.has(id) && !this.pendingDeletes.has(id))
        // Uploaded before, and since removed from the account.
        removals.add(id);
    }

    // A scan over several pages is no snapshot: a row another device added
    // behind it meanwhile would look removed. Ask for those songs directly
    // before dropping this browser's copies.
    if (removals.size && rows.length >= PAGE) {
      const found = await timed(() =>
        this.client
          .from("progress")
          .select("song_id, data")
          .in("song_id", [...removals]),
      );
      if (found.error) throw found.error;
      if (this.stopped) throw new Error("This sign-in was replaced.");
      for (const row of found.data as typeof rows) {
        removals.delete(row.song_id);
        remote.set(row.song_id, row.data);
        this.syncedProgress.set(row.song_id, canon(row.data));
      }
    }

    // Another tab may have saved while this decided: entries added to the
    // marker since it was read win too, before anything is overwritten.
    if (!adopting) {
      const latest = this.ownMarker();
      if (!latest) throw new BrowserStorageError();
      if (latest.settings !== unsynced.settings) {
        // Saved by another tab since: take that copy.
        localSettings = read<Settings | null>("settings", null);
        if (localSettings) keepSettings = true;
      }
      for (const [id, version] of Object.entries(latest.progress)) {
        const local = read<Partial<Progress> | null>(`progress:${id}`, null);
        if (unsynced.progress[id] === version || !local) continue;
        if (progressVersion(local) < version) continue;
        this.pendingDeletes.delete(id);
        this.pendingProgress.set(id, local as Progress);
        remote.delete(id);
        removals.delete(id);
      }
      for (const [id, at] of Object.entries(latest.deleted))
        if (unsynced.deleted[id] !== at && !(id in latest.progress)) {
          this.pendingProgress.delete(id);
          this.pendingDeletes.set(id, at);
          remote.delete(id);
        }
    }

    if (keepSettings) this.pendingSettings = localSettings;
    else if (settings.data) store("settings", settings.data.data);
    else if (localSettings)
      // Not this account's: start from the defaults instead.
      try {
        remove("settings");
      } catch {
        throw new BrowserStorageError();
      }
    for (const id of removals)
      try {
        removeProgress(id);
      } catch {
        throw new BrowserStorageError();
      }
    for (const [id, data] of remote) store(`progress:${id}`, data);
    // The marker goes first: once the owner is recorded, the next pull no
    // longer adopts, and only the marker would keep what this one adopted.
    if (!this.saveUnsynced({ exact: true })) throw new BrowserStorageError();
    store("owner", this.userId);
    this.error = "";
    if (this.pending) this.schedule(0);
  }

  /**
   * The marker, if it is this account's. One that a still-running tab of
   * another account wrote after a switch is set aside for that account.
   */
  private ownMarker(): Unsynced | null {
    for (const other of markerOwners()) {
      if (other === this.userId) continue;
      // Null, leaving those entries in place, if they cannot be set aside.
      if (!stashUnsent(other)) return null;
      try {
        dropMarker(other);
      } catch {
        return null;
      }
    }
    return readUnsynced(this.userId);
  }

  /**
   * Every progress row of the account, a page at a time. Each page starts
   * after the last song id of the one before: with offsets, a row another
   * device removed meanwhile would shift a later row out of view, and this
   * browser would then drop its copy as if the account had.
   */
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

  settings(settings: Settings, stored = true) {
    if (this.stopped) return;
    // An upload under way carries something else, so going back is a change.
    if (canon(settings) === this.syncedSettings && !this.inFlight?.settings) {
      // Back where the account is, such as a selection restored once
      // imported songs load: what was waiting is no longer a change.
      if (this.pendingSettings) {
        const withdrawn = settingsVersion(this.pendingSettings);
        this.pendingSettings = null;
        this.saveUnsynced({
          confirmed: { settings: withdrawn, progress: {}, deleted: {} },
        });
      }
      return;
    }
    this.pendingSettings = { ...settings };
    this.pendingSettingsStored = stored;
    this.queued(!stored);
  }

  progress(songId: string, progress: Progress, loaded = false, stored = true) {
    if (this.stopped) return;
    // A song the account has no progress for takes the save made as it opens
    // as its baseline: an untouched song is no change, and uploading it could
    // overwrite practice another device adds meanwhile.
    if (
      loaded &&
      !this.syncedProgress.has(songId) &&
      !this.pendingProgress.has(songId) &&
      !this.pendingDeletes.has(songId)
    ) {
      this.syncedProgress.set(songId, canon(progress));
      return;
    }
    if (
      !this.pendingProgress.has(songId) &&
      !this.pendingDeletes.has(songId) &&
      !(this.inFlight && songId in this.inFlight.progress) &&
      canon(progress) === this.syncedProgress.get(songId)
    )
      return;
    this.pendingDeletes.delete(songId);
    this.pendingProgress.set(songId, { ...progress });
    // A record the browser could not keep exists only here until it uploads.
    this.queued(!stored);
  }

  /** Delete a song's saved progress from the account. */
  forgetProgress(songId: string) {
    if (this.stopped) return;
    // Deletes join the upload queue, so an upload already under way cannot
    // land after the delete and bring the progress back.
    this.pendingProgress.delete(songId);
    this.pendingDeletes.set(songId, new Date().toISOString());
    this.queued();
  }

  /**
   * Remember a queued change and schedule its upload. If browser storage
   * cannot hold the marker, or (`urgent`) the change itself, a reload before
   * the upload lands would lose it, so upload at once and say so.
   */
  private queued(urgent = false) {
    if (this.saveUnsynced() && !urgent) return this.schedule();
    this.setError(STORAGE_FULL);
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
    const stored = exact ? { progress: {}, deleted: {} } : this.ownMarker();
    if (!stored) return false;
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
    for (const id of Object.keys(deleted))
      if (id in progress) {
        if (deleted[id] > progress[id]) delete progress[id];
        else delete deleted[id];
      }
    // Write each entry under its own key, and remove only the entries of
    // this account (or of none) that this decided to drop: another tab's
    // entries for other songs are never touched.
    const before = exact ? readUnsynced(this.userId) : stored;
    try {
      if (before.settings !== undefined && settings === undefined)
        dropMarker(this.userId, "settings");
      for (const id of Object.keys(before.progress))
        if (!(id in progress)) dropMarker(this.userId, `progress:${id}`);
      for (const id of Object.keys(before.deleted))
        if (!(id in deleted)) dropMarker(this.userId, `deleted:${id}`);
    } catch {
      return false;
    }
    const changed: Unsynced = {
      settings: settings !== before.settings ? settings : undefined,
      progress: Object.fromEntries(
        Object.entries(progress).filter(([id, v]) => before.progress[id] !== v),
      ),
      deleted: Object.fromEntries(
        Object.entries(deleted).filter(([id, v]) => before.deleted[id] !== v),
      ),
    };
    return putMarker(changed, this.userId);
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
    let settings = this.pendingSettings,
      progress = [...this.pendingProgress];
    const settingsStored = this.pendingSettingsStored;
    this.pendingSettingsStored = true;
    const deleted = [...this.pendingDeletes];
    const deletedIds = deleted.map(([id]) => id);
    this.pendingSettings = null;
    this.pendingProgress.clear();
    this.pendingDeletes.clear();
    this.inFlight = {
      settings: settings ? settingsVersion(settings) : undefined,
      progress: Object.fromEntries(
        progress.map(([id, data]) => [id, progressVersion(data)]),
      ),
      deleted: Object.fromEntries(deleted),
    };
    const upload = async () => {
      // Another tab may have saved these since they were queued, and its
      // upload may already have landed: send the newest copy this browser
      // holds, so an older one never lands last.
      // Settings the browser could not store are only in memory.
      const latestSettings = read<Settings | null>("settings", null);
      if (settings && settingsStored && latestSettings)
        settings = latestSettings;
      progress = progress.map(([id, data]) => {
        const local = read<Progress | null>(`progress:${id}`, null);
        return local && progressVersion(local) > progressVersion(data)
          ? [id, local]
          : [id, data];
      });
      this.inFlight = {
        settings: settings ? settingsVersion(settings) : undefined,
        progress: Object.fromEntries(
          progress.map(([id, data]) => [id, progressVersion(data)]),
        ),
        deleted: Object.fromEntries(deleted),
      };
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
          deletedIds.length > 0 &&
            this.client
              .from("progress")
              .delete()
              .in("song_id", deletedIds)
              .abortSignal(controller.signal),
        ),
      ]);
      clearTimeout(timer);
      this.inFlight = null;
      // Requeue what failed, unless a newer change arrived meanwhile.
      if (settings) {
        if (settingsOk) this.syncedSettings = canon(settings);
        else if (!this.pendingSettings) {
          this.pendingSettings = settings;
          this.pendingSettingsStored = settingsStored;
        }
      }
      for (const [id, data] of progress)
        if (progressOk) this.syncedProgress.set(id, canon(data));
        else if (!this.pendingProgress.has(id) && !this.pendingDeletes.has(id))
          this.pendingProgress.set(id, data);
      for (const [id, at] of deleted)
        if (deletesOk) this.syncedProgress.delete(id);
        else if (!this.pendingProgress.has(id) && !this.pendingDeletes.has(id))
          this.pendingDeletes.set(id, at);
      const ok = settingsOk && progressOk && deletesOk;
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
        },
      });
      if (ok) this.setError("");
      else {
        this.setError("Changes could not be saved to your account. Retrying.");
        this.schedule(RETRY_MS);
      }
    };
    CloudSync.flushing = withUploadLock(upload).finally(() => {
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
   */
  async signOut() {
    await this.flush();
    // The marker also covers changes from before a sign-in that never
    // finished loading, which this sync has not queued.
    const marker = readUnsynced(this.userId);
    const unsent =
      this.pending ||
      !!marker.settings ||
      Object.keys(marker.progress).length > 0 ||
      Object.keys(marker.deleted).length > 0;
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
