import type { Note } from "./song";

/** Closing an unplugged port can reject; the port is dropped either way. */
export function closeOutput(port: MIDIOutput) {
  void port.close().catch(() => {});
}

/** Teacher-only output, on the student piano’s MIDI channel; never echoes or scores student input. */
export class MidiDuet {
  private port?: MIDIOutput;
  private active = new Map<string, Note>();
  private started = new Set<string>();
  /** Attacks crossed last tick that waited behind an earlier one on their pitch. */
  private deferred = new Set<string>();
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
   * Follow another input channel. Sounding teacher notes end on the old one:
   * striking them again on the new one would add attacks the book never wrote,
   * and some of them may already be over by now.
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
    if (port === this.port) {
      this.outputGeneration++;
      return;
    }
    this.stop();
    const previous = this.port;
    this.port = port;
    this.outputGeneration++;
    if (previous) closeOutput(previous);
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
  /** Silence current keys without replaying earlier attacks when Listen continues. */
  silence() {
    const pitches = new Set([...this.active.values()].map((n) => n.pitch));
    this.active.clear();
    for (const pitch of pitches) this.noteOff(pitch);
  }
  stop() {
    this.silence();
    this.started.clear();
    this.deferred.clear();
    this.position = undefined;
    this.cycle = -1;
  }
  /** Process every attack crossed by the clock, including notes shorter than a tick. */
  schedule(
    notes: readonly Note[],
    position: number,
    cycle: number,
    held: boolean,
    passStart = position,
  ) {
    if (!this.port) return;
    if (cycle !== this.cycle) {
      this.stop();
      this.cycle = cycle;
      this.position = passStart;
    }
    const from = this.position ?? passStart;
    const events: { time: number; on: boolean; note: Note }[] = [];
    const releases = (n: Note) =>
      n.soundEnd < position - 1e-9 || (!held && n.soundEnd <= position);
    for (const note of this.active.values()) {
      if (releases(note))
        events.push({ time: Math.max(from, note.soundEnd), on: false, note });
    }
    const due = notes
      .filter((n) => !this.started.has(n.id) && n.start <= position)
      .sort((a, b) => a.start - b.start);
    /** Each pitch's attack this tick, by its start. */
    const struck = new Map<number, number>();
    const deferred = new Set<string>();
    for (const note of due) {
      // Seeking restores held notes, but does not replay already-finished
      // notes; a note that waited last tick is not one of those.
      const finished =
        note.start < from &&
        note.soundEnd <= from &&
        !this.deferred.has(note.id);
      if (note.soundEnd <= note.start || finished) {
        this.started.add(note.id);
        continue;
      }
      // One attack per pitch per tick: a later one waits for the next tick,
      // so the earlier note sounds rather than being cut off at once.
      const first = struck.get(note.pitch);
      if (first !== undefined && Math.abs(first - note.start) > 1e-6) {
        deferred.add(note.id);
        continue;
      }
      struck.set(note.pitch, note.start);
      this.started.add(note.id);
      // Its release waits for a later tick: a note crossed whole between two
      // ticks still sounds for a tick, not as a zero-length on/off pair.
      events.push({ time: Math.max(from, note.start), on: true, note });
    }
    this.deferred = deferred;
    events.sort((a, b) => a.time - b.time || Number(a.on) - Number(b.on));
    for (const { on, note } of events) {
      if (!this.port) return;
      if (!on) {
        if (!this.active.delete(note.id)) continue;
        if (!this.sounding(note.pitch).length) this.noteOff(note.pitch);
        continue;
      }
      const others = this.sounding(note.pitch);
      const unison = others.some(
        (other) => Math.abs(other.start - note.start) < 1e-6,
      );
      if (!unison && others.length) {
        // Retriggering ended these voices: their old tails cannot own the new key.
        for (const old of others) this.active.delete(old.id);
        this.noteOff(note.pitch);
      }
      this.active.set(note.id, note);
      if (!unison && this.port)
        this.send([
          0x90 | this.channel,
          note.pitch,
          Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
        ]);
    }
    this.position = position;
  }
}
