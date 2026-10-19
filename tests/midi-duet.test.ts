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
const output = (send = vi.fn()) =>
  ({
    send,
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
  it("restarts a sounding pitch at each new attack, and keeps it for the later note", () => {
    const { duet, send } = setup();
    // Repeated notes under the pedal: the first still sounds at the second.
    const notes = [note("a", 48, 0, 2), note("b", 48, 1, 3)];
    duet.schedule(notes, 0, 1, false);
    duet.schedule(notes, 1, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
    // The first note's end must not cut off the second.
    duet.schedule(notes, 2, 1, false);
    expect(send).toHaveBeenCalledTimes(3);
    duet.schedule(notes, 3, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("strikes a unison once, and releases it when its last note ends", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0, 2), note("b", 48, 0, 3)];
    for (const position of [0, 1, 2]) duet.schedule(notes, position, 1, false);
    expect(send).toHaveBeenCalledTimes(1);
    duet.schedule(notes, 3, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("silences and closes the old output when switching or returning to laptop", () => {
    const { duet, send, port } = setup();
    duet.schedule([note("a", 48, 0, 2)], 0, 1, false);
    const next = output();
    duet.setOutput(next);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
    expect(port.close).toHaveBeenCalledOnce();
    duet.setOutput();
    expect(next.close).toHaveBeenCalledOnce();
    expect(duet.connected).toBe(false);
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
