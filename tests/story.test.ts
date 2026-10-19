import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CD_MANIFEST,
  StoryPlayer,
  storiesBySong,
  validateManifest,
} from "../src/story";

const audio = (disc: number, track: number) =>
  `mflm-3/disc-${disc}/${String(track).padStart(2, "0")}.mp3`;
/**
 * The manifest scripts/cd-audio.mjs uploads: disc 1 has the 42 pieces of
 * Lesson Book 3 on tracks 3, 5, ... 85 and the story on the others; disc 2 is
 * the Discovery book.
 */
function manifest() {
  const tracks = [];
  for (let track = 1; track <= 86; track++) {
    const song = track % 2 === 1 && track >= 3 && track <= 85;
    tracks.push({
      disc: 1,
      track,
      title: `Track ${track}`,
      kind: song ? "song" : "story",
      ...(song && { songId: `piece-${(track - 1) / 2}` }),
      audio: audio(1, track),
      bytes: 1000,
      sha256: "0".repeat(64),
    });
  }
  for (let track = 1; track <= 26; track++)
    tracks.push({
      disc: 2,
      track,
      title: `Discovery ${track}`,
      kind: "discovery",
      audio: audio(2, track),
      bytes: 1000,
      sha256: "0".repeat(64),
    });
  return { version: 1, title: "Music for Little Mozarts", tracks };
}

describe("the CD's manifest", () => {
  it("gives each piece the story track just before it", () => {
    const stories = storiesBySong(validateManifest(manifest()));
    expect(stories.get("piece-2")).toEqual([audio(1, 4)]);
    expect(stories.get("piece-21")).toEqual([audio(1, 42)]);
    expect(stories.get("piece-42")).toEqual([audio(1, 84)]);
    expect(stories.size).toBe(42);
  });

  it("gives the first piece the opening story, then the one leading into it", () => {
    const stories = storiesBySong(validateManifest(manifest()));
    expect(stories.get("piece-1")).toEqual([audio(1, 1), audio(1, 2)]);
  });

  it("leaves out the closing story, the Discovery book and Recital Book 3", () => {
    const stories = storiesBySong(validateManifest(manifest()));
    const told = [...stories.values()].flat();
    expect(told).not.toContain(audio(1, 86));
    expect(told.some((path) => path.includes("disc-2"))).toBe(false);
    // The CD has no Recital Book 3 tracks, so its songs have no story.
    expect(stories.has("cadence-dancing-raindrops-v1")).toBe(false);
  });

  it("gives a piece with no story before it none", () => {
    const tracks = validateManifest({
      version: 1,
      tracks: [
        { disc: 1, track: 1, kind: "song", songId: "a", audio: audio(1, 1) },
        { disc: 1, track: 2, kind: "song", songId: "b", audio: audio(1, 2) },
      ],
    });
    expect(storiesBySong(tracks).size).toBe(0);
  });

  it("refuses a manifest that is not the CD's", () => {
    expect(() => validateManifest({ tracks: [] })).toThrow(/version: 1/);
    expect(() => validateManifest({ version: 1, tracks: [null] })).toThrow(
      /tracks\[0\]/,
    );
    const track = { disc: 1, track: 2, kind: "story" };
    for (const path of [
      "../library/index.json",
      "https://example.com/02.mp3",
      "mflm-3/../disc-1/02.mp3",
      "/mflm-3/disc-1/02.mp3",
      "mflm-3/disc-1/02.wav",
    ])
      expect(() =>
        validateManifest({ version: 1, tracks: [{ ...track, audio: path }] }),
      ).toThrow(/not a track/);
    expect(() =>
      validateManifest({
        version: 1,
        tracks: [{ ...track, songId: 3, audio: audio(1, 2) }],
      }),
    ).toThrow(/not a track/);
  });
});

