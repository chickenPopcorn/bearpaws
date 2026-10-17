import { describe, expect, it } from "vitest";
import {
  buildScore,
  createBeatClock,
  createMeterMap,
  isNotePlayed,
  pitchPosition,
  rhythmForBeats,
  scoreBeatAtX,
  scoreTimeAtX,
  scoreWindow,
  scoreViewport,
} from "../src/notation";
import { builtInSongs } from "../src/lessons";
import { tempoConverter, type Note, type Song } from "../src/song";

function note(id: string, start: number, end: number): Note {
  return {
    id,
    pitch: 60,
    velocity: 0.7,
    start,
    end,
    soundEnd: end,
    track: 0,
    channel: 0,
  };
}

function song(notes: Note[], duration: number): Song {
  return {
    id: "score-fixture",
    title: "Score fixture",
    notes,
    duration,
    tracks: [{ id: 0, name: "Right", hand: "right", count: notes.length }],
    ppq: 480,
    tempos: [],
    warnings: [],
  };
}

describe("sheet timeline beat clock", () => {
  it("uses MIDI's default tempo before the first change", () => {
    const clock = createBeatClock(480, [
      { tick: 480, microseconds: 1_000_000 },
    ]);
    expect(clock.at(0)).toBe(0);
    expect(clock.at(0.25)).toBeCloseTo(0.5);
    expect(clock.at(0.5)).toBeCloseTo(1);
    expect(clock.at(1)).toBeCloseTo(1.5);
    expect(clock.time(2)).toBeCloseTo(1.5);
  });

  it("inverts the playback tempo map across unsorted changes and duplicate tick-zero tempos", () => {
    const tempos = [
      { tick: 960, microseconds: 250_000 },
      { tick: 0, microseconds: 750_000 },
      { tick: 480, microseconds: 500_000 },
      { tick: 0, microseconds: 1_000_000 },
    ];
    const clock = createBeatClock(480, tempos);
    const playbackTime = tempoConverter(480, tempos);
    for (const beat of [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 4, 100]) {
      const seconds = playbackTime(beat * 480);
      expect(clock.time(beat)).toBeCloseTo(seconds, 9);
      expect(clock.at(seconds)).toBeCloseTo(beat, 9);
    }
    expect(clock.at(1.25)).toBeCloseTo(1.5);
    expect(clock.at(1.625)).toBeCloseTo(2.5);
  });
});

describe("meter-aware score geometry", () => {
  const changing = () =>
    createMeterMap({
      ppq: 480,
      timeSignatures: [
        { tick: 0, numerator: 4, denominator: 4 },
        { tick: 8 * 480, numerator: 3, denominator: 4 },
        { tick: 14 * 480, numerator: 6, denominator: 8 },
      ],
    });

  it("round-trips score positions and seeking across meter changes", () => {
    const meter = changing();
    for (const beat of [0, 1.25, 7.99, 8, 9.5, 13.99, 14, 16.5, 17, 1000]) {
      expect(meter.beatAt(meter.coordinate(beat))).toBeCloseTo(beat, 8);
      const viewport = scoreViewport(beat, 1000, meter);
      const x =
        88 +
        24 +
        (meter.coordinate(beat) - viewport.first) * viewport.measureWidth -
        viewport.offset;
      expect(
        scoreBeatAtX(
          x,
          viewport.first,
          viewport.last,
          viewport.measureWidth,
          meter,
          88,
          viewport.offset,
        ),
      ).toBeCloseTo(beat, 8);
    }
    // Moving one bar keeps the same relative place across 4/4 -> 3/4.
    expect(meter.beatAt(meter.coordinate(6) + 1)).toBe(9.5);
  });

  it("ends a partial bar exactly at a signature change", () => {
    const meter = createMeterMap({
      ppq: 480,
      timeSignatures: [{ tick: 1200, numerator: 3, denominator: 4 }],
    });
    expect(meter.measureAt(0)).toMatchObject({
      start: 0,
      end: 2.5,
      length: 2.5,
    });
    expect(meter.at(2.5)).toMatchObject({ measure: 1, offset: 0, length: 3 });
    expect(meter.coordinate(1.25)).toBe(0.5);
    expect(meter.beatAt(1.5)).toBe(4);
  });

  it("retains count-in navigation and legacy lesson metadata", () => {
    const meter = createMeterMap({ ppq: 480, beatsPerBar: 3, leadInBeats: 1 });
    expect(meter.measureAt(0)).toMatchObject({
      numerator: 3,
      denominator: 4,
      length: 3,
    });
    expect(meter.beatAt(meter.coordinate(-1) + 1)).toBe(2);
    expect(meter.beatAt(meter.coordinate(0.5) - 1)).toBe(-2.5);
  });

  it("ignores malformed persisted metadata and repeated signatures", () => {
    const meter = createMeterMap({
      ppq: 480,
      beatsPerBar: Infinity,
      timeSignatures: [
        { tick: 0, numerator: 6, denominator: 8 },
        { tick: 1, numerator: 0, denominator: 4 },
        { tick: 2, numerator: 3, denominator: 0 },
        { tick: NaN, numerator: 3, denominator: 4 },
        { tick: 100, numerator: 6, denominator: 8 },
        { tick: 200, numerator: 3, denominator: 7 },
      ],
    });
    expect(meter.at(3)).toMatchObject({
      measure: 1,
      numerator: 6,
      denominator: 8,
      start: 3,
    });
    expect(meter.beatAt(100_000_000)).toBe(300_000_000);
  });

  it("keeps a huge sparse score bounded while locating a late meter change", () => {
    const piece = song(
      [note("first", 0, 0.5), note("late", 5_000_000, 5_000_000.25)],
      5_000_001,
    );
    piece.timeSignatures = [
      { tick: 0, numerator: 3, denominator: 4 },
      { tick: 9_999_999 * 480, numerator: 6, denominator: 8 },
    ];
    const score = buildScore(piece);
    expect(score.measures.size).toBe(2);
    expect(score.measures.get(3_333_333)?.[0]).toMatchObject({
      note: { id: "late" },
      offset: 1,
    });
    const viewport = scoreViewport(10_000_000, score.measureCount, score.meter);
    expect(viewport.last - viewport.first).toBeLessThanOrEqual(4);
  });
});

