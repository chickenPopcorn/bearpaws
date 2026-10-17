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
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
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
    decodeAudioData: vi.fn(async () => buffer()),
    createDynamicsCompressor: vi.fn(() => ({
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect: vi.fn(),
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
  it("reuses one limiter for playback and previews after repeated audio unlocks", async () => {
    const { audio, context } = fixture();
    await audio.unlock();
    await audio.unlock();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(context.createDynamicsCompressor).toHaveBeenCalledOnce();
    const output = context.createDynamicsCompressor.mock.results[0].value;
    expect(output.connect).toHaveBeenCalledOnce();
    expect(output.connect).toHaveBeenCalledWith(context.destination);
    audio.tone(60, 0.8, 0, 1);
    const gain = context.createGain.mock.results[0].value;
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
