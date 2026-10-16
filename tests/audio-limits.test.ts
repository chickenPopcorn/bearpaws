import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_REFERENCE_VOICES, ReferenceAudio } from "../src/audio";
import { Transport } from "../src/engine";
import type { Note } from "../src/song";
function fixture() {
  const nodes: ReturnType<typeof oscillator>[] = [];
  function oscillator() {
    return {
      type: "triangle",
      frequency: { value: 0 },
      connect: vi.fn((gain: unknown) => gain),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    };
  }
  const createOscillator = vi.fn(() => {
    const osc = oscillator();
    nodes.push(osc);
    return osc;
  });
  const createGain = vi.fn(() => ({
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(function (this: unknown) {
      return this;
    }),
    disconnect: vi.fn(),
  }));
  const context = {
    state: "running",
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {}),
    createOscillator,
    createGain,
  };
  const audio = new ReferenceAudio();
  audio.context = context as unknown as AudioContext;
  const transport = new Transport(10);
  transport.play(0);
  return { audio, transport, context, nodes };
}
const note = (id: number, pitch = 60, soundEnd = 1): Note => ({
  id: String(id),
  pitch,
  start: 0,
  end: 0.4,
  soundEnd,
  velocity: 0.5,
  track: id % 256,
  channel: 0,
});
afterEach(() => vi.restoreAllMocks());
describe("bounded reference audio", () => {
  it("coalesces 50,000 duplicated track notes into one voice with the longest sustain tail", () => {
    const { audio, transport, context, nodes } = fixture();
    const notes = Array.from({ length: 50000 }, (_, i) =>
      note(i, 60, 1 + (i % 3)),
    );
    audio.schedule(notes, transport, true);
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    expect(context.createGain).toHaveBeenCalledTimes(1);
    expect(nodes[0].stop).toHaveBeenCalledWith(3.03);
    expect(audio.scheduled.size).toBe(50000);
    audio.schedule(notes, transport, true);
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
  });
  it("caps an imported dense chord before node allocation and cancels all retained voices", () => {
    const { audio, transport, context, nodes } = fixture();
    audio.schedule(
      Array.from({ length: 50000 }, (_, i) => note(i, i % 128)),
      transport,
      true,
    );
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
    expect(context.createOscillator).toHaveBeenCalledTimes(
      MAX_REFERENCE_VOICES,
    );
    expect(context.createGain).toHaveBeenCalledTimes(MAX_REFERENCE_VOICES);
    audio.stop();
    expect(audio.voices.size).toBe(0);
    expect(audio.scheduled.size).toBe(0);
    for (const osc of nodes) expect(osc.stop).toHaveBeenCalledTimes(2);
  });
  it("applies the same cap to direct previews and future-scheduled voices, then reuses freed slots", () => {
    const { audio, context, nodes } = fixture();
    for (let i = 0; i < 5000; i++) audio.tone(i % 128, 0.8, 100, 10);
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
    expect(context.createOscillator).toHaveBeenCalledTimes(
      MAX_REFERENCE_VOICES,
    );
    nodes[0].onended!();
    audio.tone(60, 0.8, 0, 1);
    expect(context.createOscillator).toHaveBeenCalledTimes(
      MAX_REFERENCE_VOICES + 1,
    );
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
  });
  it("contains audio allocation failures and waits for an explicit unlock before retrying", async () => {
    const { audio, context, nodes } = fixture();
    context.createGain.mockImplementationOnce(() => {
      throw new Error("quota");
    });
    expect(() => audio.tone(60, 0.8, 0, 1)).not.toThrow();
    expect(audio.voices.size).toBe(0);
    expect(nodes[0].disconnect).toHaveBeenCalledOnce();
    expect(audio.error).toMatch(/Reference sound could not start/);
    for (let i = 0; i < 1000; i++) audio.tone(60, 0.8, 0, 1);
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    await audio.unlock();
    audio.tone(60, 0.8, 0, 1);
    expect(audio.error).toBe("");
    expect(audio.voices.size).toBe(1);
  });
});