describe("written note values", () => {
  it("places middle C on the ledger between the treble and bass staves", () => {
    expect(pitchPosition(64, "right").y).toBe(104);
    expect(pitchPosition(60, "right").y).toBe(114);
    expect(pitchPosition(43, "left").y).toBe(212);
    expect(pitchPosition(60, "left").y).toBe(162);
    expect(pitchPosition(61, "right")).toMatchObject({
      y: pitchPosition(60, "right").y,
      sharp: true,
    });
    expect(pitchPosition(72, "right").y).toBe(
      pitchPosition(60, "right").y - 35,
    );
  });

  it.each([
    [4, 4, false, 0, false, false],
    [2, 2, false, 0, false, true],
    [1, 1, false, 0, true, true],
    [0.5, 0.5, false, 1, true, true],
    [0.25, 0.25, false, 2, true, true],
    [1.5, 1, true, 0, true, true],
    [0.75, 0.5, true, 1, true, true],
  ])(
    "shows %s beats with the correct notehead, stem, flag and dot",
    (beats, baseBeats, dotted, flags, filled, stem) => {
      expect(rhythmForBeats(beats)).toMatchObject({
        beats,
        baseBeats,
        dotted,
        flags,
        filled,
        stem,
      });
    },
  );

  it("keeps Ode to Joy's dotted quarter, eighth and held bass despite audio release gaps", () => {
    const ode = builtInSongs().find((piece) => piece.title === "Ode to Joy")!;
    const score = buildScore(ode);
    const fourthBar = score.measures.get(3)!;
    const melody = fourthBar.filter((item) => item.note.track === 1);
    expect(melody.map((item) => [item.offset, item.duration])).toEqual([
      [0, 1.5],
      [1.5, 0.5],
      [2, 2],
    ]);
    expect(melody.map((item) => item.rhythm.dotted)).toEqual([
      true,
      false,
      false,
    ]);
    expect(fourthBar.find((item) => item.note.track === 0)!.duration).toBe(4);
  });

  it("shows short staccato attacks as written quarter notes after the count-in", () => {
    const rain = builtInSongs().find(
      (piece) => piece.title === "Dancing Raindrops",
    )!;
    const score = buildScore(rain);
    const firstBar = score.measures.get(0)!;
    expect(firstBar.map((item) => item.offset)).toEqual([0, 1, 2, 3]);
    expect(firstBar.every((item) => item.duration === 1)).toBe(true);
    expect(firstBar.every((item) => item.rhythm.flags === 0)).toBe(true);
    expect(firstBar.every((item) => item.note.staccato)).toBe(true);
    expect(score.measures.get(6)!.every((item) => !item.note.staccato)).toBe(
      true,
    );
  });

  it("uses a MIDI key's release instead of sustain-pedal resonance for its written duration", () => {
    const heldByPedal = { ...note("pedal", 0, 0.5), soundEnd: 8 };
    const score = buildScore(song([heldByPedal], 9));
    expect(score.measures.get(0)![0].duration).toBeCloseTo(1);
    expect(score.measures.get(0)![0].rhythm.baseBeats).toBe(1);
  });
});

