import type { Note } from "./song";

/** Closing an unplugged port can reject; the port is dropped either way. */
export function closeOutput(port: MIDIOutput) {
  void port.close().catch(() => {});
}

/** Teacher-only output, on the student piano’s MIDI channel; never echoes or scores student input. */
export class MidiDuet {
  private port?: MIDIOutput;
  private active = new Map<
    string,
    { note: Note; cycle: number; tick: number }
  >();
  private pending: { note: Note; cycle: number }[] = [];
  private attacks = new Map<number, number>();
  private tick = 0;
  private finishing = false;
  private started = new Set<string>();
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
    return [...this.active.entries()].filter(
      ([, voice]) => voice.note.pitch === pitch,
    );
  }
  /** Silence current keys without replaying earlier attacks when Listen continues. */
  silence() {
    const pitches = new Set(
      [...this.active.values()].map((voice) => voice.note.pitch),
    );
    this.active.clear();
    for (const pitch of pitches) this.noteOff(pitch);
  }
  stop() {
    this.silence();
    this.started.clear();
    this.pending = [];
    this.attacks.clear();
    this.finishing = false;
    this.position = undefined;
    this.cycle = -1;
  }
  /** Drain a final crossed attack on subsequent practice ticks. */
  finish() {
    this.finishing = true;
  }
  pulse(tick = ++this.tick) {
    this.tick = tick;
    if (this.finishing) this.drain(Infinity, false, tick);
  }
  private drain(position: number, held: boolean, tick: number) {
    for (const [key, voice] of this.active) {
      const { note, cycle } = voice;
      if (voice.tick >= tick) continue;
      if (
        cycle !== this.cycle ||
        note.soundEnd < position - 1e-9 ||
        (!held && note.soundEnd <= position)
      ) {
        this.active.delete(key);
        if (!this.sounding(note.pitch).length) this.noteOff(note.pitch);
      }
    }
    const remaining: typeof this.pending = [];
    const groups = new Map<number, { cycle: number; start: number }>();
    for (const entry of this.pending) {
      if (!this.port) break;
      const { note, cycle } = entry;
      const group = groups.get(note.pitch);
      const unison =
        group?.cycle === cycle && Math.abs(group.start - note.start) < 1e-6;
      if (!unison && this.attacks.get(note.pitch) === tick) {
        remaining.push(entry);
        continue;
      }
      if (!unison) {
        const others = this.sounding(note.pitch);
        if (others.length) {
          for (const [key] of others) this.active.delete(key);
          this.noteOff(note.pitch);
        }
        groups.set(note.pitch, { cycle, start: note.start });
        this.attacks.set(note.pitch, tick);
      }
      this.active.set(`${cycle}:${note.id}`, { note, cycle, tick });
      if (!unison)
        this.send([
          0x90 | this.channel,
          note.pitch,
          Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
        ]);
    }
    this.pending = this.port ? remaining : [];
  }
  /** Process crossed attacks on the practice clock, including across loop wraps. */
  schedule(
    notes: readonly Note[],
    position: number,
    cycle: number,
    held: boolean,
    passStart = position,
    tick = ++this.tick,
  ) {
    this.tick = tick;
    if (!this.port) return;
    if (cycle !== this.cycle) {
      // Keep old-pass attacks until each has had a tick to sound. Explicit
      // pause/seek still calls stop and cancels them immediately.
      this.started.clear();
      this.cycle = cycle;
      this.position = passStart;
    }
    const from = this.position ?? passStart;
    const due = notes
      .filter((n) => !this.started.has(n.id) && n.start <= position)
      .sort((a, b) => a.start - b.start);
    for (const note of due) {
      this.started.add(note.id);
      if (
        note.soundEnd <= note.start ||
        (note.start < from && note.soundEnd <= from)
      )
        continue;
      this.pending.push({ note, cycle });
    }
    this.drain(position, held, tick);
    this.position = position;
  }
}
