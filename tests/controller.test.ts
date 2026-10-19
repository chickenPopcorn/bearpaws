import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "../src/controller";
import type { Song } from "../src/song";
import { fixtureLibrary } from "./fixtures/library";

const env = vi.hoisted(() => ({
  now: 100,
  values: new Map<string, unknown>(),
  resets: [] as (() => void)[],
  unlockWait: null as Promise<void> | null,
  prepareWait: null as Promise<void> | null,
  /** What each studio does when another tab changes stored practice. */
  watchers: new Set<() => void>(),
}));

vi.mock("../src/audio", () => ({
  ReferenceAudio: class {
    origin: number | null = null;
    now = () => (this.origin === null ? env.now : env.now - this.origin);
    eventTime(timestamp: number) {
      return this.now() + timestamp / 1000 - env.now;
    }
    unlock = vi.fn(async () => {
      this.origin ??= env.now;
      if (env.unlockWait) await env.unlockWait;
    });
    prepare = vi.fn(async (_notes?: unknown, _signal?: AbortSignal) => {
      if (env.prepareWait) await env.prepareWait;
    });
    setPlaybackNotes = vi.fn();
    setSound = vi.fn();
    stop = vi.fn();
    reschedule = vi.fn();
    schedule = vi.fn();
    tone = vi.fn();
  },
}));
vi.mock("../src/midi", () => ({
  MidiConnection: class {
    status = "disconnected";
    message = "No piano";
    devices = [];
    selectedId = "";
    constructor(callbacks: { onReset(): void }) {
      env.resets.push(callbacks.onReset);
    }
    connect = vi.fn(async () => {});
    autoConnect = vi.fn(async () => {});
    select = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("../src/storage", () => ({
  DAILY_GOAL_CHOICES: [5, 10, 15, 20, 30],
  LEARNER_NAME_MAX: 40,
  settings: () => ({
    mode: "wait",
    speed: 1,
    left: true,
    right: true,
    tolerance: 0.22,
    reference: true,
    names: true,
    selected: "cadence-ode-to-joy-v1",
    ambience: 0.22,
    pianoVoices: {
      release: true,
      keyNoise: true,
      pedalNoise: true,
      resonance: true,
    },
    learnerName: "",
    dailyGoalMinutes: 5,
    ...((env.values.get("settings") as object) ?? {}),
  }),
  read: (key: string, fallback: unknown) =>
    env.values.has(key) ? structuredClone(env.values.get(key)) : fallback,
  write: (key: string, value: unknown) => {
    env.values.set(key, structuredClone(value));
    return true;
  },
  readAll: (prefix: string) =>
    [...env.values]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => structuredClone(value)),
  remove: (key: string) => env.values.delete(key),
  watchStored: (_prefix: string, onChange: () => void) => {
    env.watchers.add(onChange);
    return () => env.watchers.delete(onChange);
  },
  progress: (id: string, _duration: number) =>
    structuredClone({
      position: 0,
      best: 0,
      attempts: 0,
      updated: "",
      assignments: {},
      loop: null,
      loopEnabled: true,
      ...((env.values.get(`progress:${id}`) as object) ?? {}),
    }),
}));

function song(pitches: [number, number][], id = "controller-fixture"): Song {
  return {
    id,
    title: "Integration exercise",
    duration: 4,
    ppq: 480,
    warnings: [],
    tempos: [],
    tracks: [
      { id: 0, name: "Right hand", hand: "right", count: pitches.length },
    ],
    notes: pitches.map(([pitch, start], i) => ({
      id: `note-${i}`,
      pitch,
      start,
      end: start + 0.3,
      soundEnd: start + 0.3,
      track: 0,
      channel: 0,
      velocity: 0.7,
    })),
  };
}
const active: Studio[] = [];
function create(fixture?: Song) {
  const studio = new Studio(fixtureLibrary());
  active.push(studio);
  if (fixture) studio.load(fixture);
  studio.speed(1);
  return studio;
}
function advance(studio: Studio, seconds: number) {
  env.now += seconds;
  studio.tick();
}
function midi(studio: Studio, data: number[], delay = 0) {
  studio.receive(new Uint8Array(data), (env.now - delay) * 1000);
}

beforeEach(() => {
  env.now = 100;
  env.values.clear();
  env.watchers.clear();
  env.resets = [];
  env.unlockWait = null;
  env.prepareWait = null;
  vi.spyOn(performance, "now").mockImplementation(() => env.now * 1000);
});
afterEach(() => {
  for (const studio of active.splice(0)) studio.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("practice studio integration", () => {
  it("restarts a passage still loading without a voice turned off", async () => {
    const studio = create(
      song([
        [60, 0],
        [64, 2],
      ]),
    );
    studio.mode("listen");
    let finish!: () => void;
    env.prepareWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const playing = studio.play();
    await vi.waitFor(() => expect(studio.audio.prepare).toHaveBeenCalledOnce());
    const [, signal] = vi.mocked(studio.audio.prepare).mock.calls[0];
    studio.pianoVoice("resonance", false);
    // The loading voice's recordings are no longer waited for.
    expect(signal!.aborted).toBe(true);
    await vi.waitFor(() =>
      expect(studio.audio.prepare).toHaveBeenCalledTimes(2),
    );
    finish();
    await playing;
    await vi.waitFor(() => expect(studio.transport.playing).toBe(true));
    expect(studio.position).toBe(0);
  });

  it("restores sound preferences before audio starts and preserves them across songs", () => {
    env.values.set("settings", { ambience: 0.43 });
    const studio = create();
    expect(studio.audio.setSound).toHaveBeenCalledWith({
      ambience: 0.43,
      voices: studio.settings.pianoVoices,
    });
    studio.sound(0.31);
    studio.load(fixtureLibrary()[1]);
    expect(studio.settings).toMatchObject({
      ambience: 0.31,
    });
    const restored = create();
    expect(restored.audio.setSound).toHaveBeenCalledWith({
      ambience: 0.31,
      voices: restored.settings.pianoVoices,
    });
  });

  it("turns optional piano voices off live, and replays from here to load one turned on", async () => {
    const studio = create(
      song([
        [60, 0],
        [64, 2],
      ]),
    );
    studio.mode("listen");
    await studio.play();
    advance(studio, 0.2);
    const position = studio.position;
    vi.mocked(studio.audio.prepare).mockClear();
    studio.pianoVoice("resonance", false);
    const off = {
      release: true,
      keyNoise: true,
      pedalNoise: true,
      resonance: false,
    };
    expect(studio.audio.setSound).toHaveBeenLastCalledWith({ voices: off });
    expect(env.values.get("settings")).toMatchObject({ pianoVoices: off });
    expect(studio.transport.playing).toBe(true);
    expect(studio.audio.prepare).not.toHaveBeenCalled();
    studio.pianoVoice("resonance", true);
    expect(studio.transport.playing).toBe(false);
    await vi.waitFor(() => expect(studio.transport.playing).toBe(true));
    expect(studio.audio.prepare).toHaveBeenCalledOnce();
    expect(studio.position).toBeCloseTo(position);
    expect(studio.settings.pianoVoices.resonance).toBe(true);
  });

  it("changes sound live without interrupting playback or resetting practice", async () => {
    const studio = create(
      song([
        [60, 0],
        [64, 2],
      ]),
    );
    studio.mode("listen");
    await studio.play();
    advance(studio, 0.2);
    const position = studio.position;
    const epoch = studio.scoringEpoch;
    const practice = studio.practice;
    vi.mocked(studio.audio.stop).mockClear();
    vi.mocked(studio.audio.prepare).mockClear();
    studio.sound(0.6);
    expect(studio.audio.setSound).toHaveBeenLastCalledWith({
      ambience: 0.6,
    });
    expect(studio.audio.stop).not.toHaveBeenCalled();
    expect(studio.audio.prepare).not.toHaveBeenCalled();
    expect(studio.transport.playing).toBe(true);
    expect(studio.position).toBe(position);
    expect(studio.scoringEpoch).toBe(epoch);
    expect(studio.practice).toBe(practice);
  });

  it("keeps a pending playback preparation alive when sound changes", async () => {
    const studio = create(
      song([
        [60, 0],
        [64, 2],
      ]),
    );
    studio.mode("listen");
    let finish!: () => void;
    env.prepareWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const playing = studio.play();
    await vi.waitFor(() => expect(studio.audio.prepare).toHaveBeenCalledOnce());
    const signal = vi.mocked(studio.audio.prepare).mock.calls[0][1]!;
    studio.sound(0);
    expect(signal.aborted).toBe(false);
    finish();
    await playing;
    expect(studio.transport.playing).toBe(true);
  });

  it("initializes once and recreates MIDI after the studio is restarted", async () => {
    const studio = create();
    const originalMidi = studio.midi;
    studio.init();
    const timer = studio.timer;
    studio.init();
    expect(originalMidi.autoConnect).toHaveBeenCalledOnce();
    expect(studio.timer).toBe(timer);
    studio.destroy();
    expect(studio.timer).toBeNull();
    expect(originalMidi.dispose).toHaveBeenCalledOnce();
    studio.init();
    expect(studio.midi).not.toBe(originalMidi);
    expect(studio.midi.autoConnect).toHaveBeenCalledOnce();
    await studio.midi.connect();
    expect(studio.midi.connect).toHaveBeenCalledOnce();
    expect(studio.timer).not.toBeNull();
  });

  it("loads the studio while automatic MIDI connection is still pending", async () => {
    const studio = create();
    vi.mocked(studio.midi.autoConnect).mockReturnValue(
      new Promise<void>(() => {}),
    );
    studio.init();
    expect(studio.timer).not.toBeNull();
    expect(studio.songs.length).toBeGreaterThan(0);
    expect(studio.midi.autoConnect).toHaveBeenCalledOnce();
  });

  it.each(["song", "mode", "seek", "pause"] as const)(
    "cancels pending sample preparation when %s changes",
    async (change) => {
      const studio = create(song([[60, 1]]));
      studio.mode("listen");
      let finish!: () => void;
      env.prepareWait = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const starting = studio.play();
      await vi.waitFor(() =>
        expect(studio.audio.prepare).toHaveBeenCalledOnce(),
      );
      if (change === "song") studio.load(song([[62, 1]], "replacement"));
      else if (change === "mode") studio.mode("rhythm");
      else if (change === "seek") studio.seek(2);
      else studio.pause();
      expect(vi.mocked(studio.audio.prepare).mock.calls[0][1]?.aborted).toBe(
        true,
      );
      finish();
      await starting;
      expect(studio.transport.playing).toBe(false);
      expect(studio.progress.attempts).toBe(0);
    },
  );

  it("does not duplicate a virtual note released and re-pressed during sample loading", async () => {
    const studio = create(song([[60, 1]]));
    let finish!: () => void;
    env.prepareWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    studio.virtual(60, true);
    studio.virtual(60, false);
    studio.virtual(60, true);
    await vi.waitFor(() =>
      expect(studio.audio.prepare).toHaveBeenCalledTimes(2),
    );
    finish();
    await vi.waitFor(() => expect(studio.audio.tone).toHaveBeenCalledOnce());
  });

  it.each(["listen", "rhythm"] as const)(
    "handles a bound MIDI source reset while %s samples are preparing",
    async (mode) => {
      const studio = create(song([[60, 1]]));
      studio.mode(mode);
      let finish!: () => void;
      env.prepareWait = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const starting = studio.play();
      await vi.waitFor(() =>
        expect(studio.audio.prepare).toHaveBeenCalledOnce(),
      );
      const signal = vi.mocked(studio.audio.prepare).mock.calls[0][1]!;
      studio.input.message(new Uint8Array([0x90, 60, 100]));
      env.resets.at(-1)!();
      expect(studio.input.down.size).toBe(0);
      expect(signal.aborted).toBe(mode === "rhythm");
      if (mode === "rhythm")
        expect(studio.notice).toMatch(/Piano connection changed.*Press Play/);
      finish();
      await starting;
      expect(studio.transport.playing).toBe(mode === "listen");
      expect(studio.progress.attempts).toBe(mode === "listen" ? 1 : 0);
    },
  );

  it("keeps concurrent playback, preview, and virtual-key preparations until the session changes", async () => {
    const studio = create(song([[60, 1]]));
    studio.mode("listen");
    let finish!: () => void;
    env.prepareWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const starting = studio.play();
    await vi.waitFor(() => expect(studio.audio.prepare).toHaveBeenCalledOnce());
    const preview = studio.preview();
    studio.virtual(63, true);
    await vi.waitFor(() =>
      expect(studio.audio.prepare).toHaveBeenCalledTimes(3),
    );
    const signals = vi
      .mocked(studio.audio.prepare)
      .mock.calls.map((call) => call[1]!);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    studio.pause();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    finish();
    await Promise.all([starting, preview]);
    expect(studio.transport.playing).toBe(false);
  });

  it.each(["seek", "disconnect"] as const)(
    "does not play a prepared chord after %s invalidates the preview",
    async (change) => {
      const studio = create(song([[60, 1]]));
      let finish!: () => void;
      env.prepareWait = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const preview = studio.preview();
      await vi.waitFor(() =>
        expect(studio.audio.prepare).toHaveBeenCalledOnce(),
      );
      if (change === "seek") studio.seek(2);
      else env.resets.at(-1)!();
      finish();
      await preview;
      expect(studio.audio.tone).not.toHaveBeenCalled();
      expect(studio.transport.playing).toBe(false);
    },
  );

  it.each(["play", "preview", "virtual"] as const)(
    "reports sample preparation failure during %s without starting sound",
    async (action) => {
      const studio = create(song([[60, 1]]));
      if (action === "play") studio.mode("listen");
      vi.mocked(studio.audio.prepare).mockRejectedValueOnce(
        new Error("Unable to load sample"),
      );
      if (action === "virtual") studio.virtual(60, true);
      else await studio[action]();
      await vi.waitFor(() => expect(studio.notice).toMatch(/try.*again/i));
      expect(studio.audio.tone).not.toHaveBeenCalled();
      expect(studio.transport.playing).toBe(false);
      expect(studio.progress.attempts).toBe(0);
    },
  );

  it.each([1, 1.4])(
    "lets the final piano release finish naturally at %sx speed, while explicit pause still stops it",
    async (speed) => {
      const studio = create(song([[60, 3.5]]));
      studio.loop(false);
      studio.mode("listen");
      studio.speed(speed);
      await studio.play();
      vi.mocked(studio.audio.stop).mockClear();
      advance(studio, 4 / speed + 0.001);
      expect(studio.transport.playing).toBe(false);
      expect(studio.notice).toBe("");
      expect(studio.audio.stop).not.toHaveBeenCalled();
      studio.pause();
      expect(studio.audio.stop).toHaveBeenCalledOnce();
    },
  );

  it("moves only waiting reference notes to a new speed during playback", async () => {
    const studio = create(
      song([
        [60, 0],
        [64, 2],
      ]),
    );
    studio.mode("listen");
    await studio.play();
    advance(studio, 0.2);
    vi.mocked(studio.audio.stop).mockClear();
    studio.speed(0.5);
    expect(studio.audio.reschedule).toHaveBeenCalledOnce();
    expect(studio.audio.stop).not.toHaveBeenCalled();
    expect(studio.transport.playing).toBe(true);
    studio.pause();
    vi.mocked(studio.audio.stop).mockClear();
    studio.speed(1);
    expect(studio.audio.stop).toHaveBeenCalledExactlyOnceWith();
    expect(studio.audio.reschedule).toHaveBeenCalledOnce();
  });

  it("keeps sounding notes when loop bounds change while the loop is off", async () => {
    const studio = create(
      song([
        [60, 0.5],
        [63, 1.5],
      ]),
    );
    studio.mode("listen");
    studio.loop(false);
    await studio.play();
    advance(studio, 0.6);
    vi.mocked(studio.audio.stop).mockClear();
    studio.bounds(0, 3);
    expect(studio.transport.playing).toBe(true);
    expect(studio.audio.stop).not.toHaveBeenCalled();
    expect(studio.transport.loop).toBeNull();
  });

  it.each(["speed", "seek", "loop wrap"] as const)(
    "retains prepared passage recordings through %s during playback",
    async (change) => {
      const studio = create(
        song([
          [60, 0.5],
          [63, 1.5],
        ]),
      );
      studio.mode("listen");
      if (change === "loop wrap") {
        studio.bounds(0, 2);
        studio.loop(true);
      }
      await studio.play();
      vi.mocked(studio.audio.stop).mockClear();
      if (change === "speed") studio.speed(0.75);
      else if (change === "seek") studio.seek(1);
      else advance(studio, 2.1);
      expect(studio.transport.playing).toBe(true);
      if (change === "seek")
        expect(studio.audio.stop).toHaveBeenCalledWith(false);
      expect(
        vi
          .mocked(studio.audio.stop)
          .mock.calls.every(([release]) => release === false),
      ).toBe(true);
      expect(studio.audio.setPlaybackNotes).not.toHaveBeenCalledWith([]);
    },
  );

  it.each(["disable", "expand", "enable"] as const)(
    "loads the new passage scope before resuming when loop is changed: %s",
    async (change) => {
      const studio = create(
        song([
          [60, 0.5],
          [63, 2.5],
        ]),
      );
      studio.mode("listen");
      studio.bounds(0, 1.5);
      if (change === "enable") studio.loop(false);
      await studio.play();
      advance(studio, 0.25);
      vi.mocked(studio.audio.prepare).mockClear();
      vi.mocked(studio.audio.setPlaybackNotes).mockClear();
      let finish!: () => void;
      env.prepareWait = new Promise<void>((resolve) => {
        finish = resolve;
      });
      if (change === "disable") studio.loop(false);
      else if (change === "expand") studio.bounds(0, 3);
      else studio.loop(true);
      expect(studio.transport.playing).toBe(false);
      const position = change === "disable" ? 0.25 : 0;
      expect(studio.position).toBeCloseTo(position);
      await vi.waitFor(() =>
        expect(studio.audio.prepare).toHaveBeenCalledOnce(),
      );
      const prepared = change === "enable" ? [studio.notes[0]] : studio.notes;
      expect(studio.audio.prepare).toHaveBeenCalledWith(
        prepared,
        expect.any(AbortSignal),
        [],
      );
      advance(studio, 1);
      expect(studio.position).toBeCloseTo(position);
      expect(studio.audio.setPlaybackNotes).not.toHaveBeenCalled();
      finish();
      await vi.waitFor(() => expect(studio.transport.playing).toBe(true));
      expect(studio.audio.setPlaybackNotes).toHaveBeenCalledWith(prepared, []);
      expect(studio.position).toBeCloseTo(position);
    },
  );

  it("resumes the latest loop range after repeated edits while samples load", async () => {
    const studio = create(
      song([
        [60, 0.5],
        [63, 2.5],
      ]),
    );
    studio.mode("listen");
    studio.bounds(0, 1.5);
    studio.loop(true);
    await studio.play();
    vi.mocked(studio.audio.prepare).mockClear();
    vi.mocked(studio.audio.setPlaybackNotes).mockClear();
    let finishFirst!: () => void, finishLatest!: () => void;
    env.prepareWait = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    studio.bounds(0, 2);
    await vi.waitFor(() =>
      expect(studio.audio.prepare).toHaveBeenCalledTimes(1),
    );
    const firstPreparation = vi.mocked(studio.audio.prepare).mock.results[0]
      .value;
    env.prepareWait = new Promise<void>((resolve) => {
      finishLatest = resolve;
    });
    studio.bounds(0, 3);
    await vi.waitFor(() =>
      expect(studio.audio.prepare).toHaveBeenCalledTimes(2),
    );
    finishFirst();
    await firstPreparation;
    await Promise.resolve();
    expect(studio.transport.playing).toBe(false);
    expect(studio.audio.setPlaybackNotes).not.toHaveBeenCalled();
    finishLatest();
    await vi.waitFor(() => expect(studio.transport.playing).toBe(true));
    expect(studio.transport.loop).toEqual([0, 3]);
    expect(studio.audio.setPlaybackNotes).toHaveBeenCalledExactlyOnceWith(
      studio.notes,
      [],
    );
  });

  it.each(["pause", "seek", "mode", "song"] as const)(
    "cancels loop-resume intent after an explicit %s during preparation",
    async (change) => {
      const studio = create(
        song([
          [60, 0.5],
          [63, 2.5],
        ]),
      );
      studio.mode("listen");
      studio.bounds(0, 1.5);
      studio.loop(true);
      await studio.play();
      vi.mocked(studio.audio.prepare).mockClear();
      let finish!: () => void;
      env.prepareWait = new Promise<void>((resolve) => {
        finish = resolve;
      });
      studio.bounds(0, 3);
      await vi.waitFor(() =>
        expect(studio.audio.prepare).toHaveBeenCalledOnce(),
      );
      const preparation = vi.mocked(studio.audio.prepare).mock.results[0].value;
      if (change === "pause") studio.pause();
      else if (change === "seek") studio.seek(1);
      else if (change === "mode") studio.mode("wait");
      else studio.load(song([[65, 0.5]], "replacement"));
      studio.bounds(0, 2.8);
      finish();
      await preparation;
      await Promise.resolve();
      expect(studio.transport.playing).toBe(false);
      expect(studio.audio.prepare).toHaveBeenCalledOnce();
    },
  );

  it("prepares sustained notes overlapping a loop boundary without adding scoring targets", async () => {
    const fixture = song([
      [60, 0.5],
      [63, 2.5],
    ]);
    fixture.notes[0].soundEnd = 1.5;
    const studio = create(fixture);
    studio.mode("listen");
    studio.bounds(1, 3);
    studio.loop(true);
    expect(studio.scoringNotes).toEqual([studio.notes[1]]);
    await studio.play();
    expect(studio.audio.prepare).toHaveBeenCalledExactlyOnceWith(
      studio.notes,
      expect.any(AbortSignal),
      [],
    );
    expect(studio.audio.setPlaybackNotes).toHaveBeenCalledWith(
      studio.notes,
      [],
    );
    expect(studio.position).toBe(1);
  });

  it.each(["wait", "rhythm"] as const)(
    "starts %s practice without loading or pinning the sample bank when reference is off",
    async (mode) => {
      const studio = create(
        song([
          [60, 0.5],
          [63, 2.5],
        ]),
      );
      studio.mode(mode);
      studio.reference(false);
      vi.mocked(studio.audio.prepare).mockRejectedValue(
        new Error("sample bank unavailable"),
      );
      await studio.play();
      expect(studio.audio.prepare).not.toHaveBeenCalled();
      expect(studio.audio.setPlaybackNotes).toHaveBeenCalledWith([], []);
      expect(studio.transport.playing).toBe(true);
      advance(studio, 0.5);
      midi(studio, [0x90, 60, 100]);
      expect(studio.practice.hit.has("note-0")).toBe(true);
    },
  );

  it("loads only the requested Wait chord when previewing a silent practice session", async () => {
    const studio = create(
      song([
        [60, 0.5],
        [63, 2.5],
      ]),
    );
    await studio.play();
    expect(studio.audio.prepare).not.toHaveBeenCalled();
    await studio.preview();
    // A preview plays no release, noise or resonance voices.
    expect(studio.audio.prepare).toHaveBeenCalledExactlyOnceWith(
      [studio.notes[0]],
      expect.any(AbortSignal),
      undefined,
    );
  });

  it("prepares reference samples before resuming an active quiet Rhythm session", async () => {
    const studio = create(
      song([
        [60, 0.5],
        [63, 2.5],
      ]),
    );
    studio.mode("rhythm");
    studio.reference(false);
    await studio.play();
    advance(studio, 0.25);
    let finish!: () => void;
    env.prepareWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    studio.reference(true);
    expect(studio.transport.playing).toBe(false);
    await vi.waitFor(() =>
      expect(studio.audio.prepare).toHaveBeenCalledExactlyOnceWith(
        studio.notes,
        expect.any(AbortSignal),
        [],
      ),
    );
    advance(studio, 1);
    expect(studio.position).toBe(0.25);
    finish();
    await vi.waitFor(() => expect(studio.transport.playing).toBe(true));
    expect(studio.position).toBe(0.25);
    expect(studio.audio.setPlaybackNotes).toHaveBeenLastCalledWith(
      studio.notes,
      [],
    );
  });

  it("can disable reference during preparation and ignores that stale completion", async () => {
    const studio = create(
      song([
        [60, 0.5],
        [63, 2.5],
      ]),
    );
    studio.mode("rhythm");
    studio.reference(false);
    await studio.play();
    let finish!: () => void;
    env.prepareWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    studio.reference(true);
    await vi.waitFor(() => expect(studio.audio.prepare).toHaveBeenCalledOnce());
    const preparation = vi.mocked(studio.audio.prepare).mock.results[0].value;
    studio.reference(false);
    await vi.waitFor(() => expect(studio.transport.playing).toBe(true));
    expect(studio.audio.setPlaybackNotes).toHaveBeenLastCalledWith([], []);
    finish();
    await preparation;
    await Promise.resolve();
    expect(studio.settings.reference).toBe(false);
    expect(studio.audio.setPlaybackNotes).toHaveBeenLastCalledWith([], []);
    expect(studio.audio.prepare).toHaveBeenCalledOnce();
  });

  it("starts on the saved song, or the first one once it leaves the library", () => {
    const songs = fixtureLibrary();
    env.values.set("settings", { selected: songs[1].id });
    expect(create().song.id).toBe(songs[1].id);
    env.values.set("settings", { selected: "gone-from-library" });
    expect(create().song.id).toBe(songs[0].id);
  });

  it("turns each hand on and off on its own, including both off", async () => {
    const studio = create(
      song([
        [60, 1],
        [64, 2],
      ]),
    );
    studio.hand("right");
    studio.hand("left");
    expect(studio.settings).toMatchObject({ left: false, right: false });
    expect(studio.notes).toHaveLength(0);
    await studio.play();
    expect(studio.transport.playing).toBe(false);
    expect(studio.notice).toMatch(/Turn on Left, Right, or both hands/);
    studio.hand("right");
    expect(studio.settings).toMatchObject({ left: false, right: true });
    expect(studio.notes).toHaveLength(2);
  });

  it.each([false, true])(
    "accepts Wait input within the early tolerance even when delivered after the gate (already held: %s)",
    async (held) => {
      const studio = create(song([[60, 1]]));
      studio.tolerance(0.5);
      await studio.play();
      env.now += 1.1;
      if (held) studio.tick();
      midi(studio, [0x90, 60, 100], 0.3);
      expect(studio.position).toBe(1);
      expect(studio.practice.hit).toEqual(new Set(["note-0"]));
      expect(studio.practice.gate).toBeUndefined();
    },
  );

  it.each([0.6, 1, 1.4])(
    "accepts a Wait note 500ms early at %sx without jumping the timeline forward",
    async (speed) => {
      const studio = create(
        song([
          [60, 1],
          [62, 2],
        ]),
      );
      studio.speed(speed);
      studio.tolerance(0.5);
      await studio.play();
      advance(studio, 1 / speed - 0.5);
      midi(studio, [0x90, 60, 100]);
      expect(studio.practice.hit).toEqual(new Set(["note-0"]));
      expect(studio.practice.gate?.start).toBe(2);
      expect(studio.position).toBeCloseTo(1 - 0.5 * speed);
      advance(studio, 0.1);
      expect(studio.position).toBeCloseTo(1 - 0.4 * speed);
    },
  );

  it("keeps early chord input until every freshly played chord pitch is held", async () => {
    const studio = create(
      song([
        [60, 1],
        [64, 1],
        [62, 2],
      ]),
    );
    studio.tolerance(0.5);
    await studio.play();
    advance(studio, 0.6);
    midi(studio, [0x90, 60, 100]);
    expect(studio.practice.gate?.start).toBe(1);
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
    advance(studio, 0.1);
    midi(studio, [0x90, 64, 100]);
    expect(studio.practice.hit).toEqual(new Set(["note-0", "note-1"]));
    expect(studio.practice.gate?.start).toBe(2);
    expect(studio.position).toBeCloseTo(0.7);
  });

  it.each([false, true])(
    "accepts Wait input played after the gate despite delayed delivery (already held: %s)",
    async (held) => {
      const studio = create(song([[60, 1]]));
      await studio.play();
      if (held) advance(studio, 1);
      env.now = 102;
      midi(studio, [0x90, 60, 100], 0.5);
      expect(studio.practice.hit).toEqual(new Set(["note-0"]));
      expect(studio.practice.gate).toBeUndefined();
    },
  );

  it("reanchors the transport when browser audio starts with a different clock origin", async () => {
    const studio = create(song([[60, 1]]));
    studio.mode("listen");
    await studio.play();
    advance(studio, 2);
    expect(studio.position).toBe(2);
    studio.pause();
    advance(studio, 100);
    expect(studio.position).toBe(2);
    await studio.play();
    advance(studio, 0.5);
    expect(studio.position).toBe(2.5);
  });

  it("allows Listen and virtual Wait practice without requesting MIDI permission", async () => {
    const studio = create(song([[60, 1]]));
    await studio.play();
    advance(studio, 5);
    expect(studio.position).toBe(1);
    studio.virtual(60, true);
    expect(studio.practice.gate).toBeUndefined();
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
    expect(studio.midi.connect).not.toHaveBeenCalled();
    studio.virtual(60, false);
    studio.mode("listen");
    studio.seek(0);
    await studio.play();
    advance(studio, 2);
    expect(studio.position).toBe(2);
    expect(studio.midi.connect).not.toHaveBeenCalled();
  });

  it("requires a physical re-press for repeated notes while keeping pedal sound distinct", async () => {
    const studio = create(
      song([
        [60, 1],
        [60, 2],
      ]),
    );
    await studio.play();
    advance(studio, 1);
    midi(studio, [0x90, 60, 100]);
    expect(studio.practice.gate?.start).toBe(2);
    advance(studio, 10);
    expect(studio.position).toBe(2);
    midi(studio, [0x90, 60, 100]);
    expect(studio.practice.gate?.start).toBe(2);
    midi(studio, [0xb0, 64, 127]);
    midi(studio, [0x90, 60, 0]);
    expect(studio.input.down.size).toBe(0);
    expect(studio.input.sounding.has(60)).toBe(true);
    midi(studio, [0x90, 60, 80]);
    expect(studio.practice.gate).toBeUndefined();
    expect(studio.practice.hit.size).toBe(2);
    expect(studio.lastVelocity).toBe(80);
  });

  it("uses the MIDI event timestamp to correct an apparent late-delivery miss", async () => {
    const studio = create(song([[60, 1]]));
    studio.mode("rhythm");
    studio.tolerance(0.12);
    await studio.play();
    advance(studio, 1.3);
    expect(studio.practice.missed).toEqual(new Set(["note-0"]));
    midi(studio, [0x90, 60, 100], 0.3);
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
    expect(studio.practice.missed.size).toBe(0);
    expect(studio.practice.feedback.at(-1)?.offset).toBeCloseTo(0);
  });

  it("clears keys and sustain and pauses practice on disconnect, then accepts a fresh chord", async () => {
    const studio = create(
      song([
        [60, 1],
        [64, 1],
      ]),
    );
    await studio.play();
    advance(studio, 1);
    midi(studio, [0x90, 60, 100]);
    midi(studio, [0xb0, 64, 127]);
    midi(studio, [0x80, 60, 0]);
    env.resets.at(-1)!();
    expect(studio.transport.playing).toBe(false);
    expect(studio.input.down.size).toBe(0);
    expect(studio.input.sounding.size).toBe(0);
    expect(studio.input.sustain).toBe(false);
    expect(studio.notice).toMatch(/connection changed/i);
    await studio.play();
    midi(studio, [0x90, 60, 100]);
    midi(studio, [0x90, 64, 100]);
    expect(studio.practice.gate).toBeUndefined();
  });

  it("keeps Listen running through a MIDI disconnect", async () => {
    const studio = create(song([[60, 1]]));
    studio.mode("listen");
    await studio.play();
    advance(studio, 0.5);
    env.resets.at(-1)!();
    expect(studio.transport.playing).toBe(true);
    advance(studio, 0.5);
    expect(studio.position).toBe(1);
  });

  it("clears partial chord hits, physical keys and pedal state on restart", async () => {
    const studio = create(
      song([
        [60, 1],
        [64, 1],
      ]),
    );
    await studio.play();
    advance(studio, 1);
    midi(studio, [0x90, 60, 100]);
    midi(studio, [0xb0, 64, 127]);
    studio.seek(0);
    expect(studio.input.down.size).toBe(0);
    expect(studio.input.sounding.size).toBe(0);
    expect(studio.input.sustain).toBe(false);
    expect(studio.practice.hit.size).toBe(0);
    expect(studio.practice.gate?.start).toBe(1);
  });

  it("matches delayed MIDI using the speed active at its timestamp", async () => {
    const studio = create(song([[60, 0.9]]));
    studio.mode("rhythm");
    studio.tolerance(0.12);
    await studio.play();
    advance(studio, 1);
    studio.speed(0.5);
    env.now += 0.1;
    midi(studio, [0x90, 60, 100], 0.2);
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
    expect(studio.practice.feedback.at(-1)?.offset).toBeCloseTo(0);
  });

  it("rejects queued note-on scoring from before a seek", async () => {
    const studio = create(
      song([
        [60, 1],
        [62, 2],
      ]),
    );
    studio.mode("rhythm");
    await studio.play();
    advance(studio, 1);
    studio.seek(2);
    midi(studio, [0x90, 62, 100], 0.2);
    expect(studio.practice.hit.size).toBe(0);
    expect(studio.practice.feedback).toEqual([]);
    midi(studio, [0x80, 62, 0]);
    midi(studio, [0x90, 62, 100]);
    expect(studio.practice.hit).toEqual(new Set(["note-1"]));
  });

  it("scores current-loop MIDI when an input callback is the first update after crossing the loop end", async () => {
    const studio = create(
      song([
        [60, 0.2],
        [62, 1.2],
      ]),
    );
    studio.mode("rhythm");
    studio.bounds(0, 2);
    studio.loop(true);
    await studio.play();
    advance(studio, 0.2);
    midi(studio, [0x90, 60, 100]);
    midi(studio, [0x80, 60, 0]);
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
    advance(studio, 1.7);
    env.now += 0.3; // The next callback is MIDI, before the interval has observed the wrap.
    midi(studio, [0x90, 60, 100]);
    expect(studio.position).toBeCloseTo(0.2);
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
  });

  it("resets the loop pass when Pause is the first update after crossing its end", async () => {
    const studio = create(
      song([
        [60, 0.5],
        [62, 1.5],
      ]),
    );
    studio.mode("rhythm");
    studio.bounds(0, 2);
    studio.loop(true);
    await studio.play();
    advance(studio, 0.5);
    midi(studio, [0x90, 60, 100]);
    midi(studio, [0x80, 60, 0]);
    advance(studio, 1.3);
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
    expect(studio.practice.missed).toEqual(new Set(["note-1"]));
    env.now += 0.3; // Pause arrives at 2.1 before any interval update observes the new pass.
    studio.pause();
    expect(studio.position).toBeCloseTo(0.1);
    expect(studio.transport.playing).toBe(false);
    expect(studio.practice.hit.size).toBe(0);
    expect(studio.practice.missed.size).toBe(0);
    await studio.play();
    env.now += 0.4;
    midi(studio, [0x90, 60, 100]);
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
    expect(studio.practice.missed.size).toBe(0);
  });

  it.each([
    ["before", 0],
    ["after", 0.1],
  ] as const)(
    "credits a Rhythm press just before a loop wrap, delivered %s it, to the next pass",
    async (_, delay) => {
      const studio = create(
        song([
          [60, 0],
          [62, 1],
        ]),
      );
      studio.mode("rhythm");
      studio.bounds(0, 2);
      studio.loop(true);
      await studio.play();
      midi(studio, [0x90, 60, 100]);
      midi(studio, [0x80, 60, 0]);
      advance(studio, 1);
      midi(studio, [0x90, 62, 100]);
      midi(studio, [0x80, 62, 0]);
      advance(studio, 0.95);
      env.now += delay;
      midi(studio, [0x90, 60, 100], delay); // 50 ms early for the next pass.
      midi(studio, [0x80, 60, 0]);
      expect(studio.practice.stats.wrong).toBe(0);
      advance(studio, 0.3);
      expect(studio.position).toBeCloseTo(0.25 + delay);
      expect(studio.practice.hit).toEqual(new Set(["note-0"]));
      expect(studio.practice.missed.size).toBe(0);
      expect(studio.practice.feedback).toMatchObject([
        { pitch: 60, offset: expect.closeTo(-0.05) },
      ]);
    },
  );

  it("scores a Rhythm press just after a loop wrap late for the previous pass's last note", async () => {
    const studio = create(
      song([
        [62, 0.2],
        [62, 1.95],
      ]),
    );
    studio.mode("rhythm");
    studio.bounds(0, 2);
    studio.loop(true);
    await studio.play();
    advance(studio, 0.2);
    midi(studio, [0x90, 62, 100]);
    midi(studio, [0x80, 62, 0]);
    advance(studio, 1.7);
    advance(studio, 0.12);
    expect(studio.position).toBeCloseTo(0.02);
    midi(studio, [0x90, 62, 100]); // 70 ms late for the note at 1.95.
    midi(studio, [0x80, 62, 0]);
    expect(studio.practice.feedback).toMatchObject([
      { kind: "late", pitch: 62, offset: expect.closeTo(0.07) },
    ]);
    // The new pass's first note, of the same pitch, is still to be played.
    expect(studio.practice.hit.size).toBe(0);
    advance(studio, 0.18);
    midi(studio, [0x90, 62, 100]);
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
    expect(studio.practice.missed.size).toBe(0);
    expect(studio.practice.stats.wrong).toBe(0);
  });

  it("rejects a Wait note outside the early tolerance, but accepts an exact-gate timestamp", async () => {
    const studio = create(song([[60, 1]]));
    studio.tolerance(0.5);
    await studio.play();
    advance(studio, 1.2);
    expect(studio.position).toBe(1);
    midi(studio, [0x90, 60, 100], 0.8); // Pressed at .4, outside the 500ms early window.
    expect(studio.practice.hit.size).toBe(0);
    expect(studio.practice.gate?.start).toBe(1);
    midi(studio, [0x80, 60, 0]);
    midi(studio, [0x90, 60, 100], 0.2); // Pressed at exactly 1, delivered at 1.2.
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
    expect(studio.practice.gate).toBeUndefined();
  });

  it("accepts delayed Wait input during a gate hold after a late loop-wrap update", async () => {
    const studio = create(song([[60, 0.25]]));
    studio.bounds(0, 2);
    studio.loop(true);
    await studio.play();
    advance(studio, 0.25);
    midi(studio, [0x90, 60, 100]);
    midi(studio, [0x80, 60, 0]);
    expect(studio.practice.gate).toBeUndefined();
    advance(studio, 1.55);
    env.now += 1.1; // The clock reaches 2.9 before the interval observes the wrap at 2.
    studio.tick();
    expect(studio.position).toBe(0.25);
    expect(studio.practice.gate?.start).toBe(0.25);
    expect(studio.practice.hit.size).toBe(0);
    // This press occurred at 2.5, after the new pass should have reached and held its .25 gate.
    midi(studio, [0x90, 60, 100], 0.4);
    expect(studio.practice.hit).toEqual(new Set(["note-0"]));
    expect(studio.practice.gate).toBeUndefined();
  });

  it.each(["song", "mode", "seek", "pause"] as const)(
    "cancels pending audio startup when %s changes before unlock resolves",
    async (change) => {
      const studio = create(song([[60, 1]]));
      let finishUnlock!: () => void;
      env.unlockWait = new Promise<void>((resolve) => {
        finishUnlock = resolve;
      });
      const starting = studio.play();
      expect(studio.audio.unlock).toHaveBeenCalledOnce();
      expect(studio.transport.playing).toBe(false);
      if (change === "song") studio.load(song([[62, 1]], "replacement"));
      else if (change === "mode") studio.mode("rhythm");
      else if (change === "seek") studio.seek(2);
      else studio.pause();
      const expected = {
        song: studio.song.id,
        mode: studio.settings.mode,
        position: studio.position,
        attempts: studio.progress.attempts,
      };
      finishUnlock();
      await starting;
      expect(studio.transport.playing).toBe(false);
      expect(studio.song.id).toBe(expected.song);
      expect(studio.settings.mode).toBe(expected.mode);
      expect(studio.position).toBe(expected.position);
      expect(studio.progress.attempts).toBe(expected.attempts);
    },
  );

  it("does not play a stale chord after the piano finishes loading", async () => {
    const studio = create(song([[60, 0]]));
    let finish!: () => void;
    env.unlockWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const preview = studio.preview();
    studio.seek(2);
    finish();
    await preview;
    expect(studio.audio.tone).not.toHaveBeenCalled();
  });

  it("does not sound a virtual key released while the piano was loading", async () => {
    const studio = create(song([[60, 0]]));
    let finish!: () => void;
    env.unlockWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    studio.virtual(60, true);
    studio.virtual(60, false);
    finish();
    await env.unlockWait;
    await Promise.resolve();
    await Promise.resolve();
    expect(studio.audio.tone).not.toHaveBeenCalled();
  });

  it("loops the whole song by default and keeps playing after the ending", async () => {
    const fixture = song([[60, 0.5]]);
    const studio = create(fixture);
    expect(studio.loopEnabled).toBe(true);
    expect(studio.transport.loop).toEqual([0, fixture.duration]);
    studio.mode("listen");
    await studio.play();
    vi.mocked(studio.audio.stop).mockClear();
    vi.mocked(studio.audio.schedule).mockClear();
    advance(studio, fixture.duration + 0.25);
    // Voices of the last pass end by the loop end, so the wrap lets them ring.
    expect(studio.audio.stop).not.toHaveBeenCalled();
    expect(studio.audio.schedule).toHaveBeenCalledOnce();
    expect(studio.transport.playing).toBe(true);
    expect(studio.position).toBeCloseTo(0.25);
  });

  it("restores an explicit loop-off preference without losing its custom bounds", () => {
    const fixture = song([[60, 1]]);
    const studio = create(fixture);
    studio.bounds(0.5, 2.5);
    studio.loop(false);
    studio.seek(3);
    studio.save();
    const restored = new Studio(fixtureLibrary());
    active.push(restored);
    restored.load(fixture);
    expect(restored.loopEnabled).toBe(false);
    expect(restored.transport.loop).toBeNull();
    expect(restored.position).toBe(3);
    expect([restored.loopStart, restored.loopEnd]).toEqual([0.5, 2.5]);
    restored.loop(true);
    expect(restored.transport.loop).toEqual([0.5, 2.5]);
  });

  it("ignores MIDI clock and active sensing without notifying views", async () => {
    const studio = create(song([[60, 1]]));
    studio.mode("listen");
    await studio.play();
    const listener = vi.fn();
    studio.subscribe(listener);
    const revision = studio.revision;
    // Clock, start, continue, stop, active sensing and reset.
    for (const status of [0xf8, 0xfa, 0xfb, 0xfc, 0xfe, 0xff])
      midi(studio, [status]);
    expect(listener).not.toHaveBeenCalled();
    expect(studio.revision).toBe(revision);
    midi(studio, [0x90, 60, 80]);
    expect(listener).toHaveBeenCalled();
    expect(studio.input.down.has(60)).toBe(true);
    expect(studio.lastVelocity).toBe(80);
  });

  it("replaces the song on hand assignment so views can memoize on it", () => {
    const studio = create(song([[60, 1]]));
    const before = studio.song;
    studio.assign(0, "left");
    expect(studio.song).not.toBe(before);
    expect(before.tracks[0].hand).toBe("right");
    expect(studio.song.tracks[0].hand).toBe("left");
    expect(studio.song.notes).toBe(before.notes);
    expect(studio.notes).toHaveLength(1);
  });

  it("persists position, speed, hand assignments, loop and feedback settings per song", () => {
    const fixture = song([
      [60, 1],
      [64, 2],
    ]);
    const studio = create(fixture);
    studio.assign(0, "left");
    studio.speed(0.5);
    studio.tolerance(0.35);
    studio.bounds(0.5, 2.5);
    studio.loop(true);
    studio.seek(1.5);
    studio.save();
    const restored = new Studio(fixtureLibrary());
    active.push(restored);
    restored.load(fixture);
    expect(restored.position).toBe(1.5);
    expect(restored.settings.speed).toBe(0.5);
    expect(restored.settings.tolerance).toBe(0.35);
    expect(restored.song.tracks[0].hand).toBe("left");
    expect(restored.transport.loop).toEqual([0.5, 2.5]);
  });
});

describe("account sync hooks", () => {
  const hooks = () => ({
    settings: vi.fn(),
    progress: vi.fn(),
  });
  it("reports saved settings and progress to the account", () => {
    const sync = hooks();
    const studio = new Studio(fixtureLibrary(), sync);
    active.push(studio);
    studio.load(song([[60, 1]]));
    expect(sync.settings).toHaveBeenLastCalledWith(
      expect.objectContaining({ selected: "controller-fixture" }),
    );
    // Opening the song reports its save as the starting point.
    expect(sync.progress).toHaveBeenLastCalledWith(
      "controller-fixture",
      expect.any(Object),
      true,
    );
    // Saving with nothing changed neither restamps nor reports the record.
    const calls = sync.progress.mock.calls.length;
    const stamp = studio.progress.updated;
    studio.save();
    expect(sync.progress).toHaveBeenCalledTimes(calls);
    expect(studio.progress.updated).toBe(stamp);
    studio.seek(1);
    expect(sync.progress).toHaveBeenLastCalledWith(
      "controller-fixture",
      expect.objectContaining({ position: 1, updated: expect.any(String) }),
      false,
    );
  });
});

describe("practice time", () => {
  // A wrong key holds Wait mode at its first note, so playback keeps running.
  const held = () => song([[60, 1]]);
  const today = (studio: Studio) =>
    studio.practiceLog.totals().get(studio.practiceLog.today()) ?? 0;

  it("counts playing time only while keys are being pressed", async () => {
    const studio = create(held());
    await studio.play();
    advance(studio, 1);
    advance(studio, 1);
    expect(today(studio)).toBe(0);
    midi(studio, [0x90, 72, 80]);
    midi(studio, [0x80, 72, 0]);
    for (let i = 0; i < 20; i++) advance(studio, 1);
    // Time stops counting 15 seconds after the last key press.
    expect(studio.transport.playing).toBe(true);
    expect(today(studio)).toBe(15);
    midi(studio, [0x90, 72, 80]);
    advance(studio, 1);
    expect(today(studio)).toBe(16);
  });

  it("leaves out Listen, paused time and long gaps between ticks", async () => {
    const studio = create(held());
    studio.mode("listen");
    await studio.play();
    midi(studio, [0x90, 72, 80]);
    advance(studio, 3);
    expect(today(studio)).toBe(0);
    studio.pause();

    studio.mode("wait");
    await studio.play();
    advance(studio, 0.5);
    midi(studio, [0x90, 74, 80]);
    advance(studio, 1);
    studio.pause();
    // The minute spent paused is not practice.
    env.now += 60;
    await studio.play();
    midi(studio, [0x90, 74, 80]);
    advance(studio, 0.5);
    // A stalled tick counts at most a second.
    advance(studio, 5);
    expect(today(studio)).toBe(2);
  });

  it("times key activity from when the key was pressed", async () => {
    const studio = create(held());
    await studio.play();
    advance(studio, 5);
    // Pressed before this playback run started, delivered late.
    midi(studio, [0x90, 72, 80], 8);
    for (let i = 0; i < 3; i++) advance(studio, 1);
    expect(today(studio)).toBe(0);
    advance(studio, 2);
    // Pressed 8 seconds before its delivery: 7 seconds of activity remain.
    midi(studio, [0x90, 74, 80], 8);
    for (let i = 0; i < 10; i++) advance(studio, 1);
    expect(today(studio)).toBe(7);
  });

  it("shows practice another tab saves, and listens again after a restart", () => {
    const studio = create(held());
    const emitted = vi.fn();
    studio.subscribe(emitted);
    env.values.set("practice:other", {
      id: "other",
      day: studio.practiceLog.today(),
      startedAt: "x",
      seconds: 120,
      songs: { ode: 120 },
    });
    for (const watcher of env.watchers) watcher();
    expect(today(studio)).toBe(120);
    expect(emitted).toHaveBeenCalled();
    studio.destroy();
    expect(env.watchers.size).toBe(0);
    // Saved while this studio was closed, then more after it reopens.
    const other = (seconds: number) => ({
      id: "other",
      day: studio.practiceLog.today(),
      startedAt: "x",
      seconds,
      songs: { ode: seconds },
    });
    env.values.set("practice:other", other(180));
    studio.init();
    expect(today(studio)).toBe(180);
    expect(env.watchers.size).toBe(1);
    env.values.set("practice:other", other(240));
    for (const watcher of env.watchers) watcher();
    expect(today(studio)).toBe(240);
  });

  it("needs a new key press after the studio restarts mid-playback", async () => {
    const studio = create(held());
    await studio.play();
    midi(studio, [0x90, 72, 80]);
    advance(studio, 1);
    expect(today(studio)).toBe(1);
    studio.destroy();
    studio.init();
    for (let i = 0; i < 3; i++) advance(studio, 1);
    expect(today(studio)).toBe(1);
    midi(studio, [0x90, 74, 80]);
    advance(studio, 1);
    expect(today(studio)).toBe(2);
  });

  it("needs a new key press after resuming playback", async () => {
    const studio = create(held());
    await studio.play();
    midi(studio, [0x90, 72, 80]);
    for (let i = 0; i < 2; i++) advance(studio, 1);
    expect(today(studio)).toBe(2);
    studio.pause();
    await studio.play();
    for (let i = 0; i < 3; i++) advance(studio, 1);
    expect(today(studio)).toBe(2);
    midi(studio, [0x90, 74, 80]);
    advance(studio, 1);
    expect(today(studio)).toBe(3);
  });

  it("ignores key presses made while paused or in Listen", async () => {
    const studio = create(held());
    midi(studio, [0x90, 72, 80]);
    await studio.play();
    for (let i = 0; i < 3; i++) advance(studio, 1);
    expect(today(studio)).toBe(0);
    studio.pause();

    studio.mode("listen");
    await studio.play();
    midi(studio, [0x90, 72, 80]);
    studio.pause();
    studio.mode("wait");
    await studio.play();
    for (let i = 0; i < 3; i++) advance(studio, 1);
    expect(today(studio)).toBe(0);
  });

  it("saves practice sessions in browser storage as they grow", async () => {
    const studio = create(held());
    await studio.play();
    midi(studio, [0x90, 72, 80]);
    for (let i = 0; i < 4; i++) advance(studio, 1);
    studio.pause();
    const sessions = [...env.values].filter(([key]) =>
      key.startsWith("practice:"),
    );
    expect(sessions).toEqual([
      [
        expect.any(String),
        expect.objectContaining({
          seconds: 4,
          songs: { "controller-fixture": 4 },
          day: studio.practiceLog.today(),
        }),
      ],
    ]);
    expect(sessions[0][0]).toBe(
      `practice:${(sessions[0][1] as { id: string }).id}`,
    );
  });

  it("saves the learner's name and a daily goal from the choices", () => {
    const studio = create();
    studio.learnerName("George");
    studio.dailyGoal(15);
    studio.dailyGoal(7);
    const saved = { learnerName: "George", dailyGoalMinutes: 15 };
    expect(studio.settings).toMatchObject(saved);
    expect(env.values.get("settings")).toMatchObject(saved);
  });
});
