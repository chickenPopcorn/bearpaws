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
  it("releases sounding notes on the old channel and plays later ones on the new one", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0, 2), note("b", 52, 1, 2)];
    duet.schedule(notes, 0, 1, false);
    duet.setChannel(4);
    // The sounding note is not struck again on the new channel.
    duet.schedule(notes, 0.5, 1, false);
    duet.schedule(notes, 1, 1, false);
    duet.stop();
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x94, 52, 64]],
      [[0x84, 52, 0]],
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
  it("does not retain an older tail after a shorter repeated attack ends", () => {
    const { duet, send } = setup();
    const notes = [note("old", 48, 0, 10), note("new", 48, 1, 2)];
    duet.schedule(notes, 0, 1, false);
    duet.schedule(notes, 1, 1, false);
    duet.schedule(notes, 2, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
    ]);
    duet.schedule(notes, 3, 1, false);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("keeps a long legato part within one tick of the song, without drifting", () => {
    const { duet, send } = setup();
    const notes = Array.from({ length: 240 }, (_, i) =>
      note(`n${i}`, 48 + (i % 5), i * 0.25, i * 0.25 + 0.25),
    );
    const attacks: number[] = [];
    for (let tick = 0; tick <= 3000; tick++) {
      const before = send.mock.calls.length;
      duet.schedule(notes, tick * 0.02, 1, false);
      for (const [data] of send.mock.calls.slice(before))
        if ((data[0] & 0xf0) === 0x90) attacks.push(tick * 0.02);
    }
    expect(attacks).toHaveLength(notes.length);
    attacks.forEach((at, i) => {
      expect(at - notes[i].start).toBeGreaterThanOrEqual(-1e-9);
      expect(at - notes[i].start).toBeLessThan(0.02 + 1e-9);
    });
  });

  it("sounds a note for at least one tick, and never strikes it twice in a pass", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0, 0.03), note("b", 48, 0.01, 1)];
    duet.schedule(notes, 0, 1, false);
    // b restarts the key; a no longer owns it, and is not struck again.
    duet.schedule(notes, 0.02, 1, false);
    duet.schedule(notes, 0.04, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
    // An input reset silences b; Listen continues without striking it again.
    duet.silence();
    duet.schedule(notes, 0.06, 1, false);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });

  it("releases a note that ended before a Wait gate, but holds one ending at it", () => {
    const { duet, send } = setup();
    const notes = [note("early", 48, 0, 0.99), note("through", 52, 0, 1)];
    duet.schedule(notes, 0.98, 1, false);
    // This tick reaches the gate at 1 s, past the end of "early".
    duet.schedule(notes, 1, 1, true);
    duet.schedule(notes, 1, 1, true);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x90, 52, 64]],
      [[0x80, 48, 0]],
    ]);
    duet.schedule(notes, 1.02, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 52, 0]);
  });

  it("plays a note a late tick passed whole, for one tick, but not after a seek", () => {
    const { duet, send } = setup();
    const notes = [note("short", 48, 0.03, 0.08), note("old", 50, 0.1, 0.2)];
    duet.schedule(notes, 0.02, 1, false);
    // The main thread stalls from 0.02 s to 0.25 s.
    duet.schedule(notes, 0.25, 1, false);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]], [[0x90, 50, 64]]]);
    duet.schedule(notes, 0.27, 1, false);
    expect(send.mock.calls.slice(2)).toEqual([
      [[0x80, 48, 0]],
      [[0x80, 50, 0]],
    ]);
    // After a seek past them, finished notes are not replayed.
    duet.stop();
    duet.schedule(notes, 0.5, 2, false);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("skips a zero-length note a late tick passes, and plays notes in time order", () => {
    const { duet, send } = setup();
    // Out of order on purpose: "late" starts after "early" on the same key.
    const notes = [
      note("late", 48, 0.05, 1),
      note("early", 48, 0.03, 1),
      note("zero", 52, 0.04, 0.04),
    ];
    duet.schedule(notes, 0.02, 1, false);
    duet.schedule(notes, 0.1, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
    // The later note owns the key until it ends.
    duet.schedule(notes, 0.5, 1, false);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not leave a zero-duration event sounding", () => {
    const { duet, send } = setup();
    duet.schedule([note("zero", 48, 0, 0)], 0, 1, false);
    expect(send).not.toHaveBeenCalled();
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
