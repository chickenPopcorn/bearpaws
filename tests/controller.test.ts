import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "../src/controller";
import type { Song } from "../src/song";
import { deleteSong, library } from "../src/storage";
import { builtInSongs } from "../src/lessons";

const env = vi.hoisted(() => ({
  now: 100,
  values: new Map<string, unknown>(),
  songs: [] as unknown[],
  resets: [] as (() => void)[],
  unlockWait: null as Promise<void> | null,
  prepareWait: null as Promise<void> | null,
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
    prepare = vi.fn(async () => {
      if (env.prepareWait) await env.prepareWait;
    });
    setPlaybackNotes = vi.fn();
    stop = vi.fn();
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
  settings: () => ({
    mode: "wait",
    speed: 0.75,
    left: true,
    right: true,
    tolerance: 0.22,
    reference: true,
    names: true,
    selected: "cadence-ode-to-joy-v1",
    ...((env.values.get("settings") as object) ?? {}),
  }),
  write: (key: string, value: unknown) => {
    env.values.set(key, structuredClone(value));
    return true;
  },
  read: (key: string, fallback: unknown) =>
    structuredClone(env.values.get(key) ?? fallback),
  progress: (id: string, _duration: number) =>
    structuredClone({
      position: 0,
      best: 0,
      attempts: 0,
      updated: "",
      assignments: {},
      loop: null,
      ...((env.values.get(`progress:${id}`) as object) ?? {}),
    }),
  library: vi.fn(async () => env.songs),
  saveSong: vi.fn(async () => {}),
  deleteSong: vi.fn(async () => {}),
  songId: vi.fn(async () => "fixture-hash"),
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
  const studio = new Studio();
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
  env.songs = [];
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
  it("initializes once and recreates MIDI after the studio is restarted", async () => {
    const studio = create();
    const originalMidi = studio.midi;
    const loadLibrary = vi.mocked(library).mockClear();
    const first = studio.init();
    expect(studio.init()).toBe(first);
    await first;
    const timer = studio.timer;
    await studio.init();
    expect(loadLibrary).toHaveBeenCalledOnce();
    expect(originalMidi.autoConnect).toHaveBeenCalledOnce();
    expect(studio.timer).toBe(timer);
    studio.destroy();
    expect(studio.timer).toBeNull();
    expect(originalMidi.dispose).toHaveBeenCalledOnce();
    await studio.init();
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
    await studio.init();
    expect(studio.timer).not.toBeNull();
    expect(studio.songs.length).toBeGreaterThan(0);
    expect(studio.midi.autoConnect).toHaveBeenCalledOnce();
  });

  it("ignores an old library load after destruction and restart", async () => {
    let finish!: (songs: Song[]) => void;
    vi.mocked(library).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const studio = create();
    const pending = studio.init();
    studio.destroy();
    expect(studio.timer).toBeNull();
    env.songs = [song([[62, 1]], "new-library")];
    await studio.init();
    const timer = studio.timer;
    finish([song([[60, 1]], "old-library")]);
    await pending;
    expect(studio.timer).toBe(timer);
    expect(studio.songs.some((entry) => entry.id === "new-library")).toBe(true);
    expect(studio.songs.some((entry) => entry.id === "old-library")).toBe(
      false,
    );
  });

  it("does not start a timer if destroyed while the library is loading", async () => {
    let finish!: (songs: Song[]) => void;
    vi.mocked(library).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const studio = create();
    const pending = studio.init();
    studio.destroy();
    finish([song([[60, 1]], "late-library")]);
    await pending;
    expect(studio.timer).toBeNull();
    expect(studio.songs.some((entry) => entry.id === "late-library")).toBe(
      false,
    );
  });

  it.each(["song", "mode", "seek", "pause"] as const)(
    "cancels pending sample preparation when %s changes",
    async (change) => {
      const studio = create(song([[60, 1]]));
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

  it.each([1, 1.5])(
    "lets the final piano release finish naturally at %sx speed, while explicit pause still stops it",
    async (speed) => {
      const studio = create(song([[60, 3.5]]));
      studio.mode("listen");
      studio.speed(speed);
      await studio.play();
      vi.mocked(studio.audio.stop).mockClear();
      advance(studio, 4 / speed + 0.001);
      expect(studio.transport.playing).toBe(false);
      expect(studio.notice).toMatch(/Passage complete/);
      expect(studio.audio.stop).not.toHaveBeenCalled();
      studio.pause();
      expect(studio.audio.stop).toHaveBeenCalledOnce();
    },
  );

  it("keeps every built-in piece and restores the selected one after library loading", async () => {
    const builtIns = builtInSongs();
    env.values.set("settings", { selected: builtIns[1].id });
    env.songs = [song([[60, 1]], "saved-import")];
    const studio = create();
    await studio.init();
    expect(studio.songs.map((s) => s.id)).toEqual([
      ...builtIns.map((s) => s.id),
      "saved-import",
    ]);
    expect(studio.song.id).toBe(builtIns[1].id);
    for (const piece of builtIns) {
      studio.load(piece);
      await studio.remove();
      expect(studio.songs.some((s) => s.id === piece.id)).toBe(true);
    }
    expect(deleteSong).not.toHaveBeenCalled();
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

  it.each([0.5, 1, 1.5])(
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

  it("finishes removing an IndexedDB song when clearing its local progress fails", async () => {
    const imported = song([[60, 1]], "remove-imported");
    const studio = create(imported);
    const fallback = studio.songs[0];
    studio.songs.push(imported);
    const removeItem = vi.fn(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    vi.stubGlobal("localStorage", { removeItem });
    vi.mocked(deleteSong).mockClear();
    await studio.remove();
    expect(deleteSong).toHaveBeenCalledWith(imported.id);
    expect(removeItem).toHaveBeenCalledWith(`cadence:progress:${imported.id}`);
    expect(studio.songs.some((s) => s.id === imported.id)).toBe(false);
    expect(studio.song.id).toBe(fallback.id);
    expect(`${studio.storageNotice} ${studio.notice}`).toMatch(/progress/i);
    expect(studio.notice).not.toMatch(/song could not be removed/i);
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
    const restored = new Studio();
    active.push(restored);
    restored.load(fixture);
    expect(restored.position).toBe(1.5);
    expect(restored.settings.speed).toBe(0.5);
    expect(restored.settings.tolerance).toBe(0.35);
    expect(restored.song.tracks[0].hand).toBe("left");
    expect(restored.transport.loop).toEqual([0.5, 2.5]);
  });

  it("restores the previously selected imported song after loading the local library", async () => {
    const imported = song([[60, 1]], "imported");
    env.values.set("settings", { selected: "imported" });
    env.songs = [imported];
    const studio = new Studio();
    active.push(studio);
    await studio.init();
    expect(studio.song.id).toBe("imported");
  });
});
