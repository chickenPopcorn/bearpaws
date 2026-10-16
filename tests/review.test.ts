import { afterEach, describe, expect, it, vi } from "vitest";
import { writeMidi } from "midi-file";
import { ReferenceAudio } from "../src/audio";
import { MidiState, Practice, Transport } from "../src/engine";
import { draw, keyLayout, range } from "../src/render";
import { parseSong, type Note, type Song } from "../src/song";

const note = (
  id: string,
  pitch: number,
  start: number,
  end: number,
  track = 0,
): Note => ({
  id,
  pitch,
  start,
  end,
  soundEnd: end,
  velocity: 0.7,
  channel: 0,
  track,
});
const song = (notes: Note[]): Song => ({
  id: "review-fixture",
  title: "Review fixture",
  duration: 4,
  ppq: 480,
  tempos: [],
  warnings: [],
  notes,
  tracks: [{ id: 0, name: "Right", hand: "right", count: notes.length }],
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("review regressions", () => {
  it("applies a controller-track pedal to matching channels on other tracks, through tempo changes", () => {
    const tracks: Parameters<typeof writeMidi>[0]["tracks"] = [
      [
        { deltaTime: 0, type: "setTempo", microsecondsPerBeat: 500000 },
        {
          deltaTime: 0,
          type: "controller",
          channel: 0,
          controllerType: 64,
          value: 127,
        },
        { deltaTime: 480, type: "setTempo", microsecondsPerBeat: 1000000 },
        {
          deltaTime: 480,
          type: "controller",
          channel: 0,
          controllerType: 64,
          value: 0,
        },
        { deltaTime: 0, type: "endOfTrack" },
      ],
      [
        {
          deltaTime: 0,
          type: "noteOn",
          channel: 0,
          noteNumber: 60,
          velocity: 80,
        },
        {
          deltaTime: 240,
          type: "noteOff",
          channel: 0,
          noteNumber: 60,
          velocity: 0,
        },
        { deltaTime: 0, type: "endOfTrack" },
      ],
      [
        {
          deltaTime: 0,
          type: "noteOn",
          channel: 1,
          noteNumber: 64,
          velocity: 80,
        },
        {
          deltaTime: 240,
          type: "noteOff",
          channel: 1,
          noteNumber: 64,
          velocity: 0,
        },
        { deltaTime: 0, type: "endOfTrack" },
      ],
    ];
    const bytes = Uint8Array.from(
      writeMidi({
        header: { format: 1, ticksPerBeat: 480, numTracks: tracks.length },
        tracks,
      }),
    );
    const imported = parseSong(bytes, "Cross-track sustain", "cross-track");
    expect(imported.notes.find((n) => n.pitch === 60)).toMatchObject({
      track: 1,
      channel: 0,
      end: 0.25,
      soundEnd: 1.5,
    });
    expect(imported.notes.find((n) => n.pitch === 64)).toMatchObject({
      track: 2,
      channel: 1,
      end: 0.25,
      soundEnd: 0.25,
    });
  });

  it("matches a shared-pitch onset on selected tracks with one press while preserving the next repeated note", () => {
    const notes = [
      note("left-c", 60, 1, 1.4, 0),
      note("right-c", 60, 1, 1.4, 1),
      note("repeat-c", 60, 2, 2.4, 1),
    ];
    const practice = new Practice(notes);
    practice.reset(0);
    practice.input(60, 1.05, "rhythm", 0.22, 1, new Set([60]));
    expect(practice.hit).toEqual(new Set(["left-c", "right-c"]));
    practice.expire(1.5, 0.22, 1);
    expect(practice.missed.size).toBe(0);
    practice.input(60, 2, "rhythm", 0.22, 1, new Set([60]));
    expect(practice.hit).toEqual(new Set(["left-c", "right-c", "repeat-c"]));
  });

  it("anchors a very short waterfall note to its true onset and the same keyboard column", () => {
    // These drawing calls are a geometry unit check, not a real-browser rendering check.
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const context = {
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn(),
      arc: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      getBoundingClientRect: () => ({ width: 880, height: 400 }),
    } as unknown as HTMLCanvasElement;
    const short = note("short", 61, 1, 1.005),
      fixture = song([short]);
    const practice = new Practice(fixture.notes);
    const check = (position: number) => {
      context.roundRect.mockClear();
      draw(
        canvas,
        fixture,
        fixture.notes,
        position,
        new MidiState(),
        practice,
        false,
        false,
        false,
      );
      return context.roundRect.mock.calls[0] as number[];
    };
    const before = check(0.9),
      atOnset = check(1);
    expect(before[3]).toBe(8); // Kept visible despite a subpixel physical duration.
    expect(before[1] + before[3]).toBeCloseTo(294); // 300px strike line, 60px per second.
    expect(atOnset[1] + atOnset[3]).toBeCloseTo(300);
    const [min, max] = range(fixture),
      key = keyLayout(min, max).find((k) => k.pitch === 61)!;
    expect(atOnset[0]).toBeCloseTo(key.x * 880 + 2);
    expect(
      context.fillRect.mock.calls.some(
        ([x, y, width]) =>
          Math.abs(x - key.x * 880) < 0.001 &&
          y === 300 &&
          Math.abs(width - key.width * 880) < 0.001,
      ),
    ).toBe(true);
    expect(canvas.width).toBe(1760);
    expect(canvas.height).toBe(800);
  });
});

function audioContext() {
  const oscillators: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    frequency: { value: number };
  }[] = [];
  const envelopes: {
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const context = {
    currentTime: 10,
    state: "running",
    destination: {},
    createOscillator: () => {
      const osc = {
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        onended: null,
      };
      osc.connect.mockImplementation((target) => target);
      oscillators.push(osc);
      return osc;
    },
    createGain: () => {
      const gain = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gain.connect.mockImplementation((target) => target);
      envelopes.push({
        exponentialRampToValueAtTime: gain.gain.exponentialRampToValueAtTime,
        disconnect: gain.disconnect,
      });
      return gain;
    },
  };
  return { context, oscillators, envelopes };
}

describe("reference audio scheduling with a fake Web Audio context", () => {
  it("uses transport speed for onset and sustain duration, avoids duplicate scheduling, and cancels on seek", () => {
    const { context, oscillators, envelopes } = audioContext();
    const audio = new ReferenceAudio();
    audio.context = context as unknown as AudioContext;
    const transport = new Transport(4);
    transport.speed = 0.5;
    transport.play(10);
    const n = { ...note("reference", 69, 0.05, 0.25), soundEnd: 0.5 };
    audio.schedule([n], transport, true);
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].start.mock.calls[0][0]).toBeCloseTo(10.1);
    expect(oscillators[0].frequency.value).toBe(440);
    expect(
      envelopes[0].exponentialRampToValueAtTime.mock.calls[0][1],
    ).toBeCloseTo(11);
    audio.schedule([n], transport, true);
    expect(oscillators).toHaveLength(1);

    context.currentTime = 10.2;
    transport.seek(0.2, context.currentTime);
    audio.schedule([n], transport, true);
    expect(oscillators).toHaveLength(2);
    expect(oscillators[0].stop).toHaveBeenLastCalledWith();
    expect(envelopes[0].disconnect).toHaveBeenCalled();
    expect(oscillators[1].start).toHaveBeenCalledWith(10.2);
    expect(
      envelopes[1].exponentialRampToValueAtTime.mock.calls[0][1],
    ).toBeCloseTo(10.8);

    transport.pause(context.currentTime);
    audio.stop();
    expect(audio.voices.size).toBe(0);
    expect(audio.scheduled.size).toBe(0);
    expect(oscillators[1].stop).toHaveBeenLastCalledWith();
    audio.schedule([n], transport, true);
    expect(oscillators).toHaveLength(2);
  });
});
