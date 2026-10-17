import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferenceAudio } from "../src/audio";
import { selectPianoRegion } from "../src/piano";
import {
  createPianoSoundBus,
  createRoomImpulse,
  DEFAULT_PIANO_SOUND,
  normalizePianoSound,
  ROOM_IMPULSE_SECONDS,
} from "../src/pianoSound";

const parameter = () => ({
  value: 0,
  cancelAndHoldAtTime: vi.fn(),
  cancelScheduledValues: vi.fn(),
  setValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
});
const node = () => ({
  connect: vi.fn((destination: unknown) => destination),
  disconnect: vi.fn(),
});
function contextFixture(sampleRate = 48000) {
  const context = {
    state: "running",
    currentTime: 9,
    sampleRate,
    destination: {},
    resume: vi.fn(async () => {}),
    createBuffer: vi.fn((channels: number, length: number, rate: number) => {
      const data = Array.from(
        { length: channels },
        () => new Float32Array(length),
      );
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        duration: length / rate,
        getChannelData: (channel: number) => data[channel],
      };
    }),
    createGain: vi.fn(() => ({ ...node(), gain: parameter() })),
    createDynamicsCompressor: vi.fn(() => ({
      ...node(),
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      attack: parameter(),
      release: parameter(),
    })),
    createConvolver: vi.fn(() => ({
      ...node(),
      buffer: null as AudioBuffer | null,
      normalize: true,
    })),
    createBufferSource: vi.fn(() => ({
      ...node(),
      buffer: null as AudioBuffer | null,
      playbackRate: parameter(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    })),
  };
  return { context, audioContext: context as unknown as AudioContext };
}

afterEach(() => vi.unstubAllGlobals());

describe("piano sound settings", () => {
  it.each([undefined, null, "natural", {}, { profile: "other" }])(
    "uses the natural defaults for invalid persisted settings %j",
    (settings) =>
      expect(normalizePianoSound(settings)).toEqual(DEFAULT_PIANO_SOUND),
  );
  it.each([NaN, Infinity, -Infinity, "0.5", null])(
    "uses default ambience for non-finite/non-numeric %j",
    (ambience) => expect(normalizePianoSound({ ambience }).ambience).toBe(0.22),
  );
  it("clamps valid ambience and preserves the dry comparison preset", () => {
    expect(normalizePianoSound({ profile: "original", ambience: -2 })).toEqual({
      profile: "original",
      ambience: 0,
    });
    expect(normalizePianoSound({ ambience: 3 }).ambience).toBe(1);
    expect(normalizePianoSound({ ambience: 0 }).ambience).toBe(0);
  });
});

describe("synthetic room impulse", () => {
  it.each([44100, 48000])(
    "is deterministic, stereo and memory-bounded at %i Hz",
    (rate) => {
      const { audioContext } = contextFixture(rate);
      const first = createRoomImpulse(audioContext);
      const next = createRoomImpulse(audioContext);
      expect(first.numberOfChannels).toBe(2);
      expect(first.length).toBe(Math.ceil(rate * ROOM_IMPULSE_SECONDS));
      expect(first.length * 2 * 4).toBeLessThan(600000);
      const left = first.getChannelData(0);
      const right = first.getChannelData(1);
      expect(left).toEqual(next.getChannelData(0));
      expect(right).toEqual(next.getChannelData(1));
      let leftEnergy = 0,
        rightEnergy = 0,
        cross = 0;
      for (let i = 0; i < first.length; i++) {
        expect(Number.isFinite(left[i]) && Number.isFinite(right[i])).toBe(
          true,
        );
        leftEnergy += left[i] ** 2;
        rightEnergy += right[i] ** 2;
        cross += left[i] * right[i];
      }
      expect(leftEnergy).toBeGreaterThan(0.45);
      expect(leftEnergy).toBeLessThan(0.65);
      expect(rightEnergy).toBeGreaterThan(0.45);
      expect(rightEnergy).toBeLessThan(0.65);
      expect(
        Math.abs(cross / Math.sqrt(leftEnergy * rightEnergy)),
      ).toBeLessThan(0.1);
      expect(
        left.slice(0, Math.floor(rate * 0.012)).every((v) => v === 0),
      ).toBe(true);
      expect(left.at(-1)).toBeCloseTo(0);
      expect(right.at(-1)).toBeCloseTo(0);
    },
  );
});

