import { describe, expect, it } from "vitest";
import { writeMidi } from "midi-file";
import { buildScore } from "../src/notation";
import {
  parseSong,
  songVersion,
  type Song,
  type TimeSignature,
} from "../src/song";
import { createBeatClock } from "../src/timeline";
import { fixtureLibrary } from "./fixtures/library";

function midi(signatures: TimeSignature[], count = 12, noteTicks = 240) {
  let previous = 0;
  const meterEvents = signatures.map(({ tick, numerator, denominator }) => {
    const deltaTime = tick - previous;
    previous = tick;
    return {
      deltaTime,
      type: "timeSignature" as const,
      numerator,
      denominator,
      metronome: 24,
      thirtyseconds: 8,
    };
  });
  const notes = Array.from({ length: count }, (_, index) => [
    {
      deltaTime: 0,
      type: "noteOn" as const,
      channel: 0,
      noteNumber: 60 + (index % 5),
      velocity: 90,
    },
    {
      deltaTime: noteTicks,
      type: "noteOff" as const,
      channel: 0,
      noteNumber: 60 + (index % 5),
      velocity: 0,
    },
  ]).flat();
  return new Uint8Array(
    writeMidi({
      header: { format: 1, numTracks: 2, ticksPerBeat: 480 },
      tracks: [meterEvents, notes],
    }),
  );
}

describe("imported MIDI meter", () => {
  it.each([
    [3, 4, 6, 480],
    [6, 8, 12, 240],
  ])(
    "preserves %s/%s and places two bars at their quarter-note boundaries",
    (numerator, denominator, count, noteTicks) => {
      const signature = { tick: 0, numerator, denominator };
      const song = parseSong(
        midi([signature], count, noteTicks),
        "Imported",
        "meter",
      );
      expect(song.timeSignatures).toEqual([signature]);
      const score = buildScore(song);
      expect(score.meter.measureAt(0).beatsPerBar).toBe(3);
      expect(score.measureCount).toBe(2);
      expect(score.measures.get(0)).toHaveLength(count / 2);
      expect(score.measures.get(1)?.[0]).toMatchObject({ beat: 3, offset: 0 });
      expect(score.meter.measureAt(1)).toMatchObject({
        numerator,
        denominator,
        beatUnit: 4 / denominator,
      });
    },
  );

  it("retains meter changes and maps each new signature to the correct following bars", () => {
    const signatures = [
      { tick: 0, numerator: 3, denominator: 4 },
      { tick: 6 * 480, numerator: 2, denominator: 4 },
      { tick: 10 * 480, numerator: 6, denominator: 8 },
    ];
    const song = parseSong(midi(signatures, 26), "Changing meter", "changes");
    expect(song.timeSignatures).toEqual(signatures);
    const score = buildScore(song);
    expect(score.measureCount).toBe(5);
    expect(
      [0, 1, 2, 3, 4].map((index) => score.meter.measureAt(index).start),
    ).toEqual([0, 3, 6, 8, 10]);
    expect(score.measures.get(4)?.[1]).toMatchObject({
      beat: 10.5,
      offset: 0.5,
    });
    expect(score.meter.measureAt(4)).toMatchObject({
      numerator: 6,
      denominator: 8,
      length: 3,
    });
  });

  it("uses 4/4 for a MIDI with no time signature", () => {
    const song = parseSong(midi([], 8, 480), "No meter", "default");
    expect(song.timeSignatures).toEqual([]);
    expect(buildScore(song).measureCount).toBe(2);
  });

  it.each([
    [0, 4],
    [3, 2 ** 32],
  ])(
    "rejects unsupported raw signature %s/%s before the parser can wrap its denominator",
    (numerator, denominator) => {
      expect(() =>
        parseSong(
          midi([{ tick: 0, numerator, denominator }]),
          "Invalid",
          "invalid",
        ),
      ).toThrow("unsupported time signature");
    },
  );
});

describe("song version", () => {
  const ode = () => fixtureLibrary()[0];
  /** `song` at a steady `microseconds` per beat: the same notes on the same beats. */
  function retimed(song: Song, microseconds: number): Song {
    const tempos = [{ tick: 0, microseconds }],
      from = createBeatClock(song.ppq, song.tempos),
      to = createBeatClock(song.ppq, tempos),
      time = (seconds: number) => to.time(from.at(seconds));
    return {
      ...song,
      tempos,
      duration: time(song.duration),
      notes: song.notes.map((note) => ({
        ...note,
        start: time(note.start),
        end: time(note.end),
        soundEnd: time(note.soundEnd),
      })),
    };
  }

  it("stays the same when only the tempo changes", () => {
    const song = ode();
    expect(songVersion(song)).toMatch(/^[0-9a-f]{8}$/);
    for (const microseconds of [1_000_000, 444_444, 500_000])
      expect(songVersion(retimed(song, microseconds))).toBe(songVersion(song));
  });

  it("stays the same at another MIDI resolution", () => {
    const song = ode();
    // Exported at 960 ticks per beat: every tick doubles, every time stays.
    const finer = {
      ...song,
      ppq: 960,
      tempos: song.tempos.map((tempo) => ({ ...tempo, tick: tempo.tick * 2 })),
    };
    expect(songVersion(finer)).toBe(songVersion(song));
    const [first, ...rest] = finer.notes;
    // One tick later at 960 ticks per beat, where 750,000 µs is a beat.
    const moved = [{ ...first, start: first.start + 0.75 / 960 }, ...rest];
    expect(songVersion({ ...finer, notes: moved })).not.toBe(songVersion(song));
  });

  it("follows the student's notes, not their order or the duet", () => {
    const song = fixtureLibrary()[1];
    const version = songVersion(song);
    expect(songVersion({ ...song, notes: [...song.notes].reverse() })).toBe(
      version,
    );
    expect(songVersion({ ...song, duet: undefined })).toBe(version);
    const [first, ...rest] = song.notes;
    for (const changed of [
      [{ ...first, pitch: first.pitch + 1 }, ...rest],
      // One tick later, at 480 ticks per beat.
      [{ ...first, start: first.start + 0.75 / 480 }, ...rest],
      rest,
    ])
      expect(songVersion({ ...song, notes: changed })).not.toBe(version);
  });
});
