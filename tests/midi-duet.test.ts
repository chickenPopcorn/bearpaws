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

  it("plays a short note crossed between clock callbacks once, sounding until the next one", () => {
    const { duet, send } = setup();
    const notes = [note("short", 48, 0.005, 0.01)];
    duet.schedule(notes, 0, 1, false);
    duet.schedule(notes, 0.02, 1, false);
    // Not a zero-length note: the release waits for the next callback.
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]]]);
    duet.schedule(notes, 0.04, 1, false);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]], [[0x80, 48, 0]]]);
    duet.schedule(notes, 0.06, 1, false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("catches short notes before the first tick but skips finished notes before a seek", () => {
    const { duet, send } = setup();
    const notes = [
      note("old", 45, 0.005, 0.01),
      note("short", 48, 1.005, 1.01),
    ];
    duet.schedule(notes, 1.02, 1, false, 1);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]]]);
    duet.schedule(notes, 1.04, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });

  it("gives each same-pitch note crossed in one tick a tick of its own", () => {
    const { duet, send } = setup();
    const notes = [
      note("a", 48, 0.002, 0.005),
      note("b", 48, 0.01, 0.015),
      note("c", 48, 0.016, 0.018),
    ];
    // A delayed callback crosses all three.
    duet.schedule(notes, 0.02, 1, false, 0);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]]]);
    duet.schedule(notes, 0.04, 1, false);
    duet.schedule(notes, 0.06, 1, false);
    duet.schedule(notes, 0.08, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
    ]);
  });

  it("preserves crossed attacks across two passes scheduled in the same tick", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0.002, 0.005), note("b", 48, 0.01, 0.015)];
    duet.schedule(notes, 0.02, 1, false, 0, 1);
    duet.schedule(notes, 0, 2, false, 0, 1);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]]]);
    duet.schedule([], 0, 2, false, 0, 2);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
    duet.schedule([], 0, 2, false, 0, 3);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("drains final crossed attacks after completion and cancels them on explicit stop", () => {
    const { duet, send } = setup();
    const notes = [note("a", 48, 0.002, 0.005), note("b", 48, 0.01, 0.015)];
    duet.schedule(notes, 0.02, 1, false, 0, 1);
    duet.finish();
    expect(send).toHaveBeenCalledTimes(1);
    duet.pulse(2);
    expect(send).toHaveBeenCalledTimes(3);
    duet.pulse(3);
    expect(send).toHaveBeenCalledTimes(4);
    duet.stop();
    duet.schedule(notes, 0.02, 2, false, 0, 4);
    duet.finish();
    duet.stop();
    duet.pulse(5);
    expect(send).toHaveBeenCalledTimes(6);
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

  it("lets an attack just before a loop wrap ring for a tick into the next pass", () => {
    const { duet, send } = setup();
    const notes = [note("last", 48, 0.99, 1.5), note("first", 52, 0, 0.5)];
    duet.schedule(notes, 0.98, 1, false);
    // The wrap: the old pass is finished up to its end, then the new one begins.
    duet.schedule(notes, 1, 1, false, 0, 2);
    duet.schedule(notes, 0.005, 2, false, 0, 2);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]], [[0x90, 52, 64]]]);
    duet.schedule(notes, 0.025, 2, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
    duet.stop();
    expect(send).toHaveBeenLastCalledWith([0x80, 52, 0]);
  });

  it("restrikes a pitch the new pass opens with while the old pass's note rings", () => {
    const { duet, send } = setup();
    const notes = [note("last", 48, 0.99, 1.5), note("first", 48, 0, 0.5)];
    duet.schedule(notes, 1, 1, false, 0.98, 1);
    duet.schedule(notes, 0.005, 2, false, 0, 1);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]]]);
    duet.schedule(notes, 0.025, 2, false, 0, 2);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
    // The new pass's note keeps the key past the old note's extra tick.
    duet.schedule(notes, 0.025, 2, false);
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
