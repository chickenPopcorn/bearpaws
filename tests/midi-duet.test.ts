import { afterEach, describe, expect, it, vi } from "vitest";
import { MidiDuet } from "../src/midiDuet";
import type { Note } from "../src/song";
const note = (id: string, pitch: number, start: number, end: number): Note => ({
  id,
  pitch,
  start,
  end,
  soundEnd: end,
  velocity: 0.5,
  track: 0,
  channel: 0,
});
const output = (send = vi.fn()) =>
  ({
    send,
    clear: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }) as unknown as MIDIOutput & { close: ReturnType<typeof vi.fn> };
function setup() {
  const send = vi.fn();
  const failed = vi.fn();
  const duet = new MidiDuet(failed);
  const port = output(send);
  duet.setOutput(port);
  return { duet, send, failed, port };
}
afterEach(() => vi.restoreAllMocks());
describe("teacher MIDI output", () => {
  it("sends velocity-scaled teacher notes on channel 1 by default and releases only its notes", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 1, 2), note("b", 55, 1, 3)];
    duet.schedule(notes, 0, 1, false);
    expect(send).not.toHaveBeenCalled();
    duet.schedule(notes, 1, 1, false);
    duet.schedule(notes, 1.5, 1, false);
    expect(send.mock.calls.map(([data]) => [data])).toEqual([
      [[0x90, 48, 64]],
      [[0x90, 55, 64]],
    ]);
    duet.schedule(notes, 2, 1, false);
    expect(send.mock.calls.at(-1)?.[0]).toEqual([0x80, 48, 0]);
    duet.stop();
    expect(send.mock.calls.at(-1)?.[0]).toEqual([0x80, 55, 0]);
  });
  it("releases on the old channel before moving teacher notes to a new one", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0, 2)];
    duet.schedule(notes, 0, 1, false);
    duet.setChannel(4);
    duet.schedule(notes, 0.5, 1, false);
    duet.stop();
    expect(send.mock.calls.map(([data]) => [data])).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x94, 48, 64]],
      [[0x84, 48, 0]],
    ]);
  });

  it("holds sounding notes at a Wait gate and releases them on resume", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0, 1)];
    duet.schedule(notes, 0, 1, false);
    duet.schedule([], 1, 1, true);
    duet.schedule([], 1, 1, true);
    expect(send).toHaveBeenCalledTimes(1);
    duet.schedule([], 1, 1, false);
    expect(send.mock.calls.at(-1)?.[0]).toEqual([0x80, 48, 0]);
  });
  it("releases and retriggers on a seek or loop cycle and restores notes at a seek position", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0, 2)];
    duet.schedule(notes, 1, 1, false);
    duet.schedule(notes, 0.5, 2, false);
    expect(send.mock.calls.map(([data]) => [data])).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
  });
  it("restarts a sounding pitch at each new attack, and keeps it for the later note", () => {
    const { duet, send } = setup();
    // Repeated notes under the pedal: the first still sounds at the second.
    const notes = [note("a", 48, 0, 2), note("b", 48, 1, 3)];
    duet.schedule(notes, 0, 1, false);
    duet.schedule(notes, 1, 1, false);
    expect(send.mock.calls.map(([data]) => [data])).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
    // The first note's end must not cut off the second.
    duet.schedule(notes, 2, 1, false);
    expect(send).toHaveBeenCalledTimes(3);
    duet.schedule(notes, 3, 1, false);
    expect(send.mock.calls.at(-1)?.[0]).toEqual([0x80, 48, 0]);
  });
  it("does not retain an older tail after a shorter repeated attack ends", () => {
    const { duet, send } = setup();
    const notes = [note("old", 48, 0, 10), note("new", 48, 1, 2)];
    duet.schedule(notes, 0, 1, false);
    duet.schedule(notes, 1, 1, false);
    duet.schedule(notes, 2, 1, false);
    expect(send.mock.calls.map(([data]) => [data])).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
    ]);
    duet.schedule(notes, 3, 1, false);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("plays a complete short note crossed between clock callbacks exactly once", () => {
    const { duet, send } = setup();
    const notes = [note("short", 48, 0.005, 0.01)];
    duet.schedule(notes, 0, 1, false);
    duet.schedule(notes, 0.02, 1, false);
    expect(send.mock.calls.map(([data]) => [data])).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
    ]);
    duet.schedule(notes, 0.04, 1, false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("catches short notes before the first tick but skips finished notes before a seek", () => {
    const { duet, send } = setup();
    const notes = [
      note("old", 45, 0.005, 0.01),
      note("short", 48, 1.005, 1.01),
    ];
    duet.schedule(notes, 1.02, 1, false, 1);
    expect(send.mock.calls.map(([data]) => [data])).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
    ]);
  });

  it("does not leave a zero-duration event sounding", () => {
    const { duet, send } = setup();
    duet.schedule([note("zero", 48, 0, 0)], 0, 1, false);
    expect(send).not.toHaveBeenCalled();
  });

  it("preserves a short note's real duration after a late tick, scaled by speed", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { duet, send, port } = setup();
    const sent: { data: number[]; at: number }[] = [];
    send.mockImplementation((data: number[], at?: number) =>
      sent.push({ data, at: at ?? now }),
    );
    const clear = vi.fn();
    Object.defineProperty(port, "clear", { value: clear });
    const notes = [note("short", 48, 0.005, 0.012)];
    duet.schedule(notes, 0, 1, false, 0, 1.4);
    now = 1020;
    duet.schedule(notes, 0.02, 1, false, 0, 1.4);
    expect(sent.map((s) => s.data)).toEqual([
      [0x90, 48, 64],
      [0x80, 48, 0],
    ]);
    expect(sent[1].at - sent[0].at).toBeCloseTo(5);
    duet.finish();
    expect(clear).not.toHaveBeenCalled();
    now = 1021;
    duet.stop();
    expect(clear).toHaveBeenCalledOnce();
    expect(sent.at(-1)).toEqual({ data: [0x80, 48, 0], at: 1021 });
  });

  it("keeps the queued tail across a loop boundary instead of cancelling it", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { duet, send, port } = setup();
    const clear = (port as unknown as { clear: ReturnType<typeof vi.fn> })
      .clear;
    const sent: { data: number[]; at: number }[] = [];
    send.mockImplementation((data: number[], at?: number) =>
      sent.push({ data, at: at ?? now }),
    );
    const notes = [note("short", 48, 0.005, 0.01)];
    duet.schedule(notes, 0, 1, false);
    now = 1020;
    duet.schedule(notes, 0.02, 1, false);
    duet.schedule(notes, 0, 2, false, 0);
    expect(clear).not.toHaveBeenCalled();
    expect(sent[1].at - sent[0].at).toBeCloseTo(5);
    now = 1040;
    duet.schedule(notes, 0.02, 2, false, 0);
    expect(sent[3].at - sent[2].at).toBeCloseTo(5);
    expect(sent[2].at).toBeGreaterThanOrEqual(sent[1].at);
  });

  it("strikes a unison once, and releases it when its last note ends", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0, 2), note("b", 48, 0, 3)];
    for (const position of [0, 1, 2]) duet.schedule(notes, position, 1, false);
    expect(send).toHaveBeenCalledTimes(1);
    duet.schedule(notes, 3, 1, false);
    expect(send.mock.calls.at(-1)?.[0]).toEqual([0x80, 48, 0]);
  });
  it("silences and closes the old output when switching or returning to laptop", () => {
    const { duet, send, port } = setup();
    duet.schedule([note("a", 48, 0, 2)], 0, 1, false);
    const next = output();
    duet.setOutput(next);
    expect(send.mock.calls.at(-1)?.[0]).toEqual([0x80, 48, 0]);
    expect(port.close).toHaveBeenCalledOnce();
    duet.setOutput();
    expect(next.close).toHaveBeenCalledOnce();
    expect(duet.connected).toBe(false);
  });
  it("ignores a deferred failure once a healthy replacement is selected", async () => {
    const { duet, send, failed } = setup();
    duet.schedule([note("a", 48, 0, 2)], 0, 1, false);
    send.mockImplementation(() => {
      throw new Error("Disconnected");
    });
    const replacement = output();
    duet.setOutput(replacement);
    await Promise.resolve();
    expect(failed).not.toHaveBeenCalled();
    expect(duet.connected).toBe(true);
    duet.schedule([note("b", 52, 0, 2)], 0, 1, false);
    expect(replacement.send).toHaveBeenLastCalledWith([0x90, 52, 64]);
  });

  it("drops and closes an unplugged output, and reports it after the tick", async () => {
    const { duet, send, failed, port } = setup();
    send.mockImplementation(() => {
      throw new Error("Disconnected");
    });
    expect(() =>
      duet.schedule([note("a", 48, 0, 2), note("b", 52, 0, 2)], 0, 1, false),
    ).not.toThrow();
    // The second note is not tried on the dropped output.
    expect(send).toHaveBeenCalledOnce();
    expect(duet.connected).toBe(false);
    expect(port.close).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(failed).toHaveBeenCalledOnce();
  });
});
