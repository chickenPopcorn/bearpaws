/**
 * The course CD's story: the narration that leads into each piece of Lesson
 * Book 3, from the private bucket `cd-audio` (see docs/library.md). Only
 * signed-in users can read it, so each track is fetched as the signed-in user
 * and played from an object URL, on an audio element of its own: the piano's
 * Web Audio scheduling never sees it.
 */

/** The private Supabase bucket that holds the course CD's audio. */
export const CD_AUDIO_BUCKET = "cd-audio";
/** Lists the CD's tracks, as scripts/cd-audio.mjs uploads it. */
export const CD_MANIFEST = "mflm-3/manifest.json";
/** Tracks kept in memory for a story played again. A story has at most two. */
const KEPT_TRACKS = 4;
/** A track's path in the bucket, such as mflm-3/disc-1/02.mp3. */
const AUDIO_PATH = /^(?:[\w-]+\/)*[\w-]+\.mp3$/;

/** What the app reads of a track in manifest.json. */
export interface CdTrack {
  disc: number;
  track: number;
  /** `song` for a piece of Lesson Book 3, `story` for the narration around them. */
  kind: string;
  /** The library song a `song` track plays. */
  songId?: string;
  /** Its path in the bucket. */
  audio: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Check manifest.json and return its tracks. Throws with the first problem found. */
export function validateManifest(value: unknown): CdTrack[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.tracks))
    throw new Error("manifest.json: expected { version: 1, tracks: [...] }");
  return value.tracks.map((track: unknown, i) => {
    if (
      !isRecord(track) ||
      !Number.isSafeInteger(track.disc) ||
      !Number.isSafeInteger(track.track) ||
      typeof track.kind !== "string" ||
      (track.songId !== undefined && typeof track.songId !== "string") ||
      typeof track.audio !== "string" ||
      !AUDIO_PATH.test(track.audio)
    )
      throw new Error(`manifest.json tracks[${i}]: not a track of the CD`);
    return track as unknown as CdTrack;
  });
}

/**
 * The story told before each piece, by song id: the audio of the `story`
 * tracks between the piece and the track before it that is not a story, in
 * order. On disc 1 that is the track just before each piece, and for the
 * first piece (track 3) the opening story too, tracks 1 and 2. The closing
 * story after the last piece leads into none.
 */
export function storiesBySong(tracks: readonly CdTrack[]) {
  const byNumber = new Map(tracks.map((t) => [`${t.disc}/${t.track}`, t]));
  const stories = new Map<string, readonly string[]>();
  for (const piece of tracks) {
    if (piece.kind !== "song" || !piece.songId) continue;
    const story: string[] = [];
    for (let n = piece.track - 1; ; n--) {
      const track = byNumber.get(`${piece.disc}/${n}`);
      if (track?.kind !== "story") break;
      story.unshift(track.audio);
    }
    if (story.length) stories.set(piece.songId, story);
  }
  return stories;
}

/**
 * Plays the story before a piece, one track after another. The manifest
 * loads once per page; a story's tracks load only when it plays, and the last
 * few stay in memory as object URLs until dispose().
 */
export class StoryPlayer {
  /** The song whose story is loading or playing, or "" for none. */
  playing = "";
  private stories: Map<string, readonly string[]> | null = null;
  private manifest: Promise<void> | null = null;
  /** Changes on every stop, so a story stopped meanwhile goes no further. */
  private generation = 0;
  private download: AbortController | null = null;
  private element: HTMLAudioElement | null = null;
  /** Ends the wait for the track playing now, as the story stops. */
  private settle: (() => void) | null = null;
  /** Object URLs of fetched tracks by path, least recently played first. */
  private urls = new Map<string, string>();
  private revision = 0;
  private listeners = new Set<() => void>();

  constructor(
    /** The URL of a file in the cd-audio bucket. */
    private url: (path: string) => string,
    /** fetch() as the signed-in user: signedInFetch(). */
    private fetcher: () => Promise<typeof fetch>,
    private createAudio: () => HTMLAudioElement = () => new Audio(),
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.revision;
  private emit() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  /**
   * Load the manifest, once per page. While it loads, or if it cannot, no
   * piece has a story; a failed load is tried again on the next call.
   */
  load() {
    this.manifest ??= this.fetcher()
      .then((get) => get(this.url(CD_MANIFEST)))
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`${CD_MANIFEST}: HTTP ${response.status}`);
        this.stories = storiesBySong(validateManifest(await response.json()));
        this.emit();
      })
      .catch(() => {
        this.manifest = null;
      });
  }

  /** Whether the CD tells a story before the song's piece. */
  has(songId: string) {
    return !!this.stories?.has(songId);
  }

  /**
   * Play the story before the song's piece. Resolves once it has played to
   * the end or stopped; rejects, stopped, if its audio cannot load or play.
   */
  async play(songId: string) {
    this.stop();
    const paths = this.stories?.get(songId);
    if (!paths) return;
    const generation = this.generation;
    const download = new AbortController();
    this.download = download;
    this.playing = songId;
    this.emit();
    try {
      const get = await this.fetcher();
      // Every track first, so the next one starts as soon as one ends.
      const urls = await Promise.all(
        paths.map((path) => this.track(path, get, download.signal)),
      );
      for (const url of urls) {
        if (generation !== this.generation) return;
        await this.sound(url);
      }
    } catch (error) {
      if (generation === this.generation) throw error;
    } finally {
      if (generation === this.generation) this.stop();
    }
  }

  /** Stop the story, or its download. */
  stop() {
    this.generation++;
    this.download?.abort();
    this.download = null;
    this.element?.pause();
    this.settle?.();
    if (this.playing) {
      this.playing = "";
      this.emit();
    }
  }

  /** Stop, and free the tracks kept in memory: as the studio closes. */
  dispose() {
    this.stop();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    if (this.element) {
      this.element.removeAttribute("src");
      this.element.load();
      this.element = null;
    }
  }

  /** The object URL of a track's audio, fetched unless still kept. */
  private async track(path: string, get: typeof fetch, signal: AbortSignal) {
    let url = this.urls.get(path);
    if (!url) {
      const response = await get(this.url(path), { signal });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      const blob = await response.blob();
      url = this.urls.get(path) ?? URL.createObjectURL(blob);
    }
    // The tracks of the story starting now are the latest, so the oldest
    // that go are never among them.
    this.urls.delete(path);
    this.urls.set(path, url);
    for (const [kept, keptUrl] of this.urls) {
      if (this.urls.size <= KEPT_TRACKS) break;
      URL.revokeObjectURL(keptUrl);
      this.urls.delete(kept);
    }
    return url;
  }

  /** Play one track: resolves when it ends or the story stops. */
  private sound(url: string) {
    const element = (this.element ??= this.createAudio());
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (failure?: { error: unknown }) => {
        if (settled) return;
        settled = true;
        element.removeEventListener("ended", ended);
        element.removeEventListener("error", failed);
        if (this.settle === ended) this.settle = null;
        if (failure) reject(failure.error);
        else resolve();
      };
      const ended = () => done();
      const failed = () => done({ error: element.error });
      this.settle = ended;
      element.addEventListener("ended", ended);
      element.addEventListener("error", failed);
      element.src = url;
      // A play() that stop() interrupts fails after the wait has ended, so
      // only a real failure counts.
      element.play().catch((error: unknown) => done({ error }));
    });
  }
}
