import { describe, expect, it } from "vitest";
import { parseSong } from "../src/song";

function midi(track: Uint8Array) {
  const bytes = new Uint8Array(22 + track.length);
  bytes.set([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72,
    0x6b,
  ]);
  new DataView(bytes.buffer).setUint32(18, track.length);
  bytes.set(track, 22);
  return bytes;
}

const count = 50000;
const velocity = (i: number) => (i % 127) + 1;

describe("bounded dense-note normalization", () => {
  it("pairs 50,000 overlapping same-pitch attacks FIFO with their own onset and velocity", () => {
    const track = new Uint8Array(count * 8 + 4);
    for (let i = 0; i < count; i++) {
      track.set([1, 0x90, 60, velocity(i)], i * 4);
      track.set([1, 0x80, 60, 0], count * 4 + i * 4);
    }
    track.set([0, 0xff, 0x2f, 0], count * 8);
    const song = parseSong(
      midi(track),
      "Overlapping at the limit",
      "overlapping",
    );
    expect(song.notes).toHaveLength(count);
    expect(song.warnings).toEqual([]);
    const mismatches = song.notes.filter(
      (n, i) =>
        Math.abs(n.start - (i + 1) / 960) > 1e-9 ||
        Math.abs(n.end - (count + i + 1) / 960) > 1e-9 ||
        n.velocity !== velocity(i) / 127 ||
        n.pitch !== 60 ||
        n.channel !== 0,
    );
    expect(mismatches).toEqual([]);
    expect(song.notes[0].end - song.notes[0].start).toBeCloseTo(count / 960);
    expect(song.notes.at(-1)!.end - song.notes.at(-1)!.start).toBeCloseTo(
      count / 960,
    );
  });

  it("closes only entries still pending after earlier FIFO releases", () => {
    const track = Uint8Array.from([
      0, 0x90, 60, 20, 1, 0x90, 60, 40, 1, 0x90, 60, 60, 1, 0x80, 60, 0, 0x83,
      0x60, 0xff, 0x2f, 0,
    ]);
    const song = parseSong(midi(track), "Pending notes", "pending");
    expect(song.notes).toHaveLength(3);
    expect(song.notes.map((n) => n.velocity)).toEqual([
      20 / 127,
      40 / 127,
      60 / 127,
    ]);
    expect(song.notes[0].end).toBeCloseTo(3 / 960);
    expect(song.notes[1].end).toBeCloseTo(483 / 960);
    expect(song.notes[2].end).toBeCloseTo(483 / 960);
    expect(song.tracks[0].name).toBe("Track 1");
    expect(song.warnings).toEqual(["Unclosed note ended at track boundary."]);
  });

  it("normalizes 50,000 interleaved sustained notes with independent channel pedal releases", () => {
    const track = new Uint8Array(8 + count * 8 + 10 + 4);
    track.set([0, 0xb0, 64, 127, 0, 0xb1, 64, 127]);
    for (let i = 0; i < count; i++) {
      const channel = i % 2;
      track.set(
        [1, 0x90 | channel, 60, velocity(i), 1, 0x80 | channel, 60, 0],
        8 + i * 8,
      );
    }
    track.set(
      [0x83, 0x60, 0xb0, 64, 0, 0x83, 0x60, 0xb1, 64, 0, 0, 0xff, 0x2f, 0],
      8 + count * 8,
    );
    const song = parseSong(midi(track), "Interleaved sustain", "interleaved");
    expect(song.notes).toHaveLength(count);
    expect(song.warnings).toEqual([]);
    const mismatches = song.notes.filter(
      (n, i) =>
        n.channel !== i % 2 ||
        Math.abs(n.end - ((i + 1) * 2) / 960) > 1e-9 ||
        Math.abs(n.soundEnd - (count * 2 + ((i % 2) + 1) * 480) / 960) > 1e-9,
    );
    expect(mismatches).toEqual([]);
    expect(song.notes[0].soundEnd).toBeLessThan(song.notes[1].soundEnd);
    expect(song.notes.at(-1)!.end).toBeLessThan(song.notes.at(-1)!.soundEnd);
  });

  it.each([159, 160, 10000])(
    "caps a %i-character normalized track display name at 160 characters",
    (length) => {
      const encodedLength =
        length < 128 ? [length] : [(length >> 7) | 0x80, length & 0x7f];
      const prefix = [0, 0xff, 3, ...encodedLength];
      const notes = [0, 0x90, 60, 80, 1, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
      const track = new Uint8Array(prefix.length + length + notes.length);
      track.set(prefix);
      track.fill(0x6e, prefix.length, prefix.length + length);
      track.set(notes, prefix.length + length);
      const song = parseSong(midi(track), "Long name", "long-name");
      expect(song.tracks[0].name).toBe("n".repeat(Math.min(160, length)));
      expect(song.notes).toHaveLength(1);
    },
  );
});