describe("shared reference sound bus", () => {
  it("protects the mixed room/dry output, with gentler natural compression", () => {
    const { context, audioContext } = contextFixture();
    const bus = createPianoSoundBus(audioContext, DEFAULT_PIANO_SOUND);
    const [compressor, safety] =
      context.createDynamicsCompressor.mock.results.map((v) => v.value);
    const [dry, wet, master] = context.createGain.mock.results.map(
      (v) => v.value,
    );
    const convolver = context.createConvolver.mock.results[0].value;
    expect(bus.input).toBe(compressor);
    expect(compressor.connect).toHaveBeenCalledWith(dry);
    expect(compressor.connect).toHaveBeenCalledWith(convolver);
    expect(dry.connect).toHaveBeenCalledWith(safety);
    expect(convolver.connect).toHaveBeenCalledWith(wet);
    expect(wet.connect).toHaveBeenCalledWith(safety);
    expect(safety.connect).toHaveBeenCalledWith(master);
    expect(master.connect).toHaveBeenCalledWith(context.destination);
    expect(compressor.ratio.value).toBe(1.65);
    expect(compressor.attack.value).toBe(0.012);
    expect(safety.threshold.value).toBe(-3);
    expect(safety.ratio.value).toBe(20);
    expect(wet.gain.value).toBeCloseTo(0.154);
    expect(master.gain.value).toBe(0.92);
    expect(convolver.normalize).toBe(false);
  });

  it("keeps the original dry compression and bypasses the extra limiter", () => {
    const { context, audioContext } = contextFixture();
    createPianoSoundBus(audioContext, { profile: "original", ambience: 1 });
    const [compressor, safety] =
      context.createDynamicsCompressor.mock.results.map((v) => v.value);
    const [dry, wet, master] = context.createGain.mock.results.map(
      (v) => v.value,
    );
    expect(
      Object.fromEntries(
        ["threshold", "knee", "ratio", "attack", "release"].map((key) => [
          key,
          compressor[key as "ratio"].value,
        ]),
      ),
    ).toEqual({
      threshold: -10,
      knee: 12,
      ratio: 4,
      attack: 0.003,
      release: 0.25,
    });
    expect(safety.ratio.value).toBe(1);
    expect(dry.gain.value).toBe(1);
    expect(wet.gain.value).toBe(0);
    expect(master.gain.value).toBe(1);
  });

  it("smooths repeated live changes without allocating nodes or changing active notes", async () => {
    const { context, audioContext } = contextFixture();
    const audio = new ReferenceAudio();
    audio.setSound({ profile: "original", ambience: 0.6 });
    expect(audio.context).toBeNull();
    expect(context.createBuffer).not.toHaveBeenCalled();
    audio.context = audioContext;
    await audio.unlock();
    const [compressor] = context.createDynamicsCompressor.mock.results.map(
      (v) => v.value,
    );
    const wet = context.createGain.mock.results[1].value;
    expect(compressor.ratio.value).toBe(4);
    const region = selectPianoRegion(60, 0.8)!;
    audio.samples.set(region.file, { duration: 20 } as AudioBuffer);
    audio.tone(60, 0.8, 10, 2);
    audio.scheduled.add("held-note");
    const source = context.createBufferSource.mock.results[0].value;
    const previousStop = source.stop.mock.calls.slice();
    audio.setSound({ profile: "natural", ambience: 0.4 });
    audio.setSound({ profile: "natural", ambience: 0.7 });
    expect(wet.gain.cancelAndHoldAtTime).toHaveBeenNthCalledWith(2, 9);
    expect(wet.gain.setTargetAtTime).toHaveBeenLastCalledWith(
      0.7 * 0.7,
      9,
      0.04,
    );
    expect(source.stop.mock.calls).toEqual(previousStop);
    expect(audio.voices.size).toBe(1);
    expect(audio.scheduled.has("held-note")).toBe(true);
    expect(context.createDynamicsCompressor).toHaveBeenCalledTimes(2);
    expect(context.createConvolver).toHaveBeenCalledOnce();
    expect(context.createBuffer).toHaveBeenCalledOnce();
  });

  it("flushes old room tails on stop while reusing the impulse and persistent bus", async () => {
    const { context, audioContext } = contextFixture();
    const audio = new ReferenceAudio();
    audio.context = audioContext;
    await audio.unlock();
    const first = context.createConvolver.mock.results[0].value;
    audio.stop();
    const next = context.createConvolver.mock.results[1].value;
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(next.buffer).toBe(first.buffer);
    expect(context.createBuffer).toHaveBeenCalledOnce();
    expect(context.createDynamicsCompressor).toHaveBeenCalledTimes(2);
    expect(context.createGain).toHaveBeenCalledTimes(3);
  });

  it("contains a room-reset allocation failure and rebuilds on explicit retry", async () => {
    const { context, audioContext } = contextFixture();
    const audio = new ReferenceAudio();
    audio.context = audioContext;
    await audio.unlock();
    const first = context.createConvolver.mock.results[0].value;
    context.createConvolver.mockImplementationOnce(() => {
      throw new Error("quota");
    });
    expect(() => audio.stop()).not.toThrow();
    expect(first.disconnect).toHaveBeenCalled();
    expect(audio.error).toContain("could not reset");
    await audio.unlock();
    expect(audio.error).toBe("");
    expect(context.createDynamicsCompressor).toHaveBeenCalledTimes(4);
  });

  it("disconnects a partially built bus before an unlock retry", async () => {
    const { context, audioContext } = contextFixture();
    const audio = new ReferenceAudio();
    audio.context = audioContext;
    context.createBuffer.mockImplementationOnce(() => {
      throw new Error("quota");
    });
    await expect(audio.unlock()).rejects.toThrow("quota");
    for (const result of context.createGain.mock.results)
      expect(result.value.disconnect).toHaveBeenCalledOnce();
    for (const result of context.createDynamicsCompressor.mock.results)
      expect(result.value.disconnect).toHaveBeenCalledOnce();
    await audio.unlock();
    expect(audio.error).toBe("");
  });
});
