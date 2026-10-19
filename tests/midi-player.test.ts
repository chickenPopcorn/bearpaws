import { describe, expect, it, vi } from "vitest";
import { MidiPlayer } from "../src/midiPlayer";
import type { Note, PedalSpan } from "../src/song";
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
  const player = new MidiPlayer(failed);
  const port = output(send);
  player.setOutput(port);
  return { player, send, failed, port };
}
describe("MIDI playback output", () => {
  it("sends velocity-scaled notes on channel 1 by default and releases only its notes", () => {
    const { player, send } = setup();
    const notes = [note("a", 48, 1, 2), note("b", 55, 1, 3)];
    player.schedule(notes, 0, 1, false);
    expect(send).not.toHaveBeenCalled();
    player.schedule(notes, 1, 1, false);
    player.schedule(notes, 1.5, 1, false);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]], [[0x90, 55, 64]]]);
    player.schedule(notes, 2, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
    player.stop();
    expect(send).toHaveBeenLastCalledWith([0x80, 55, 0]);
  });
  it("releases sounding notes on the old channel and plays later ones on the new one", () => {
    const { player, send } = setup();
    const notes = [note("a", 48, 0, 2), note("b", 52, 1, 2)];
    player.schedule(notes, 0, 1, false);
    player.setChannel(4);
    // The sounding note is not struck again on the new channel.
    player.schedule(notes, 0.5, 1, false);
    player.schedule(notes, 1, 1, false);
    player.stop();
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x94, 52, 64]],
      [[0x84, 52, 0]],
    ]);
  });

  it("holds sounding notes at a Wait gate and releases them on resume", () => {
    const { player, send } = setup();
    const notes = [note("a", 48, 0, 1)];
    player.schedule(notes, 0, 1, false);
    player.schedule([], 1, 1, true);
    player.schedule([], 1, 1, true);
    expect(send).toHaveBeenCalledTimes(1);
    player.schedule([], 1, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("releases and retriggers on a seek or loop cycle and restores notes at a seek position", () => {
    const { player, send } = setup();
    const notes = [note("a", 48, 0, 2)];
    player.schedule(notes, 1, 1, false);
    player.schedule(notes, 0.5, 2, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
  });
  it("restarts a sounding pitch at each new attack, and keeps it for the later note", () => {
    const { player, send } = setup();
    // Repeated notes under the pedal: the first still sounds at the second.
    const notes = [note("a", 48, 0, 2), note("b", 48, 1, 3)];
    player.schedule(notes, 0, 1, false);
    player.schedule(notes, 1, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
    // The first note's end must not cut off the second.
    player.schedule(notes, 2, 1, false);
    expect(send).toHaveBeenCalledTimes(3);
    player.schedule(notes, 3, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("does not retain an older tail after a shorter repeated attack ends", () => {
    const { player, send } = setup();
    const notes = [note("old", 48, 0, 10), note("new", 48, 1, 2)];
    player.schedule(notes, 0, 1, false);
    player.schedule(notes, 1, 1, false);
    player.schedule(notes, 2, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
    ]);
    player.schedule(notes, 3, 1, false);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("keeps a long legato part within one tick of the song, without drifting", () => {
    const { player, send } = setup();
    const notes = Array.from({ length: 240 }, (_, i) =>
      note(`n${i}`, 48 + (i % 5), i * 0.25, i * 0.25 + 0.25),
    );
    const attacks: number[] = [];
    for (let tick = 0; tick <= 3000; tick++) {
      const before = send.mock.calls.length;
      player.schedule(notes, tick * 0.02, 1, false);
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
    const { player, send } = setup();
    const notes = [note("a", 48, 0, 0.03), note("b", 48, 0.01, 1)];
    player.schedule(notes, 0, 1, false);
    // b restarts the key; a no longer owns it, and is not struck again.
    player.schedule(notes, 0.02, 1, false);
    player.schedule(notes, 0.04, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
    // An input reset silences b; Listen continues without striking it again.
    player.silence();
    player.schedule(notes, 0.06, 1, false);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });

  it("releases a note that ended before a Wait gate, but holds one ending at it", () => {
    const { player, send } = setup();
    const notes = [note("early", 48, 0, 0.99), note("through", 52, 0, 1)];
    player.schedule(notes, 0.98, 1, false);
    // This tick reaches the gate at 1 s, past the end of "early".
    player.schedule(notes, 1, 1, true);
    player.schedule(notes, 1, 1, true);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x90, 52, 64]],
      [[0x80, 48, 0]],
    ]);
    player.schedule(notes, 1.02, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 52, 0]);
  });

  it("plays a note a late tick passed whole, for one tick, but not after a seek", () => {
    const { player, send } = setup();
    const notes = [note("short", 48, 0.03, 0.08), note("old", 50, 0.1, 0.2)];
    player.schedule(notes, 0.02, 1, false);
    // The main thread stalls from 0.02 s to 0.25 s.
    player.schedule(notes, 0.25, 1, false);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]], [[0x90, 50, 64]]]);
    player.schedule(notes, 0.27, 1, false);
    expect(send.mock.calls.slice(2)).toEqual([
      [[0x80, 48, 0]],
      [[0x80, 50, 0]],
    ]);
    // After a seek past them, finished notes are not replayed.
    player.stop();
    player.schedule(notes, 0.5, 2, false);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("skips a zero-length note a late tick passes, and plays notes in time order", () => {
    const { player, send } = setup();
    // Out of order on purpose: "late" starts after "early" on the same key.
    const notes = [
      note("late", 48, 0.05, 1),
      note("early", 48, 0.03, 1),
      note("zero", 52, 0.04, 0.04),
    ];
    player.schedule(notes, 0.02, 1, false);
    player.schedule(notes, 0.1, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
    ]);
    // The later note owns the key until it ends.
    player.schedule(notes, 0.5, 1, false);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not leave a zero-duration event sounding", () => {
    const { player, send } = setup();
    player.schedule([note("zero", 48, 0, 0)], 0, 1, false);
    expect(send).not.toHaveBeenCalled();
  });

  it("strikes a unison once, and releases it when its last note ends", () => {
    const { player, send } = setup();
    const notes = [note("a", 48, 0, 2), note("b", 48, 0, 3)];
    for (const position of [0, 1, 2])
      player.schedule(notes, position, 1, false);
    expect(send).toHaveBeenCalledTimes(1);
    player.schedule(notes, 3, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("silences and closes the old output when switching or returning to laptop", () => {
    const { player, send, port } = setup();
    player.schedule([note("a", 48, 0, 2)], 0, 1, false);
    const next = output();
    player.setOutput(next);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
    expect(port.close).toHaveBeenCalledOnce();
    player.setOutput();
    expect(next.close).toHaveBeenCalledOnce();
    expect(player.connected).toBe(false);
  });
  it("ignores a deferred failure once a healthy replacement is selected", async () => {
    const { player, send, failed } = setup();
    player.schedule([note("a", 48, 0, 2)], 0, 1, false);
    send.mockImplementation(() => {
      throw new Error("Disconnected");
    });
    const replacement = output();
    player.setOutput(replacement);
    await Promise.resolve();
    expect(failed).not.toHaveBeenCalled();
    expect(player.connected).toBe(true);
    player.schedule([note("b", 52, 0, 2)], 0, 1, false);
    expect(replacement.send).toHaveBeenLastCalledWith([0x90, 52, 64]);
  });

  it("drops and closes an unplugged output, and reports it after the tick", async () => {
    const { player, send, failed, port } = setup();
    send.mockImplementation(() => {
      throw new Error("Disconnected");
    });
    expect(() =>
      player.schedule([note("a", 48, 0, 2), note("b", 52, 0, 2)], 0, 1, false),
    ).not.toThrow();
    // The second note is not tried on the dropped output.
    expect(send).toHaveBeenCalledOnce();
    expect(player.connected).toBe(false);
    expect(port.close).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(failed).toHaveBeenCalledOnce();
  });

  it("sends the notes' sustain pedal as CC64, before the attacks it holds", () => {
    const { player, send } = setup();
    const notes = [note("a", 48, 0.5, 1)];
    // Only presses on the notes' own channels belong to them.
    const pedals: PedalSpan[] = [
      { channel: 0, start: 0.5, end: 1.5 },
      { channel: 3, start: 0, end: 3 },
    ];
    player.schedule(notes, 0, 1, false, pedals);
    expect(send).not.toHaveBeenCalled();
    for (const position of [0.5, 1, 1.5])
      player.schedule(notes, position, 1, false, pedals);
    expect(send.mock.calls).toEqual([
      [[0xb0, 64, 127]],
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0xb0, 64, 0]],
    ]);
  });

  it("holds the pedal through a Wait gate it lifts at, and lifts it on stop", () => {
    const { player, send } = setup();
    const notes = [note("a", 48, 0, 2)];
    const pedals: PedalSpan[] = [{ channel: 0, start: 0, end: 1 }];
    player.schedule(notes, 0, 1, false, pedals);
    player.schedule(notes, 1, 1, true, pedals);
    player.schedule(notes, 1, 1, true, pedals);
    expect(send).toHaveBeenCalledTimes(2);
    player.schedule(notes, 1.02, 1, false, pedals);
    expect(send).toHaveBeenLastCalledWith([0xb0, 64, 0]);
    player.schedule(notes, 0, 2, false, pedals);
    player.stop();
    expect(send.mock.calls.slice(3)).toEqual([
      [[0x80, 48, 0]],
      [[0xb0, 64, 127]],
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0xb0, 64, 0]],
    ]);
  });

  it("keeps a press still down where the song ends down until playback stops", () => {
    const { player, send } = setup();
    const notes = [note("a", 48, 0, 3)];
    const pedals: PedalSpan[] = [{ channel: 0, start: 0, end: 1, open: true }];
    player.schedule(notes, 0, 1, false, pedals);
    player.schedule(notes, 2, 1, false, pedals);
    expect(send).toHaveBeenCalledTimes(2);
    player.stop();
    expect(send.mock.calls.slice(2)).toEqual([
      [[0x80, 48, 0]],
      [[0xb0, 64, 0]],
    ]);
  });

  it("moves the pedal to a new input channel without striking notes again", () => {
    const { player, send } = setup();
    const notes = [note("a", 48, 0, 2)];
    const pedals: PedalSpan[] = [{ channel: 0, start: 0, end: 2 }];
    player.schedule(notes, 0, 1, false, pedals);
    player.setChannel(4);
    player.schedule(notes, 0.5, 1, false, pedals);
    expect(send.mock.calls).toEqual([
      [[0xb0, 64, 127]],
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0xb0, 64, 0]],
      [[0xb4, 64, 127]],
    ]);
  });

  it("sounds a key played on screen until it comes up, and hands its pitch to the next attack", () => {
    const { player, send } = setup();
    const notes = [note("a", 60, 1, 2)];
    player.schedule(notes, 0.5, 1, false);
    player.keyDown(60, 0.6);
    expect(send.mock.calls).toEqual([[[0x90, 60, 76]]]);
    // The note restarts the key, so the key coming up does not cut it short.
    player.schedule(notes, 1, 1, false);
    player.keyUp(60);
    player.schedule(notes, 2, 1, false);
    expect(send.mock.calls.slice(1)).toEqual([
      [[0x80, 60, 0]],
      [[0x90, 60, 64]],
      [[0x80, 60, 0]],
    ]);
  });

  it("keeps a key struck over a sounding note until the key comes up", () => {
    const { player, send } = setup();
    const notes = [note("a", 60, 0, 1)];
    player.schedule(notes, 0, 1, false);
    player.keyDown(60, 0.6);
    player.schedule(notes, 1, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 60, 64]],
      [[0x80, 60, 0]],
      [[0x90, 60, 76]],
    ]);
    player.keyUp(60);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send).toHaveBeenLastCalledWith([0x80, 60, 0]);
  });

  it("releases held keys on stop, and sends none without an output", () => {
    const { player, send } = setup();
    player.keyDown(60, 0.6);
    player.keyDown(64, 0.6);
    player.stop();
    player.keyUp(60);
    expect(send.mock.calls.slice(2)).toEqual([
      [[0x80, 60, 0]],
      [[0x80, 64, 0]],
    ]);
    player.setOutput();
    player.keyDown(67, 0.6);
    player.keyUp(67);
    expect(send).toHaveBeenCalledTimes(4);
  });
  it("sends metronome clicks as GM percussion on channel 10", () => {
    const { player, send } = setup();
    player.click(true);
    player.click(false);
    expect(send.mock.calls).toEqual([
      [[0x99, 76, 110]],
      [[0x89, 76, 0]],
      [[0x99, 77, 80]],
      [[0x89, 77, 0]],
    ]);
  });
});
