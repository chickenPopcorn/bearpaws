import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const output = () =>
  ({
    send: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }) as unknown as MIDIOutput & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
function setup() {
  const port = output(),
    lost = vi.fn(),
    duet = new MidiDuet(lost);
  duet.setOutput(port);
  return { port, send: port.send, lost, duet };
}
beforeEach(() =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }),
);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("teacher MIDI output", () => {
  it("sends velocity-scaled teacher notes and releases their own keys", () => {
    const { duet, send } = setup(),
      notes = [note("a", 48, 1, 2), note("b", 55, 1, 3)];
    duet.schedule(notes, 0, 1, false);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    duet.schedule(notes, 1, 1, false);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]], [[0x90, 55, 64]]]);
    vi.advanceTimersByTime(1000);
    duet.schedule(notes, 2, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
    duet.stop();
    expect(send).toHaveBeenLastCalledWith([0x80, 55, 0]);
  });
  it("holds a note at a Wait gate until playback resumes", () => {
    const { duet, send } = setup();
    duet.schedule([note("a", 48, 0, 1)], 0, 1, false);
    vi.advanceTimersByTime(1000);
    duet.schedule([], 1, 1, true);
    vi.advanceTimersByTime(5000);
    duet.schedule([], 1, 1, true);
    expect(send).toHaveBeenCalledTimes(1);
    duet.schedule([], 1, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("releases on the old channel and continues live notes on the new one", () => {
    const { duet, send } = setup();
    duet.schedule([note("a", 48, 0, 2)], 0, 1, false);
    duet.setChannel(4);
    duet.stop();
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x94, 48, 64]],
      [[0x84, 48, 0]],
    ]);
  });
  it("restores notes at a seek but skips notes completed before it", () => {
    const { duet, send } = setup();
    duet.schedule(
      [note("old", 48, 0, 1), note("held", 55, 0, 10)],
      5,
      1,
      false,
    );
    expect(send.mock.calls).toEqual([[[0x90, 55, 64]]]);
    duet.stop();
    duet.schedule([note("again", 48, 0, 1)], 0, 2, false);
    expect(send).toHaveBeenLastCalledWith([0x90, 48, 64]);
  });
  it("retires a longer old tail when a shorter repeated attack replaces it", () => {
    const { duet, send } = setup(),
      notes = [note("old", 48, 0, 10), note("new", 48, 1, 2)];
    duet.schedule(notes, 0, 1, false);
    vi.advanceTimersByTime(1000);
    duet.schedule(notes, 1, 1, false);
    vi.advanceTimersByTime(1000);
    duet.schedule(notes, 2, 1, false);
    expect(send.mock.calls).toEqual([
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
      [[0x90, 48, 64]],
      [[0x80, 48, 0]],
    ]);
    vi.advanceTimersByTime(1000);
    duet.schedule(notes, 3, 1, false);
    expect(send).toHaveBeenCalledTimes(4);
  });
  it("strikes simultaneous unisons once and keeps the longest one", () => {
    const { duet, send } = setup(),
      notes = [note("a", 48, 0, 2), note("b", 48, 0, 3)];
    duet.schedule(notes, 0, 1, false);
    vi.advanceTimersByTime(2000);
    duet.schedule(notes, 2, 1, false);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    duet.schedule(notes, 3, 1, false);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("keeps durations and gaps when a delayed tick crosses repeated short notes", () => {
    const { duet, send } = setup(),
      notes = [note("a", 48, 0.005, 0.01), note("b", 48, 0.015, 0.02)];
    duet.schedule(notes, 0, 1, false);
    vi.advanceTimersByTime(100);
    duet.schedule(notes, 0.1, 1, false);
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]]]);
    vi.advanceTimersByTime(4);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
    vi.advanceTimersByTime(4);
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenLastCalledWith([0x90, 48, 64]);
    vi.advanceTimersByTime(5);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("scales delayed note duration with speed", () => {
    const { duet, send } = setup(),
      notes = [note("a", 48, 0.005, 0.012)];
    duet.schedule(notes, 0, 1, false, 0, 1.4);
    vi.advanceTimersByTime(20);
    duet.schedule(notes, 0.02, 1, false, 0, 1.4);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("cancels pending notes and releases a sounding note on pause or seek", () => {
    const { duet, send } = setup(),
      notes = [note("a", 48, 0.005, 0.01), note("b", 52, 0.015, 0.02)];
    duet.schedule(notes, 0, 1, false);
    vi.advanceTimersByTime(100);
    duet.schedule(notes, 0.1, 1, false);
    duet.stop();
    expect(send.mock.calls).toEqual([[[0x90, 48, 64]], [[0x80, 48, 0]]]);
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("lets final queued notes finish naturally", () => {
    const { duet, send } = setup(),
      notes = [note("a", 48, 0.005, 0.01)];
    duet.schedule(notes, 0, 1, false);
    vi.advanceTimersByTime(20);
    duet.schedule(notes, 0.02, 1, false);
    duet.finish();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps a queued tail at a loop boundary", () => {
    const { duet, send } = setup(),
      notes = [note("a", 48, 0.005, 0.01)];
    duet.schedule(notes, 0, 1, false);
    vi.advanceTimersByTime(20);
    duet.schedule(notes, 0.02, 1, false);
    duet.schedule(notes, 0, 2, false, 0);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5);
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("silences and closes an old port without sending its delayed notes to a replacement", () => {
    const { duet, send, port } = setup(),
      next = output();
    duet.schedule(
      [note("a", 48, 0.005, 0.01), note("b", 52, 0.015, 0.02)],
      0.02,
      1,
      false,
      0,
    );
    duet.setOutput(next);
    expect(port.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(next.send).not.toHaveBeenCalled();
    expect(send).toHaveBeenLastCalledWith([0x80, 48, 0]);
  });
  it("ignores a deferred failure when a healthy output replaces the failed one", async () => {
    const { duet, send, lost } = setup();
    duet.schedule([note("a", 48, 0, 2)], 0, 1, false);
    send.mockImplementation(() => {
      throw new Error("Disconnected");
    });
    const next = output();
    duet.setOutput(next);
    await Promise.resolve();
    expect(lost).not.toHaveBeenCalled();
    expect(duet.connected).toBe(true);
  });
  it("drops failed outputs and reports loss after the current tick", async () => {
    const { duet, send, lost, port } = setup();
    send.mockImplementation(() => {
      throw new Error("Disconnected");
    });
    duet.schedule([note("a", 48, 0, 2)], 0, 1, false);
    expect(duet.connected).toBe(false);
    expect(port.close).toHaveBeenCalledOnce();
    expect(lost).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(lost).toHaveBeenCalledOnce();
  });
  it("does not leave zero-duration events sounding", () => {
    const { duet, send } = setup();
    duet.schedule([note("a", 48, 0, 0)], 0, 1, false);
    expect(send).not.toHaveBeenCalled();
  });
});
