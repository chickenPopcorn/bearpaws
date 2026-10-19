import type { Note } from "./song";

/** Teacher-only output, on the student piano’s MIDI channel; never echoes or scores student input. */
export class MidiDuet {
  private port?: MIDIOutput;
  private active = new Map<string, Note>();
  private cycle = -1;
  private channel = 0;
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
  get connected() {
    return !!this.port;
  }
  constructor(private failed: () => void = () => {}) {}
  setOutput(port?: MIDIOutput) {
    if (port === this.port) return;
    this.stop();
    this.port = port;
  }
  private send(data: number[]) {
    try {
      this.port?.send(data);
    } catch {
      // A disconnected output must not break the practice clock.
      const port = this.port;
      this.port = undefined;
      for (const note of this.active.values()) {
        try {
          port?.send([0x80 | this.channel, note.pitch, 0]);
        } catch {
          /* Port is gone. */
        }
      }
      this.active.clear();
      this.failed();
    }
  }
  stop() {
    for (const pitch of new Set([...this.active.values()].map((n) => n.pitch)))
      this.send([0x80 | this.channel, pitch, 0]);
    this.active.clear();
    this.cycle = -1;
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
      if (![...this.active.values()].some((other) => other.pitch === n.pitch))
        this.send([0x80 | this.channel, n.pitch, 0]);
    }
    for (const [id, n] of wanted) {
      if (!this.port) break;
      if (this.active.has(id)) continue;
      const sounding = [...this.active.values()].some(
        (other) => other.pitch === n.pitch,
      );
      this.active.set(id, n);
      if (!sounding)
        this.send([
          0x90 | this.channel,
          n.pitch,
          Math.max(1, Math.min(127, Math.round(n.velocity * 127))),
        ]);
    }
  }
}
