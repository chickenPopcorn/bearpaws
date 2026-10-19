import type { Note, PedalSpan } from "./song";
import type { Transport } from "./engine";
import {
  createPianoSoundBus,
  DEFAULT_PIANO_SOUND,
  normalizePianoSound,
  type PianoSoundBus,
  type PianoSoundSettings,
  type PianoVoice,
} from "./pianoSound";
import {
  pianoInstrument,
  pianoLevel,
  pianoPlaybackRate,
  selectPianoRegion,
} from "./piano";
import {
  liftTriggered,
  MIN_PIANO_VOICE_LEVEL,
  pianoVoiceEvents,
  pianoVoiceFiles,
  pianoVoiceLevel,
  type PianoVoiceEvent,
} from "./pianoVoices";
import { firstIndexAtOrAfter } from "./timeline";
export const MAX_PIANO_VOICES = 64;
/**
 * Release, noise and resonance voices may hold at most this many of the
 * voices, and never take one from a note: a note at the cap takes one of
 * theirs first.
 */
export const MAX_OPTIONAL_VOICES = MAX_PIANO_VOICES / 2;
export const MAX_PIANO_CACHE_BYTES = 512 * 1024 * 1024;
type PianoNote = Pick<Note, "pitch" | "velocity">;
const NO_PEDALS: readonly PedalSpan[] = [];
/** Notes from a song, rather than a pitch and velocity to preview. */
const isSongNote = (note: PianoNote): note is Note => "soundEnd" in note;
/** How far ahead of the clock schedule() starts notes, in seconds at 1x. */
const LOOKAHEAD_SECONDS = 0.12;
/** Explicit stops fade sounding voices this quickly instead of cutting them. */
const FADE_SECONDS = 0.008;
/** Six fade time constants leave less than 0.3% gain when the source stops. */
const FADE_STOP_SECONDS = 0.05;
/** A note at the voice cap may replace a voice once it starts within this time. */
const DUE_SECONDS = 0.001;
/** Length of each voice's attack ramp. */
const ATTACK_SECONDS = 0.003;
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
/** Lower strings take longer to damp. */
const releaseTimeConstant = (releaseSeconds: number, pitch: number) =>
  Math.max(
    releaseSeconds / 7,
    0.16,
    Math.min(0.32, 0.24 * 2 ** ((60 - pitch) / 48)),
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
  /** Context times of the attack and of the scheduled stop. */
  start: number;
  end: number;
  /** Length of the attack ramp. */
  attack: number;
  /** The room input this voice feeds, until a stop takes it out of the room. */
  room?: AudioNode;
  /**
   * For a scheduled note: where in the song its release begins, and when
   * (in context time) and how fast it is damped. A speed change moves the
   * release; undamped treble voices ring to the end of their sample.
   */
  songEnd: number;
  releaseAt: number;
  releaseTime: number | null;
  sampleEnd: number;
  /** The scheduled notes this voice plays, and the set that records them. */
  ids: readonly string[];
  pass: Set<string>;
  /** The release, noise or resonance voice it plays, which gives way to notes. */
  layer: PianoVoice | null;
}
/** What a new voice plays, and when it is damped. */
interface VoiceRequest {
  file: string;
  /** Where the recording starts, in its own seconds, and how fast it plays. */
  offset: number;
  rate: number;
  level: number;
  when: number;
  attack: number;
  /** When damping begins and its time constant; null rings to the end. */
  releaseAt: number;
  releaseTime: number | null;
  ids: readonly string[];
  pass: Set<string>;
  songEnd: number;
  layer: PianoVoice | null;
}
class PianoMemoryError extends Error {}
/** Audio and MIDI timestamps share performance.timeOrigin. Frames never advance time. */
export class PianoAudio {
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
  /** When each note of a pass was struck, in context time, for rt_decay. */
  private struck = new WeakMap<Set<string>, Map<string, number>>();
  /** The ids of the notes in each list schedule() was given. */
  private noteIds = new WeakMap<readonly Note[], Set<string>>();
  /** The passage that playback prepared, which its optional voices follow. */
  private playback?: { notes: readonly Note[]; pedals: readonly PedalSpan[] };
  private voiceEventCache?: {
    notes: readonly Note[];
    pedals: readonly PedalSpan[];
    events: PianoVoiceEvent[];
    /** Each note's resonance, for a note struck where a pass begins. */
    resonance: Map<string, PianoVoiceEvent[]>;
  };
  /** Whether the room has received sound since it was last rebuilt. */
  private roomUsed = false;
  scheduled = new Set<string>();
  /** Notes of the next loop pass, scheduled before the transport wraps. */
  private ahead = new Set<string>();
  /** Context time at which the pass that `ahead` belongs to begins. */
  private aheadStart = Infinity;
  private cycle = -1;
  /** Where the current pass began playing: a play position or loop start. */
  private passStart = -Infinity;
  error = "";
  get loading() {
    return this.preparations > 0;
  }
  now = () => this.context?.currentTime ?? performance.now() / 1000;
  eventTime(timestamp: number) {
    return this.now() + (timestamp - performance.now()) / 1000;
  }
  /** Settings left out keep their current value. */
  setSound(settings: Partial<PianoSoundSettings>) {
    this.sound = normalizePianoSound({ ...this.sound, ...settings });
    this.output?.setSound(this.sound);
    // A voice turned off stops, including sources waiting to start. Notes
    // and the other voices play on.
    const now = this.now();
    for (const voice of this.voices)
      if (voice.layer && !this.sound.voices[voice.layer]) this.fade(voice, now);
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
  /**
   * Recordings that are sounding, scheduled, or being prepared. A voice that
   * is fading out ends within FADE_STOP_SECONDS, so it never holds memory a
   * new passage needs: makeRoom() retires it instead.
   */
  private inUse() {
    return new Set([
      ...this.playbackFiles,
      ...this.pins.keys(),
      ...[...this.voices].map((voice) => voice.file),
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
      // A fading source still holds the buffer; end it now to free the memory.
      for (const voice of this.fading)
        if (voice.file === file) {
          try {
            voice.source.stop();
          } catch {}
          this.disconnect(voice);
        }
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
  /** The optional voices a song passage triggers, cached for each tick. */
  private voiceEvents(notes: readonly Note[], pedals: readonly PedalSpan[]) {
    const cache = this.voiceEventCache;
    if (cache?.notes === notes && cache.pedals === pedals) return cache;
    const events = pianoVoiceEvents(notes, pedals),
      resonance = new Map<string, PianoVoiceEvent[]>();
    for (const event of events)
      if (event.region.voice === "resonance")
        for (const id of event.notes)
          resonance.set(id, [...(resonance.get(id) ?? []), event]);
    return (this.voiceEventCache = { notes, pedals, events, resonance });
  }
  /** The recordings of the enabled optional voices these notes trigger. */
  private voiceFiles(
    notes: readonly PianoNote[],
    pedals: readonly PedalSpan[],
  ) {
    return pianoVoiceFiles(
      pianoVoiceEvents(notes.filter(isSongNote), pedals),
      this.sound.voices,
    );
  }
  private async loadAll(
    files: readonly string[],
    context: AudioContext,
    signal?: AbortSignal,
  ) {
    let next = 0;
    const failures: unknown[] = [];
    await Promise.all(
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
    return failures;
  }
  /** The decoded size of a recording, or its estimate before it loads. */
  private cachedBytes(file: string, context: AudioContext) {
    const buffer = this.samples.get(file);
    return buffer
      ? this.bufferBytes(buffer)
      : this.estimateBytes(file, context);
  }
  /**
   * Load the recordings these notes need. With `pedals`, the notes are a
   * song passage to play, and the enabled optional voices it triggers load
   * too: only those that fit beside the notes' own recordings, since the
   * passage plays without them.
   */
  async prepare(
    notes: readonly PianoNote[],
    signal?: AbortSignal,
    pedals?: readonly PedalSpan[],
  ) {
    signal?.throwIfAborted();
    const context = this.context;
    if (!context) throw new Error("Enable piano audio first.");
    const files = [...sampleFiles(notes)];
    const optional = pedals
      ? this.voiceFiles(notes, pedals).filter((file) => !files.includes(file))
      : [];
    this.preparations++;
    const generation = ++this.preparationGeneration;
    this.error = "";
    const pinned: string[] = [];
    const pin = (list: readonly string[]) => {
      for (const file of list) {
        this.pins.set(file, (this.pins.get(file) ?? 0) + 1);
        pinned.push(file);
      }
    };
    pin(files);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const file of pinned) {
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
    const settle = <T>(work: Promise<T>) =>
      cancelled ? Promise.race([work, cancelled]) : work;
    try {
      const abandonedDecodes = [...this.pending.values()].filter(
        (request) => request.decoding && request.controller.signal.aborted,
      );
      if (abandonedDecodes.length)
        await settle(
          Promise.all(
            abandonedDecodes.map((request) => request.promise.catch(() => {})),
          ),
        );
      // Refuse an oversized passage before starting its downloads. Other cached
      // pieces can be evicted, but not a piece that is still loading or playing.
      let required = 0;
      for (const file of this.inUse())
        required += this.cachedBytes(file, context);
      if (required > MAX_PIANO_CACHE_BYTES)
        throw new PianoMemoryError(MEMORY_MESSAGE);
      const failures = await settle(this.loadAll(files, context, signal));
      if (failures.length) throw failures[0];
      if (optional.length) {
        signal?.throwIfAborted();
        let used = 0;
        for (const file of this.inUse())
          used += this.cachedBytes(file, context);
        const fitting = optional.filter((file) => {
          const bytes = this.cachedBytes(file, context);
          if (used + bytes > MAX_PIANO_CACHE_BYTES) return false;
          used += bytes;
          return true;
        });
        pin(fitting);
        // A recording that fails to load only leaves its optional voice out.
        await settle(this.loadAll(fitting, context, signal));
      }
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
  /**
   * The recordings playback keeps from eviction. With `pedals`, they include
   * the optional voices' recordings that loaded. Those that did not fit stay
   * out of the cache, and their voices stay silent.
   */
  setPlaybackNotes(notes: readonly PianoNote[], pedals?: readonly PedalSpan[]) {
    this.playbackFiles = sampleFiles(notes);
    // The scheduler takes optional voices from this same passage, so that
    // each one it plays is one whose recording was prepared.
    this.playback = pedals
      ? { notes: notes.filter(isSongNote), pedals }
      : undefined;
    if (pedals)
      for (const file of this.voiceFiles(notes, pedals))
        if (this.samples.has(file)) this.playbackFiles.add(file);
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
    this.fading.add(voice);
    // A voice that stops by itself first needs no fade.
    if (voice.end <= at) return;
    try {
      voice.gain.gain.cancelAndHoldAtTime(at);
      voice.gain.gain.setTargetAtTime(0, at, FADE_SECONDS);
      voice.source.stop(at + FADE_STOP_SECONDS);
      voice.end = at + FADE_STOP_SECONDS;
    } catch {
      try {
        voice.source.stop();
      } catch {}
      this.disconnect(voice);
    }
  }
  /**
   * Make room for a voice that is due now: fade the oldest voice that started
   * before it. Optional voices give way first, even before they start, and
   * only a note may take a note's voice.
   */
  private steal(now: number, optional: boolean) {
    let oldest: Voice | undefined;
    for (const voice of this.voices)
      if (voice.layer && voice.start < (oldest?.start ?? now)) oldest = voice;
    if (!oldest && !optional) {
      // A note may also cancel an optional voice still waiting to start,
      // the last to start first, before it takes a note's voice.
      for (const voice of this.voices)
        if (voice.layer && voice.start > (oldest?.start ?? -Infinity))
          oldest = voice;
      if (!oldest)
        for (const voice of this.voices)
          if (voice.start < (oldest?.start ?? now)) oldest = voice;
    }
    if (oldest) this.fade(oldest, now);
    return oldest !== undefined;
  }
  /**
   * Whether a voice may start, after making room for it if it is due. The cap
   * includes future scheduled voices and previews: no entry point can bypass
   * it. At the cap a dense pedalled passage replaces its oldest sounding voice
   * rather than going silent, but only once the new voice is due: stealing
   * ahead would cut the old voice before its replacement sounds, and leave a
   * deferred fade for stops and speed changes to chase. Fading voices hold
   * their nodes until they end, so they count toward a total cap too,
   * including after a stop.
   */
  private admit(when: number, now: number, optional: boolean) {
    if (this.voices.size + this.fading.size >= 2 * MAX_PIANO_VOICES)
      return false;
    const due = when <= now + DUE_SECONDS;
    if (optional) {
      let count = 0;
      for (const voice of this.voices) if (voice.layer) count++;
      if (count >= MAX_OPTIONAL_VOICES && !(due && this.steal(now, true)))
        return false;
    }
    return (
      this.voices.size < MAX_PIANO_VOICES || (due && this.steal(now, optional))
    );
  }
  /**
   * Cancel scheduled voices that have not started, so the next schedule()
   * plays their notes at a new speed. Sounding notes ring on instead of being
   * struck again.
   */
  reschedule(transport: Transport) {
    const now = this.now(),
      position = transport.at(now);
    for (const voice of this.voices) {
      if (voice.start <= now)
        this.retime(
          voice,
          now,
          now + (voice.songEnd - position) / transport.speed,
        );
      else if (voice.ids.length) {
        for (const id of voice.ids) voice.pass.delete(id);
        this.fade(voice, now);
      }
    }
  }
  /** Move a sounding voice's release, and its cleanup, to a new time. */
  private retime(voice: Voice, now: number, releaseAt: number) {
    // Previews have no song position, undamped voices no release, and a voice
    // already released (such as one from the last loop pass) keeps its decay.
    if (
      !Number.isFinite(voice.songEnd) ||
      voice.releaseTime === null ||
      voice.releaseAt <= now
    )
      return;
    // Hold after the attack ramp, so a just-struck note keeps its full level.
    const hold = Math.max(now, voice.start + voice.attack);
    voice.releaseAt = Math.max(hold, releaseAt);
    voice.end = Math.min(
      voice.sampleEnd,
      voice.releaseAt + voice.releaseTime * 7 + 0.02,
    );
    try {
      voice.gain.gain.cancelAndHoldAtTime(hold);
      // A held voice rings on until it is retimed again.
      if (Number.isFinite(voice.releaseAt))
        voice.gain.gain.setTargetAtTime(0, voice.releaseAt, voice.releaseTime);
      voice.source.stop(voice.end);
    } catch {}
  }
  /**
   * Keep sounding notes held while the transport waits, as at a Wait gate.
   * reschedule() releases them where their notes end once it moves on.
   */
  hold() {
    const now = this.now();
    for (const voice of this.voices)
      if (voice.start <= now) this.retime(voice, now, Infinity);
  }
  stop(releasePrepared = true) {
    if (releasePrepared) {
      this.playbackFiles.clear();
      this.playback = undefined;
    }
    const now = this.now();
    for (const voice of this.voices) this.fade(voice, now);
    this.scheduled.clear();
    this.ahead.clear();
    this.struck = new WeakMap();
    // A large song's events are rebuilt on the next tick that needs them.
    this.voiceEventCache = undefined;
    this.aheadStart = Infinity;
    // Rebuilding the room flushes its tail. Skip it when there is no tail,
    // such as while dragging the playhead with nothing playing.
    try {
      if (this.roomUsed && this.output) {
        // Fading voices would feed the fresh room and leave a new tail of the
        // old passage. They finish on the dry path, which is unchanged.
        for (const voice of this.fading)
          if (voice.room) {
            voice.gain.disconnect(voice.room);
            voice.room = undefined;
          }
        this.output.reset();
        this.roomUsed = false;
      }
    } catch {
      this.output?.dispose();
      this.output = null;
      this.playbackBlocked = true;
      this.error = "The piano sound could not reset. Please try Play again.";
    }
  }
  /** Returns false only when the voice cap refused the note, so it can be tried again. */
  tone(
    pitch: number,
    velocity: number,
    when: number,
    duration: number,
    ids: readonly string[] = [],
    pass = this.scheduled,
    songEnd = Infinity,
  ) {
    if (velocity <= 0) return true;
    const region = selectPianoRegion(pitch, velocity);
    if (!region) return true;
    const undamped = region.releaseSeconds >= 100;
    return this.play({
      file: region.file,
      offset: region.offset,
      rate: pianoPlaybackRate(region, pitch),
      level: pianoLevel(region, velocity),
      when,
      attack: ATTACK_SECONDS,
      releaseAt: when + Math.max(0.04, duration),
      // A time constant retains a gentle overlap between notes; a short ramp
      // to near-zero sounded like a gate.
      releaseTime: undamped
        ? null
        : releaseTimeConstant(region.releaseSeconds, pitch),
      ids,
      pass,
      songEnd,
      layer: null,
    });
  }
  /**
   * Play a release, noise or resonance voice. Unlike a note, a voice the cap
   * refuses is left out rather than tried again late.
   */
  private optionalVoice(
    event: PianoVoiceEvent,
    when: number,
    at: number,
    speed: number,
    songEnd: number,
    pass: Set<string>,
  ) {
    const { region } = event;
    // rt_decay counts the time the voice's note has sounded, across speed
    // changes, from when it was struck in this pass. Notes released together
    // share one voice, decayed for the shortest of their holds.
    const struck = this.struck.get(pass),
      times = event.notes.flatMap((id) => struck?.get(id) ?? []);
    const held = times.length
      ? Math.max(0, when - Math.max(...times))
      : event.held / speed;
    const level = pianoVoiceLevel(event, held);
    if (level < MIN_PIANO_VOICE_LEVEL) return;
    // Resonance is damped with its note, and the next pedal change cuts
    // pedal noise. Release and key noise play their recording out.
    const damped = Number.isFinite(songEnd);
    this.play({
      file: region.file,
      offset: region.offset,
      rate: pianoPlaybackRate(region, event.pitch),
      level,
      when,
      attack: Math.max(ATTACK_SECONDS, region.attackSeconds),
      releaseAt: damped
        ? when + Math.max(0.04, (songEnd - at) / speed)
        : Infinity,
      releaseTime: !damped
        ? null
        : region.voice === "pedalNoise"
          ? region.cutSeconds / 7
          : releaseTimeConstant(region.releaseSeconds, event.pitch),
      ids: event.ids,
      pass,
      songEnd,
      layer: region.voice,
    });
  }
  /** Returns false only when the voice cap refused a note. */
  private play(request: VoiceRequest) {
    const context = this.context;
    if (!context || context.state !== "running" || this.playbackBlocked)
      return true;
    const buffer = this.samples.get(request.file);
    if (!buffer) return true;
    // A refused note is tried again on a later tick, at most a tick late.
    const optional = request.layer !== null;
    if (!this.admit(request.when, context.currentTime, optional))
      return optional;
    const { when, attack, level, releaseTime, rate, offset } = request;
    // Damping never starts before the attack ramp ends, which would then
    // raise the level again.
    const releaseAt = Math.max(request.releaseAt, when + attack);
    let source: AudioBufferSourceNode | undefined, gain: GainNode | undefined;
    try {
      source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      gain = context.createGain();
      // Silent until the attack, including when a fade cancels the attack.
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(level, when + attack);
      // The recording supplies the piano's natural decay. Only damp it after
      // key/pedal release, instead of fading away throughout the held note.
      if (releaseTime !== null) {
        gain.gain.setValueAtTime(level, releaseAt);
        gain.gain.setTargetAtTime(0, releaseAt, releaseTime);
      }
      source.connect(gain);
      const room = this.output?.roomInput;
      if (this.output && room) {
        gain.connect(this.output.input);
        gain.connect(room);
      } else gain.connect(context.destination);
      this.roomUsed = true;
      // Seven time constants leaves less than 0.1% gain before cleanup.
      const sampleEnd = when + (buffer.duration - offset) / rate;
      const end =
        releaseTime === null
          ? sampleEnd
          : Math.min(sampleEnd, releaseAt + releaseTime * 7 + 0.02);
      const voice = {
        source,
        gain,
        file: request.file,
        start: when,
        end,
        attack,
        room,
        songEnd: request.songEnd,
        releaseAt,
        releaseTime,
        sampleEnd,
        ids: request.ids,
        pass: request.pass,
        layer: request.layer,
      };
      this.voices.add(voice);
      source.onended = () => this.disconnect(voice);
      source.start(when, offset);
      source.stop(end);
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
      this.error = "Piano sound could not start. Pause and try Play again.";
    }
    return true;
  }
  /**
   * Schedule the notes that start within the lookahead. Near a loop's end,
   * the next pass starts from `ahead`, which defaults to the same notes. With
   * no notes in either, nothing sounds, not even the pedal's noise.
   */
  schedule(
    notes: readonly Note[],
    transport: Transport,
    pedals: readonly PedalSpan[] = NO_PEDALS,
    ahead: readonly Note[] = notes,
  ) {
    if ((!notes.length && !ahead.length) || !transport.playing || !this.context)
      return;
    const now = this.now(),
      position = transport.at(now),
      loop = transport.loop;
    if (this.cycle !== transport.cycle) {
      // A new pass keeps the notes scheduled ahead for it. The last pass's
      // voices end by the loop end, so they ring out, and so does the room
      // tail. Pause, seek and song changes call stop(), which clears both.
      // After a stall longer than a loop, the transport skips whole passes:
      // the notes scheduled ahead then played in a pass that has already
      // gone, and the current pass starts with nothing scheduled.
      const passSeconds = loop ? (loop[1] - loop[0]) / transport.speed : 0;
      this.scheduled =
        now < this.aheadStart + passSeconds ? this.ahead : new Set();
      this.ahead = new Set();
      this.aheadStart = Infinity;
      this.cycle = transport.cycle;
      this.passStart = transport.position;
    }
    this.schedulePass(
      notes,
      pedals,
      transport,
      now,
      position,
      this.scheduled,
      this.passStart <= position ? this.passStart : -Infinity,
    );
    // Start the next pass within the lookahead too. Waiting for the tick
    // that observes the wrap would strike its first notes up to a tick late.
    if (loop && position + LOOKAHEAD_SECONDS * transport.speed >= loop[1]) {
      this.aheadStart = now + (loop[1] - position) / transport.speed;
      this.schedulePass(
        ahead,
        pedals,
        transport,
        now,
        position - (loop[1] - loop[0]),
        this.ahead,
        -Infinity,
      );
    }
  }
  /**
   * Schedule one pass's notes that start within the lookahead. `position` is
   * measured from the start of that pass, so for the next loop pass it is
   * one loop length earlier than the transport position. `start` is where
   * playback of the pass began, if not at the loop start.
   */
  private schedulePass(
    notes: readonly Note[],
    pedals: readonly PedalSpan[],
    transport: Transport,
    now: number,
    position: number,
    pass: Set<string>,
    start: number,
  ) {
    const [from, to] = transport.loop ?? [-Infinity, Infinity];
    // A note that sounds into the pass is struck where the pass begins.
    const head = Math.max(position, from);
    const attacks = new Map<string, Note & { ids: string[] }>();
    for (const n of notes) {
      if (
        pass.has(n.id) ||
        n.soundEnd <= head ||
        n.start > position + LOOKAHEAD_SECONDS * transport.speed ||
        n.start >= to
      )
        continue;
      const key = `${n.pitch}:${n.start}`,
        previous = attacks.get(key);
      // Duplicate tracks at the same onset need one sound, with the longest pedal tail.
      if (!previous) attacks.set(key, { ...n, ids: [n.id] });
      else {
        previous.soundEnd = Math.max(previous.soundEnd, n.soundEnd);
        previous.velocity = Math.max(previous.velocity, n.velocity);
        previous.ids.push(n.id);
      }
    }
    const { events, resonance } = this.playback
      ? this.voiceEvents(this.playback.notes, this.playback.pedals)
      : this.voiceEvents(notes, pedals);
    // The prepared passage can hold notes this pass may not play yet, such as
    // a duet waiting at a Wait gate: their optional voices wait with them.
    let ids = this.noteIds.get(notes);
    if (!ids) this.noteIds.set(notes, (ids = new Set(notes.map((n) => n.id))));
    const playable = (event: PianoVoiceEvent) =>
      event.notes.every((id) => ids.has(id));
    /** Where the next pass's first pedal press falls, after this pass. */
    const wrappedPress = () => {
      if (!Number.isFinite(to)) return Infinity;
      for (
        let i = firstIndexAtOrAfter(events, "time", from);
        i < events.length && events[i].time < to;
        i++
      )
        if (events[i].region.trigger === "pedalDown")
          return to + events[i].time - from;
      return Infinity;
    };
    /** Play an optional voice from song time `at`. */
    const sound = (event: PianoVoiceEvent, at: number) => {
      // Held voices end with the pass. The next press cuts a lift's noise,
      // in the next pass if none follows in this one.
      this.optionalVoice(
        event,
        now + (at - position) / transport.speed,
        at,
        transport.speed,
        event.songEnd <= to
          ? event.songEnd
          : liftTriggered(event.region)
            ? wrappedPress()
            : to,
        pass,
      );
      for (const id of event.ids) pass.add(id);
    };
    const carried: string[] = [];
    for (const n of attacks.values()) {
      const start = (Math.max(n.start, head) - position) / transport.speed,
        end = (Math.min(n.soundEnd, to) - position) / transport.speed;
      // A note the voice cap refused stays unscheduled, so a later tick can
      // play it once a voice is free.
      if (end <= 0) for (const id of n.ids) pass.add(id);
      else if (
        this.tone(
          n.pitch,
          n.velocity,
          now + start,
          end - start,
          n.ids,
          pass,
          Math.min(n.soundEnd, to),
        )
      ) {
        let struck = this.struck.get(pass);
        if (!struck) this.struck.set(pass, (struck = new Map()));
        for (const id of n.ids) {
          pass.add(id);
          struck.set(id, now + start);
        }
        if (n.start < head) carried.push(...n.ids);
      }
    }
    // Then the optional voices, after the notes they belong to have a voice.
    // A note struck where the pass begins brings its resonance with it.
    if (this.sound.voices.resonance)
      for (const id of carried)
        for (const event of resonance.get(id) ?? [])
          if (!pass.has(event.ids[0])) sound(event, head);
    // Release, noise and resonance voices start at an instant. One that a
    // late tick missed, such as at the very start of playback, still sounds
    // up to a lookahead late, but none from before the pass began.
    const boundary = Math.max(start, from),
      first = Math.max(
        boundary,
        position - LOOKAHEAD_SECONDS * transport.speed,
      ),
      limit = position + LOOKAHEAD_SECONDS * transport.speed;
    for (
      let i = firstIndexAtOrAfter(events, "time", first);
      i < events.length && events[i].time <= limit;
      i++
    ) {
      const event = events[i],
        lift = liftTriggered(event.region);
      // A key or pedal that comes up as the pass ends still sounds in it;
      // one that comes up as it begins belongs to what came before.
      if (
        event.time > to ||
        (event.time === to && !lift) ||
        (event.time === boundary && lift) ||
        !this.sound.voices[event.region.voice] ||
        pass.has(event.ids[0]) ||
        !playable(event)
      )
        continue;
      sound(event, event.time);
    }
  }
}
