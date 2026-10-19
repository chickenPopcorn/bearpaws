import type { Note, PedalSpan } from "./song";

/** Closing an unplugged port can reject; the port is dropped either way. */
export function closeOutput(port: MIDIOutput) {
  void port.close().catch(() => {});
}

const NO_PEDALS: readonly PedalSpan[] = [];
const velocity = (value: number) =>
  Math.max(1, Math.min(127, Math.round(value * 127)));

/**
 * The app's sound on a MIDI output, on the student piano’s MIDI channel: the
 * notes playback gives it, their sustain pedal, and keys played on screen. It
 * never echoes or scores the student's own key presses.
 *
 * It follows the 20 ms practice clock: each tick releases the notes the clock
 * has passed and strikes the ones it has reached. A tick that runs late still
 * strikes the notes it passed, so they sound for a tick.
 */
export class MidiPlayer {
  private port?: MIDIOutput;
  /** The notes sounding now, by id. */
  private active = new Map<string, Note>();
  /** Keys held down on screen or on the computer keyboard, by pitch. */
  private keys = new Set<number>();
  /** The notes struck this pass, so none is struck twice. */
  private played = new Set<string>();
  /** Whether the sustain pedal is down on the output. */
  private pedal = false;
  /** This pass's last tick, or undefined before its first. */
  private position: number | undefined;
  private cycle = -1;
  private channel = 0;
  private outputGeneration = 0;
  /** `lost` hears that the output stopped accepting notes. */
  constructor(private lost: () => void = () => {}) {}
  get connected() {
    return !!this.port;
  }
  /**
   * Follow another input channel. Sounding notes end on the old one: striking
   * them again on the new one would add attacks the book never wrote. The
   * pedal goes down again on the new one at the next tick.
   */
  setChannel(channel: number) {
    if (
      !Number.isInteger(channel) ||
      channel < 0 ||
      channel > 15 ||
      channel === this.channel
    )
      return;
    this.silence();
    this.channel = channel;
  }
  /** Silence and close the current output, then play on `port`, if any. */
  setOutput(port?: MIDIOutput) {
    if (port !== this.port) {
      this.stop();
      const previous = this.port;
      this.port = port;
      if (previous) closeOutput(previous);
    }
    // A new choice supersedes any loss report still pending (see send()),
    // including one from releasing the old output just now.
    this.outputGeneration++;
  }
  private send(data: number[]) {
    const port = this.port;
    const generation = this.outputGeneration;
    if (!port) return;
    try {
      port.send(data);
    } catch {
      // An unplugged output must not break the practice clock. It can take
      // no note-offs either, so its notes, keys and pedal are simply forgotten.
      this.port = undefined;
      this.active.clear();
      this.keys.clear();
      this.pedal = false;
      this.cycle = -1;
      closeOutput(port);
      // Report after the tick that is still scheduling.
      queueMicrotask(() => {
        if (this.outputGeneration === generation) this.lost();
      });
    }
  }
  private noteOff(pitch: number) {
    this.send([0x80 | this.channel, pitch, 0]);
  }
  private sounding(pitch: number) {
    return [...this.active.values()].filter((note) => note.pitch === pitch);
  }
  /** Release `pitch`, unless another note or a held key still sounds it. */
  private release(pitch: number) {
    if (!this.keys.has(pitch) && !this.sounding(pitch).length)
      this.noteOff(pitch);
  }
  /**
   * Strike `pitch`. A new attack on a sounding pitch restarts it, as a
   * pianist would, and the note or key that sounded it no longer owns it.
   */
  private strike(pitch: number, value: number) {
    const others = this.sounding(pitch);
    if (others.length || this.keys.has(pitch)) {
      for (const old of others) this.active.delete(old.id);
      this.keys.delete(pitch);
      this.noteOff(pitch);
    }
    this.send([0x90 | this.channel, pitch, velocity(value)]);
  }
  private setPedal(down: boolean) {
    if (down === this.pedal) return;
    this.pedal = down;
    this.send([0xb0 | this.channel, 64, down ? 127 : 0]);
  }
  /**
   * A key pressed on screen or on the computer keyboard, at velocity `value`
   * from 0 to 1. It sounds until it comes up.
   */
  keyDown(pitch: number, value: number) {
    if (!this.port) return;
    this.strike(pitch, value);
    this.keys.add(pitch);
  }
  keyUp(pitch: number) {
    if (this.keys.delete(pitch)) this.release(pitch);
  }
  /**
   * Release every sounding note and key, and lift the pedal. Notes already
   * played this pass stay played, so when an input reset lets Listen continue
   * they are not struck again.
   */
  silence() {
    const pitches = new Set([...this.active.values()].map((n) => n.pitch));
    for (const pitch of this.keys) pitches.add(pitch);
    this.active.clear();
    this.keys.clear();
    for (const pitch of pitches) this.noteOff(pitch);
    this.setPedal(false);
  }
  /** Release everything and start over, as for a pause, seek or new pass. */
  stop() {
    this.silence();
    this.played.clear();
    this.position = undefined;
    this.cycle = -1;
  }
  /**
   * One practice tick at song `position`. `cycle` changes with each loop pass
   * or seek; `held` is true while a Wait gate holds the music. `pedals` is the
   * song's sustain pedal: presses on the channels of `notes` go out as CC64.
   */
  schedule(
    notes: readonly Note[],
    position: number,
    cycle: number,
    held: boolean,
    pedals: readonly PedalSpan[] = NO_PEDALS,
  ) {
    if (!this.port) return;
    if (cycle !== this.cycle) {
      this.stop();
      this.cycle = cycle;
    }
    // At a gate the player holds what sounds through it until the student
    // plays; a note that ended before the gate still ends. Releases come
    // before this tick's attacks, so a note always sounds for a tick.
    for (const [id, note] of this.active) {
      if (note.soundEnd > position || (held && note.soundEnd > position - 1e-6))
        continue;
      this.active.delete(id);
      this.release(note.pitch);
    }
    // The pedal changes before this tick's attacks, so notes struck as it
    // goes down are under it. Notes still end where their sound does, as on
    // the laptop; the pedal adds the piano's own resonance.
    this.setPedal(this.pedalDown(notes, pedals, position, held));
    const from = this.position;
    this.position = position;
    // In time order, so a later attack on a pitch always wins its key.
    const due = notes
      .filter(
        (n) =>
          !this.played.has(n.id) &&
          n.start <= position &&
          n.soundEnd > n.start &&
          // Notes the clock is inside, and notes a late tick passed whole.
          // A seek or new pass (no last tick) does not replay finished notes.
          (n.soundEnd > position || (from !== undefined && n.start > from)),
      )
      .sort((a, b) => a.start - b.start);
    for (const note of due) {
      if (!this.port) return;
      this.played.add(note.id);
      // A unison shares the key already struck for it.
      if (
        !this.sounding(note.pitch).some(
          (other) => Math.abs(other.start - note.start) < 1e-6,
        )
      )
        this.strike(note.pitch, note.velocity);
      this.active.set(note.id, note);
    }
  }
  /**
   * Whether a press on one of the notes' channels holds the pedal down at
   * `position`. Like the notes, one that lifts at a Wait gate holds through it,
   * and one still down where the song ends stays down.
   */
  private pedalDown(
    notes: readonly Note[],
    pedals: readonly PedalSpan[],
    position: number,
    held: boolean,
  ) {
    if (!pedals.length) return false;
    const channels = new Set(notes.map((note) => note.channel));
    return pedals.some(
      (span) =>
        channels.has(span.channel) &&
        span.start <= position &&
        (span.open ||
          span.end > position ||
          (held && span.end > position - 1e-6)),
    );
  }
}
