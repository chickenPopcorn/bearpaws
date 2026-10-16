import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseMidi } from "midi-file";
import { parseSong } from "../src/song";

vi.mock("midi-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("midi-file")>();
  return { ...actual, parseMidi: vi.fn(actual.parseMidi) };
});

function midi(...tracks: Uint8Array[]) {
  const bytes = new Uint8Array(
    14 + tracks.reduce((sum, track) => sum + 8 + track.length, 0),
  );
  bytes.set([
    0x4d,
    0x54,
    0x68,
    0x64,
    0,
    0,
    0,
    6,
    0,
    tracks.length > 1 ? 1 : 0,
    0,
    tracks.length,
    1,
    0xe0,
  ]);
  const view = new DataView(bytes.buffer);
  let offset = 14;
  for (const track of tracks) {
    bytes.set([0x4d, 0x54, 0x72, 0x6b], offset);
    view.setUint32(offset + 4, track.length);
    bytes.set(track, offset + 8);
    offset += 8 + track.length;
  }
  return bytes;
}

function variable(value: number) {
  const result = [value & 0x7f];
  while ((value = Math.floor(value / 128)))
    result.unshift((value & 0x7f) | 0x80);
  return result;
}

function attacks(count: number, paired = false) {
  // Every event after the first uses running note-on status. Velocity zero is a release.
  const stride = paired ? 6 : 3;
  const track = new Uint8Array(1 + count * stride + 4);
  track.set([0, 0x90, 60, 80]);
  let offset = 4;
  if (paired) {
    track.set([1, 60, 0], offset);
    offset += 3;
  }
  for (let i = 1; i < count; i++) {
    track.set([0, 60, 80], offset);
    offset += 3;
    if (paired) {
      track.set([1, 60, 0], offset);
      offset += 3;
    }
  }
  track.set([0, 0xff, 0x2f, 0], offset);
  return track;
}

const validNotes = [0, 0x90, 60, 80, 0x83, 0x60, 60, 0, 0, 0xff, 0x2f, 0];
beforeEach(() => {
  vi.mocked(parseMidi).mockClear();
});

describe("bounded MIDI import preflight", () => {
  it("rejects more than 50,000 running-status attacks before allocating parser events", () => {
    const bytes = midi(attacks(50001));
    expect(bytes.length).toBeLessThan(10 * 1024 * 1024);
    expect(() => parseSong(bytes, "Dense", "dense")).toThrow(
      /more than 50,000 notes/,
    );
    expect(parseMidi).not.toHaveBeenCalled();
  });

  it("counts the limit across tracks before full parsing", () => {
    expect(() =>
      parseSong(midi(attacks(25000), attacks(25001)), "Two tracks", "two"),
    ).toThrow(/more than 50,000 notes/);
    expect(parseMidi).not.toHaveBeenCalled();
  });

  it("bounds controller-heavy files before allocating their full event arrays", () => {
    const controllers = new Uint8Array(1 + 500001 * 3 + validNotes.length);
    controllers.set([0, 0xb0, 1, 64]);
    let offset = 4;
    for (let i = 1; i < 500001; i++) {
      controllers.set([0, 1, 64], offset);
      offset += 3;
    }
    controllers.set(validNotes, offset);
    const bytes = midi(controllers);
    expect(bytes.length).toBeLessThan(10 * 1024 * 1024);
    expect(() => parseSong(bytes, "Controller dense", "controllers")).toThrow(
      /more than 500,000 events/,
    );
    expect(parseMidi).not.toHaveBeenCalled();
  });

  it("accepts exactly 50,000 paired attacks without counting velocity-zero releases", () => {
    const song = parseSong(midi(attacks(50000, true)), "At the limit", "limit");
    expect(parseMidi).toHaveBeenCalledOnce();
    expect(song.notes).toHaveLength(50000);
    expect(song.warnings).toEqual([]);
    expect(song.notes.at(-1)!.end).toBeCloseTo(50000 / 960);
  });

  it("preserves channel running status across a meta event as the full parser does", () => {
    const track = Uint8Array.from([
      0, 0x90, 60, 80, 0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0x83, 0x60, 60, 0, 0,
      0xff, 0x2f, 0,
    ]);
    const song = parseSong(midi(track), "Running across meta", "running-meta");
    expect(song.notes).toHaveLength(1);
    expect(song.notes[0]).toMatchObject({ pitch: 60, start: 0, end: 0.5 });
  });

  it("skips bounded meta and SysEx payloads instead of interpreting embedded note bytes", () => {
    const payload = new Uint8Array(160000).fill(0x90);
    const track: number[] = [];
    for (const prefix of [
      [0, 0xff, 0x7f],
      [0, 0xf0],
      [0, 0xf7],
    ]) {
      track.push(...prefix, ...variable(payload.length));
      // Append without spreading the large payload onto the JS argument stack.
      for (const byte of payload) track.push(byte);
    }
    track.push(...validNotes);
    const song = parseSong(
      midi(Uint8Array.from(track)),
      "Payloads",
      "payloads",
    );
    expect(song.notes).toHaveLength(1);
    expect(song.notes[0]).toMatchObject({ pitch: 60, start: 0, end: 0.5 });
  });

  it.each([
    ["truncated meta payload", [0, 0xff, 0x7f, 10, 1]],
    ["truncated SysEx payload", [0, 0xf0, 10, 1]],
    [
      "meta length exceeding four bytes",
      [0, 0xff, 0x7f, 0x81, 0x80, 0x80, 0x80, 0],
    ],
    ["SysEx length exceeding four bytes", [0, 0xf7, 0x81, 0x80, 0x80, 0x80, 0]],
    [
      "delta time exceeding four bytes",
      [0x81, 0x80, 0x80, 0x80, 0, 0x90, 60, 80],
    ],
    ["truncated channel event", [0, 0x90, 60]],
    ["running status without a channel status", [0, 60, 80]],
    ["running status leaking across tracks", [0, 60, 0]],
  ])("rejects %s before full parsing", (_, malformed) => {
    const tracks =
      _ === "running status leaking across tracks"
        ? [Uint8Array.from(validNotes), Uint8Array.from(malformed)]
        : [Uint8Array.from(malformed)];
    expect(() => parseSong(midi(...tracks), "Malformed", "malformed")).toThrow(
      /malformed|incomplete/,
    );
    expect(parseMidi).not.toHaveBeenCalled();
  });

  it("rejects a maximum-size declared payload rather than skipping beyond its track", () => {
    const bytes = midi(
      Uint8Array.from([0, 0xff, 0x7f, ...variable(0x0fffffff), ...validNotes]),
    );
    expect(() => parseSong(bytes, "Bad length", "length")).toThrow(
      /malformed|incomplete/,
    );
    expect(parseMidi).not.toHaveBeenCalled();
  });
});
