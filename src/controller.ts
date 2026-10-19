import {
  Practice,
  Transport,
  MidiState,
  TIMING_EPSILON,
  type Mode,
} from "./engine";
import { ReferenceAudio } from "./audio";
import { MidiConnection } from "./midi";
import type { Note, PedalSpan, Song, Hand } from "./song";
import { normalizePianoSound, type PianoVoice } from "./pianoSound";
import {
  settings,
  write,
  progress,
  DAILY_GOAL_CHOICES,
  LEARNER_NAME_MAX,
  type Progress,
} from "./storage";
import type { SyncHooks } from "./cloud";
import { IDLE_SECONDS, PracticeLog, watchSessions } from "./practiceLog";
const SOUND_UNAVAILABLE = "Piano sound is unavailable. Please try again.";
/** A progress record's content, leaving out when it was saved. */
const unstamped = ({ updated: _updated, ...rest }: Progress) =>
  JSON.stringify(rest);
const NO_PEDALS: readonly PedalSpan[] = [];
const NO_NOTES: Note[] = [];
export class Studio {
  settings = settings();
  savedSelection = this.settings.selected;
  private playGeneration = 0;
  private playbackPending = false;
  outputChanging = false;
  private midiDuetRouted = false;
  private audioPreparations = new Set<AbortController>();
  private virtualRequests = new Map<number, number>();
  private nextVirtualRequest = 0;
  private destroyed = false;
  private selectedNotes: Song["notes"] = [];
  scoringEpoch = 0;
  // Where the current loop pass began. Earlier presses in this scoring
  // session belong to the previous pass.
  private passEpoch = -Infinity;
  /** The shared song library, in library order. */
  songs: Song[];
  song: Song;
  /** The song as printed. With Duet on, `song` has its student part moved up. */
  written: Song;
  audio = new ReferenceAudio();
  input = new MidiState();
  transport: Transport;
  practice: Practice;
  midi: MidiConnection;
  position = 0;
  notice = "";
  storageNotice = "";
  lastVelocity = 0;
  revision = 0;
  listeners = new Set<() => void>();
  lastSave = 0;
  /** The current song's record as last written, without its stamp. */
  private savedProgress = "";
  /** Playing time per day, for the practice calendar. */
  practiceLog = new PracticeLog();
  /** When a key was last pressed, on the audio clock. */
  private lastKeyAt = -Infinity;
  /** The previous tick while practice time was being counted. */
  private lastPracticeTick: number | null = null;
  /** Stops following other tabs' practice; see watchPractice(). */
  private unwatchPractice = () => {};
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
  loopEnd: number;
  timer: ReturnType<typeof setInterval> | null = null;
  /**
   * `library` holds the shared songs (see src/library.ts). `sync` copies
   * saved changes to the signed-in account.
   */
  constructor(
    library: readonly Song[],
    private sync?: SyncHooks,
  ) {
    if (!library.length) throw new Error("The song library is empty.");
    this.songs = [...library];
    // Start on the saved song, if it is still in the library.
    this.song =
      this.songs.find((song) => song.id === this.savedSelection) ??
      this.songs[0];
    this.written = this.song;
    this.transport = new Transport(this.song.duration);
    this.practice = new Practice(this.song.notes);
    this.loopEnd = this.song.duration;
    this.audio.setSound({
      ambience: this.settings.ambience,
      voices: this.settings.pianoVoices,
    });
    this.midi = this.createMidi();
    this.watchPractice();
    this.load(this.song);
  }
  /** Another tab's practice shows here too, without waiting for this one. */
  private watchPractice() {
    this.unwatchPractice = watchSessions(() => {
      if (this.practiceLog.refresh()) this.emit();
    });
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
      onOutputLost: () => {
        // Playback, or a start still loading, routed the duet to the lost
        // output and never prepared its laptop sound: stop, and let Play
        // start over on the laptop.
        if (
          this.destroyed ||
          !this.midiDuetRouted ||
          !(this.transport.playing || this.playbackPending)
        )
          return;
        this.pause();
        this.notice = "Piano output disconnected. Press Play to continue.";
        this.emit();
      },
    });
  }
  /**
   * Route the duet to output `id`, or the laptop with "". Play waits until
   * the choice settles (see play()), so no run starts on the old routing.
   */
  async duetOutput(id: string) {
    if (this.outputChanging) return;
    this.outputChanging = true;
    this.emit();
    const resume = this.transport.playing || this.playbackPending;
    this.pause();
    const generation = this.playGeneration;
    try {
      await this.midi.selectOutput(id);
    } finally {
      this.outputChanging = false;
      this.emit();
    }
    if (
      resume &&
      !this.destroyed &&
      generation === this.playGeneration &&
      (!id || this.midi.duet.connected)
    )
      await this.play();
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
  /** Notes that sound within the passage: all of them without a loop. */
  private inPassage(notes: readonly Note[]) {
    return notes.filter(
      (note) =>
        !this.loopEnabled ||
        (note.start < this.loopEnd && note.soundEnd > this.loopStart),
    );
  }
  private get referenceNotes() {
    if (!this.referenceAudible) return [];
    return this.inPassage(this.notes);
  }
  /** The teacher part that plays along, with Duet on. */
  get duetNotes(): readonly Note[] {
    return (this.settings.duet && this.song.duet?.notes) || NO_NOTES;
  }
  /** How far Duet moves the student part, in semitones: negative is lower. */
  get octaveShift() {
    return this.settings.duet && this.written.duet
      ? 12 * this.written.duet.octaves
      : 0;
  }
  /** Everything playback sounds: the reference, when audible, and the duet. */
  private get playbackNotes() {
    return [
      ...this.referenceNotes,
      ...(this.midi.duet.connected ? [] : this.inPassage(this.duetNotes)),
    ];
  }
  /** Whether playback sounds anything: the reference or the duet. */
  private get audible() {
    return this.referenceAudible || this.duetNotes.length > 0;
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
  /** Start the practice clock and look for a piano, again after destroy(). */
  init() {
    if (this.timer !== null) return;
    if (this.destroyed) {
      this.midi = this.createMidi();
      this.watchPractice();
      // Take in what other tabs saved while this studio was closed.
      this.practiceLog.refresh();
      this.destroyed = false;
    }
    void this.midi.autoConnect();
    this.timer = setInterval(() => this.tick(), 20);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelPlaybackPreparation();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.save();
    // A restart begins a new playback run, which needs its own key press.
    this.lastPracticeTick = null;
    this.midi.duet.stop();
    this.audio.stop();
    this.midi.dispose();
    this.unwatchPractice();
  }
  persist() {
    if (!write("settings", this.settings))
      this.storageNotice =
        "Browser storage is full or blocked. Changes will last for this session.";
    this.sync?.settings(this.settings);
  }
  /** `loaded`: this save is made as the song opens, before any practice. */
  save(loaded = false) {
    // Practice time grows on its own, so it is saved even when progress has
    // not changed.
    if (!this.practiceLog.commit())
      this.storageNotice = "Practice time could not be saved in this browser.";
    const next: Progress = {
      ...this.progress,
      position: this.position,
      assignments: Object.fromEntries(
        this.song.tracks.map((t) => [t.id, t.hand]),
      ),
      loopEnabled: this.loopEnabled,
      loop: [this.loopStart, this.loopEnd],
    };
    // Only a change gets a new stamp and is written: the account keeps the
    // position of the later save, so re-saving what was loaded must not look
    // newer than practice saved since on another device.
    if (unstamped(next) === this.savedProgress) {
      if (loaded) this.sync?.progress(this.song.id, this.progress, true);
      return;
    }
    this.progress = { ...next, updated: new Date().toISOString() };
    this.savedProgress = unstamped(next);
    if (!write(`progress:${this.song.id}`, this.progress))
      this.storageNotice = "Progress could not be saved in this browser.";
    this.sync?.progress(this.song.id, this.progress, loaded);
  }
  load(song: Song) {
    this.cancelPlaybackPreparation();
    if (this.transport.playing) this.pause();
    this.midi.duet.stop();
    this.audio.stop();
    this.written = { ...song, tracks: song.tracks.map((t) => ({ ...t })) };
    this.settings.selected = song.id;
    this.persist();
    this.progress = progress(song.id, song.duration);
    this.savedProgress = this.progress.updated ? unstamped(this.progress) : "";
    for (const t of this.written.tracks) {
      const hand = this.progress.assignments[t.id];
      if (["left", "right", "off"].includes(hand)) t.hand = hand as Hand;
    }
    this.song = this.practiced();
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
    // The account's starting point for this song, so closing it untouched
    // uploads nothing.
    this.save(true);
    this.emit();
  }
  rebuild() {
    this.cancelPlaybackPreparation();
    this.refreshSelection();
    this.midi.duet.stop();
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
  /** The teacher duet turns on and off; the student part moves with it. */
  duet() {
    this.pause();
    this.settings.duet = !this.settings.duet;
    this.song = this.practiced();
    this.rebuild();
  }
  /**
   * The written song, or with Duet on, the student part as the book has it
   * played with the duet: an octave or two up or down, with its hand
   * positions.
   */
  private practiced(): Song {
    const written = this.written,
      shift = this.octaveShift;
    if (!shift) return written;
    const raise = (text: string) =>
      text.replace(
        /\b([A-G])(\d)\b/g,
        (_, name, octave) => `${name}${Number(octave) + shift / 12}`,
      );
    return {
      ...written,
      notes: written.notes.map((note) => ({
        ...note,
        pitch: note.pitch + shift,
      })),
      lesson: written.lesson && {
        ...written.lesson,
        handPositions: {
          left: raise(written.lesson.handPositions.left),
          right: raise(written.lesson.handPositions.right),
        },
      },
    };
  }
  assign(track: number, hand: Hand) {
    this.pause();
    // Replace rather than mutate, so views can memoize on the song's identity.
    this.written = {
      ...this.written,
      tracks: this.written.tracks.map((t) =>
        t.id === track ? { ...t, hand } : t,
      ),
    };
    this.song = this.practiced();
    this.rebuild();
  }
  speed(speed: number) {
    const now = this.audio.now();
    if (this.transport.playing) this.tick(now);
    this.transport.setSpeed(speed, now);
    this.settings.speed = speed;
    // Sounding notes ring on; only notes that have not started change speed.
    if (this.transport.playing) {
      this.audio.reschedule(this.transport);
      // Notes held at a Wait gate keep waiting.
      if (this.transport.held) this.audio.hold();
    } else {
      this.midi.duet.stop();
      this.audio.stop();
    }
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
  learnerName(name: string) {
    this.settings.learnerName = name.slice(0, LEARNER_NAME_MAX);
    this.settings.learnerNameChosen = true;
    this.persist();
    this.emit();
  }
  dailyGoal(minutes: number) {
    if (!DAILY_GOAL_CHOICES.includes(minutes)) return;
    this.settings.dailyGoalMinutes = minutes;
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
      this.audible &&
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
    this.midi.duet.stop();
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
    this.midiDuetRouted = false;
    this.cancelPlaybackPreparation();
    const now = this.audio.now();
    if (this.transport.playing) this.tick(now);
    this.lastPracticeTick = null;
    this.transport.pause(now);
    this.position = this.transport.position;
    this.midi.duet.stop();
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
    // duetOutput() resumes playback itself once the output has settled.
    if (this.outputChanging) return;
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
      const playbackNotes = this.playbackNotes;
      this.midiDuetRouted =
        this.midi.duet.connected && this.inPassage(this.duetNotes).length > 0;
      this.midi.duet.stop();
      this.audio.stop();
      await this.prepareAudio(playbackNotes, generation, this.pedals);
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
      this.audio.setPlaybackNotes(playbackNotes, this.pedals);
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
      cycle = this.transport.cycle,
      held = this.transport.held;
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
      // The duet's sounding notes wait at a gate with the learner.
      if (this.transport.held && !held && this.duetNotes.length)
        this.audio.hold();
      // Practice time counts while someone plays along: not in Listen, and
      // not once the keys have been quiet for a while, such as a Wait gate
      // left waiting. Each playback run needs its own key press, so one from
      // before a pause or the song's end cannot count the next run's start.
      if (this.lastPracticeTick === null) this.lastKeyAt = -Infinity;
      else if (
        this.settings.mode !== "listen" &&
        now - this.lastKeyAt <= IDLE_SECONDS
      )
        this.practiceLog.add(
          Math.min(now - this.lastPracticeTick, 1),
          this.song.id,
        );
      this.lastPracticeTick = this.transport.playing ? now : null;
      if (this.settings.mode === "rhythm")
        this.practice.expire(
          this.position,
          this.settings.tolerance,
          this.settings.speed,
        );
      this.scheduleAudio();
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
        this.midi.duet.stop();
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
  /**
   * Schedule what sounds next. In Wait mode the duet waits too: its notes
   * from the next gate on sound once the student plays that gate.
   */
  private scheduleAudio() {
    const reference = this.referenceAudible ? this.notes : NO_NOTES,
      gate = this.waitGate,
      duet =
        gate === undefined
          ? this.duetNotes
          : this.duetNotes.filter((note) => note.start < gate - 0.001),
      // A Wait loop's next pass is scheduled ahead, before its gates come
      // back, so it starts only the duet notes before its first gate.
      first =
        this.settings.mode === "wait" && this.transport.loop
          ? this.practice.groups[0]?.start
          : undefined,
      next =
        first === undefined
          ? duet
          : this.duetNotes.filter((note) => note.start < first - 0.001),
      withReference = (part: readonly Note[]) =>
        part.length ? [...reference, ...part] : reference,
      notes = withReference(duet);
    this.midi.duet.schedule(
      duet,
      this.position,
      this.transport.cycle,
      this.transport.held,
    );
    const browserNotes = this.midi.duet.connected ? reference : notes;
    this.audio.schedule(
      browserNotes,
      this.transport,
      browserNotes.length > 0 || (!this.midi.duet.connected && next.length > 0),
      this.pedals,
      this.midi.duet.connected
        ? reference
        : next === duet
          ? notes
          : withReference(next),
    );
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
      // Only presses during playback that counts keep practice time going;
      // one made while paused or in Listen would credit idle time after. The
      // press's own time counts, not a late delivery's.
      if (
        wasPlaying &&
        this.settings.mode !== "listen" &&
        event >= this.scoringEpoch
      )
        this.lastKeyAt = Math.max(this.lastKeyAt, event);
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
          this.transport.resume(this.position, now);
          this.notice = "";
          if (this.duetNotes.length) {
            // Held duet notes end where they are written from here, and its
            // notes at this gate sound with the student's key.
            this.audio.reschedule(this.transport);
            this.scheduleAudio();
          }
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
}
