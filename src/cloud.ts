import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearAccountData,
  localProgress,
  read,
  write,
  type Progress,
  type Settings,
} from "./storage";

/** A burst of saves within this time becomes one upload. */
const DEBOUNCE_MS = 2000;
/** A failed upload is tried again after this long. */
const RETRY_MS = 15000;
/** A request that takes longer than this is treated as failed. */
const TIMEOUT_MS = 30000;

/** Reject when `work` has not settled within TIMEOUT_MS. */
function timed<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    Promise.resolve(work),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("The account service did not respond.")),
        TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
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
 * changes upload shortly after they happen.
 */
export class CloudSync implements SyncHooks {
  private pendingSettings: Settings | null = null;
  private pendingProgress = new Map<string, Progress>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private stopped = false;
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
    // Another account's settings and progress must not show in, or upload
    // to, this one. Imported songs belong to the browser and stay.
    const owner = read<string | null>("owner", null);
    if (owner && owner !== this.userId) clearAccountData();
    write("owner", this.userId);
    const [settings, progress] = await timed(
      Promise.all([
        this.client.from("settings").select("data").maybeSingle(),
        this.client.from("progress").select("song_id, data"),
      ]),
    );
    if (settings.error) throw settings.error;
    if (progress.error) throw progress.error;

    // The account's settings win. A first sign-in uploads this browser's.
    if (settings.data) write("settings", settings.data.data);
    else {
      const local = read<Settings | null>("settings", null);
      if (local) this.pendingSettings = local;
    }

    // For each song, the more recently updated progress wins.
    const remote = new Map(
      (progress.data as { song_id: string; data: Partial<Progress> }[]).map(
        (row) => [row.song_id, row.data],
      ),
    );
    for (const { id, progress: local } of localProgress()) {
      const theirs = remote.get(id);
      if (!theirs || (local.updated ?? "") > (theirs.updated ?? "")) {
        this.pendingProgress.set(id, local as Progress);
        remote.delete(id);
      }
    }
    for (const [id, data] of remote) write(`progress:${id}`, data);

    this.error = "";
    if (this.pendingSettings || this.pendingProgress.size) this.schedule(0);
  }

  settings(settings: Settings) {
    if (this.stopped) return;
    this.pendingSettings = { ...settings };
    this.schedule();
  }

  progress(songId: string, progress: Progress) {
    if (this.stopped) return;
    this.pendingProgress.set(songId, { ...progress });
    this.schedule();
  }

  forgetProgress(songId: string) {
    this.pendingProgress.delete(songId);
    if (this.stopped) return;
    void timed(
      this.client.from("progress").delete().eq("song_id", songId),
    ).then(
      (result) => {
        if (result.error)
          this.setError(
            "The song's progress could not be removed from your account.",
          );
      },
      () =>
        this.setError(
          "The song's progress could not be removed from your account.",
        ),
    );
  }

  private schedule(delay = DEBOUNCE_MS) {
    if (this.stopped || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  get pending() {
    return !!this.pendingSettings || this.pendingProgress.size > 0;
  }

  /** Upload waiting changes now. Failures stay queued and retry later. */
  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;
    if (!this.pending) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const settings = this.pendingSettings,
      progress = [...this.pendingProgress];
    this.pendingSettings = null;
    this.pendingProgress.clear();
    const updated = new Date().toISOString();
    this.flushing = (async () => {
      let ok = false;
      try {
        const results = await timed(
          Promise.all([
            settings &&
              this.client.from("settings").upsert({
                user_id: this.userId,
                data: settings,
                updated_at: updated,
              }),
            progress.length > 0 &&
              this.client.from("progress").upsert(
                progress.map(([song_id, data]) => ({
                  user_id: this.userId,
                  song_id,
                  data,
                  updated_at: updated,
                })),
              ),
          ]),
        );
        ok = results.every((result) => !result || !result.error);
      } catch {}
      if (ok) {
        this.setError("");
        return;
      }
      // Requeue what failed, unless a newer change arrived meanwhile.
      if (settings && !this.pendingSettings) this.pendingSettings = settings;
      for (const [id, data] of progress)
        if (!this.pendingProgress.has(id)) this.pendingProgress.set(id, data);
      this.setError("Changes could not be saved to your account. Retrying.");
      this.schedule(RETRY_MS);
    })().finally(() => {
      this.flushing = null;
    });
    await this.flushing;
  }

  /**
   * Upload what is waiting, stop syncing, and sign out. This browser's copy of
   * the account's settings and progress is cleared unless some changes could
   * not be uploaded: the next sign-in by the same account uploads them then.
   * Imported songs stay on the browser.
   */
  async signOut() {
    await this.flush();
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) clearAccountData();
    await this.client.auth.signOut();
  }
}
