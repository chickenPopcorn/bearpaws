import type { Note } from "./song";

/** Closing an unplugged port can reject; the port is dropped either way. */
export function closeOutput(port: MIDIOutput) {
  void port.close().catch(() => {});
}

/**
 * Teacher-only output, on the student piano’s MIDI channel; never echoes or
 * scores student input.
 *
 * It follows the 20 ms practice clock: each tick strikes the teacher notes
 * the clock is inside and releases the ones it has passed. Every teacher note
 * in the library lasts longer than a tick even at the fastest speed, so the
 * clock lands inside each one.
 */
export class MidiDuet {
  private port?: MIDIOutput;
  /** The notes sounding now, by id. */
  private active = new Map<string, Note>();
  /** The notes struck this pass, so none is struck twice. */
  private played = new Set<string>();
  private cycle = -1;
  private channel = 0;
  private outputGeneration = 0;
  /** `lost` hears that the output stopped accepting notes. */
  constructor(private lost: () => void = () => {}) {}
  get connected() {
    return !!this.port;
  }
  /**
   * Follow another input channel. Sounding teacher notes end on the old one:
   * striking them again on the new one would add attacks the book never wrote.
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
      // no note-offs either, so its notes are simply forgotten.
      this.port = undefined;
      this.active.clear();
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
  /**
   * Release every sounding note. Notes already played this pass stay played,
   * so when an input reset lets Listen continue they are not struck again.
   */
  silence() {
    const pitches = new Set([...this.active.values()].map((n) => n.pitch));
    this.active.clear();
    for (const pitch of pitches) this.noteOff(pitch);
  }
  /** Release everything and start over, as for a pause, seek or new pass. */
  stop() {
    this.silence();
    this.played.clear();
    this.cycle = -1;
  }
  /**
   * One practice tick at song `position`. `cycle` changes with each loop pass
   * or seek; `held` is true while a Wait gate holds the music.
   */
  schedule(
    notes: readonly Note[],
    position: number,
    cycle: number,
    held: boolean,
  ) {
    if (!this.port) return;
    if (cycle !== this.cycle) {
      this.stop();
      this.cycle = cycle;
    }
    // At a gate the teacher holds what is sounding until the student plays.
    // Releases come before this tick's attacks, so a note always sounds for
    // at least one tick.
    if (!held)
      for (const [id, note] of this.active) {
        if (note.soundEnd > position) continue;
        this.active.delete(id);
        if (!this.sounding(note.pitch).length) this.noteOff(note.pitch);
      }
    for (const note of notes) {
      if (!this.port) return;
      if (this.played.has(note.id)) continue;
      if (note.start > position || note.soundEnd <= position) continue;
      this.played.add(note.id);
      const others = this.sounding(note.pitch);
      this.active.set(note.id, note);
      // A unison shares the key already struck for it.
      if (others.some((other) => Math.abs(other.start - note.start) < 1e-6))
        continue;
      // A new attack on a sounding pitch restarts it, as a pianist would, and
      // the earlier note no longer owns the key.
      if (others.length) {
        for (const old of others) this.active.delete(old.id);
        this.noteOff(note.pitch);
      }
      this.send([
        0x90 | this.channel,
        note.pitch,
        Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
      ]);
    }
  }
}
