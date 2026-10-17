import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PIANO_CACHE_BYTES,
  MAX_REFERENCE_VOICES,
  ReferenceAudio,
} from "../src/audio";
import {
  PIANO_REGIONS,
  pianoInstrument,
  pianoLevel,
  selectPianoRegion,
} from "../src/piano";
import { Transport } from "../src/engine";
import type { Note } from "../src/song";
const sampleRate = 48000;
const instrumentMetadata: {
  files?: Record<string, { duration: number; channels: number }>;
} = pianoInstrument;
const originalFileMetadata = instrumentMetadata.files;
const buffer = (duration = 20): AudioBuffer =>
  ({
    duration,
    length: Math.ceil(duration * sampleRate),
    numberOfChannels: 2,
  }) as AudioBuffer;
const sizedBuffer = (bytes: number): AudioBuffer =>
  ({
    duration: bytes / (sampleRate * 8),
    length: bytes / 8,
    numberOfChannels: 2,
  }) as AudioBuffer;
const sound = (pitch: number, velocity = 0.8) => ({ pitch, velocity });
const fileFor = (pitch: number, velocity = 0.8) =>
  selectPianoRegion(pitch, velocity)!.file;
const cachedBytes = (audio: ReferenceAudio) =>
  [...audio.samples.values()].reduce(
    (sum, sample) => sum + sample.length * sample.numberOfChannels * 4,
    0,
  );