describe("sheet timeline progress", () => {
  it.each(["wait", "rhythm"] as const)(
    "dims only accepted notes in %s mode, including part of a chord",
    (mode) => {
      const lower = note("lower", 2, 2.5);
      const upper = { ...note("upper", 2, 2.5), pitch: 64 };
      const hit = new Set([lower.id]);
      expect(isNotePlayed(lower, mode, hit, 2)).toBe(true);
      expect(isNotePlayed(upper, mode, hit, 2)).toBe(false);
      expect(isNotePlayed(upper, mode, hit, 20)).toBe(false);
      expect(isNotePlayed(lower, mode, new Set(), 20)).toBe(false);
    },
  );

  it("follows reference playback in Listen mode without marking future or skipped earlier notes", () => {
    const current = note("current", 2, 3);
    expect(isNotePlayed(current, "listen", new Set(), 1.9)).toBe(false);
    expect(isNotePlayed(current, "listen", new Set(), 2.1)).toBe(true);
    expect(isNotePlayed(current, "listen", new Set(), 10, 4)).toBe(false);
    expect(isNotePlayed(current, "listen", new Set(), 0)).toBe(false);
  });
});

describe("bounded score rendering", () => {
  it("keeps the current measure visible and clamps a three-measure window at both ends", () => {
    expect(scoreWindow(0, 10, 3)).toEqual({ first: 0, last: 3 });
    expect(scoreWindow(9, 10, 3)).toEqual({ first: 7, last: 10 });
    expect(scoreWindow(0, 1, 3)).toEqual({ first: 0, last: 1 });
    for (let measure = 0; measure < 10; measure++) {
      const { first, last } = scoreWindow(measure, 10, 3);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(last).toBeLessThanOrEqual(10);
      expect(last - first).toBeLessThanOrEqual(3);
      expect(measure).toBeGreaterThanOrEqual(first);
      expect(measure).toBeLessThan(last);
    }
  });

  it("scrolls continuously across bars and when the rendered measure window rebases", () => {
    const screenX = (beat: number, noteBeat: number) => {
      const viewport = scoreViewport(beat, 12, 4);
      return (
        88 +
        24 +
        (noteBeat / 4 - viewport.first) * viewport.measureWidth -
        viewport.offset
      );
    };
    const beforeBar = screenX(7.999, 12);
    const afterBar = screenX(8.001, 12);
    expect(Math.abs(afterBar - beforeBar)).toBeLessThan(1);

    const initial = scoreViewport(0, 12, 4);
    const rebaseBeat =
      ((initial.measureWidth + (initial.viewWidth - 103) * 0.34 - 24) /
        initial.measureWidth) *
      4;
    const before = scoreViewport(rebaseBeat - 0.001, 12, 4);
    const after = scoreViewport(rebaseBeat + 0.001, 12, 4);
    expect(after.first).toBe(before.first + 1);
    expect(
      Math.abs(
        screenX(rebaseBeat + 0.001, 12) - screenX(rebaseBeat - 0.001, 12),
      ),
    ).toBeLessThan(1);
  });

  it("clamps smooth scrolling at both ends and renders only the viewport plus one extra bar", () => {
    for (const count of [1, 2, 3]) {
      const start = scoreViewport(-10, 12, 4, count, 960);
      expect(start.first).toBe(0);
      expect(start.offset).toBe(0);
      const end = scoreViewport(10_000, 12, 4, count, 960);
      expect(end.first).toBe(12 - count);
      expect(end.last).toBe(12);
      expect(end.offset).toBeCloseTo(0);
      for (let beat = 0; beat <= 48; beat += 0.125) {
        const viewport = scoreViewport(beat, 12, 4, count, 960);
        expect(viewport.first).toBeGreaterThanOrEqual(0);
        expect(viewport.last).toBeLessThanOrEqual(12);
        expect(viewport.last - viewport.first).toBeLessThanOrEqual(count + 1);
        expect(viewport.offset).toBeGreaterThanOrEqual(0);
        expect(viewport.offset).toBeLessThan(viewport.measureWidth + 0.000001);
      }
    }
    const short = scoreViewport(10, 1, 4, 3, 320);
    expect(short).toMatchObject({
      first: 0,
      last: 1,
      viewWidth: 320,
      offset: 0,
    });
  });

  it.each([
    [1, 320],
    [2, 600],
    [3, 960],
  ])(
    "leaves room for the final short note at a %s-bar viewport",
    (count, width) => {
      const viewport = scoreViewport(32, 8, 4, count, width);
      for (const duration of [0.25, 0.0625]) {
        const x =
          88 +
          24 +
          ((32 - duration) / 4 - viewport.first) * viewport.measureWidth -
          viewport.offset;
        expect(x + 16).toBeLessThanOrEqual(viewport.viewWidth - 15);
      }
    },
  );

  it("indexes a maximum-size MIDI by measure so a late window retrieves only its own notes", () => {
    const notes = Array.from({ length: 50_000 }, (_, index) =>
      note(`dense-${index}`, index * 0.5, index * 0.5 + 0.45),
    );
    const score = buildScore(song(notes, 25_000));
    const window = scoreWindow(12_499, score.measureCount, 3);
    const visible = [];
    for (let measure = window.first; measure < window.last; measure++)
      visible.push(...(score.measures.get(measure) ?? []));
    expect(visible.length).toBeLessThanOrEqual(12);
    expect(visible.some((item) => item.note.id === "dense-49999")).toBe(true);
    expect(visible.every((item) => item.measure >= window.first)).toBe(true);
  });
});

