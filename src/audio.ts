import type { Note } from "./song";
import type { Transport } from "./engine";
import {
  createPianoSoundBus,
  DEFAULT_PIANO_SOUND,
  normalizePianoSound,
  type PianoSoundBus,
  type PianoSoundSettings,
} from "./pianoSound";
import {
  pianoInstrument,
  pianoLevel,
  pianoPlaybackRate,
  selectPianoRegion,
} from "./piano";
export const MAX_REFERENCE_VOICES = 64;
export const MAX_PIANO_CACHE_BYTES = 512 * 1024 * 1024;
type PianoNote = Pick<Note, "pitch" | "velocity">;
/** Explicit stops fade sounding voices this quickly instead of cutting them. */
const FADE_SECONDS = 0.008;
/** Six fade time constants leave less than 0.3% gain when the source stops. */
const FADE_STOP_SECONDS = 0.05;
const MEMORY_MESSAGE =
  "This passage needs too many piano samples. Try one hand or a shorter loop.";
/** The recordings that play these notes. */
const sampleFiles = (notes: readonly PianoNote[]) =>
  new Set(
    notes.flatMap((note) => {
      const region = selectPianoRegion(note.pitch, note.velocity);
      return region ? [region.file] : [];
    }),
  );
interface SampleRequest {
  promise: Promise<AudioBuffer>;
  controller: AbortController;
  decoding: boolean;
}
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  file: string;
  /** Context time of the attack. */
  start: number;
}
class PianoMemoryError extends Error {}
/** Audio and MIDI timestamps share performance.timeOrigin. Frames never advance time. */
export class ReferenceAudio {
  context: AudioContext | null = null;
  samples = new Map<string, AudioBuffer>();
  voices = new Set<Voice>();
  /** Voices fading out after a stop, until their sources end. */
  private fading = new Set<Voice>();
  private output: PianoSoundBus | null = null;
  private sound: PianoSoundSettings = { ...DEFAULT_PIANO_SOUND };
  private pending = new Map<string, SampleRequest>();
  private reserved = new Map<string, number>();
  private pins = new Map<string, number>();
  private preparations = 0;
  private preparationGeneration = 0;
  private playbackBlocked = false;
  private playbackFiles = new Set<string>();
  /** Whether the room has received sound since it was last rebuilt. */
  private roomUsed = false;
  scheduled = new Set<string>();
  private cycle = -1;
  error = "";
  get loading() {
    return this.preparations > 0;
  }
  now = () => this.context?.currentTime ?? performance.now() / 1000;
  eventTime(timestamp: number) {
    return this.now() + (timestamp - performance.now()) / 1000;
  }
  setSound(settings: PianoSoundSettings) {
    this.sound = normalizePianoSound(settings);
    this.output?.setSound(this.sound);
  }
  async unlock() {
    this.context ??= new AudioContext();
    this.error = "";
    try {
      await this.context.resume();
      if (!this.output) {
        this.output = createPianoSoundBus(this.context, this.sound);
        this.roomUsed = false;
      }
      this.playbackBlocked = false;
    } catch (error) {
      this.playbackBlocked = true;
      this.error = "The piano sound could not load. Please try again.";
      throw error;
    }
  }
  private bufferBytes(buffer: AudioBuffer) {
    return buffer.length * buffer.numberOfChannels * 4;
  }
  private estimateBytes(file: string, context: AudioContext) {
    const info = pianoInstrument.files?.[file];
    return info
      ? (Math.ceil(info.duration * context.sampleRate) + 256) *
          info.channels *
          4
      : 32 * 1024 * 1024;
  }
  /** Recordings that are sounding, scheduled, or being prepared. */
  private inUse() {
    return new Set([
      ...this.playbackFiles,
      ...this.pins.keys(),
      ...[...this.voices, ...this.fading].map((voice) => voice.file),
    ]);
  }
  private makeRoom(bytes: number) {
    let used =
      [...this.samples.values()].reduce(
        (sum, buffer) => sum + this.bufferBytes(buffer),
        0,
      ) + [...this.reserved.values()].reduce((sum, value) => sum + value, 0);
    const inUse = this.inUse();
    for (const [file, buffer] of this.samples) {
      if (used + bytes <= MAX_PIANO_CACHE_BYTES) break;
      if (inUse.has(file)) continue;
      this.samples.delete(file);
      used -= this.bufferBytes(buffer);
    }
    if (used + bytes > MAX_PIANO_CACHE_BYTES)
      throw new PianoMemoryError(MEMORY_MESSAGE);
  }
  private loadSample(
    file: string,
    context: AudioContext,
  ): Promise<AudioBuffer> {
    const cached = this.samples.get(file);
    if (cached) {
      // makeRoom() evicts in Map order; keep recently used recordings last.
      this.samples.delete(file);
      this.samples.set(file, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(file);
    if (pending) return pending.promise;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30000),
    ]);
    // Reserve last: nothing above may throw and leave the memory reserved.
    const size = this.estimateBytes(file, context);
    this.makeRoom(size);
    this.reserved.set(file, size);
    let request!: SampleRequest;
    const promise = (async () => {
      const response = await fetch(
        `${import.meta.env.BASE_URL}audio/accurate-salamander/${file}`,
        { signal },
      );
      signal.throwIfAborted();
      if (!response.ok) throw new Error(`Piano sample: ${response.status}`);
      const bytes = await response.arrayBuffer();
      signal.throwIfAborted();
      request.decoding = true;
      const buffer = await context.decodeAudioData(bytes);
      signal.throwIfAborted();
      this.reserved.delete(file);
      this.makeRoom(this.bufferBytes(buffer));
      this.samples.set(file, buffer);
      return buffer;
    })().finally(() => {
      if (this.pending.get(file) === request) {
        this.pending.delete(file);
        this.reserved.delete(file);
      }
    });
    request = { promise, controller, decoding: false };
    this.pending.set(file, request);
    return promise;
  }
  private cancelUnusedLoads() {
    const inUse = this.inUse();
    for (const [file, request] of this.pending) {
      if (inUse.has(file)) continue;
      request.controller.abort();
      // A decoder cannot be cancelled. Retain its reservation until it settles;
      // the next scope waits for that memory instead of exceeding the cap.
      if (!request.decoding) {
        this.pending.delete(file);
        this.reserved.delete(file);
      }
    }
  }
  async prepare(notes: readonly PianoNote[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    const context = this.context;
    if (!context) throw new Error("Enable piano audio first.");
    const files = [...sampleFiles(notes)];
    this.preparations++;
    const generation = ++this.preparationGeneration;
    this.error = "";
    for (const file of files)
      this.pins.set(file, (this.pins.get(file) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const file of files) {
        const count = this.pins.get(file)! - 1;
        if (count) this.pins.set(file, count);
        else this.pins.delete(file);
      }
      this.cancelUnusedLoads();
    };
    let abort!: () => void;
    const cancelled = signal
      ? new Promise<never>((_, reject) => {
          abort = () => {
            release();
            reject(signal.reason);
          };
          signal.addEventListener("abort", abort, { once: true });
        })
      : undefined;
    try {
      const abandonedDecodes = [...this.pending.values()].filter(
        (request) => request.decoding && request.controller.signal.aborted,
      );
      if (abandonedDecodes.length) {
        const settled = Promise.all(
          abandonedDecodes.map((request) => request.promise.catch(() => {})),
        );
        await (cancelled ? Promise.race([settled, cancelled]) : settled);
      }
      // Refuse an oversized passage before starting its downloads. Other cached
      // pieces can be evicted, but not a piece that is still loading or playing.
      let required = 0;
      for (const file of this.inUse()) {
        const buffer = this.samples.get(file);
        required += buffer
          ? this.bufferBytes(buffer)
          : this.estimateBytes(file, context);
      }
      if (required > MAX_PIANO_CACHE_BYTES)
        throw new PianoMemoryError(MEMORY_MESSAGE);
      let next = 0;
      const failures: unknown[] = [];
      const loading = Promise.all(
        Array.from({ length: Math.min(4, files.length) }, async () => {
          while (!signal?.aborted && next < files.length) {
            const file = files[next++];
            try {
              await this.loadSample(file, context);
            } catch (error) {
              failures.push(error);
            }
          }
        }),
      );
      await (cancelled ? Promise.race([loading, cancelled]) : loading);
      if (failures.length) throw failures[0];
      if (generation === this.preparationGeneration) this.error = "";
    } catch (error) {
      if (!signal?.aborted && generation === this.preparationGeneration)
        this.error =
          error instanceof PianoMemoryError
            ? error.message
            : "The piano samples could not load. Please try again.";
      throw error;
    } finally {
      this.preparations--;
      if (signal) signal.removeEventListener("abort", abort);
      release();
    }
  }
  setPlaybackNotes(notes: readonly PianoNote[]) {
    this.playbackFiles = sampleFiles(notes);
  }
  private disconnect(voice: Voice) {
    this.voices.delete(voice);
    this.fading.delete(voice);
    voice.source.disconnect();
    voice.gain.disconnect();
  }
  /** Cutting a sounding sample clicks. Fade it, and disconnect it once it ends. */
  private fade(voice: Voice, at: number) {
    this.voices.delete(voice);
    try {
      voice.gain.gain.cancelAndHoldAtTime(at);
      voice.gain.gain.setTargetAtTime(0, at, FADE_SECONDS);
      voice.source.stop(at + FADE_STOP_SECONDS);
      this.fading.add(voice);
    } catch {
      try {
        voice.source.stop();
      } catch {}
      this.disconnect(voice);
    }
  }
  /** Fade the oldest sounding voice to make room for a new one. */
  private steal(now: number) {
    let oldest: Voice | undefined;
    for (const voice of this.voices)
      if (voice.start < (oldest?.start ?? now)) oldest = voice;
    if (oldest) this.fade(oldest, now);
    return oldest !== undefined;
  }
  stop(releasePrepared = true, resetRoom = true) {
    if (releasePrepared) this.playbackFiles.clear();
    const now = this.now();
    for (const voice of this.voices) this.fade(voice, now);
    this.scheduled.clear();
    // Rebuilding the room flushes its tail. Skip it when there is no tail,
    // such as while dragging the playhead with nothing playing.
    try {
      if (resetRoom && this.roomUsed) {
        this.output?.reset();
        this.roomUsed = false;
      }
    } catch {
      this.output?.dispose();
      this.output = null;
      this.playbackBlocked = true;
      this.error = "The piano sound could not reset. Please try Play again.";
    }
  }
  tone(pitch: number, velocity: number, when: number, duration: number) {
    const context = this.context;
    if (
      !context ||
      context.state !== "running" ||
      this.playbackBlocked ||
      velocity <= 0
    )
      return;
    const region = selectPianoRegion(pitch, velocity);
    if (!region) return;
    const buffer = this.samples.get(region.file);
    if (!buffer) return;
    // The cap includes future scheduled voices and previews: no entry point can
    // bypass it. A dense pedalled passage replaces its oldest sounding voice
    // rather than going silent; only voices that are all waiting refuse a note.
    if (
      this.voices.size >= MAX_REFERENCE_VOICES &&
      !this.steal(context.currentTime)
    )
      return;
    let source: AudioBufferSourceNode | undefined, gain: GainNode | undefined;
    try {
      source = context.createBufferSource();
      source.buffer = buffer;
      const rate = pianoPlaybackRate(region, pitch);
      source.playbackRate.value = rate;
      gain = context.createGain();
      // Silent until the attack, including when a fade cancels the attack.
      gain.gain.value = 0;
      const level = pianoLevel(region, velocity);
      const releaseAt = when + Math.max(0.04, duration);
      // Lower strings take longer to damp. A time constant retains a gentle
      // overlap between notes; a short ramp to near-zero sounded like a gate.
      const releaseTime = Math.max(
        region.releaseSeconds / 7,
        0.16,
        Math.min(0.32, 0.24 * 2 ** ((60 - pitch) / 48)),
      );
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(level, when + 0.003);
      // The recording supplies the piano's natural decay. Only damp it after
      // key/pedal release, instead of fading away throughout the held note.
      gain.gain.setValueAtTime(level, releaseAt);
      if (region.releaseSeconds < 100)
        gain.gain.setTargetAtTime(0, releaseAt, releaseTime);
      source.connect(gain).connect(this.output?.input ?? context.destination);
      this.roomUsed = true;
      const voice = { source, gain, file: region.file, start: when };
      this.voices.add(voice);
      source.onended = () => this.disconnect(voice);
      source.start(when, region.offset);
      // Seven time constants leaves less than 0.1% gain before cleanup.
      const sampleEnd = when + (buffer.duration - region.offset) / rate;
      source.stop(
        region.releaseSeconds >= 100
          ? sampleEnd
          : Math.min(sampleEnd, releaseAt + releaseTime * 7 + 0.02),
      );
    } catch {
      this.playbackBlocked = true;
      for (const voice of this.voices)
        if (voice.source === source) this.voices.delete(voice);
      try {
        source?.stop();
      } catch {}
      try {
        source?.disconnect();
        gain?.disconnect();
      } catch {}
      this.error = "Reference sound could not start. Pause and try Play again.";
    }
  }
  schedule(notes: Note[], transport: Transport, enabled: boolean) {
    if (!enabled || !transport.playing || !this.context) return;
    if (this.cycle !== transport.cycle) {
      // A new pass schedules its notes again. The last pass's voices end by
      // the loop end, so they ring out, and so does the room tail. Explicit
      // pause, seek and song changes fade voices and reset the room in stop().
      this.scheduled = new Set();
      this.cycle = transport.cycle;
    }
    const now = this.now(),
      position = transport.at(now),
      lookahead = 0.12 * transport.speed;
    const attacks = new Map<string, Note>();
    for (const n of notes) {
      if (
        this.scheduled.has(n.id) ||
        n.soundEnd <= position ||
        n.start > position + lookahead
      )
        continue;
      if (
        transport.loop &&
        (n.start >= transport.loop[1] || n.soundEnd <= transport.loop[0])
      )
        continue;
      this.scheduled.add(n.id);
      const key = `${n.pitch}:${n.start}`,
        previous = attacks.get(key);
      // Duplicate tracks at the same onset need one sound, with the longest pedal tail.
      if (!previous) attacks.set(key, { ...n });
      else {
        previous.soundEnd = Math.max(previous.soundEnd, n.soundEnd);
        previous.velocity = Math.max(previous.velocity, n.velocity);
      }
    }
    for (const n of attacks.values()) {
      const start = Math.max(0, (n.start - position) / transport.speed),
        end =
          (Math.min(n.soundEnd, transport.loop?.[1] ?? Infinity) - position) /
          transport.speed;
      if (end > 0) this.tone(n.pitch, n.velocity, now + start, end - start);
    }
  }
}
