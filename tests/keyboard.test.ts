import { describe, expect, it } from "vitest";
import {
  BLACK_KEY_HEIGHT,
  KEYBOARD_HEIGHT,
  keyLayout,
  pianoKeyAt,
  range,
} from "../src/render";
import type { Song } from "../src/song";

const song: Song = {
  id: "keyboard-geometry",
  title: "Keyboard geometry",
  duration: 1,
  ppq: 480,
  tempos: [],
  warnings: [],
  tracks: [],
  notes: [],
};
const keys = keyLayout(...range(song));

describe("piano keyboard geometry and pointer input", () => {
  it("keeps narrower black keys centered on their white-key boundaries", () => {
    for (const key of keys.filter((candidate) => candidate.black)) {
      const precedingWhite = keys.find(
        (candidate) => candidate.pitch === key.pitch - 1,
      )!;
      expect(key.width / precedingWhite.width).toBeCloseTo(0.56);
      expect(key.x + key.width / 2).toBeCloseTo(
        precedingWhite.x + precedingWhite.width,
      );
    }
  });

  it.each([400, 700])(
    "prioritizes black keys only within their visible height on a %ipx canvas",
    (height) => {
      const top = height - KEYBOARD_HEIGHT;
      for (const key of keys.filter((candidate) => candidate.black)) {
        // Use the right half so the white key below is unambiguous at the boundary.
        const x = key.x + key.width * 0.75;
        expect(pianoKeyAt(song, x, top, height)).toBe(key.pitch);
        expect(pianoKeyAt(song, x, top + BLACK_KEY_HEIGHT - 0.01, height)).toBe(
          key.pitch,
        );
        expect(pianoKeyAt(song, x, top + BLACK_KEY_HEIGHT, height)).toBe(
          key.pitch + 1,
        );
        expect(pianoKeyAt(song, x, height - 1, height)).toBe(key.pitch + 1);
      }
    },
  );

  it("preserves the full front surface of every white key as a click target", () => {
    const height = 400;
    for (const key of keys.filter((candidate) => !candidate.black)) {
      for (const fraction of [0.05, 0.5, 0.95]) {
        expect(
          pianoKeyAt(song, key.x + key.width * fraction, height - 1, height),
        ).toBe(key.pitch);
      }
    }
  });

  it("does not play notes for clicks on the waterfall or outside the keyboard", () => {
    const height = 400;
    expect(
      pianoKeyAt(song, 0.5, height - KEYBOARD_HEIGHT - 0.01, height),
    ).toBeUndefined();
    expect(pianoKeyAt(song, 0.5, height + 0.01, height)).toBeUndefined();
    expect(pianoKeyAt(song, -0.01, height - 1, height)).toBeUndefined();
    expect(pianoKeyAt(song, 1.01, height - 1, height)).toBeUndefined();
  });
});

describe("keyboard with the teacher duet", () => {
  const note = (id: string, pitch: number, track: number) => ({
    id,
    pitch,
    start: 0,
    end: 1,
    soundEnd: 1,
    velocity: 0.5,
    track,
    channel: track,
  });
  it("adds the duet's notes to the keys only when asked", () => {
    const duetSong: Song = {
      ...song,
      notes: [note("melody", 79, 1)],
      duet: { octaves: 1, notes: [note("bass", 31, 2)] },
    };
    expect(range(duetSong)).toEqual([48, 84]);
    // G1 to G5: no empty octave under the bass, none over the melody.
    expect(range(duetSong, true)).toEqual([31, 79]);
    const height = 400;
    // The leftmost white key is G1 with the duet, C3 without.
    expect(pianoKeyAt(duetSong, 0.001, height - 1, height)).toBe(48);
    expect(pianoKeyAt(duetSong, 0.001, height - 1, height, true)).toBe(31);
    expect(pianoKeyAt(duetSong, 0.999, height - 1, height, true)).toBe(79);
  });
  it("ends the duet's keys on white keys past black-key notes", () => {
    const duetSong: Song = {
      ...song,
      notes: [note("melody", 82, 1)],
      duet: { octaves: 1, notes: [note("bass", 30, 2)] },
    };
    // F#1 and A#5 sit between F1 and B5.
    expect(range(duetSong, true)).toEqual([29, 83]);
    const keys = keyLayout(...range(duetSong, true));
    for (const key of keys) {
      expect(key.x).toBeGreaterThanOrEqual(0);
      expect(key.x + key.width).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