describe("seeking on the printed score", () => {
  it("maps note positions back to fractional beats in the visible measure window", () => {
    // The first visible bar is bar five: the clefs and note inset are not time.
    expect(scoreBeatAtX(112, 4, 7, 240, 4)).toBeCloseTo(16);
    expect(scoreBeatAtX(232, 4, 7, 240, 4)).toBeCloseTo(18);
    expect(scoreBeatAtX(352, 4, 7, 240, 4)).toBeCloseTo(20);
    expect(scoreBeatAtX(382, 4, 7, 240, 4)).toBeCloseTo(20.5);
  });

  it("clamps dragging before or after the displayed measures to their boundaries", () => {
    expect(scoreBeatAtX(-500, 4, 7, 240, 4)).toBe(16);
    expect(scoreBeatAtX(10_000, 4, 7, 240, 4)).toBe(28);
    expect(scoreBeatAtX(0, 0, 3, 240, 4)).toBe(0);
  });

  it("seeks to the note under the pointer after the score has translated", () => {
    const viewport = scoreViewport(9.25, 12, 4);
    const noteBeat = 12.5;
    const x =
      88 +
      24 +
      (noteBeat / 4 - viewport.first) * viewport.measureWidth -
      viewport.offset;
    expect(
      scoreBeatAtX(
        x,
        viewport.first,
        viewport.last,
        viewport.measureWidth,
        4,
        88,
        viewport.offset,
      ),
    ).toBeCloseTo(noteBeat);
    const clock = createBeatClock(480, []);
    expect(
      scoreTimeAtX(x, { ...viewport, beatsPerBar: 4 }, clock, 1, 30),
    ).toBeCloseTo((noteBeat + 1) / 2);
  });

  it("uses the score meter and converts through the count-in and changing tempo", () => {
    // Two bars of 3/4, one count-in beat, initially 60 BPM then 120 BPM at beat four.
    const beat = scoreBeatAtX(272, 0, 2, 240, 3);
    expect(beat).toBeCloseTo(2);
    const clock = createBeatClock(480, [
      { tick: 0, microseconds: 1_000_000 },
      { tick: 1920, microseconds: 500_000 },
    ]);
    expect(clock.time(beat + 1)).toBeCloseTo(3);
    const laterBeat = scoreBeatAtX(512, 0, 2, 240, 3);
    expect(laterBeat).toBeCloseTo(5);
    expect(clock.time(laterBeat + 1)).toBeCloseTo(5);
  });

  it("seeks by the supplied visible geometry and clamps to the actual song duration", () => {
    const clock = createBeatClock(480, []);
    const geometry = { first: 4, last: 7, measureWidth: 240, beatsPerBar: 4 };
    expect(scoreTimeAtX(112, geometry, clock, 1, 10)).toBeCloseTo(8.5);
    expect(scoreTimeAtX(232, geometry, clock, 1, 10)).toBeCloseTo(9.5);
    expect(scoreTimeAtX(10_000, geometry, clock, 1, 10)).toBe(10);
  });
});
