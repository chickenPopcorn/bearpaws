import { describe, expect, it, vi } from "vitest";
import { createClickTrack, Metronome, type ClickClock } from "../src/metronome";
import type { MidiPlayer } from "../src/midiPlayer";

/** 4/4 at 120 BPM, with the library's one-beat lead-in before bar 1. */
const timing = {
  ppq: 480,
  tempos: [{ tick: 0, microseconds: 500000 }],
  leadInBeats: 1,
  beatsPerBar: 4,
  duration: 10,
};
const times = (clicks: { time: number; accent: boolean }[]) =>
  clicks.map(({ time, accent }) => [+time.toFixed(6), accent]);

describe("metronome clicks", () => {
  it("clicks each beat and accents each bar's first, from the lead-in on", () => {
    const track = createClickTrack(timing);
    expect(times(track.between(0, 2.6))).toEqual([
      [0, false],
      [0.5, true],
      [1, false],
      [1.5, false],
      [2, false],
      [2.5, true],
    ]);
  });
  it("follows the bar length and the time signature's beat", () => {
    const waltz = createClickTrack({ ...timing, beatsPerBar: 3 });
    expect(times(waltz.between(0.5, 2.1)).map(([, accent]) => accent)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    // In 6/8 each eighth clicks, six to the bar.
    const compound = createClickTrack({
      ...timing,
      leadInBeats: 0,
      timeSignatures: [{ tick: 0, numerator: 6, denominator: 8 }],
    });
    expect(times(compound.between(0, 1.75))).toEqual([
      [0, true],
      [0.25, false],
      [0.5, false],
      [0.75, false],
      [1, false],
      [1.25, false],
      [1.5, true],
    ]);
  });
  it("follows tempo changes and stops at the song's end", () => {
    const track = createClickTrack({
      ...timing,
      leadInBeats: 0,
      // Twice as fast from the third beat.
      tempos: [
        { tick: 0, microseconds: 500000 },
        { tick: 960, microseconds: 250000 },
      ],
      duration: 1.6,
    });
    expect(times(track.between(0, 5)).map(([time]) => time)).toEqual([
      0, 0.5, 1, 1.25, 1.5,
    ]);
  });
  it("counts in from the bar's start, or a whole bar before its first beat", () => {
    const track = createClickTrack(timing);
    // From the song's start: three clicks, then the lead-in beat is the fourth.
    const start = track.countIn(0);
    expect(times(track.between(start, 0))).toEqual([
      [-1.5, true],
      [-1, false],
      [-0.5, false],
    ]);
    // From bar 1's first beat, the whole bar before it.
    expect(track.between(track.countIn(0.5), 0.5)).toHaveLength(4);
    // From its third beat, its first two.
    expect(times(track.between(track.countIn(1.5), 1.5))).toEqual([
      [0.5, true],
      [1, false],
    ]);
    // From its second beat, one click is too few: a bar earlier.
    expect(track.countIn(1)).toBeCloseTo(-1.5);
  });
  it("counts in at the song's opening tempo", () => {
    // 80 BPM from the first tick, as the library's lessons have it.
    const track = createClickTrack({
      ...timing,
      tempos: [{ tick: 0, microseconds: 750000 }],
    });
    const start = track.countIn(0);
    expect(times(track.between(start, 0.1))).toEqual([
      [-2.25, true],
      [-1.5, false],
      [-0.75, false],
      [0, false],
    ]);
  });
});

/** An audio context whose clicks record when they start and whether they were cut. */
function audioContext() {
  const clicks: {
    when: number;
    frequency: number;
    stopped: boolean;
  }[] = [];
  const node = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
  const context = {
    currentTime: 0,
    state: "running",
    destination: {},
    createGain: () => ({
      ...node(),
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    }),
    createOscillator() {
      const click = { when: NaN, frequency: 0, stopped: false };
      const source = {
        ...node(),
        frequency: {
          set value(value: number) {
            click.frequency = value;
          },
        },
        onended: null as null | (() => void),
        start: (when: number) => {
          click.when = when;
          clicks.push(click);
        },
        stop: (when?: number) => {
          if (when === undefined) click.stopped = true;
        },
      };
      return source;
    },
  };
  return { context: context as unknown as AudioContext, clicks };
}
const noMidi = { connected: false, click: vi.fn() } as unknown as MidiPlayer;
const clock = (position: number, extra: Partial<ClickClock> = {}) => ({
  position,
  speed: 1,
  pass: 1,
  start: 0,
  loop: null,
  ...extra,
});

describe("metronome scheduling", () => {
  it("schedules laptop clicks a lookahead ahead, each once", () => {
    const track = createClickTrack(timing),
      metronome = new Metronome(),
      { context, clicks } = audioContext();
    metronome.tick(track, clock(0.4), 10, context, noMidi);
    expect(clicks.map(({ when }) => when)).toEqual([10.1]);
    // The accented beat is higher.
    expect(clicks[0].frequency).toBeGreaterThan(1500);
    metronome.tick(track, clock(0.45), 10.05, context, noMidi);
    expect(clicks).toHaveLength(1);
    metronome.tick(track, clock(0.9), 10.5, context, noMidi);
    expect(clicks.map(({ when }) => when)).toEqual([10.1, 10.6]);
    expect(clicks[1].frequency).toBeLessThan(1500);
  });
  it("schedules a loop's next pass ahead and keeps it through the wrap", () => {
    const track = createClickTrack(timing),
      metronome = new Metronome(),
      { context, clicks } = audioContext(),
      loop = [0.5, 2.5] as const;
    metronome.tick(
      track,
      clock(2.45, { loop, start: 0.5 }),
      20,
      context,
      noMidi,
    );
    // The loop's first beat, as the next pass begins.
    expect(clicks.map(({ when }) => when)).toEqual([20.05]);
    metronome.tick(
      track,
      clock(0.52, { loop, start: 0.5, pass: 2 }),
      20.07,
      context,
      noMidi,
    );
    expect(clicks).toHaveLength(1);
  });
  it("cancels clicks to come on a speed change and stop, then schedules again", () => {
    const track = createClickTrack(timing),
      metronome = new Metronome(),
      { context, clicks } = audioContext();
    metronome.tick(track, clock(0.4), 10, context, noMidi);
    metronome.reschedule(10.02);
    expect(clicks[0].stopped).toBe(true);
    // At half speed the beat is twice as far away.
    metronome.tick(track, clock(0.45, { speed: 0.5 }), 10.02, context, noMidi);
    expect(clicks[1].when).toBeCloseTo(10.12);
    metronome.stop(10.03);
    expect(clicks[1].stopped).toBe(true);
    // A click that has started rings out.
    metronome.tick(track, clock(0.45), 10.05, context, noMidi);
    metronome.stop(10.15);
    expect(clicks[2].stopped).toBe(false);
  });
  it("sends clicks to a MIDI output on the practice clock", () => {
    const track = createClickTrack(timing),
      metronome = new Metronome(),
      midi = { connected: true, click: vi.fn() } as unknown as MidiPlayer;
    // A count-in: song time from before 0, the clicks up to where it is.
    const counting = { start: -1.5 };
    metronome.tick(track, clock(-1.6, counting), 0, null, midi);
    expect(midi.click).not.toHaveBeenCalled();
    metronome.tick(track, clock(-1.49, counting), 0.11, null, midi);
    metronome.tick(track, clock(-1.47, counting), 0.13, null, midi);
    expect(vi.mocked(midi.click).mock.calls).toEqual([[true]]);
    // A late tick sends every click it passed.
    metronome.tick(track, clock(0.02, counting), 1.6, null, midi);
    expect(vi.mocked(midi.click).mock.calls).toEqual([
      [true],
      [false],
      [false],
      [false],
    ]);
    // A new pass clicks where it starts, but not before.
    metronome.tick(track, clock(0.52, { pass: 2, start: 0.5 }), 2, null, midi);
    expect(vi.mocked(midi.click).mock.calls.at(-1)).toEqual([true]);
    expect(midi.click).toHaveBeenCalledTimes(5);
  });
});
