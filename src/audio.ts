import type { Note } from "./song";
import type { Transport } from "./engine";
import {
  pianoInstrument,
  pianoLevel,
  pianoPlaybackRate,
  selectPianoRegion,
} from "./piano";
export const MAX_REFERENCE_VOICES = 64;
export const MAX_PIANO_CACHE_BYTES = 512 * 1024 * 1024;
type PianoNote = Pick<Note, "pitch" | "velocity">;
class PianoMemoryError extends Error {}
/** Audio and MIDI timestamps share performance.timeOrigin. Frames never advance time. */
export class ReferenceAudio {
  context: AudioContext | null = null;
  samples = new Map<string, AudioBuffer>();
  voices = new Set<{
    source: AudioBufferSourceNode;
    gain: GainNode;
    file: string;
  }>();
  private output: DynamicsCompressorNode | null = null;
  private pending = new Map<string, Promise<AudioBuffer>>();
  private reserved = new Map<string, number>();
  private pins = new Map<string, number>();
  private preparations = 0;
  private preparationGeneration = 0;
  private playbackFiles = new Set<string>();
  scheduled = new Set<string>();
  cycle = -1;
  error = "";
  get loading() {
    return this.preparations > 0;
  }
  now = () => this.context?.currentTime ?? performance.now() / 1000;
  eventTime(timestamp: number) {
    return this.now() + (timestamp - performance.now()) / 1000;
  }
  async unlock() {
    this.context ??= new AudioContext();
    this.error = "";
    try {
      await this.context.resume();
      if (!this.output) {
        const output = this.context.createDynamicsCompressor();
        output.threshold.value = -10;
        output.knee.value = 12;
        output.ratio.value = 4;
        output.attack.value = 0.003;
        output.release.value = 0.25;
        output.connect(this.context.destination);
        this.output = output;
      }
    } catch (error) {
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
  private makeRoom(bytes: number) {
    let used =
      [...this.samples.values()].reduce(
        (sum, buffer) => sum + this.bufferBytes(buffer),
        0,
      ) + [...this.reserved.values()].reduce((sum, value) => sum + value, 0);
    const active = new Set([
      ...this.playbackFiles,
      ...[...this.voices].map((voice) => voice.file),
    ]);
    for (const [file, buffer] of this.samples) {
      if (used + bytes <= MAX_PIANO_CACHE_BYTES) break;
      if (this.pins.has(file) || active.has(file)) continue;
      this.samples.delete(file);
      used -= this.bufferBytes(buffer);
    }
    if (used + bytes > MAX_PIANO_CACHE_BYTES)
      throw new PianoMemoryError(
        "This passage needs too many piano samples. Try one hand or a shorter loop.",
      );
  }
  private loadSample(
    file: string,
    context: AudioContext,
  ): Promise<AudioBuffer> {
    const cached = this.samples.get(file);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(file);
    if (pending) return pending;
    const size = this.estimateBytes(file, context);
    this.makeRoom(size);
    this.reserved.set(file, size);
    const request = (async () => {
      const response = await fetch(
        `${import.meta.env.BASE_URL}audio/accurate-salamander/${file}`,
        {
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok) throw new Error(`Piano sample: ${response.status}`);
      const buffer = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      this.reserved.delete(file);
      this.makeRoom(this.bufferBytes(buffer));
      this.samples.set(file, buffer);
      return buffer;
    })().finally(() => {
      this.pending.delete(file);
      this.reserved.delete(file);
    });
    this.pending.set(file, request);
    return request;
  }
  async prepare(notes: readonly PianoNote[]) {
    const context = this.context;
    if (!context) throw new Error("Enable piano audio first.");
    const files = [
      ...new Set(
        notes.flatMap((note) => {
          const region = selectPianoRegion(note.pitch, note.velocity);
          return region ? [region.file] : [];
        }),
      ),
    ];
    this.preparations++;
    const generation = ++this.preparationGeneration;
    this.error = "";
    for (const file of files)
      this.pins.set(file, (this.pins.get(file) ?? 0) + 1);
    try {
      // Refuse an oversized passage before starting its downloads. Other cached
      // pieces can be evicted, but not a piece that is still loading or playing.
      const needed = new Set([
        ...this.playbackFiles,
        ...this.pins.keys(),
        ...[...this.voices].map((voice) => voice.file),
      ]);
      let required = 0;
      for (const file of needed) {
        const buffer = this.samples.get(file);
        required += buffer
          ? this.bufferBytes(buffer)
          : this.estimateBytes(file, context);
      }
      if (required > MAX_PIANO_CACHE_BYTES)
        throw new PianoMemoryError(
          "This passage needs too many piano samples. Try one hand or a shorter loop.",
        );
      let next = 0;
      const failures: unknown[] = [];
      await Promise.all(
        Array.from({ length: Math.min(4, files.length) }, async () => {
          while (next < files.length) {
            const file = files[next++];
            try {
              await this.loadSample(file, context);
            } catch (error) {
              failures.push(error);
            }
          }
        }),
      );
      if (failures.length) throw failures[0];
      if (generation === this.preparationGeneration) this.error = "";
    } catch (error) {
      if (generation === this.preparationGeneration)
        this.error =
          error instanceof PianoMemoryError
            ? error.message
            : "The piano samples could not load. Please try again.";
      throw error;
    } finally {
      this.preparations--;
      for (const file of files) {
        const count = this.pins.get(file)! - 1;
        if (count) this.pins.set(file, count);
        else this.pins.delete(file);
      }
    }
  }
  setPlaybackNotes(notes: readonly PianoNote[]) {
    this.playbackFiles = new Set(
      notes.flatMap((note) => {
        const region = selectPianoRegion(note.pitch, note.velocity);
        return region ? [region.file] : [];
      }),
    );
  }
  stop(releasePrepared = true) {
    if (releasePrepared) this.playbackFiles.clear();
    for (const v of this.voices) {
      try {
        v.source.stop();
      } catch {}
      v.source.disconnect();
      v.gain.disconnect();
    }
    this.voices.clear();
    this.scheduled.clear();
  }
  tone(pitch: number, velocity: number, when: number, duration: number) {
    const context = this.context;
    // Includes future scheduled voices and previews: no entry point can bypass the cap.
    if (
      !context ||
      context.state !== "running" ||
      this.error ||
      velocity <= 0 ||
      this.voices.size >= MAX_REFERENCE_VOICES
    )
      return;
    const region = selectPianoRegion(pitch, velocity);
    if (!region) return;
    const buffer = this.samples.get(region.file);
    if (!buffer) return;
    let source: AudioBufferSourceNode | undefined, gain: GainNode | undefined;
    try {
      source = context.createBufferSource();
      source.buffer = buffer;
      const rate = pianoPlaybackRate(region, pitch);
      source.playbackRate.value = rate;
      gain = context.createGain();
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
      source.connect(gain).connect(this.output ?? context.destination);
      const voice = { source, gain, file: region.file };
      this.voices.add(voice);
      source.onended = () => {
        this.voices.delete(voice);
        voice.source.disconnect();
        voice.gain.disconnect();
      };
      source.start(when, region.offset);
      // Seven time constants leaves less than 0.1% gain before cleanup.
      const sampleEnd = when + (buffer.duration - region.offset) / rate;
      source.stop(
        region.releaseSeconds >= 100
          ? sampleEnd
          : Math.min(sampleEnd, releaseAt + releaseTime * 7 + 0.02),
      );
    } catch {
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
      this.stop(false);
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