/** An audio element that plays at once, and ends when a test says so. */
class FakeAudio extends EventTarget {
  src = "";
  paused = true;
  error: { code: number } | null = null;
  /** Set to make play() fail, as a browser that refuses it. */
  refuse: Error | null = null;
  play = vi.fn(async () => {
    if (this.refuse) throw this.refuse;
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  load = vi.fn();
  end() {
    this.paused = true;
    this.dispatchEvent(new Event("ended"));
  }
}

const URL_BASE = "https://project.supabase.test/cd-audio/";

describe("the story player", () => {
  let element: FakeAudio | undefined;
  let elements: FakeAudio[];
  /** Answers by path; any other track is its path as audio. */
  let responses: Map<string, () => Response>;
  let get: ReturnType<typeof vi.fn<typeof fetch>>;
  let signedIn: ReturnType<typeof vi.fn<() => Promise<typeof fetch>>>;
  let revoked: string[];

  /** Paths fetched, in order. */
  const fetched = () =>
    get.mock.calls.map(([input]) => String(input).slice(URL_BASE.length));
  function player() {
    return new StoryPlayer(
      (path) => URL_BASE + path,
      signedIn,
      () => {
        element = new FakeAudio();
        elements.push(element);
        return element as unknown as HTMLAudioElement;
      },
    );
  }
  async function loaded() {
    const story = player();
    story.load();
    await vi.waitFor(() => expect(story.has("piece-2")).toBe(true));
    return story;
  }
  /** Wait until the element plays the track at `path`. */
  const playing = (path: string) =>
    vi.waitFor(() => {
      expect(element?.src).toBe(`blob:${path}`);
      expect(element?.paused).toBe(false);
    });
  /** Play a story to its end. */
  async function playThrough(story: StoryPlayer, songId: string) {
    const played = story.play(songId);
    await vi.waitFor(() => expect(element?.paused).toBe(false));
    element!.end();
    await played;
  }

  beforeEach(() => {
    element = undefined;
    elements = [];
    responses = new Map([[CD_MANIFEST, () => Response.json(manifest())]]);
    const tracks = new Map<Blob, string>();
    get = vi.fn<typeof fetch>(async (input) => {
      const path = String(input).slice(URL_BASE.length);
      const respond = responses.get(path);
      if (respond) return respond();
      const blob = new Blob([path], { type: "audio/mpeg" });
      tracks.set(blob, path);
      return { ok: true, status: 200, blob: async () => blob } as Response;
    });
    signedIn = vi.fn(async () => get);
    revoked = [];
    // Each object URL names the track it holds.
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      (blob) => `blob:${tracks.get(blob as Blob)}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revoked.push(url);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the manifest once, as the signed-in user", async () => {
    const story = player();
    expect(story.has("piece-2")).toBe(false);
    const changed = vi.fn();
    const unsubscribe = story.subscribe(changed);
    const before = story.snapshot();
    story.load();
    story.load();
    await vi.waitFor(() => expect(story.has("piece-2")).toBe(true));
    story.load();
    expect(fetched()).toEqual([CD_MANIFEST]);
    expect(signedIn).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
    expect(story.snapshot()).not.toBe(before);
    expect(story.has("cadence-dancing-raindrops-v1")).toBe(false);
    unsubscribe();
    void story.play("piece-2");
    story.stop();
    expect(changed).toHaveBeenCalledOnce();
  });

  it("has no stories while the manifest cannot load, and tries again next time", async () => {
    responses.set(CD_MANIFEST, () => new Response("down", { status: 503 }));
    const story = player();
    story.load();
    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve));
    expect(story.has("piece-2")).toBe(false);
    // Nothing to play.
    await story.play("piece-2");
    expect(story.playing).toBe("");

    responses.set(CD_MANIFEST, () => Response.json({ version: 2 }));
    story.load();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve));
    expect(story.has("piece-2")).toBe(false);

    responses.set(CD_MANIFEST, () => Response.json(manifest()));
    story.load();
    await vi.waitFor(() => expect(story.has("piece-2")).toBe(true));
    expect(fetched()).toEqual([CD_MANIFEST, CD_MANIFEST, CD_MANIFEST]);
  });

  it("fetches a story only to play it, and plays its tracks in order", async () => {
    const story = await loaded();
    expect(fetched()).toEqual([CD_MANIFEST]);
    const changed = vi.fn();
    story.subscribe(changed);

    const done = vi.fn();
    void story.play("piece-1").then(done);
    expect(story.playing).toBe("piece-1");
    expect(changed).toHaveBeenCalledOnce();
    await playing(audio(1, 1));
    expect(fetched().slice(1).sort()).toEqual([audio(1, 1), audio(1, 2)]);
    element!.end();
    await playing(audio(1, 2));
    expect(story.playing).toBe("piece-1");
    expect(done).not.toHaveBeenCalled();
    element!.end();
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(story.playing).toBe("");
    expect(changed).toHaveBeenCalledTimes(2);
    // One element plays every track, apart from the piano's Web Audio.
    expect(elements).toHaveLength(1);
  });

  it("stops at once, mid-track or while its audio downloads", async () => {
    const story = await loaded();
    const first = story.play("piece-2");
    await playing(audio(1, 4));
    story.stop();
    await expect(first).resolves.toBeUndefined();
    expect(element!.pause).toHaveBeenCalled();
    expect(element!.paused).toBe(true);
    expect(story.playing).toBe("");

    // A story stopped while it downloads never plays.
    let signal: AbortSignal | undefined;
    get.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init!.signal!;
          signal.addEventListener("abort", () => reject(signal!.reason));
        }),
    );
    const second = story.play("piece-3");
    await vi.waitFor(() => expect(signal).toBeDefined());
    story.stop();
    await expect(second).resolves.toBeUndefined();
    expect(signal!.aborted).toBe(true);
    expect(element!.play).toHaveBeenCalledOnce();
    expect(story.playing).toBe("");
  });

  it("plays one story at a time", async () => {
    const story = await loaded();
    const first = story.play("piece-2");
    await playing(audio(1, 4));
    const second = story.play("piece-3");
    await expect(first).resolves.toBeUndefined();
    expect(story.playing).toBe("piece-3");
    await playing(audio(1, 6));
    element!.end();
    await second;
    expect(story.playing).toBe("");
  });

  it("keeps the last few tracks for a story played again, and frees the rest", async () => {
    const story = await loaded();
    await playThrough(story, "piece-2");
    await playThrough(story, "piece-2");
    expect(fetched()).toEqual([CD_MANIFEST, audio(1, 4)]);

    for (const piece of [3, 4, 5]) await playThrough(story, `piece-${piece}`);
    expect(revoked).toEqual([]);
    await playThrough(story, "piece-6");
    // A fifth track: the one played longest ago goes.
    expect(revoked).toEqual([`blob:${audio(1, 4)}`]);
    await playThrough(story, "piece-3");
    expect(fetched()).toHaveLength(6);

    story.dispose();
    expect(revoked.sort()).toEqual(
      [4, 6, 8, 10, 12].map((track) => `blob:${audio(1, track)}`),
    );
    expect(elements[0].removeAttribute).toHaveBeenCalledWith("src");
    expect(elements[0].load).toHaveBeenCalled();
    // The manifest stays for the page; the next story fetches its audio again.
    await playThrough(story, "piece-3");
    expect(fetched().at(-1)).toBe(audio(1, 6));
    expect(elements).toHaveLength(2);
  });

  it("rejects, stopped, when its audio cannot load or play", async () => {
    const story = await loaded();
    responses.set(audio(1, 4), () => new Response("down", { status: 503 }));
    await expect(story.play("piece-2")).rejects.toThrow(/HTTP 503/);
    expect(story.playing).toBe("");

    signedIn.mockRejectedValueOnce(new Error("Sign in to load the songs."));
    await expect(story.play("piece-3")).rejects.toThrow(/Sign in/);
    expect(story.playing).toBe("");

    // A track the browser cannot decode.
    const broken = story.play("piece-3");
    await playing(audio(1, 6));
    element!.error = { code: 4 };
    element!.dispatchEvent(new Event("error"));
    await expect(broken).rejects.toEqual({ code: 4 });
    expect(story.playing).toBe("");

    // A browser that will not play it.
    element!.refuse = new Error("NotAllowedError");
    await expect(story.play("piece-4")).rejects.toThrow("NotAllowedError");
    expect(story.playing).toBe("");
  });
});
