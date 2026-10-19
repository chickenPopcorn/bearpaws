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
  private position: number | undefined;
  private cycle = -1;
  private channel = 0;
  private outputGeneration = 0;
  /** `lost` hears that the output stopped accepting notes. */
  constructor(private lost: () => void = () => {}) {}
  get connected() {
    return !!this.port;
  }
  /** Release on the old channel before following another input channel. */
  setChannel(channel: number) {
    if (
      !Number.isInteger(channel) ||
      channel < 0 ||
      channel > 15 ||
      channel === this.channel
    )
      return;
    const sounding = [...this.active.values()];
    for (const pitch of new Set(sounding.map((n) => n.pitch)))
      this.noteOff(pitch);
    this.channel = channel;
    for (const pitch of new Set(sounding.map((n) => n.pitch))) {
      if (!this.port) break;
      const note = sounding.find((n) => n.pitch === pitch)!;
      this.send([
        0x90 | this.channel,
        pitch,
        Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
      ]);
    }
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
  stop() {
    const pitches = new Set([...this.active.values()].map((n) => n.pitch));
    this.active.clear();
    this.started.clear();
    this.position = undefined;
    this.cycle = -1;
    for (const pitch of pitches) this.noteOff(pitch);
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
    for (const note of notes) {
      if (this.started.has(note.id) || note.start > position) continue;
      this.started.add(note.id);
      if (note.soundEnd <= note.start) continue;
      // Seeking restores held notes, but does not replay already-finished notes.
      if (note.start < from && note.soundEnd <= from) continue;
      events.push({ time: Math.max(from, note.start), on: true, note });
      if (releases(note))
        events.push({ time: Math.max(from, note.soundEnd), on: false, note });
    }
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
