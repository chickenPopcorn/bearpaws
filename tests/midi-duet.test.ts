import { describe, expect, it, vi } from "vitest";
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
function setup() {
  const send = vi.fn();
  const failed = vi.fn();
  const duet = new MidiDuet(failed);
  duet.setOutput({ send } as unknown as MIDIOutput);
  return { duet, send, failed };
}
describe("teacher MIDI output", () => {
  it("sends velocity-scaled teacher notes on channel 1 by default and releases only its notes", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 1, 2), note("b", 55, 1, 3)];
    duet.schedule(notes, 0, 1, false);
    expect(send).not.toHaveBeenCalled();
    duet.schedule(notes, 1, 1, false);
    duet.schedule(notes, 1.5, 1, false);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]], [[0x90, 55, 64]]]);
    duet.schedule(notes, 2, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
    duet.stop();
    expect(send).toHaveBeenLastCalledWith([0x80, 55, 0]);
  });
  it("releases on the old channel before moving teacher notes to a new one", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0, 2)];
    duet.schedule(notes, 0, 1, false);
    duet.setChannel(4);
    duet.schedule(notes, 0.5, 1, false);
    duet.stop();
    expect(send.mock.calls).toEqual([
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
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("releases and retriggers on a seek or loop cycle and restores notes at a seek position", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0, 2)];
    duet.schedule(notes, 1, 1, false);
    duet.schedule(notes, 0.5, 2, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
  });
  it("does not cut off an overlapping note of the same pitch", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0, 2), note("b", 48, 1, 3)];
    for (const position of [0, 1, 2]) duet.schedule(notes, position, 1, false);
    expect(send).toHaveBeenCalledTimes(1);
    duet.schedule(notes, 3, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("silences the old output before switching and tolerates an unplugged output", () => {
    const { duet, send, failed } = setup();
    duet.schedule([note("a", 48, 0, 2)], 0, 1, false);
    const next = vi.fn();
    duet.setOutput({ send: next } as unknown as MIDIOutput);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
    next.mockImplementation(() => {
      throw new Error("Disconnected");
    });
    expect(() =>
      duet.schedule([note("a", 48, 0, 2)], 0, 1, false),
    ).not.toThrow();
    expect(duet.connected).toBe(false);
    expect(failed).toHaveBeenCalledOnce();
  });
});
