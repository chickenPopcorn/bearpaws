import {
  Practice,
  Transport,
  MidiState,
  TIMING_EPSILON,
  type Mode,
} from "./engine";
import { ReferenceAudio } from "./audio";
import { MidiConnection } from "./midi";
import {
  checkMidiSize,
  parseSong,
  type PedalSpan,
  type Song,
  type Hand,
} from "./song";
import { builtInSongs, isBuiltInSong } from "./lessons";
import { normalizePianoSound, type PianoVoice } from "./pianoSound";
import {
  settings,
  write,
  progress,
  library,
  saveSong,
  deleteSong,
  removeProgress,
  songId,
  type Progress,
} from "./storage";
const SOUND_UNAVAILABLE = "Piano sound is unavailable. Please try again.";
const NO_PEDALS: readonly PedalSpan[] = [];
export class Studio {
  settings = settings();
  savedSelection = this.settings.selected;
  private playGeneration = 0;
  private playbackPending = false;
  private audioPreparations = new Set<AbortController>();
  private virtualRequests = new Map<number, number>();
  private nextVirtualRequest = 0;
  private lifecycleGeneration = 0;
  private initialization: Promise<void> | undefined;
  private destroyed = false;
  private selectedNotes: Song["notes"] = [];
  scoringEpoch = 0;
  // Where the current loop pass began. Earlier presses in this scoring
  // session belong to the previous pass.
  private passEpoch = -Infinity;
  songs = builtInSongs();
  // Loading writes the selection, so start on the saved built-in song (if
  // any) rather than overwrite it before the library loads, or fails to.
  song =
    this.songs.find((song) => song.id === this.savedSelection) ?? this.songs[0];
  audio = new ReferenceAudio();
  input = new MidiState();
  transport = new Transport(this.song.duration);
  practice = new Practice(this.song.notes);
  midi: MidiConnection;
  position = 0;
  notice = "";
  storageNotice = "";
  lastVelocity = 0;
  revision = 0;
  listeners = new Set<() => void>();
  lastSave = 0;
  progress: Progress = {
    position: 0,
    best: 0,
    attempts: 0,
    updated: "",
    assignments: {},
    loopEnabled: true,
    loop: null,
  };
  loopEnabled = true;
  loopStart = 0;
  loopEnd = this.song.duration;
  timer: ReturnType<typeof setInterval> | null = null;
  constructor() {
    this.audio.setSound({
      ambience: this.settings.ambience,
      voices: this.settings.pianoVoices,
    });
    this.midi = this.createMidi();
    this.load(this.song);
  }
  private createMidi() {
    return new MidiConnection({
      onMessage: (data, time) => this.receive(data, time),
      onReset: () => {
        this.input.clear();
        if (this.settings.mode !== "listen") {
          if (this.transport.playing || this.playbackPending) {
            this.pause();
            this.notice =
              "Piano connection changed. Press Play when you are ready.";
          } else this.cancelPlaybackPreparation();
        }
        this.emit();
      },
      onChange: () => this.emit(),
    });
  }
  get scoringNotes() {
    return this.notes.filter(
      (n) =>
        !this.loopEnabled ||
        (n.start >= this.loopStart - 0.001 && n.start < this.loopEnd),
    );
  }
  /** Whether the reference recording plays in the current mode. */
  private get referenceAudible() {
    return (
      this.settings.mode === "listen" ||
      (this.settings.mode === "rhythm" && this.settings.reference)
    );
  }
  private get referenceNotes() {
    if (!this.referenceAudible) return [];
    return this.notes.filter(
      (note) =>
        !this.loopEnabled ||
        (note.start < this.loopEnd && note.soundEnd > this.loopStart),
    );
  }
  /** Wait mode holds the transport at the next chord. */
  private get waitGate() {
    return this.settings.mode === "wait"
      ? this.practice.gate?.start
      : undefined;
  }
  /** Score afresh from the current position, with no keys held. */
  private restartScoring() {
    this.scoringEpoch = this.audio.now();
    this.input.clear();
    this.practice = new Practice(this.scoringNotes, this.transport.loop);
    this.practice.reset(this.position);
  }
  private cancelPlaybackPreparation() {
    this.playGeneration++;
    this.playbackPending = false;
    for (const preparation of this.audioPreparations) preparation.abort();
    this.audioPreparations.clear();
  }
  get notes() {
    return this.selectedNotes;
  }
  private refreshSelection() {
    const hands = new Map(this.song.tracks.map((t) => [t.id, t.hand]));
    this.selectedNotes = this.song.notes.filter((n) => {
      const hand = hands.get(n.track);
      return hand === "left"
        ? this.settings.left
        : hand === "right" && this.settings.right;
    });
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.revision;
  emit() {
    this.revision++;
    for (const l of this.listeners) l();
  }
  init(): Promise<void> {
    if (this.initialization) return this.initialization;
    if (this.timer !== null) return Promise.resolve();
    if (this.destroyed) {
      this.midi = this.createMidi();
      this.destroyed = false;
    }
    const generation = ++this.lifecycleGeneration;
    void this.midi.autoConnect();
    this.initialization = this.loadLibrary(generation).finally(() => {
      if (generation === this.lifecycleGeneration)
        this.initialization = undefined;
    });
    return this.initialization;
  }
  private async loadLibrary(generation: number) {
    try {
      const songs = await library();
      if (generation !== this.lifecycleGeneration) return;
      this.songs = [
        ...builtInSongs(),
        ...songs.filter((song) => !isBuiltInSong(song.id)),
      ];
      const selected = this.songs.find((s) => s.id === this.savedSelection);
      // A saved built-in song is already active; reloading it would stop any
      // practice that started before the library finished loading.
      if (selected && selected.id !== this.song.id) this.load(selected);
      this.emit();
    } catch {
      if (generation !== this.lifecycleGeneration) return;
      this.storageNotice =
        "Local song storage is unavailable. Imports work for this session.";
      this.emit();
    }
    if (generation === this.lifecycleGeneration)
      this.timer = setInterval(() => this.tick(), 20);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lifecycleGeneration++;
    this.initialization = undefined;
    this.cancelPlaybackPreparation();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.save();
    this.audio.stop();
    this.midi.dispose();
  }
  persist() {
    if (!write("settings", this.settings))
      this.storageNotice =
        "Browser storage is full or blocked. Changes will last for this session.";
  }
  save() {
    this.progress = {
      ...this.progress,
      position: this.position,
      updated: new Date().toISOString(),
      assignments: Object.fromEntries(
        this.song.tracks.map((t) => [t.id, t.hand]),
      ),
      loopEnabled: this.loopEnabled,
      loop: [this.loopStart, this.loopEnd],
    };
    if (!write(`progress:${this.song.id}`, this.progress))
      this.storageNotice = "Progress could not be saved in this browser.";
  }
  load(song: Song) {
    this.cancelPlaybackPreparation();
    if (this.transport.playing) this.pause();
    this.audio.stop();
    this.song = { ...song, tracks: song.tracks.map((t) => ({ ...t })) };
    this.settings.selected = song.id;
    this.persist();
    this.progress = progress(song.id, song.duration);
    for (const t of this.song.tracks) {
      const hand = this.progress.assignments[t.id];
      if (["left", "right", "off"].includes(hand)) t.hand = hand as Hand;
    }
    this.transport = new Transport(song.duration);
    this.transport.speed = this.settings.speed;
    this.position = Math.max(
      0,
      Math.min(song.duration, this.progress.position || 0),
    );
    this.transport.seek(this.position, this.audio.now());
    this.loopStart = this.progress.loop?.[0] ?? 0;
    this.loopEnd = this.progress.loop?.[1] ?? song.duration;
    this.loopEnabled = this.progress.loopEnabled;
    this.syncLoop();
    this.refreshSelection();
    this.restartScoring();
    this.notice = "";
    this.emit();
  }
  rebuild() {
    this.cancelPlaybackPreparation();
    this.refreshSelection();
    this.audio.stop();
    this.restartScoring();
    this.transport.seek(this.position, this.audio.now());
    this.save();
    this.persist();
    this.emit();
  }
  mode(mode: Mode) {
    this.pause();
    this.settings.mode = mode;
    this.rebuild();
  }
  /** Each hand turns on and off on its own; both may be off. */
  hand(hand: "left" | "right") {
    this.pause();
    this.settings[hand] = !this.settings[hand];
    this.rebuild();
  }
  assign(track: number, hand: Hand) {
    this.pause();
    // Replace rather than mutate, so views can memoize on the song's identity.
    this.song = {
      ...this.song,
      tracks: this.song.tracks.map((t) =>
        t.id === track ? { ...t, hand } : t,
      ),
    };
    this.rebuild();
  }
  speed(speed: number) {
    const now = this.audio.now();
    if (this.transport.playing) this.tick(now);
    this.transport.setSpeed(speed, now);
    this.settings.speed = speed;
    // Sounding notes ring on; only notes that have not started change speed.
    if (this.transport.playing) this.audio.reschedule(this.transport);
    else this.audio.stop();
    this.persist();
    this.emit();
  }
  names(enabled: boolean) {
    this.settings.names = enabled;
    this.persist();
    this.emit();
  }
  tolerance(value: number) {
    this.settings.tolerance = value;
    this.persist();
    this.emit();
  }
  reference(enabled: boolean) {
    if (this.settings.reference === enabled) return;
    const resume =
      this.settings.mode === "rhythm" &&
      (this.transport.playing || this.playbackPending);
    if (resume) this.pause();
    this.settings.reference = enabled;
    this.persist();
    this.emit();
    if (resume) void this.play();
  }
  sound(ambience: number) {
    const sound = normalizePianoSound({ ambience });
    this.settings.ambience = sound.ambience;
    this.audio.setSound({ ambience: sound.ambience });
    this.persist();
    this.emit();
  }
  pianoVoice(voice: PianoVoice, enabled: boolean) {
    if (this.settings.pianoVoices[voice] === enabled) return;
    // A voice turned on mid-passage needs its recordings, and a passage still
    // loading should not wait for those of one turned off. Play on from here
    // once the right ones load, as for the Rhythm reference.
    const resume =
      this.referenceAudible &&
      (this.playbackPending || (enabled && this.transport.playing));
    if (resume) this.pause();
    this.settings.pianoVoices = {
      ...this.settings.pianoVoices,
      [voice]: enabled,
    };
    this.audio.setSound({ voices: this.settings.pianoVoices });
    this.persist();
    this.emit();
    if (resume) void this.play();
  }
  seek(position: number) {
    this.cancelPlaybackPreparation();
    this.audio.stop(!this.transport.playing);
    if (this.loopEnabled)
      position = Math.min(
        this.loopEnd - 0.001,
        Math.max(this.loopStart, position),
      );
    this.transport.seek(position, this.audio.now());
    this.position = this.transport.at(this.audio.now());
    this.restartScoring();
    this.notice = "";
    this.save();
    this.emit();
  }
  pause() {
    this.cancelPlaybackPreparation();
    const now = this.audio.now();
    if (this.transport.playing) this.tick(now);
    this.transport.pause(now);
    this.position = this.transport.position;
    this.audio.stop();
    this.save();
    this.emit();
  }
  /** The song's pedal, which the reference's optional voices follow. */
  private get pedals(): readonly PedalSpan[] {
    return this.song.pedals ?? NO_PEDALS;
  }
  /** With `pedals`, `notes` are a passage to play, with its optional voices. */
  private async prepareAudio(
    notes: Pick<Song["notes"][number], "pitch" | "velocity">[],
    generation: number,
    pedals?: readonly PedalSpan[],
  ) {
    await this.audio.unlock();
    if (generation !== this.playGeneration || !notes.length) return;
    const controller = new AbortController();
    this.audioPreparations.add(controller);
    const preparation = this.audio.prepare(notes, controller.signal, pedals);
    this.emit();
    try {
      await preparation;
    } finally {
      this.audioPreparations.delete(controller);
      this.emit();
    }
  }
  async play() {
    this.cancelPlaybackPreparation();
    const generation = this.playGeneration;
    this.playbackPending = true;
    if (!this.notes.length) {
      this.playbackPending = false;
      this.notice =
        this.settings.left || this.settings.right
          ? "Assign at least one track to an enabled hand below."
          : "Turn on Left, Right, or both hands to play.";
      this.emit();
      return;
    }
    try {
      const p = this.position;
      const referenceNotes = this.referenceNotes;
      this.audio.stop();
      await this.prepareAudio(referenceNotes, generation, this.pedals);
      if (generation !== this.playGeneration) return;
      this.scoringEpoch = this.audio.now();
      this.transport.seek(p, this.audio.now());
      if (p >= this.song.duration)
        this.seek(this.loopEnabled ? this.loopStart : 0);
      if (
        this.loopEnabled &&
        (this.position < this.loopStart || this.position >= this.loopEnd)
      )
        this.seek(this.loopStart);
      this.audio.setPlaybackNotes(referenceNotes, this.pedals);
      this.transport.play(this.audio.now());
      this.progress.attempts++;
      this.notice = "";
      this.save();
      this.emit();
    } catch {
      if (generation !== this.playGeneration) return;
      this.notice =
        this.audio.error ||
        "Browser audio could not start. Enable audio for this page and try Play again.";
      this.emit();
    } finally {
      if (generation === this.playGeneration) this.playbackPending = false;
    }
  }
  syncLoop() {
    if (this.loopEnabled && this.loopEnd > this.loopStart + 0.1)
      this.transport.loop = [this.loopStart, this.loopEnd];
    else this.transport.loop = null;
  }
  loop(enabled: boolean) {
    // The new scope may need recordings that the previous loop did not load.
    const resume = this.transport.playing || this.playbackPending;
    if (resume) this.pause();
    this.loopEnabled = enabled;
    this.syncLoop();
    this.seek(enabled ? this.loopStart : this.position);
    if (resume) void this.play();
  }
  bounds(start: number, end: number) {
    const resume =
      this.loopEnabled && (this.transport.playing || this.playbackPending);
    if (resume) this.pause();
    this.loopStart = Math.max(0, Math.min(this.song.duration - 0.2, start));
    this.loopEnd = Math.max(
      this.loopStart + 0.2,
      Math.min(this.song.duration, end),
    );
    this.syncLoop();
    // An enabled loop restarts from its new start. A disabled one does not
    // change playback, so sounding notes must not be stopped and re-struck.
    if (this.loopEnabled) this.seek(this.loopStart);
    this.save();
    this.emit();
    if (resume) void this.play();
  }
  tick(now = this.audio.now()) {
    const playing = this.transport.playing,
      cycle = this.transport.cycle;
    if (playing) {
      this.position = this.transport.update(now, this.waitGate);
      if (cycle !== this.transport.cycle) {
        this.passEpoch =
          now - (this.position - this.loopStart) / this.settings.speed;
        this.input.clear();
        this.practice.wrap();
        // Replay this pass from its actual clock boundary so a late callback
        // records the first Wait hold at its true arrival time.
        this.transport.seek(this.loopStart, this.passEpoch);
        this.position = this.transport.update(now, this.waitGate);
      }
      if (this.settings.mode === "rhythm")
        this.practice.expire(
          this.position,
          this.settings.tolerance,
          this.settings.speed,
        );
      this.audio.schedule(
        this.notes,
        this.transport,
        this.referenceAudible,
        this.pedals,
      );
      if (this.audio.error) this.notice = this.audio.error;
      const total = this.practice.notes.filter(
        (n) => n.start >= this.practice.from - 0.001,
      ).length;
      if (total)
        this.progress.best = Math.max(
          this.progress.best,
          Math.round((this.practice.hit.size / total) * 100),
        );
      if (!this.transport.playing) {
        // The transport has finished, but the final piano release can still
        // be ringing. Explicit pause/seek/song changes continue to stop audio.
        this.audio.setPlaybackNotes([]);
        this.notice = "";
        this.save();
      }
      if (now - this.lastSave > 1) {
        this.save();
        this.lastSave = now;
      }
      this.emit();
    }
  }
  receive(data: Uint8Array, timestamp: number) {
    // System real-time messages (clock, active sensing) can arrive dozens of
    // times a second and never change keys, pedals or scoring.
    if (data[0] >= 0xf8) return;
    const wasPlaying = this.transport.playing,
      now = this.audio.now(),
      event = Math.min(now, this.audio.eventTime(timestamp)),
      mapped = this.transport.eventAt(event);
    if (wasPlaying) this.tick();
    const edge = this.input.message(data);
    if (edge) {
      this.lastVelocity = edge.velocity;
      // A Rhythm press within the timing window before a loop wrap, delivered
      // after it, is scored in the new pass's time. There it can be early for
      // the pass's first notes or late for the previous pass's last ones.
      const carried =
        this.settings.mode === "rhythm" &&
        event < this.passEpoch &&
        this.passEpoch - event <= this.settings.tolerance + TIMING_EPSILON;
      if (
        wasPlaying &&
        event >= this.scoringEpoch &&
        (event >= this.passEpoch || carried)
      ) {
        // Wait gates are recorded by tick; map again so delayed events retain
        // their actual position, including time spent held at the gate.
        const position =
          this.settings.mode === "wait"
            ? this.transport.eventAt(event).position
            : mapped.position - (carried ? this.loopEnd - this.loopStart : 0);
        const advanced = this.practice.input(
          edge.pitch,
          position,
          this.settings.mode,
          this.settings.tolerance,
          mapped.speed,
          this.input.down,
        );
        if (advanced) {
          this.transport.seek(this.position, now);
          this.notice = "";
        }
      }
    }
    this.emit();
  }
  virtual(pitch: number, on: boolean) {
    const request = ++this.nextVirtualRequest;
    if (on) this.virtualRequests.set(pitch, request);
    else this.virtualRequests.delete(pitch);
    this.receive(
      new Uint8Array([on ? 0x9f : 0x8f, pitch, on ? 90 : 0]),
      performance.now(),
    );
    if (on) {
      const generation = this.playGeneration;
      void this.prepareAudio([{ pitch, velocity: 0.6 }], generation)
        .then(() => {
          if (
            generation === this.playGeneration &&
            this.virtualRequests.get(pitch) === request &&
            this.input.down.has(pitch)
          )
            this.audio.tone(pitch, 0.6, this.audio.now(), 0.4);
        })
        .catch(() => {
          if (generation !== this.playGeneration) return;
          this.notice = this.audio.error || SOUND_UNAVAILABLE;
          this.emit();
        });
    }
  }
  async preview() {
    const generation = this.playGeneration;
    const notes = [
      ...new Map(this.practice.gate?.notes.map((n) => [n.pitch, n])).values(),
    ];
    try {
      await this.prepareAudio(notes, generation);
      if (generation !== this.playGeneration) return;
      for (const n of notes)
        this.audio.tone(n.pitch, n.velocity, this.audio.now(), 0.7);
    } catch {
      if (generation !== this.playGeneration) return;
      this.notice = this.audio.error || SOUND_UNAVAILABLE;
      this.emit();
    }
  }
  async import(file: File) {
    try {
      checkMidiSize(file.size);
      const bytes = new Uint8Array(await file.arrayBuffer()),
        song = parseSong(
          bytes,
          file.name.replace(/\.midi?$/i, ""),
          await songId(bytes),
        );
      try {
        await saveSong(song);
      } catch {
        this.storageNotice =
          "This song is available for this session; browser storage could not save it.";
      }
      this.songs = [...this.songs.filter((s) => s.id !== song.id), song];
      this.save();
      this.load(song);
      this.notice =
        song.tracks.filter((t) => t.count).length > 1
          ? "Choose Left, Right, or Skip for each track below before playing."
          : "Imported locally. Check the track assignment below.";
      this.emit();
    } catch (error) {
      this.notice =
        error instanceof Error
          ? error.message
          : "Unable to read this MIDI file.";
      this.emit();
    }
  }
  async remove() {
    const id = this.song.id;
    if (isBuiltInSong(id)) return;
    this.pause();
    try {
      await deleteSong(id);
    } catch {
      this.notice = "This song could not be removed from local storage.";
      this.emit();
      return;
    }
    // IndexedDB deletion has committed. Progress cleanup must not undo the UI result.
    try {
      removeProgress(id);
    } catch {
      this.storageNotice =
        "Song removed. Saved progress could not be cleared in this browser.";
    }
    this.songs = this.songs.filter((song) => song.id !== id);
    if (this.song.id === id) this.load(this.songs[0]);
    else this.emit();
  }
}
