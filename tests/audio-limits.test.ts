import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_OPTIONAL_VOICES,
  MAX_PIANO_CACHE_BYTES,
  MAX_REFERENCE_VOICES,
  ReferenceAudio,
} from "../src/audio";
import {
  PIANO_REGIONS,
  pianoInstrument,
  pianoLevel,
  pianoPlaybackRate,
  selectPianoRegion,
} from "../src/piano";
import {
  PIANO_VOICE_GROUPS,
  pianoVoiceEvents,
  pianoVoiceFiles,
  pianoVoiceRegions,
} from "../src/pianoVoices";
import { DEFAULT_PIANO_SOUND } from "../src/pianoSound";
import { Transport } from "../src/engine";
import type { Note, PedalSpan } from "../src/song";
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
    expect(context.createDynamicsCompressor).toHaveBeenCalledTimes(3);
    expect(context.createConvolver).toHaveBeenCalledOnce();
    expect(context.createBuffer).toHaveBeenCalledOnce();
    const [output, , room] = context.createDynamicsCompressor.mock.results.map(
      (result) => result.value,
    );
    const master = context.createGain.mock.results[2].value;
    expect(master.connect).toHaveBeenCalledWith(context.destination);
    audio.tone(60, 0.8, 0, 1);
    const gain = context.createGain.mock.results[3].value;
    expect(gain.connect).toHaveBeenCalledWith(output);
    expect(gain.connect).toHaveBeenCalledWith(room);
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
  it("replaces a voice at the cap only once the new note is due, so no fade is left pending", () => {
    const { audio, transport, context, nodes } = fixture();
    const gain = (index: number) =>
      context.createGain.mock.results[index].value.gain;
    for (let i = 0; i < MAX_REFERENCE_VOICES; i++)
      audio.tone(36 + (i % 60), 0.8, i / 100, 10);
    context.currentTime = 0.4;
    // Ahead of its attack the note waits, and no sounding voice is cut early,
    // so a speed change before then has no deferred fade to move.
    expect(audio.tone(100, 0.8, 0.5, 1)).toBe(false);
    expect(nodes).toHaveLength(MAX_REFERENCE_VOICES);
    transport.setSpeed(0.5, 0.4);
    audio.reschedule(transport);
    for (let i = 0; i < 40; i++)
      expect(gain(i).cancelAndHoldAtTime).not.toHaveBeenCalled();
    context.currentTime = 0.5;
    expect(audio.tone(100, 0.8, 0.5, 1)).toBe(true);
    expect(gain(0).cancelAndHoldAtTime).toHaveBeenCalledExactlyOnceWith(0.5);
  });
  it("bounds allocation when a dense file has more attacks than voices, until fades end", () => {
    const { audio, transport, context, nodes } = fixture();
    const notes = Array.from({ length: 1000 }, (_, i) => ({
      ...note(i, 21 + (i % 88), 2),
      start: i * 0.0001,
    }));
    audio.schedule(notes, transport, true);
    expect(nodes).toHaveLength(MAX_REFERENCE_VOICES);
    // The rest are due by the next tick: each replaces a voice, which fades.
    context.currentTime = 0.02;
    audio.schedule(notes, transport, true);
    expect(nodes).toHaveLength(2 * MAX_REFERENCE_VOICES);
    // Faded voices hold their nodes until they end, so later ticks wait.
    context.currentTime = 0.2;
    audio.schedule(notes, transport, true);
    expect(nodes).toHaveLength(2 * MAX_REFERENCE_VOICES);
    for (const osc of nodes.slice(0, MAX_REFERENCE_VOICES)) osc.onended!();
    context.currentTime = 0.22;
    audio.schedule(notes, transport, true);
    expect(nodes).toHaveLength(3 * MAX_REFERENCE_VOICES);
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
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
  it("takes voices fading after a stop out of the fresh room, keeping their compressed dry path", async () => {
    const { audio, context } = fixture();
    await audio.unlock();
    const [compressor, , room] =
      context.createDynamicsCompressor.mock.results.map(
        (result) => result.value,
      );
    audio.tone(60, 0.8, 0, 2);
    const voice = context.createGain.mock.results[3].value;
    expect(voice.connect.mock.calls).toEqual([[compressor], [room]]);
    context.currentTime = 1;
    audio.stop();
    expect(context.createConvolver).toHaveBeenCalledTimes(2);
    expect(voice.disconnect.mock.calls).toEqual([[room]]);
    expect(voice.connect).toHaveBeenCalledTimes(2);
    // A second stop while it still fades must not disconnect it again: Web
    // Audio throws for a connection that no longer exists.
    audio.tone(62, 0.8, 1, 2);
    audio.stop();
    expect(voice.disconnect.mock.calls).toEqual([[room]]);
    expect(audio.error).toBe("");
    audio.tone(64, 0.8, 1, 2);
    const next = context.createGain.mock.results[5].value;
    expect(next.connect.mock.calls).toEqual([[compressor], [room]]);
  });
  it("keeps a dense pedalled passage sounding past the voice cap", () => {
    const { audio, transport, context, nodes } = fixture();
    const notes = Array.from({ length: 200 }, (_, i) => ({
      ...note(i, 36 + (i % 60), 10),
      start: i / 100,
    }));
    const ended = new Set<(typeof nodes)[number]>();
    for (let tick = 0; tick <= 100; tick++) {
      context.currentTime = tick * 0.02;
      // As the browser does, end each source once its stop time has passed.
      for (const osc of nodes)
        if (
          !ended.has(osc) &&
          osc.stop.mock.lastCall![0] <= context.currentTime
        ) {
          ended.add(osc);
          osc.onended!();
        }
      audio.schedule(notes, transport, true);
    }
    expect(context.createBufferSource).toHaveBeenCalledTimes(200);
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
  });
  it("moves waiting voices to a new speed, and a sounding note's release, without striking it again", () => {
    const { audio, transport, context, nodes } = fixture();
    const notes = [note(1, 60, 2), { ...note(2, 64, 2), start: 0.1 }];
    audio.schedule(notes, transport, true);
    audio.tone(67, 0.8, 0.3, 0.4);
    expect(nodes).toHaveLength(3);
    const gain = (index: number) =>
      context.createGain.mock.results[index].value.gain;
    const releaseTime = gain(0).setTargetAtTime.mock.calls[0][2];
    context.currentTime = 0.05;
    transport.setSpeed(0.5, 0.05);
    audio.reschedule(transport);
    expect(audio.scheduled).toEqual(new Set(["1"]));
    // The sounding note holds, then releases where its note-off now falls:
    // 1.95 s of song remain at half speed. The preview has no note to move.
    expect(gain(0).cancelAndHoldAtTime).toHaveBeenCalledExactlyOnceWith(0.05);
    expect(gain(0).setTargetAtTime).toHaveBeenLastCalledWith(
      0,
      expect.closeTo(3.95),
      releaseTime,
    );
    expect(nodes[0].stop.mock.lastCall![0]).toBeCloseTo(
      3.95 + releaseTime * 7 + 0.02,
    );
    expect(gain(1).cancelAndHoldAtTime).toHaveBeenCalledExactlyOnceWith(0.05);
    expect(gain(2).cancelAndHoldAtTime).not.toHaveBeenCalled();
    audio.schedule(notes, transport, true);
    expect(nodes).toHaveLength(4);
    // 0.05 of the song remains before the note, played at half speed.
    expect(nodes[3].start.mock.calls[0][0]).toBeCloseTo(0.15);
  });
  it("holds sounding notes at a Wait gate, then releases them where they end from there", () => {
    const { audio, transport, context, nodes } = fixture();
    audio.schedule([note(1, 60, 2)], transport, true);
    const gain = context.createGain.mock.results[0].value.gain;
    const releaseTime = gain.setTargetAtTime.mock.calls[0][2];
    context.currentTime = 1;
    transport.update(1, 1);
    audio.hold();
    // No release: the note rings on to the end of its recording.
    expect(gain.cancelAndHoldAtTime).toHaveBeenCalledExactlyOnceWith(1);
    expect(gain.setTargetAtTime).toHaveBeenCalledOnce();
    expect(nodes[0].stop.mock.lastCall![0]).toBeCloseTo(20, 1);
    // The learner plays three seconds later; one second of the note remains.
    context.currentTime = 4;
    transport.resume(1, 4);
    audio.reschedule(transport);
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(
      0,
      expect.closeTo(5),
      releaseTime,
    );
    expect(nodes[0].stop.mock.lastCall![0]).toBeCloseTo(
      5 + releaseTime * 7 + 0.02,
    );
  });

  it("keeps a just-struck note's full level when its release moves", () => {
    const { audio, transport, context } = fixture();
    audio.schedule([note(1, 60, 2)], transport, true);
    context.currentTime = 0.001;
    transport.setSpeed(0.5, 0.001);
    audio.reschedule(transport);
    const gain = context.createGain.mock.results[0].value.gain;
    // Held after the 3 ms attack ramp, not partway up it.
    expect(gain.cancelAndHoldAtTime).toHaveBeenCalledExactlyOnceWith(0.003);
  });
  it("caps active and fading voices together across rapid stops", () => {
    const { audio, nodes } = fixture();
    const fill = (when: number) => {
      for (let i = 0; i < MAX_REFERENCE_VOICES; i++)
        audio.tone(36 + (i % 60), 0.8, when, 10);
    };
    fill(0);
    audio.stop();
    fill(0);
    expect(nodes).toHaveLength(2 * MAX_REFERENCE_VOICES);
    // A second stop inside the 50 ms fade leaves 128 sources still fading.
    audio.stop();
    expect(audio.tone(60, 0.8, 0, 1)).toBe(false);
    expect(nodes).toHaveLength(2 * MAX_REFERENCE_VOICES);
    for (const osc of nodes.slice(0, MAX_REFERENCE_VOICES)) osc.onended!();
    fill(0);
    expect(nodes).toHaveLength(3 * MAX_REFERENCE_VOICES);
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

    it("starts the next pass from its own notes when given them", () => {
      const { audio, transport, context, nodes, tick } = loopFixture();
      tick(0);
      context.currentTime = 0.9;
      transport.update(0.9);
      // As in a Wait loop, only note 2 may start the next pass; note 1,
      // which would sound into it, waits.
      audio.schedule(loopNotes, transport, true, undefined, [loopNotes[1]]);
      expect(starts(nodes).slice(3)).toEqual([
        expect.closeTo(0.95),
        expect.closeTo(1),
      ]);
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
      audio.reschedule(transport);
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

describe("optional piano voices", () => {
  /** A fixture with every release, noise and resonance recording loaded. */
  function withVoices() {
    const setup = fixture();
    for (const group of Object.values(PIANO_VOICE_GROUPS))
      for (const region of group.regions)
        if (!setup.audio.samples.has(region.file))
          setup.audio.samples.set(region.file, buffer(2));
    const files = new Map(
      [...setup.audio.samples].map(([file, sample]) => [sample, file]),
    );
    /** Each started voice's recording and start time, in the order started. */
    const played = () =>
      setup.nodes.map((node) => [
        files.get(node.buffer!),
        Math.round(node.start.mock.calls[0][0] * 1000) / 1000 || 0,
      ]);
    const gain = (index: number) =>
      setup.context.createGain.mock.results[index].value.gain;
    /** Tick the scheduler every 20 ms, as the practice clock does. */
    const run = (notes: Note[], pedals: PedalSpan[], until: number) => {
      for (let tick = 0; tick * 0.02 <= until; tick++) {
        setup.context.currentTime = tick * 0.02;
        setup.audio.schedule(notes, setup.transport, true, pedals);
      }
    };
    const optional = () =>
      [...setup.audio.voices].filter((voice) => voice.layer).length;
    return { ...setup, played, gain, run, optional };
  }
  const passage = (): [Note[], PedalSpan[]] => [
    [
      // Released with the pedal up.
      note(1, 60, 0.4),
      // Struck with the pedal down, which holds it to 2 s.
      { ...note(2, 64, 2), start: 0.5, end: 0.9 },
    ],
    [{ channel: 0, start: 0.45, end: 2 }],
  ];

  it("plays release, key and pedal noise, and resonance where the song triggers them", () => {
    const { audio, played, gain, nodes, run } = withVoices();
    run(...passage(), 2.2);
    const release = pianoVoiceRegions("release", 60, 0.5)[0];
    const resonance = pianoVoiceRegions("resonance", 64, 0.5);
    expect(played()).toEqual([
      [fileFor(60, 0.5), 0],
      ["rel40.flac", 0.4],
      [release.file, 0.4],
      ["pedalD1.flac", 0.45],
      [fileFor(64, 0.5), 0.5],
      ...resonance.map((region) => [region.file, 0.5]),
      // The pedal holds the second key-up: key noise without harmonics.
      ["rel44.flac", 0.9],
      ["pedalU1.flac", 2],
    ]);
    expect(audio.error).toBe("");
    // Harmonics fade by rt_decay for the 0.4 s the key was held, and play
    // their recording out.
    expect(gain(2).linearRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(
        pianoLevel(
          { gainDb: release.gainDb - release.decayDbPerSecond * 0.4 },
          0.5,
        ),
        12,
      ),
      expect.closeTo(0.403),
    );
    expect(gain(2).setTargetAtTime).not.toHaveBeenCalled();
    expect(nodes[2].stop.mock.calls[0][0]).toBeCloseTo(
      0.4 + 2 / pianoPlaybackRate(release, 60),
    );
    // Pedal noise is cut 0.1 s after the pedal lifts (off_time).
    expect(gain(3).setTargetAtTime).toHaveBeenCalledWith(
      0,
      expect.closeTo(2),
      expect.closeTo(0.1 / 7),
    );
    // Resonance swells in over 50 ms and is damped with its note.
    const [, noteRelease, noteTimeConstant] =
      gain(4).setTargetAtTime.mock.calls[0];
    for (let i = 0; i < resonance.length; i++) {
      expect(gain(5 + i).linearRampToValueAtTime.mock.calls[0][1]).toBeCloseTo(
        0.55,
      );
      expect(gain(5 + i).setTargetAtTime).toHaveBeenCalledWith(
        0,
        expect.closeTo(noteRelease),
        noteTimeConstant,
      );
    }
  });

  it("leaves out the voices that are turned off", () => {
    const all = withVoices();
    all.audio.setSound({
      voices: {
        release: false,
        keyNoise: false,
        pedalNoise: false,
        resonance: false,
      },
    });
    all.run(...passage(), 2.2);
    expect(all.played()).toEqual([
      [fileFor(60, 0.5), 0],
      [fileFor(64, 0.5), 0.5],
    ]);
    const some = withVoices();
    some.audio.setSound({
      voices: { ...DEFAULT_PIANO_SOUND.voices, resonance: false },
    });
    some.run(...passage(), 2.2);
    expect(some.played().map(([file]) => file)).toEqual([
      fileFor(60, 0.5),
      "rel40.flac",
      pianoVoiceRegions("release", 60, 0.5)[0].file,
      "pedalD1.flac",
      fileFor(64, 0.5),
      "rel44.flac",
      "pedalU1.flac",
    ]);
  });

  /** A pedalled chord, struck at `start`, of `count` keys from C1 up. */
  const chord = (count: number, start: number): [Note[], PedalSpan[]] => [
    Array.from({ length: count }, (_, i) => ({
      ...note(i, 24 + i, 3),
      start,
      end: 2,
    })),
    [{ channel: 0, start, end: 3 }],
  ];
  const resonanceFor = (notes: Note[]) =>
    notes.flatMap((n) => pianoVoiceRegions("resonance", n.pitch, n.velocity))
      .length;

  it.each([24, 48])(
    "gives a %s-note pedalled chord's resonance only the voices notes leave, at most half",
    (count) => {
      const { audio, nodes, optional, run } = withVoices();
      const [notes, pedals] = chord(count, 0.05);
      const resonance = resonanceFor(notes);
      expect(resonance).toBeGreaterThan(MAX_OPTIONAL_VOICES);
      run(notes, pedals, 0);
      const expected = Math.min(
        MAX_OPTIONAL_VOICES,
        MAX_REFERENCE_VOICES - count,
      );
      expect(optional()).toBe(expected);
      expect(audio.voices.size).toBe(count + expected);
      // Refused resonance is left out, not struck late once the chord sounds.
      run(notes, pedals, 0.1);
      expect(nodes).toHaveLength(count + expected);
      for (const n of notes)
        for (let i = 0; i < resonanceFor([n]); i++)
          expect(audio.scheduled.has(`${n.id}~resonance~${i}`)).toBe(true);
    },
  );

  it("lets a note at the cap take an optional voice before any note's", () => {
    const { audio, transport, context, nodes, gain, optional } = withVoices();
    // Older notes first, then a pedalled chord whose resonance fills the cap.
    for (let i = 0; i < 40; i++) audio.tone(36 + i, 0.8, i / 1000, 10);
    context.currentTime = 0.1;
    const [notes, pedals] = chord(12, 0.1);
    audio.schedule(notes, transport, true, pedals);
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
    expect(optional()).toBe(MAX_REFERENCE_VOICES - 52);
    context.currentTime = 0.5;
    // C7 has no resonance of its own.
    const late = { ...note(99, 96, 3), start: 0.5, end: 2 };
    audio.schedule([...notes, late], transport, true, pedals);
    expect(nodes).toHaveLength(MAX_REFERENCE_VOICES + 1);
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
    expect(optional()).toBe(MAX_REFERENCE_VOICES - 53);
    const faded = nodes
      .map((_, index) => index)
      .filter((index) => gain(index).cancelAndHoldAtTime.mock.calls.length);
    // The oldest optional voice, not the older notes.
    expect(faded).toEqual([52]);
  });

  it("lets a due note cancel an optional voice waiting to start before it takes a note's", () => {
    const { audio, transport, context, nodes, gain } = withVoices();
    const resonance = pianoVoiceRegions("resonance", 64, 0.5).length;
    const older = MAX_REFERENCE_VOICES - 1 - resonance;
    for (let i = 0; i < older; i++) audio.tone(36 + i, 0.8, i / 1000, 10);
    context.currentTime = 0.05;
    // A pedalled note and its resonance wait to start at 0.1 s.
    audio.schedule(
      [{ ...note(1, 64, 3), start: 0.1, end: 2 }],
      transport,
      true,
      [{ channel: 0, start: 0.1, end: 3 }],
    );
    expect(audio.voices.size).toBe(MAX_REFERENCE_VOICES);
    // An on-screen preview, due now.
    expect(audio.tone(100, 0.8, 0.05, 1)).toBe(true);
    expect(nodes).toHaveLength(MAX_REFERENCE_VOICES + 1);
    const faded = nodes
      .map((_, index) => index)
      .filter((index) => gain(index).cancelAndHoldAtTime.mock.calls.length);
    // One of the waiting resonance voices, after the older notes and the
    // pedalled note at index `older`.
    expect(faded).toHaveLength(1);
    expect(faded[0]).toBeGreaterThan(older);
  });

  it("never takes a note's voice for an optional voice", () => {
    const { audio, transport, context, nodes, gain } = withVoices();
    for (let i = 0; i < MAX_REFERENCE_VOICES; i++)
      audio.tone(36 + (i % 60), 0.8, i / 100, 10);
    context.currentTime = 1;
    // Its key comes up now, with the pedal up: harmonics and key noise.
    const released = { ...note(99, 60, 1), end: 1 };
    audio.schedule([released], transport, true);
    expect(nodes).toHaveLength(MAX_REFERENCE_VOICES);
    for (let i = 0; i < MAX_REFERENCE_VOICES; i++)
      expect(gain(i).cancelAndHoldAtTime).not.toHaveBeenCalled();
    expect(audio.scheduled).toEqual(new Set(["99~keyNoise~0", "99~release~0"]));
  });

  it("plays a voice due where playback starts after the first tick, but none from before it", () => {
    const { audio, transport, context, played } = withVoices();
    transport.seek(1, 0);
    context.currentTime = 0.02;
    const notes = [
      { ...note(1, 60, 0.95), end: 0.95 },
      // Its key comes up as playback starts: that belongs before it.
      { ...note(2, 62, 1.5), start: 0.5, end: 1 },
    ];
    audio.schedule(notes, transport, true, [{ channel: 0, start: 1, end: 2 }]);
    expect(played()).toEqual([
      // The pedal holds it, so its note sounds from here.
      [fileFor(62, 0.5), 0.02],
      // The pedal pressed as playback starts, a tick late.
      ["pedalD1.flac", 0],
    ]);
  });

  it("sounds a key or pedal lift at the end of a loop pass, every pass", () => {
    const { audio, context, played, gain } = withVoices();
    const transport = new Transport(4);
    transport.loop = [0, 1];
    transport.play(0);
    const notes = [{ ...note(1, 60, 1), end: 1 }];
    const pedals = [
      { channel: 0, start: 0.2, end: 1 },
      // Pressed again after the loop ends.
      { channel: 0, start: 1.05, end: 2 },
    ];
    for (let tick = 0; tick * 0.02 <= 1.95; tick++) {
      context.currentTime = tick * 0.02;
      transport.update(context.currentTime);
      audio.schedule(notes, transport, true, pedals);
    }
    const release = pianoVoiceRegions("release", 60, 0.5)[0].file;
    const lifts = played().filter(([file]) =>
      ["rel40.flac", release, "pedalU1.flac", "pedalU2.flac"].includes(
        file as string,
      ),
    );
    expect(lifts.map(([, time]) => time)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(
      played().filter(([file]) => (file as string).startsWith("pedalD")),
    ).toEqual([
      ["pedalD1.flac", 0.2],
      ["pedalD1.flac", 1.2],
    ]);
    // The pedal's lift noise is not cut as it starts, but by the next pass's
    // press, 0.2 s into it.
    const lift = played().findIndex(([file]) => file === "pedalU1.flac");
    expect(gain(lift).setTargetAtTime).toHaveBeenCalledExactlyOnceWith(
      0,
      expect.closeTo(1.2),
      expect.closeTo(0.1 / 7),
    );
  });

  it("still plays a lift a full lookahead late after a stall", () => {
    const { audio, transport, context, played } = withVoices();
    // The first tick comes 1.12 s after playback starts at 0.
    context.currentTime = 1.12;
    const late = transport.at(1.12) - 0.12 * transport.speed;
    audio.schedule([{ ...note(1, 60, late), end: late }], transport, true, []);
    expect(played().map(([file]) => file)).toEqual([
      "rel40.flac",
      pianoVoiceRegions("release", 60, 0.5)[0].file,
    ]);
  });

  it("leaves a key that comes up as a loop pass begins to the passage before it", () => {
    const { audio, context, played } = withVoices();
    const transport = new Transport(4);
    transport.loop = [1, 2];
    transport.seek(1, 0);
    transport.play(0);
    const notes = [
      { ...note(1, 60, 1), start: 0.5, end: 1 },
      { ...note(2, 62, 2), start: 1.2, end: 2 },
    ];
    for (let tick = 0; tick * 0.02 <= 1.95; tick++) {
      context.currentTime = tick * 0.02;
      transport.update(context.currentTime);
      audio.schedule(notes, transport, true, []);
    }
    expect(
      played().filter(([file]) => (file as string).startsWith("rel")),
    ).toEqual([
      ["rel42.flac", 1],
      ["rel42.flac", 2],
    ]);
  });

  it("brings a pedalled note's resonance when it is struck where playback starts", () => {
    const { audio, transport, played, gain } = withVoices();
    transport.seek(1, 0);
    const notes = [{ ...note(1, 64, 3), start: 0.5, end: 2.5 }];
    audio.schedule(notes, transport, true, [{ channel: 0, start: 0, end: 3 }]);
    const resonance = pianoVoiceRegions("resonance", 64, 0.5);
    expect(played()).toEqual([
      [fileFor(64, 0.5), 0],
      ...resonance.map((region) => [region.file, 0]),
    ]);
    for (let i = 0; i < resonance.length; i++) {
      expect(gain(1 + i).linearRampToValueAtTime.mock.calls[0][1]).toBe(0.05);
      // Damped with its note, 2 s of song from here.
      expect(gain(1 + i).setTargetAtTime.mock.calls[0][1]).toBe(2);
    }
  });

  it("damps resonance after its attack ramp when its note ends sooner", () => {
    const { audio, transport, gain } = withVoices();
    // Playback starts 20 ms before the pedal lifts and damps the note.
    transport.seek(2.98, 0);
    const notes = [{ ...note(1, 64, 3), start: 0.5, end: 2.5 }];
    audio.schedule(notes, transport, true, [{ channel: 0, start: 0, end: 3 }]);
    const resonance = pianoVoiceRegions("resonance", 64, 0.5).length;
    expect(resonance).toBeGreaterThan(0);
    for (let i = 0; i < resonance; i++) {
      const envelope = gain(1 + i);
      const [, rampEnd] = envelope.linearRampToValueAtTime.mock.calls[0];
      expect(rampEnd).toBeCloseTo(0.05);
      expect(envelope.setTargetAtTime.mock.calls[0][1]).toBeGreaterThanOrEqual(
        rampEnd,
      );
    }
  });

  it("stops a voice turned off, including sources waiting to start, but no note", () => {
    const { audio, context, gain, played, run } = withVoices();
    run(...passage(), 0.4);
    const resonance = pianoVoiceRegions("resonance", 64, 0.5).length;
    // The second note and its resonance wait to start at 0.5 s.
    expect(played()).toHaveLength(5 + resonance);
    audio.setSound({
      voices: { ...DEFAULT_PIANO_SOUND.voices, resonance: false },
    });
    for (let i = 0; i < 5; i++)
      expect(gain(i).cancelAndHoldAtTime).not.toHaveBeenCalled();
    for (let i = 0; i < resonance; i++)
      expect(gain(5 + i).cancelAndHoldAtTime).toHaveBeenCalledWith(0.4);
    expect(context.createBufferSource).toHaveBeenCalledTimes(5 + resonance);
  });

  it("decays release harmonics by the time the key was really held, across speed changes", () => {
    const { audio, transport, context, gain, played, run } = withVoices();
    // Held for 1 s of song: 0.5 s at 1x, then 0.5 s of song at half speed.
    const notes = [{ ...note(1, 60, 1), end: 1 }];
    run(notes, [], 0.5);
    transport.setSpeed(0.5, 0.5);
    audio.reschedule(transport);
    for (let tick = 26; tick * 0.02 <= 1.6; tick++) {
      context.currentTime = tick * 0.02;
      audio.schedule(notes, transport, true, []);
    }
    const region = pianoVoiceRegions("release", 60, 0.5)[0];
    const index = played().findIndex(([file]) => file === region.file);
    expect(played()[index][1]).toBeCloseTo(1.5);
    // 1.5 s of real time, not 1 s of song at the new half speed (2 s).
    expect(gain(index).linearRampToValueAtTime.mock.calls[0][0]).toBeCloseTo(
      pianoLevel(
        { gainDb: region.gainDb - region.decayDbPerSecond * 1.5 },
        0.5,
      ),
      12,
    );
  });

  it("decays a release shared by notes struck apart by the shorter hold", () => {
    const { audio, transport, context, gain, played } = withVoices();
    // Two tracks hold the same key from 0 and from 0.5 s, and release it
    // together at 1 s.
    const notes = [
      { ...note(1, 60, 1), end: 1 },
      { ...note(2, 60, 1), start: 0.5, end: 1, track: 1 },
    ];
    for (let tick = 0; tick * 0.02 <= 1.1; tick++) {
      context.currentTime = tick * 0.02;
      audio.schedule(notes, transport, true, []);
    }
    const region = pianoVoiceRegions("release", 60, 0.5)[0];
    const index = played().findIndex(([file]) => file === region.file);
    expect(gain(index).linearRampToValueAtTime.mock.calls[0][0]).toBeCloseTo(
      pianoLevel(
        { gainDb: region.gainDb - region.decayDbPerSecond * 0.5 },
        0.5,
      ),
      12,
    );
  });

  it("takes optional voices from the passage playback prepared", () => {
    const { audio, transport, context, played } = withVoices();
    transport.loop = [0, 2];
    const notes = [
      { ...note(1, 60, 1), end: 1 },
      // Outside the loop, on another channel with a pedal inside it.
      { ...note(2, 48, 4), start: 3, end: 4, channel: 1 },
    ];
    const pedals = [{ channel: 1, start: 0.5, end: 1.5 }];
    audio.setPlaybackNotes([notes[0]], pedals);
    for (let tick = 0; tick * 0.02 <= 1.6; tick++) {
      context.currentTime = tick * 0.02;
      transport.update(context.currentTime);
      audio.schedule(notes, transport, true, pedals);
    }
    // Channel 1 has no note in the prepared passage: no pedal noise.
    expect(
      played().filter(([file]) => (file as string).startsWith("pedal")),
    ).toEqual([]);
    // After a stop, the song's own notes and pedal apply again.
    audio.stop();
    const before = played().length;
    context.currentTime = 0.5;
    transport.seek(0.45, 0.5);
    audio.schedule(notes, transport, true, pedals);
    expect(
      played()
        .slice(before)
        .map(([file]) => file),
    ).toContain("pedalD1.flac");
  });

  it("lets go of a song's optional voice events when playback stops", () => {
    const { audio, transport } = withVoices();
    const cache = () =>
      (audio as unknown as { voiceEventCache?: unknown }).voiceEventCache;
    audio.schedule([note(1, 60, 0.4)], transport, true, []);
    expect(cache()).toBeDefined();
    audio.stop();
    expect(cache()).toBeUndefined();
  });

  it("moves resonance and pedal noise to a new speed with their notes", () => {
    const { audio, transport, context, gain, run } = withVoices();
    run(...passage(), 0.6);
    const resonance = pianoVoiceRegions("resonance", 64, 0.5).length;
    context.currentTime = 1;
    transport.setSpeed(0.5, 1);
    audio.reschedule(transport);
    // One second of song remains before the pedal lifts, now two seconds.
    for (const index of [
      3,
      ...Array.from({ length: resonance }, (_, i) => 5 + i),
    ])
      expect(gain(index).setTargetAtTime.mock.lastCall![1]).toBeCloseTo(3);
    // Released harmonics play out as they were.
    expect(gain(2).cancelAndHoldAtTime).not.toHaveBeenCalled();
  });
});

describe("optional piano voice loading", () => {
  const response = () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  });
  const song = (): [Note[], PedalSpan[]] => [
    [
      { ...note(1, 60, 0.4), velocity: 0.8 },
      { ...note(2, 64, 2), start: 0.5, end: 0.9, velocity: 0.8 },
    ],
    [{ channel: 0, start: 0.45, end: 2 }],
  ];

  it("loads the optional recordings a passage triggers, but none for a preview", async () => {
    const { audio } = fixture(false);
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("pedalU1.flac")) throw new Error("offline");
      return response();
    });
    vi.stubGlobal("fetch", fetcher);
    await audio.unlock();
    await audio.prepare([sound(60)]);
    expect(fetcher).toHaveBeenCalledOnce();
    const [notes, pedals] = song();
    await audio.prepare(notes, undefined, pedals);
    const files = pianoVoiceFiles(
      pianoVoiceEvents(notes, pedals),
      DEFAULT_PIANO_SOUND.voices,
    );
    expect(files).toEqual(
      expect.arrayContaining([
        "rel40.flac",
        "rel44.flac",
        pianoVoiceRegions("release", 60, 0.8)[0].file,
        "pedalD1.flac",
        "pedalU1.flac",
        ...pianoVoiceRegions("resonance", 64, 0.8).map((r) => r.file),
      ]),
    );
    // A recording that fails to load leaves its voice out, not the passage.
    expect(audio.error).toBe("");
    expect([...audio.samples.keys()].sort()).toEqual(
      [
        ...new Set([
          fileFor(60),
          fileFor(64),
          ...files.filter((file) => file !== "pedalU1.flac"),
        ]),
      ].sort(),
    );
  });

  it("loads only the voices that are turned on", async () => {
    const { audio } = fixture(false);
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetcher);
    await audio.unlock();
    audio.setSound({
      voices: {
        release: false,
        keyNoise: true,
        pedalNoise: false,
        resonance: false,
      },
    });
    const [notes, pedals] = song();
    await audio.prepare(notes, undefined, pedals);
    expect([...audio.samples.keys()].sort()).toEqual(
      [fileFor(60), fileFor(64), "rel40.flac", "rel44.flac"].sort(),
    );
  });

  it("plays a passage without the optional recordings that do not fit", async () => {
    const { audio, context } = fixture(false);
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetcher);
    // Unknown metadata uses the conservative 32 MiB estimate per recording:
    // the note's fits beside the sounding one, then no optional one does.
    instrumentMetadata.files = {
      [fileFor(66)]: { duration: 1, channels: 2 },
    };
    const sounding = fileFor(72);
    audio.samples.set(sounding, sizedBuffer(476 * 1024 * 1024));
    await audio.unlock();
    audio.tone(72, 0.8, 0, 10);
    const notes = [{ ...note(1, 60, 0.4), velocity: 0.8 }];
    await audio.prepare(notes, undefined, []);
    expect(audio.error).toBe("");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `/audio/accurate-salamander/${fileFor(60)}`,
      expect.anything(),
    );
    // Recordings that did not load hold no place: another note still fits.
    audio.setPlaybackNotes(notes, []);
    await audio.prepare([sound(66)]);
    expect(audio.samples.has(fileFor(66))).toBe(true);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
  });
});