function fixture(loaded = true) {
  const nodes: ReturnType<typeof source>[] = [];
  function source() {
    return {
      buffer: null as AudioBuffer | null,
      playbackRate: { value: 1 },
      connect: vi.fn((gain: unknown) => gain),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    };
  }
  const createBufferSource = vi.fn(() => {
    const osc = source();
    nodes.push(osc);
    return osc;
  });
  const createGain = vi.fn(() => ({
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
      cancelAndHoldAtTime: vi.fn(),
    },
    connect: vi.fn(function (this: unknown) {
      return this;
    }),
    disconnect: vi.fn(),
  }));
  const context = {
    state: "running",
    currentTime: 0,
    sampleRate,
    destination: {},
    resume: vi.fn(async () => {}),
    createBufferSource,
    createGain,
    createConvolver: vi.fn(() => ({
      normalize: true,
      buffer: null as AudioBuffer | null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createBuffer: vi.fn((channels: number, length: number, rate: number) => {
      const data = Array.from(
        { length: channels },
        () => new Float32Array(length),
      );
      return {
        length,
        sampleRate: rate,
        numberOfChannels: channels,
        getChannelData: (channel: number) => data[channel],
      };
    }),
    decodeAudioData: vi.fn(async () => buffer()),
    createDynamicsCompressor: vi.fn(() => ({
      threshold: {
        value: 0,
        cancelAndHoldAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
      },
      knee: {
        value: 0,
        cancelAndHoldAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
      },
      ratio: {
        value: 0,
        cancelAndHoldAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
      },
      attack: {
        value: 0,
        cancelAndHoldAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
      },
      release: {
        value: 0,
        cancelAndHoldAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
      },
      connect: vi.fn((node: unknown) => node),
      disconnect: vi.fn(),
    })),
  };
  const audio = new ReferenceAudio();
  audio.context = context as unknown as AudioContext;
  if (loaded)
    for (const region of PIANO_REGIONS)
      audio.samples.set(region.file, buffer());
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
afterEach(() => {
  instrumentMetadata.files = originalFileMetadata;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("bounded reference audio", () => {
  it("reuses the shared sound bus for playback and previews after repeated audio unlocks", async () => {
    const { audio, context } = fixture();
    await audio.unlock();
    await audio.unlock();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(context.createDynamicsCompressor).toHaveBeenCalledTimes(2);
    expect(context.createConvolver).toHaveBeenCalledOnce();
    expect(context.createBuffer).toHaveBeenCalledOnce();
    const output = context.createDynamicsCompressor.mock.results[0].value;
    const master = context.createGain.mock.results[2].value;
    expect(master.connect).toHaveBeenCalledWith(context.destination);
    audio.tone(60, 0.8, 0, 1);
    const gain = context.createGain.mock.results[3].value;
    expect(gain.connect).toHaveBeenCalledWith(output);
  });

  it("can retry after the browser rejects an audio unlock", async () => {
    const { audio, context } = fixture();
    context.resume.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(audio.unlock()).rejects.toThrow("Permission denied");
    expect(audio.error).toMatch(/piano sound could not load/);
    expect(context.createDynamicsCompressor).not.toHaveBeenCalled();
    audio.tone(60, 0.8, 0, 1);
    expect(context.createBufferSource).not.toHaveBeenCalled();
    await audio.unlock();
    expect(audio.error).toBe("");
    audio.tone(60, 0.8, 0, 1);
    expect(audio.voices.size).toBe(1);
  });

  it("lets undamped upper strings finish their recorded decay", () => {
    const { audio, context, nodes } = fixture();
    const region = PIANO_REGIONS.find((entry) => entry.releaseSeconds >= 100)!;
    expect(region).toBeDefined();
    audio.tone(region.pitch, region.velocityMax / 127, 2, 0.2);
    const gain = context.createGain.mock.results[0].value.gain;
    expect(gain.setTargetAtTime).not.toHaveBeenCalled();
    const rate = nodes[0].playbackRate.value;
    expect(nodes[0].stop).toHaveBeenCalledWith(
      2 + (nodes[0].buffer!.duration - region.offset) / rate,
    );
  });

  it.each(["start", "stop"] as const)(
    "cleans up both nodes after a source %s failure and frees the voice slot",
    (operation) => {
      const { audio, context, nodes } = fixture();
      const create = context.createBufferSource.getMockImplementation()!;
      context.createBufferSource.mockImplementationOnce(() => {
        const source = create();
        source[operation].mockImplementationOnce(() => {
          throw new Error("Source failure");
        });
        return source;
      });
      audio.tone(60, 0.8, 0, 1);
      expect(audio.voices.size).toBe(0);
      expect(nodes[0].disconnect).toHaveBeenCalledOnce();
      expect(
        context.createGain.mock.results[0].value.disconnect,
      ).toHaveBeenCalledOnce();
      expect(audio.error).toMatch(/Reference sound could not start/);
    },
  );

  it("lets release tails overlap following notes and damps bass more slowly than treble", () => {
    const { audio, context, nodes } = fixture();
    audio.tone(36, 0.7, 0, 0.445);
    audio.tone(84, 0.7, 0.5, 0.445);
    const bassRelease =
      context.createGain.mock.results[0].value.gain.setTargetAtTime.mock
        .calls[0];
    const trebleRelease =
      context.createGain.mock.results[1].value.gain.setTargetAtTime.mock
        .calls[0];
    expect(bassRelease[1]).toBe(0.445);
    expect(trebleRelease[1]).toBeCloseTo(0.945);
    expect(bassRelease[2]).toBeGreaterThan(trebleRelease[2]);
    expect(nodes[0].stop.mock.calls[0][0]).toBeGreaterThan(0.5);
    expect(audio.voices.size).toBe(2);
  });

  it("plays the mapped velocity recording with its tuning and keeps its body until release", () => {
    const { audio, context, nodes } = fixture();
    const region = selectPianoRegion(61, 0.8)!;
    audio.tone(61, 0.8, 10, 2);
    expect(nodes[0].buffer).toBe(audio.samples.get(region.file));
    expect(nodes[0].playbackRate.value).toBeCloseTo(1.060687741368217, 12);
    expect(nodes[0].start).toHaveBeenCalledWith(10, region.offset);
    const gain = context.createGain.mock.results[0].value.gain;
    const level = pianoLevel(region, 0.8);
    expect(gain.setValueAtTime).toHaveBeenCalledWith(level, 12);
    expect(gain.setTargetAtTime).toHaveBeenCalledOnce();
    const [target, releaseAt, timeConstant] =
      gain.setTargetAtTime.mock.calls[0];
    expect(target).toBe(0);
    expect(releaseAt).toBe(12);
    // Adjacent lesson notes have a 55ms key-release gap. Most of the current
    // note should remain audible when the next one starts, without moving it.
    expect(Math.exp(-0.055 / timeConstant)).toBeGreaterThan(0.75);
    const stopAt = nodes[0].stop.mock.calls[0][0];
    expect(Math.exp(-(stopAt - releaseAt) / timeConstant)).toBeLessThan(0.001);
    audio.tone(61, 0.4, 10, 2);
    expect(nodes[1].buffer).toBe(audio.samples.get(fileFor(61, 0.4)));
    expect(nodes[1].buffer).not.toBe(nodes[0].buffer);
    const softer = context.createGain.mock.results[1].value.gain;
    expect(softer.linearRampToValueAtTime.mock.calls[0][0]).toBeLessThan(level);
  });
  it("coalesces 50,000 duplicated track notes into one voice with the longest sustain tail", () => {
    const { audio, transport, context, nodes } = fixture();
    const notes = Array.from({ length: 50000 }, (_, i) =>
      note(i, 60, 1 + (i % 3)),
    );
    audio.schedule(notes, transport, true);
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    expect(context.createGain).toHaveBeenCalledTimes(1);
    expect(
      context.createGain.mock.results[0].value.gain.setTargetAtTime,
    ).toHaveBeenCalledWith(0, 3, 0.24);
    expect(nodes[0].stop.mock.calls[0][0]).toBeCloseTo(4.7);
    expect(audio.scheduled.size).toBe(50000);
    audio.schedule(notes, transport, true);
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
  });
  it("caps an imported dense chord before node allocation and cancels all retained voices", () => {
    const { audio, transport, context, nodes } = fixture();
    audio.schedule(
      Array.from({ length: 50000 }, (_, i) => note(i, i % 128)),
      transport,
      true,
    );
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
    expect(context.createBufferSource).toHaveBeenCalledTimes(
      MAX_REFERENCE_VOICES,
    );
    expect(context.createGain).toHaveBeenCalledTimes(MAX_REFERENCE_VOICES);
    audio.stop();
    expect(audio.voices.size).toBe(0);
    expect(audio.scheduled.size).toBe(0);
    for (const osc of nodes) expect(osc.stop).toHaveBeenCalledTimes(2);
  });
  it("fades sounding and waiting voices on an explicit stop and disconnects each when it ends", () => {
    const { audio, context, nodes } = fixture();
    audio.tone(60, 0.8, 0, 2);
    audio.tone(64, 0.8, 1.02, 2);
    context.currentTime = 1;
    audio.stop();
    expect(audio.voices.size).toBe(0);
    expect(audio.scheduled.size).toBe(0);
    nodes.forEach((osc, index) => {
      const gain = context.createGain.mock.results[index].value;
      // Silent before its attack, so a fade cannot start a waiting voice loud.
      expect(gain.gain.value).toBe(0);
      expect(gain.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(1);
      expect(gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, 0.008);
      expect(osc.stop).toHaveBeenCalledTimes(2);
      expect(osc.stop.mock.lastCall![0]).toBeCloseTo(1.05);
      expect(osc.disconnect).not.toHaveBeenCalled();
      osc.onended!();
      expect(osc.disconnect).toHaveBeenCalledOnce();
      expect(gain.disconnect).toHaveBeenCalledOnce();
    });
  });
  it("stops a voice outright when the browser cannot fade it", () => {
    const { audio, context, nodes } = fixture();
    audio.tone(60, 0.8, 0, 2);
    context.createGain.mock.results[0].value.gain.cancelAndHoldAtTime.mockImplementation(
      () => {
        throw new TypeError("Unsupported");
      },
    );
    context.currentTime = 1;
    expect(() => audio.stop()).not.toThrow();
    expect(nodes[0].stop).toHaveBeenLastCalledWith();
    expect(nodes[0].disconnect).toHaveBeenCalledOnce();
    expect(audio.voices.size).toBe(0);
  });
  it("replaces the oldest sounding voice at the cap, and refuses only while every voice is waiting to start", () => {
    const { audio, context, nodes } = fixture();
    const gain = (index: number) =>
      context.createGain.mock.results[index].value.gain;
    // A pedalled passage: one long note every 10 ms.
    for (let i = 0; i < MAX_REFERENCE_VOICES; i++)
      audio.tone(36 + (i % 60), 0.8, i / 100, 10);
    context.currentTime = 0.5;
    audio.tone(100, 0.8, 0.5, 1);
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
    expect(nodes).toHaveLength(MAX_REFERENCE_VOICES + 1);
    expect(gain(0).cancelAndHoldAtTime).toHaveBeenCalledWith(0.5);
    expect(gain(0).setTargetAtTime).toHaveBeenLastCalledWith(0, 0.5, 0.008);
    expect(nodes[0].stop.mock.lastCall![0]).toBeCloseTo(0.55);
    expect(gain(1).cancelAndHoldAtTime).not.toHaveBeenCalled();
    // Fifty voices started before 0.5 s. The others, and each new voice, wait.
    for (let i = 0; i < 100; i++) audio.tone(100, 0.8, 0.5, 1);
    expect(nodes).toHaveLength(MAX_REFERENCE_VOICES + 50);
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
    for (let i = 0; i < MAX_REFERENCE_VOICES; i++)
      expect(gain(i).cancelAndHoldAtTime).toHaveBeenCalledTimes(i < 50 ? 1 : 0);
  });
  it("fades a stolen voice at its replacement's attack, not when the lookahead allocates", () => {
    const { audio, context, nodes } = fixture();
    const gain = (index: number) =>
      context.createGain.mock.results[index].value.gain;
    for (let i = 0; i < MAX_REFERENCE_VOICES; i++)
      audio.tone(36 + (i % 60), 0.8, i / 100, 10);
    context.currentTime = 0.4;
    audio.tone(100, 0.8, 0.5, 1);
    expect(gain(0).cancelAndHoldAtTime).toHaveBeenCalledWith(0.5);
    expect(gain(0).setTargetAtTime).toHaveBeenLastCalledWith(0, 0.5, 0.008);
    expect(nodes[0].stop.mock.lastCall![0]).toBeCloseTo(0.55);
  });
  it("bounds allocation when a dense file has more attacks in one lookahead than voices", () => {
    const { audio, transport, context, nodes } = fixture();
    const notes = Array.from({ length: 1000 }, (_, i) => ({
      ...note(i, 21 + (i % 88), 2),
      start: i * 0.0001,
    }));
    audio.schedule(notes, transport, true);
    // The cap, plus at most as many voices stolen for attacks still ahead.
    expect(nodes).toHaveLength(2 * MAX_REFERENCE_VOICES);
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
    // Once those attacks pass, the refused notes are tried again.
    context.currentTime = 0.02;
    audio.schedule(notes, transport, true);
    expect(nodes.length).toBeGreaterThan(2 * MAX_REFERENCE_VOICES);
    expect(nodes.length).toBeLessThanOrEqual(4 * MAX_REFERENCE_VOICES);
  });
  it("lets a stop before the attack cancel a voice stolen for that attack", () => {
    const { audio, context, nodes } = fixture();
    const gain = (index: number) =>
      context.createGain.mock.results[index].value.gain;
    for (let i = 0; i < MAX_REFERENCE_VOICES; i++)
      audio.tone(36 + (i % 60), 0.8, i / 100, 10);
    context.currentTime = 0.4;
    audio.tone(100, 0.8, 0.5, 1);
    expect(gain(0).cancelAndHoldAtTime).toHaveBeenLastCalledWith(0.5);
    context.currentTime = 0.45;
    audio.stop();
    expect(gain(0).cancelAndHoldAtTime).toHaveBeenLastCalledWith(0.45);
    expect(nodes[0].stop.mock.lastCall![0]).toBeCloseTo(0.5);
  });
  it("moves a voice stolen before its own attack to a new speed", () => {
    const { audio, transport, context } = fixture();
    const gain = (index: number) =>
      context.createGain.mock.results[index].value.gain;
    const notes = [
      ...Array.from({ length: MAX_REFERENCE_VOICES }, (_, i) => ({
        ...note(i, 30 + i),
        start: 0.05,
      })),
      { ...note(MAX_REFERENCE_VOICES, 100), start: 0.1 },
    ];
    audio.schedule(notes, transport, true);
    // The new note took the slot of note 0, which waits to start at 0.05.
    expect(gain(0).cancelAndHoldAtTime).toHaveBeenLastCalledWith(0.1);
    expect(audio.scheduled.has("0")).toBe(true);
    context.currentTime = 0.01;
    transport.setSpeed(0.5, 0.01);
    audio.reschedule();
    expect(gain(0).cancelAndHoldAtTime).toHaveBeenLastCalledWith(0.01);
    expect(audio.scheduled.has("0")).toBe(false);
  });
  it("retries a note the voice cap refused once a voice is free", () => {
    const { audio, transport, context, nodes } = fixture();
    const notes = Array.from({ length: MAX_REFERENCE_VOICES + 1 }, (_, i) => ({
      ...note(i, 30 + i),
      start: 0.05,
    }));
    audio.schedule(notes, transport, true);
    expect(nodes).toHaveLength(MAX_REFERENCE_VOICES);
    expect(audio.scheduled.has(String(MAX_REFERENCE_VOICES))).toBe(false);
    nodes[0].onended!();
    context.currentTime = 0.02;
    audio.schedule(notes, transport, true);
    expect(nodes).toHaveLength(MAX_REFERENCE_VOICES + 1);
    expect(nodes.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(0.05);
    expect(audio.scheduled.has(String(MAX_REFERENCE_VOICES))).toBe(true);
  });
  it("lets voices fading after a stop finish on the dry path, outside the fresh room", async () => {
    const { audio, context } = fixture();
    await audio.unlock();
    const [dry] = context.createGain.mock.results.map((result) => result.value);
    const [compressor] = context.createDynamicsCompressor.mock.results.map(
      (result) => result.value,
    );
    audio.tone(60, 0.8, 0, 2);
    const voice = context.createGain.mock.results[3].value;
    expect(voice.connect).toHaveBeenLastCalledWith(compressor);
    context.currentTime = 1;
    audio.stop();
    expect(context.createConvolver).toHaveBeenCalledTimes(2);
    expect(voice.disconnect).toHaveBeenCalledOnce();
    expect(voice.connect).toHaveBeenLastCalledWith(dry);
    audio.tone(64, 0.8, 1, 2);
    const next = context.createGain.mock.results[4].value;
    expect(next.connect).toHaveBeenLastCalledWith(compressor);
  });
  it("keeps a dense pedalled passage sounding past the voice cap", () => {
    const { audio, transport, context } = fixture();
    const notes = Array.from({ length: 200 }, (_, i) => ({
      ...note(i, 36 + (i % 60), 10),
      start: i / 100,
    }));
    for (let tick = 0; tick <= 100; tick++) {
      context.currentTime = tick * 0.02;
      audio.schedule(notes, transport, true);
    }
    expect(context.createBufferSource).toHaveBeenCalledTimes(200);
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
  });
  it("moves only waiting voices to a new speed, so sounding notes are not struck again", () => {
    const { audio, transport, context, nodes } = fixture();
    const notes = [note(1, 60, 2), { ...note(2, 64, 2), start: 0.1 }];
    audio.schedule(notes, transport, true);
    audio.tone(67, 0.8, 0.3, 0.4);
    expect(nodes).toHaveLength(3);
    context.currentTime = 0.05;
    transport.setSpeed(0.5, 0.05);
    audio.reschedule();
    expect(audio.scheduled).toEqual(new Set(["1"]));
    const fades = context.createGain.mock.results.map(
      (result) => result.value.gain.cancelAndHoldAtTime.mock.calls,
    );
    // The sounding note and the preview, which has no note to replay, remain.
    expect(fades).toEqual([[], [[0.05]], []]);
    audio.schedule(notes, transport, true);
    expect(nodes).toHaveLength(4);
    // 0.05 of the song remains before the note, played at half speed.
    expect(nodes[3].start.mock.calls[0][0]).toBeCloseTo(0.15);
    expect(nodes[0].stop).toHaveBeenCalledOnce();
  });
  describe("across loop passes", () => {
    // The loop [0.5, 1.5] at 1x wraps when the clock reaches 1 s.
    const loopNotes = [
      { ...note(1, 60, 2), start: 0.2 }, // Sounds into the loop from before it.
      { ...note(2, 64, 0.9), start: 0.5 },
      { ...note(3, 67, 1.4), start: 0.55 },
      { ...note(4, 71, 1.5), start: 1.45 },
    ];
    function loopFixture() {
      const result = fixture();
      const transport = new Transport(2);
      transport.loop = [0.5, 1.5];
      transport.seek(0.5, 0);
      transport.play(0);
      /** One controller tick: observe the wrap, then schedule. */
      const tick = (now: number) => {
        result.context.currentTime = now;
        transport.update(now);
        result.audio.schedule(loopNotes, transport, true);
      };
      return { ...result, transport, tick };
    }
    const starts = (nodes: ReturnType<typeof fixture>["nodes"]) =>
      nodes.map((osc) => osc.start.mock.calls[0][0]);

    it("schedules the first notes of the next pass on time, before the wrap, once", () => {
      const { nodes, tick } = loopFixture();
      tick(0);
      expect(starts(nodes)).toEqual([0, 0, expect.closeTo(0.05)]);
      tick(0.9);
      // Note 4 ends this pass. Notes 1 and 2 start the next one at the wrap.
      expect(starts(nodes).slice(3)).toEqual([
        expect.closeTo(0.95),
        expect.closeTo(1),
        expect.closeTo(1),
      ]);
      tick(1.02);
      expect(starts(nodes).slice(6)).toEqual([expect.closeTo(1.05)]);
      tick(1.04);
      expect(nodes).toHaveLength(7);
    });

    it("schedules the current pass afresh after a stall longer than a loop", () => {
      const { nodes, tick } = loopFixture();
      tick(0);
      tick(0.9);
      expect(nodes).toHaveLength(6);
      // The clock skips the passes that began at 1 s and 2 s.
      tick(3.3);
      // Position 0.8: notes 1, 2 and 3 are sounding and are struck now.
      expect(starts(nodes).slice(6)).toEqual([
        expect.closeTo(3.3),
        expect.closeTo(3.3),
        expect.closeTo(3.3),
      ]);
    });

    it("moves next-pass voices to a new speed before the wrap", () => {
      const { audio, transport, context, nodes, tick } = loopFixture();
      tick(0);
      tick(0.9);
      context.currentTime = 0.94;
      transport.setSpeed(0.5, 0.94);
      audio.reschedule();
      tick(0.94);
      tick(0.96);
      // 0.06 of the loop remains before the wrap, played at half speed.
      expect(starts(nodes).slice(6)).toEqual([
        expect.closeTo(0.96),
        expect.closeTo(1.06),
        expect.closeTo(1.06),
      ]);
      // After the wrap only note 3 is new.
      tick(1.07);
      expect(starts(nodes).slice(9)).toEqual([expect.closeTo(1.16)]);
    });
  });
  it("applies the same cap to direct previews and future-scheduled voices, then reuses freed slots", () => {
    const { audio, context, nodes } = fixture();
    for (let i = 0; i < 5000; i++) audio.tone(i % 128, 0.8, 100, 10);
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
    expect(context.createBufferSource).toHaveBeenCalledTimes(
      MAX_REFERENCE_VOICES,
    );
    nodes[0].onended!();
    audio.tone(60, 0.8, 0, 1);
    expect(context.createBufferSource).toHaveBeenCalledTimes(
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
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    await audio.unlock();
    audio.tone(60, 0.8, 0, 1);
    expect(audio.error).toBe("");
    expect(audio.voices.size).toBe(1);
  });
});

describe("piano sample loading", () => {
  const response = () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  });

  it("does not let a fading voice's recording block a new passage", async () => {
    const { audio, context, nodes } = fixture(false);
    const bytes = 200 * 1024 * 1024;
    const fading = fileFor(60),
      first = fileFor(63),
      second = fileFor(66);
    audio.samples.set(fading, sizedBuffer(bytes));
    instrumentMetadata.files = {
      [first]: { duration: bytes / (sampleRate * 8), channels: 2 },
      [second]: { duration: bytes / (sampleRate * 8), channels: 2 },
    };
    context.decodeAudioData
      .mockResolvedValueOnce(sizedBuffer(bytes))
      .mockResolvedValueOnce(sizedBuffer(bytes));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
    await audio.unlock();
    audio.tone(60, 0.8, 0, 2);
    context.currentTime = 1;
    // The voice fades for 50 ms. Both new recordings fit once it has gone.
    audio.stop();
    await audio.prepare([sound(63), sound(66)]);
    expect(audio.samples.has(first)).toBe(true);
    expect(audio.samples.has(second)).toBe(true);
    expect(audio.samples.has(fading)).toBe(false);
    // Under memory pressure the fading voice ends at once.
    expect(nodes[0].stop).toHaveBeenLastCalledWith();
    expect(nodes[0].disconnect).toHaveBeenCalledOnce();
  });

  it("loads only requested recordings, shares concurrent work, and reuses decoded samples", async () => {
    const { audio, context } = fixture(false);
    let finish!: (value: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>((resolve) => {
      finish = resolve;
    });
    const fetcher = vi.fn((_url: string) => pending);
    vi.stubGlobal("fetch", fetcher);
    await audio.unlock();
    expect(fetcher).not.toHaveBeenCalled();
    const first = audio.prepare([
      sound(60, 0.4),
      sound(61, 0.4),
      sound(60),
      sound(70, 0),
    ]);
    const second = audio.prepare([sound(60), sound(63)]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(audio.loading).toBe(true);
    audio.tone(60, 0.8, 0, 1);
    expect(context.createBufferSource).not.toHaveBeenCalled();
    finish(response());
    await Promise.all([first, second]);
    expect(audio.loading).toBe(false);
    expect([...audio.samples.keys()].sort()).toEqual(
      [fileFor(60, 0.4), fileFor(60), fileFor(63)].sort(),
    );
    expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual(
      [fileFor(60, 0.4), fileFor(60), fileFor(63)]
        .map((file) => `/audio/accurate-salamander/${file}`)
        .sort(),
    );
    expect(context.decodeAudioData).toHaveBeenCalledTimes(3);
    await audio.unlock();
    await audio.prepare([sound(60), sound(63)]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    audio.tone(60, 0.8, 0, 1);
    expect(context.createBufferSource).toHaveBeenCalledOnce();
  });

  it.each(["download", "decode"] as const)(
    "releases a cancelled scope during %s so a disjoint near-limit scope can load",
    async (phase) => {
      const { audio, context } = fixture(false);
      const bytes = 300 * 1024 * 1024;
      const oldFile = fileFor(60),
        nextFile = fileFor(63);
      instrumentMetadata.files = Object.fromEntries(
        [oldFile, nextFile].map((file) => [
          file,
          { duration: bytes / (sampleRate * 8), channels: 2 },
        ]),
      );
      let finishDownload!: (value: ReturnType<typeof response>) => void;
      const oldDownload = new Promise<ReturnType<typeof response>>(
        (resolve) => {
          finishDownload = resolve;
        },
      );
      let finishDecode!: (value: AudioBuffer) => void;
      const oldDecode = new Promise<AudioBuffer>((resolve) => {
        finishDecode = resolve;
      });
      const fetcher = vi.fn(async (url: string) =>
        phase === "download" && url.endsWith(oldFile)
          ? oldDownload
          : response(),
      );
      vi.stubGlobal("fetch", fetcher);
      context.decodeAudioData.mockImplementation(async () =>
        sizedBuffer(bytes),
      );
      if (phase === "decode")
        context.decodeAudioData.mockImplementationOnce(() => oldDecode);
      await audio.unlock();
      const controller = new AbortController();
      const old = audio.prepare([sound(60)], controller.signal);
      const cancelled = expect(old).rejects.toMatchObject({
        name: "AbortError",
      });
      if (phase === "decode")
        await vi.waitFor(() =>
          expect(context.decodeAudioData).toHaveBeenCalledOnce(),
        );
      controller.abort();
      await cancelled;
      expect(audio.loading).toBe(false);
      const next = audio.prepare([sound(63)]);
      if (phase === "decode") {
        // The in-flight decoder retains its 300 MiB reservation. A second
        // 300 MiB scope waits instead of overcommitting or being rejected.
        expect(fetcher).toHaveBeenCalledOnce();
        expect(audio.loading).toBe(true);
        finishDecode(sizedBuffer(bytes));
      }
      await next;
      audio.setPlaybackNotes([sound(63)]);
      expect(audio.samples.has(nextFile)).toBe(true);
      expect(audio.error).toBe("");
      finishDownload(response());
      finishDecode(sizedBuffer(bytes));
      await vi.waitFor(() => expect(audio.samples.size).toBe(1));
      // Let the abandoned worker finish; it must not publish the stale decode.
      await Promise.resolve();
      await Promise.resolve();
      expect(audio.samples.has(oldFile)).toBe(false);
      expect(cachedBytes(audio)).toBe(bytes);
      expect(cachedBytes(audio)).toBeLessThanOrEqual(MAX_PIANO_CACHE_BYTES);
    },
  );

  it("keeps a shared load and active sound when only one preparation is cancelled", async () => {
    const { audio, context } = fixture(false);
    const activeFile = fileFor(66),
      sharedFile = fileFor(60);
    const bytes = 300 * 1024 * 1024;
    audio.samples.set(activeFile, sizedBuffer(100 * 1024 * 1024));
    instrumentMetadata.files = {
      [sharedFile]: { duration: bytes / (sampleRate * 8), channels: 2 },
    };
    let finish!: (value: ReturnType<typeof response>) => void;
    const download = new Promise<ReturnType<typeof response>>((resolve) => {
      finish = resolve;
    });
    let requestSignal!: AbortSignal;
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
      requestSignal = options.signal as AbortSignal;
      return download;
    });
    vi.stubGlobal("fetch", fetcher);
    context.decodeAudioData.mockResolvedValue(sizedBuffer(bytes));
    await audio.unlock();
    audio.setPlaybackNotes([sound(66)]);
    audio.tone(66, 0.8, 0, 1);
    const controller = new AbortController();
    const first = audio.prepare([sound(60)], controller.signal);
    const cancelled = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    const shared = audio.prepare([sound(60)]);
    controller.abort();
    await cancelled;
    expect(requestSignal.aborted).toBe(false);
    expect(audio.loading).toBe(true);
    finish(response());
    await shared;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(audio.samples.has(sharedFile)).toBe(true);
    expect(audio.samples.has(activeFile)).toBe(true);
    expect(audio.voices.size).toBe(1);
    expect(audio.loading).toBe(false);
  });

  it.each(["download", "decode"] as const)(
    "retries the same file after a cancelled %s without stale cleanup removing its replacement",
    async (phase) => {
      const { audio, context } = fixture(false);
      const file = fileFor(60),
        bytes = 300 * 1024 * 1024;
      instrumentMetadata.files = {
        [file]: { duration: bytes / (sampleRate * 8), channels: 2 },
      };
      let finishOldDownload!: (value: ReturnType<typeof response>) => void;
      const oldDownload = new Promise<ReturnType<typeof response>>(
        (resolve) => {
          finishOldDownload = resolve;
        },
      );
      let finishNewDownload!: (value: ReturnType<typeof response>) => void;
      const newDownload = new Promise<ReturnType<typeof response>>(
        (resolve) => {
          finishNewDownload = resolve;
        },
      );
      let finishOldDecode!: (value: AudioBuffer) => void;
      const oldDecode = new Promise<AudioBuffer>((resolve) => {
        finishOldDecode = resolve;
      });
      const fetcher = vi
        .fn()
        .mockImplementationOnce(() =>
          phase === "download" ? oldDownload : response(),
        )
        .mockImplementation(() => newDownload);
      vi.stubGlobal("fetch", fetcher);
      context.decodeAudioData.mockResolvedValue(sizedBuffer(bytes));
      if (phase === "decode")
        context.decodeAudioData.mockImplementationOnce(() => oldDecode);
      await audio.unlock();
      const controller = new AbortController();
      const first = audio.prepare([sound(60)], controller.signal);
      const cancellation = expect(first).rejects.toMatchObject({
        name: "AbortError",
      });
      if (phase === "decode")
        await vi.waitFor(() =>
          expect(context.decodeAudioData).toHaveBeenCalledOnce(),
        );
      // Observe the abandoned worker through its cleanup, after public prepare
      // has already rejected on cancellation, to exercise the identity guard.
      const oldWorker = (
        Reflect.get(audio, "pending") as Map<
          string,
          { promise: Promise<AudioBuffer> }
        >
      )
        .get(file)!
        .promise.catch(() => {});
      controller.abort();
      await cancellation;
      const replacement = audio.prepare([sound(60)]);
      if (phase === "decode") expect(fetcher).toHaveBeenCalledOnce();
      else expect(fetcher).toHaveBeenCalledTimes(2);
      finishOldDownload(response());
      finishOldDecode(sizedBuffer(bytes));
      await oldWorker;
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      const shared = audio.prepare([sound(60)]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      finishNewDownload(response());
      await Promise.all([replacement, shared]);
      expect(audio.samples.size).toBe(1);
      expect(audio.samples.has(file)).toBe(true);
      expect(cachedBytes(audio)).toBe(bytes);
      expect(audio.error).toBe("");
      expect(audio.loading).toBe(false);
    },
  );

  it.each(["download", "decode"])(
    "retains successful recordings and retries only the failed %s",
    async (failure) => {
      const { audio, context } = fixture(false);
      const fetcher = vi.fn(async () => response());
      vi.stubGlobal("fetch", fetcher);
      if (failure === "download")
        fetcher.mockResolvedValueOnce({ ...response(), ok: false });
      else
        context.decodeAudioData.mockRejectedValueOnce(
          new Error("Invalid audio"),
        );
      await audio.unlock();
      const notes = [sound(60), sound(63)];
      await expect(audio.prepare(notes)).rejects.toThrow();
      expect(audio.loading).toBe(false);
      expect(audio.error).toMatch(/piano samples could not load/);
      expect(audio.samples.size).toBe(1);
      const [retainedFile, retainedBuffer] = [...audio.samples][0];
      expect(fetcher).toHaveBeenCalledTimes(2);
      await audio.prepare(notes);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(audio.samples.size).toBe(2);
      expect(audio.samples.get(retainedFile)).toBe(retainedBuffer);
      expect(audio.error).toBe("");
    },
  );

  it("rejects an oversized passage before downloading and releases its reservations", async () => {
    const { audio } = fixture(false);
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetcher);
    // Unknown metadata uses the conservative 32 MiB estimate per recording.
    instrumentMetadata.files = {};
    const notes = [...new Set(PIANO_REGIONS.map((region) => region.file))]
      .slice(0, 17)
      .map((file) => {
        const region = PIANO_REGIONS.find((entry) => entry.file === file)!;
        return sound(region.pitch, region.velocityMin / 127);
      });
    expect(MAX_PIANO_CACHE_BYTES).toBe(512 * 1024 * 1024);
    await audio.unlock();
    await expect(audio.prepare(notes)).rejects.toThrow(
      /too many piano samples/,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(audio.samples.size).toBe(0);
    expect(audio.loading).toBe(false);
    await audio.prepare([notes[0]]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(audio.error).toBe("");
  });

  it("evicts unused decoded recordings while retaining a sounding recording", async () => {
    const { audio, context } = fixture(false);
    const bytes = 200 * 1024 * 1024;
    const playing = fileFor(60),
      unused = fileFor(63),
      requested = fileFor(66);
    audio.samples.set(playing, sizedBuffer(bytes));
    audio.samples.set(unused, sizedBuffer(bytes));
    instrumentMetadata.files = {
      [requested]: { duration: bytes / (sampleRate * 8), channels: 2 },
    };
    context.decodeAudioData.mockResolvedValueOnce(sizedBuffer(bytes));
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetcher);
    await audio.unlock();
    audio.tone(60, 0.8, 0, 1);
    await audio.prepare([sound(66)]);
    expect(audio.voices.size).toBe(1);
    expect(audio.samples.has(playing)).toBe(true);
    expect(audio.samples.has(unused)).toBe(false);
    expect(audio.samples.has(requested)).toBe(true);
    expect(cachedBytes(audio)).toBe(2 * bytes);
    expect(cachedBytes(audio)).toBeLessThanOrEqual(MAX_PIANO_CACHE_BYTES);
  });

  it("evicts the least recently used recording, not the first loaded", async () => {
    const { audio, context } = fixture(false);
    const bytes = 200 * 1024 * 1024;
    const reused = fileFor(60),
      stale = fileFor(63),
      requested = fileFor(66);
    audio.samples.set(reused, sizedBuffer(bytes));
    audio.samples.set(stale, sizedBuffer(bytes));
    instrumentMetadata.files = {
      [requested]: { duration: bytes / (sampleRate * 8), channels: 2 },
    };
    context.decodeAudioData.mockResolvedValueOnce(sizedBuffer(bytes));
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetcher);
    await audio.unlock();
    await audio.prepare([sound(60)]);
    expect(fetcher).not.toHaveBeenCalled();
    await audio.prepare([sound(66)]);
    expect(audio.samples.has(reused)).toBe(true);
    expect(audio.samples.has(stale)).toBe(false);
    expect(audio.samples.has(requested)).toBe(true);
  });

  it("protects future playback recordings across scheduler cycles until playback stops", async () => {
    const { audio, context, transport } = fixture(false);
    const bytes = 200 * 1024 * 1024;
    const playing = fileFor(60),
      future = fileFor(63),
      requested = fileFor(66);
    audio.samples.set(playing, sizedBuffer(bytes));
    audio.samples.set(future, sizedBuffer(bytes));
    instrumentMetadata.files = {
      [requested]: { duration: bytes / (sampleRate * 8), channels: 2 },
    };
    context.decodeAudioData.mockResolvedValueOnce(sizedBuffer(bytes));
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetcher);
    await audio.unlock();
    audio.setPlaybackNotes([sound(60), sound(63)]);
    audio.schedule([{ ...note(1), velocity: 0.8 }], transport, true);
    expect(audio.voices.size).toBe(1);
    await expect(audio.prepare([sound(66)])).rejects.toThrow(
      /too many piano samples/,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(audio.samples.has(future)).toBe(true);
    audio.stop();
    await audio.prepare([sound(66)]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(audio.samples.has(requested)).toBe(true);
    expect(cachedBytes(audio)).toBeLessThanOrEqual(MAX_PIANO_CACHE_BYTES);
  });

  it("retains future recordings after voice cancellation and keeps playing after an unrelated memory rejection", async () => {
    const { audio, context, transport } = fixture(false);
    const bytes = 200 * 1024 * 1024;
    const future = fileFor(63),
      requested = fileFor(66);
    audio.samples.set(fileFor(60), sizedBuffer(bytes));
    audio.samples.set(future, sizedBuffer(bytes));
    instrumentMetadata.files = {
      [requested]: { duration: bytes / (sampleRate * 8), channels: 2 },
    };
    await audio.unlock();
    audio.setPlaybackNotes([sound(60), sound(63)]);
    audio.stop(false);
    await expect(audio.prepare([sound(66)])).rejects.toThrow(
      /too many piano samples/,
    );
    expect(audio.samples.has(future)).toBe(true);
    expect(audio.error).toMatch(/too many piano samples/);
    audio.schedule([{ ...note(1, 63), velocity: 0.8 }], transport, true);
    expect(context.createBufferSource).toHaveBeenCalledOnce();
    expect(audio.voices.size).toBe(1);
  });

  it("keeps cached playback available after an unrelated sample download fails", async () => {
    const { audio, context, transport } = fixture(false);
    audio.samples.set(fileFor(63), buffer());
    audio.setPlaybackNotes([sound(63)]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await audio.unlock();
    await expect(audio.prepare([sound(60)])).rejects.toThrow("offline");
    expect(audio.error).toMatch(/piano samples could not load/);
    audio.schedule([{ ...note(1, 63), velocity: 0.8 }], transport, true);
    expect(context.createBufferSource).toHaveBeenCalledOnce();
    expect(audio.voices.size).toBe(1);
  });

  it("counts concurrent preparations toward the memory limit without evicting their samples", async () => {
    const { audio, context } = fixture(false);
    const bytes = 200 * 1024 * 1024;
    const notes = [sound(60), sound(63), sound(66)];
    instrumentMetadata.files = Object.fromEntries(
      notes.map(({ pitch, velocity }) => [
        fileFor(pitch, velocity),
        { duration: bytes / (sampleRate * 8), channels: 2 },
      ]),
    );
    let finish!: (value: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>((resolve) => {
      finish = resolve;
    });
    const fetcher = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetcher);
    context.decodeAudioData.mockImplementation(async () => sizedBuffer(bytes));
    await audio.unlock();
    const first = audio.prepare([notes[0]]);
    const second = audio.prepare([notes[1]]);
    await expect(audio.prepare([notes[2]])).rejects.toThrow(
      /too many piano samples/,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(audio.loading).toBe(true);
    finish(response());
    await Promise.all([first, second]);
    expect(audio.samples.size).toBe(2);
    expect(audio.loading).toBe(false);
    expect(cachedBytes(audio)).toBeLessThanOrEqual(MAX_PIANO_CACHE_BYTES);
  });

  it("rejects a decoded sample that exceeds its estimate without caching it", async () => {
    const { audio, context } = fixture(false);
    instrumentMetadata.files = {
      [fileFor(60)]: { duration: 1, channels: 2 },
    };
    context.decodeAudioData.mockResolvedValueOnce(
      sizedBuffer(MAX_PIANO_CACHE_BYTES + 8),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
    await audio.unlock();
    await expect(audio.prepare([sound(60)])).rejects.toThrow(
      /too many piano samples/,
    );
    expect(audio.samples.size).toBe(0);
    expect(audio.loading).toBe(false);
    await audio.prepare([sound(60)]);
    expect(audio.samples.size).toBe(1);
  });

  it("does not replace a newer successful preparation with a stale loading error", async () => {
    const { audio, context } = fixture(false);
    let rejectFirst!: (error: Error) => void;
    const pending = new Promise<ReturnType<typeof response>>((_, reject) => {
      rejectFirst = reject;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.endsWith(fileFor(60)) ? pending : Promise.resolve(response()),
      ),
    );
    await audio.unlock();
    const first = audio.prepare([sound(60)]);
    const firstFailure = expect(first).rejects.toThrow("download failed");
    await audio.prepare([sound(63)]);
    expect(audio.loading).toBe(true);
    rejectFirst(new Error("download failed"));
    await firstFailure;
    expect(audio.error).toBe("");
    expect(audio.loading).toBe(false);
    audio.tone(63, 0.8, 0, 1);
    expect(context.createBufferSource).toHaveBeenCalledOnce();
  });
});
