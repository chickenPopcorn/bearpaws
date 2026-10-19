import { describe, expect, it } from "vitest";
import { attachDuet, duetNotes, parsePitch } from "../src/duet";
import type { Song } from "../src/song";

const notes = (bars: string[][], swing = false) =>
  duetNotes("piece", { octaves: 1, swing, bars }, 60, 4).map(
    ({ pitch, start, end, velocity }) => ({
      pitch,
      start,
      end: Math.round(end * 1000) / 1000,
      velocity,
    }),
  );

describe("teacher duet notation", () => {
  it("reads pitch names with accidentals, middle C being C4", () => {
    expect(["C4", "A0", "F#3", "Bb2", "B3", "C8"].map(parsePitch)).toEqual([
      60, 21, 54, 46, 59, 108,
    ]);
    expect(() => parsePitch("H2")).toThrow(/Unknown pitch/);
  });

  it("plays chords, rests and dynamics after a one-beat lead-in", () => {
    expect(notes([["pp G2+D3/2 r/1 mf B2/1"]])).toEqual([
      { pitch: 43, start: 1, end: 2.96, velocity: 0.3 },
      { pitch: 50, start: 1, end: 2.96, velocity: 0.3 },
      { pitch: 47, start: 4, end: 4.96, velocity: 0.6 },
    ]);
  });

  it("keeps a dynamic for the bars after it and starts at mp", () => {
    expect(
      notes([["C3/4"], ["f C3/4"], ["C3/4"]]).map((n) => n.velocity),
    ).toEqual([0.5, 0.72, 0.72]);
  });

  it("holds tied notes through the bar line without striking them again", () => {
    expect(
      notes([
        ["C3~/4", "E3/4"],
        ["C3/2 r/2", "E3/4"],
      ]),
    ).toEqual([
      { pitch: 48, start: 1, end: 6.96, velocity: 0.5 },
      { pitch: 52, start: 1, end: 4.96, velocity: 0.5 },
      { pitch: 52, start: 5, end: 8.96, velocity: 0.5 },
    ]);
  });

  it("plays staccato short and grace notes just before their note", () => {
    expect(notes([["r/1 D#3/g E3/1' r/2"]])).toEqual([
      { pitch: 51, start: 1.875, end: 2, velocity: 0.5 },
      { pitch: 52, start: 2, end: 2.45, velocity: 0.5 },
    ]);
  });

  it("swings off-beat eighths onto the triplet", () => {
    expect(
      notes([["C3/0.5 D3/0.5 E3/1 F3/0.5 G3/0.5 A3/1"]], true).map(
        (note) => Math.round(note.start * 1000) / 1000,
      ),
    ).toEqual([1, 1.667, 2, 3, 3.667, 4]);
  });

  it("rejects unknown tokens", () => {
    expect(() => notes([["C3 4"]])).toThrow(/Unknown duet token/);
  });

  it("gives a lesson its duet on its own track, unfingered, within the song", () => {
    const song: Song = {
      id: "lesson",
      title: "Lesson",
      notes: [],
      tracks: [],
      duration: 4.5,
      tempos: [],
      ppq: 480,
      warnings: [],
      beatsPerBar: 4,
      leadInBeats: 1,
      lesson: {
        composer: "",
        description: "",
        level: "",
        bpm: 60,
        handPositions: { left: "", right: "" },
      },
    };
    const withDuet = attachDuet(song, {
      octaves: 2,
      bars: [["G2/4"], ["G2/4"]],
    });
    expect(song.duet).toBeUndefined();
    expect(withDuet.duet!.octaves).toBe(2);
    expect(withDuet.duet!.notes.map((note) => note.id)).toEqual([
      "lesson-duet-0",
      "lesson-duet-1",
    ]);
    for (const note of withDuet.duet!.notes) {
      expect(note).toMatchObject({ track: 2, channel: 2 });
      expect(note.finger).toBeUndefined();
    }
    expect(withDuet.duration).toBeCloseTo(8.96 + 0.5);
    expect(attachDuet(song, undefined)).toBe(song);
  });
});
