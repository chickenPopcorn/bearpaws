import type { Note } from "./song";

/** Closing an unplugged port can reject; the port is dropped either way. */
export function closeOutput(port: MIDIOutput) {
  void port.close().catch(() => {});
}

/** Teacher-only output, on the student piano’s MIDI channel; never echoes or scores student input. */
export class MidiDuet {
  private port?: MIDIOutput;
  private active = new Map<string, Note>();
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
    this.stop();
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
  stop() {
    const pitches = new Set([...this.active.values()].map((n) => n.pitch));
    this.active.clear();
    this.cycle = -1;
    for (const pitch of pitches) this.noteOff(pitch);
  }
  /** Called on the same 20 ms practice clock as the score, never ahead of a Wait gate. */
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
    const wanted = new Map(
      notes
        .filter((n) => n.start <= position && n.soundEnd > position)
        .map((n) => [n.id, n]),
    );
    // At a gate, keep the chord ringing until the student releases the gate.
    if (held) for (const [id, n] of this.active) wanted.set(id, n);
    for (const [id, n] of this.active) {
      if (wanted.has(id)) continue;
      this.active.delete(id);
      // An overlapping note of the same pitch still owns the key.
      if (!this.sounding(n.pitch).length) this.noteOff(n.pitch);
    }
    for (const [id, n] of wanted) {
      // A failed send has dropped the output.
      if (!this.port) return;
      if (this.active.has(id)) continue;
      const others = this.sounding(n.pitch);
      this.active.set(id, n);
      // A unison in another voice shares the key already struck with it.
      if (others.some((other) => Math.abs(other.start - n.start) < 1e-6))
        continue;
      // A new attack on a sounding pitch restarts it, as a pianist would.
      if (others.length) {
        this.noteOff(n.pitch);
        if (!this.port) return;
      }
      this.send([
        0x90 | this.channel,
        n.pitch,
        Math.max(1, Math.min(127, Math.round(n.velocity * 127))),
      ]);
    }
  }
}
