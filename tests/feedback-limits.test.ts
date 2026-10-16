import { describe, expect, it } from "vitest";
import { MidiState, Practice, type Mode } from "../src/engine";
import type { Note } from "../src/song";

function note(id: string, pitch: number, start: number): Note {
  return {
    id,
    pitch,
    start,
    end: start + 0.3,
    soundEnd: start + 0.3,
    track: 0,
    channel: 0,
    velocity: 0.8,
  };
}

function deliver(
  practice: Practice,
  physical: MidiState,
  mode: Mode,
  data: number[],
  position: number,
) {
  const edge = physical.message(data);
  return (
    edge && practice.input(edge.pitch, position, mode, 0.2, 1, physical.down)
  );
}

// Long-running practice must retain useful totals without retaining every input event.
describe("bounded practice feedback", () => {
  it("bounds 10,000 wrong Wait presses while preserving physical chord and repeated-note gating", () => {
    const practice = new Practice([
      note("c", 60, 1),
      note("e", 64, 1),
      note("repeat", 60, 2),
    ]);
    const physical = new MidiState();
    for (let i = 0; i < 10_000; i++) {
      const pitch = i % 2 === 0 ? 61 : 63;
      deliver(practice, physical, "wait", [0x90, pitch, 100], 1);
      deliver(practice, physical, "wait", [0x90, pitch, 0], 1);
    }
    expect(practice.feedback.length).toBeLessThanOrEqual(256);
    expect(practice.feedback.length).toBeGreaterThan(0);
    expect(practice.feedback.at(-1)).toEqual({
      kind: "wrong",
      pitch: 63,
      at: 1,
    });
    expect(practice.stats.wrong).toBe(10_000);
    expect(practice.stats.matched).toBe(0);
    expect(practice.gate?.start).toBe(1);
    expect(practice.hit.size).toBe(0);
    expect(physical.down.size).toBe(0);
    expect(physical.sounding.size).toBe(0);

    deliver(practice, physical, "wait", [0x90, 60, 100], 1);
    deliver(practice, physical, "wait", [0x80, 60, 0], 1);
    deliver(practice, physical, "wait", [0x90, 64, 100], 1);
    expect(practice.gate?.start).toBe(1); // A previously pressed, released C cannot fill this chord.
    expect(deliver(practice, physical, "wait", [0x90, 60, 100], 1)).toBe(true);
    expect(practice.gate?.start).toBe(2);
    expect(
      deliver(practice, physical, "wait", [0x90, 60, 100], 2),
    ).toBeUndefined();
    expect(practice.gate?.start).toBe(2); // A repeated note still needs a fresh physical edge.
    deliver(practice, physical, "wait", [0xb0, 64, 127], 2);
    deliver(practice, physical, "wait", [0x90, 60, 0], 2);
    expect(physical.down.has(60)).toBe(false);
    expect(physical.sounding.has(60)).toBe(true);
    expect(deliver(practice, physical, "wait", [0x90, 60, 80], 2)).toBe(true);
    expect(practice.gate).toBeUndefined();
    expect(practice.hit.size).toBe(3);
    expect(practice.stats.matched).toBe(3);
    expect(practice.stats.wrong).toBe(10_000);
    expect(practice.feedback.length).toBeLessThanOrEqual(256);
  });

  it("retains full-session Rhythm timing aggregates after detailed events are evicted", () => {
    const notes = Array.from({ length: 1_000 }, (_, i) =>
      note(`note-${i}`, 60, i + 1),
    );
    const practice = new Practice(notes);
    const physical = new MidiState();
    const offsets = [0.1, -0.1, 0.025, -0.025];
    let timingAbsTotal = 0;
    for (let i = 0; i < notes.length; i++) {
      const offset = offsets[i % offsets.length];
      timingAbsTotal += Math.abs(offset);
      deliver(
        practice,
        physical,
        "rhythm",
        [0x90, 60, 100],
        notes[i].start + offset,
      );
      deliver(
        practice,
        physical,
        "rhythm",
        [0x80, 60, 0],
        notes[i].start + offset,
      );
      deliver(
        practice,
        physical,
        "rhythm",
        [0x90, 61, 100],
        notes[i].start + 0.4,
      );
      deliver(
        practice,
        physical,
        "rhythm",
        [0x80, 61, 0],
        notes[i].start + 0.4,
      );
    }
    expect(practice.feedback.length).toBeLessThanOrEqual(256);
    expect(practice.feedback.at(-1)).toEqual({
      kind: "wrong",
      pitch: 61,
      at: 1000.4,
    });
    expect(practice.hit.size).toBe(notes.length);
    expect(practice.missed.size).toBe(0);
    expect(practice.stats).toMatchObject({
      matched: 1_000,
      wrong: 1_000,
      missed: 0,
      timingCount: 1_000,
    });
    expect(practice.stats.timingAbsTotal).toBeCloseTo(timingAbsTotal, 8);
    expect(
      practice.stats.timingAbsTotal / practice.stats.timingCount,
    ).toBeCloseTo(0.0625, 8);
  });

  it("bounds feedback at the 50,000-note song limit while retaining every unresolved miss", () => {
    const notes = Array.from({ length: 50_000 }, (_, i) =>
      note(`note-${i}`, 48 + (i % 36), i),
    );
    const practice = new Practice(notes);
    practice.expire(50_001, 0.2, 1);
    practice.expire(50_002, 0.2, 1);
    expect(practice.missed.size).toBe(notes.length);
    expect(practice.hit.size).toBe(0);
    expect(practice.stats.missed).toBe(notes.length);
    expect(practice.feedback.length).toBeLessThanOrEqual(256);
    expect(practice.feedback.at(-1)).toEqual({
      kind: "miss",
      pitch: notes.at(-1)!.pitch,
      at: 49_999,
    });
    practice.input(48, 0.1, "rhythm", 0.2, 1, new Set([48]));
    expect(practice.hit.size).toBe(1);
    expect(practice.missed.size).toBe(notes.length - 1);
    expect(practice.stats.missed).toBe(notes.length - 1);
    expect(practice.hit.size + practice.missed.size).toBe(notes.length);
    expect(practice.feedback.length).toBeLessThanOrEqual(256);
  });

  it("reconciles aggregate misses even after their detailed feedback has been evicted", () => {
    const practice = new Practice([
      note("first", 60, 1),
      note("second", 62, 2),
      note("third", 64, 3),
    ]);
    practice.expire(2.3, 0.2, 1);
    expect(practice.stats.missed).toBe(2);
    for (let i = 0; i < 1_000; i++)
      practice.input(70, 2.3, "rhythm", 0.2, 1, new Set([70]));
    expect(practice.feedback.length).toBeLessThanOrEqual(256);
    expect(practice.feedback.some((f) => f.kind === "miss")).toBe(false);
    expect(practice.stats.wrong).toBe(1_000);

    practice.input(60, 1.08, "rhythm", 0.2, 1, new Set([60]));
    practice.expire(2.3, 0.2, 1);
    expect(practice.missed).toEqual(new Set(["second"]));
    expect(practice.stats).toMatchObject({
      matched: 1,
      wrong: 1_000,
      missed: 1,
      timingCount: 1,
    });
    practice.input(62, 2.12, "rhythm", 0.2, 1, new Set([62]));
    expect(practice.stats).toMatchObject({
      matched: 2,
      wrong: 1_000,
      missed: 0,
      timingCount: 2,
    });
    expect(practice.stats.timingAbsTotal).toBeCloseTo(0.2);
    practice.expire(4, 0.2, 1);
    expect(practice.stats.missed).toBe(1);
    expect(practice.missed).toEqual(new Set(["third"]));
    expect(practice.hit.size).toBeLessThanOrEqual(practice.notes.length);
    expect(practice.missed.size).toBeLessThanOrEqual(practice.notes.length);
    expect(practice.feedback.length).toBeLessThanOrEqual(256);

    practice.reset(2);
    expect(practice.stats).toEqual({
      wrong: 0,
      matched: 0,
      missed: 0,
      timingCount: 0,
      timingAbsTotal: 0,
    });
    expect(practice.feedback).toEqual([]);
    expect(practice.hit.size).toBe(0);
    expect(practice.missed.size).toBe(0);
    expect(practice.gate?.start).toBe(2);
  });
});
