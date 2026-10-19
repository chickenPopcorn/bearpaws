import type { Note } from "./song";

// Web MIDI defines clear(), but the pinned TypeScript DOM library omits it.
export type QueuedMidiOutput = MIDIOutput & { clear(): void };

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
  private clock: number | undefined;
  private lastEventAt = 0;
  /** Releases still queued in the device; Infinity means its key remains down. */
  private releases = new Map<number, number>();
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
    this.clearQueue();
    for (const pitch of new Set([
      ...this.releases.keys(),
      ...sounding.map((n) => n.pitch),
    ]))
      this.noteOff(pitch);
    this.releases.clear();
    this.clock = performance.now();
    this.lastEventAt = this.clock;
    this.channel = channel;
    for (const pitch of new Set(sounding.map((n) => n.pitch))) {
      if (!this.port) break;
      const note = sounding.find((n) => n.pitch === pitch)!;
      this.noteOn(note);
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
  private send(data: number[], at?: number) {
    const port = this.port;
    const generation = this.outputGeneration;
    if (!port) return;
    try {
      this.lastEventAt = Math.max(this.lastEventAt, at ?? performance.now());
      if (at !== undefined && at > performance.now()) port.send(data, at);
      else port.send(data);
    } catch {
      // An unplugged output must not break the practice clock. It can take
      // no note-offs either, so its notes are simply forgotten.
      this.port = undefined;
      this.active.clear();
      this.releases.clear();
      this.cycle = -1;
      try {
        (port as QueuedMidiOutput).clear();
      } catch {
        /* Already disconnected. */
      }
      closeOutput(port);
      // Report after the tick that is still scheduling.
      queueMicrotask(() => {
        if (this.outputGeneration === generation) this.lost();
      });
    }
  }
  private clearQueue() {
    try {
      (this.port as QueuedMidiOutput | undefined)?.clear();
    } catch {
      /* Already disconnected. */
    }
  }
  private pruneReleases(now: number) {
    for (const [pitch, end] of this.releases)
      if (end <= now) this.releases.delete(pitch);
  }
  private noteOff(pitch: number, at?: number) {
    if (at !== undefined && at > performance.now())
      this.releases.set(pitch, at);
    else this.releases.delete(pitch);
    this.send([0x80 | this.channel, pitch, 0], at);
  }
  private noteOn(note: Note, at?: number) {
    this.releases.set(note.pitch, Infinity);
    this.send(
      [
        0x90 | this.channel,
        note.pitch,
        Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
      ],
      at,
    );
  }
  private sounding(pitch: number) {
    return [...this.active.values()].filter((note) => note.pitch === pitch);
  }
  stop() {
    this.pruneReleases(performance.now());
    const pitches = new Set([
      ...this.releases.keys(),
      ...[...this.active.values()].map((n) => n.pitch),
    ]);
    this.clearQueue();
    this.active.clear();
    this.releases.clear();
    this.clock = undefined;
    this.lastEventAt = 0;
    this.started.clear();
    this.position = undefined;
    this.cycle = -1;
    for (const pitch of pitches) this.noteOff(pitch);
  }
  /** Natural completion lets timestamped final notes finish; explicit stop cancels them. */
  finish() {
    const at = Math.max(performance.now(), this.lastEventAt);
    for (const pitch of new Set([...this.active.values()].map((n) => n.pitch)))
      this.noteOff(pitch, at);
    this.active.clear();
    this.started.clear();
    this.position = undefined;
    this.clock = undefined;
    this.cycle = -1;
  }
  /** Process every attack crossed by the clock, including notes shorter than a tick. */
  schedule(
    notes: readonly Note[],
    position: number,
    cycle: number,
    held: boolean,
    passStart = position,
    speed = 1,
  ) {
    if (!this.port) return;
    let now = performance.now();
    this.pruneReleases(now);
    if (cycle !== this.cycle) {
      if (this.cycle >= 0) {
        // A loop boundary follows the queued tail of the previous pass.
        const boundary = Math.max(now, this.lastEventAt);
        for (const pitch of new Set(
          [...this.active.values()].map((n) => n.pitch),
        ))
          this.noteOff(pitch, boundary);
        this.clock = boundary;
      }
      this.active.clear();
      this.started.clear();
      this.cycle = cycle;
      this.position = passStart;
    }
    const from = this.position ?? passStart;
    const milliseconds = 1000 / Math.max(0.01, speed);
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
    // Building a large catch-up batch must not consume its playback duration.
    now = performance.now();
    let base = this.clock ?? now - (position - from) * milliseconds;
    if (events.length) {
      // Move an overdue batch together, preserving every note's duration.
      const first = base + (events[0].time - from) * milliseconds;
      base += Math.max(0, now - first);
    }
    for (const { on, note, time } of events) {
      const at = Math.max(now, base + (time - from) * milliseconds);
      if (!this.port) return;
      if (!on) {
        if (!this.active.delete(note.id)) continue;
        if (!this.sounding(note.pitch).length) this.noteOff(note.pitch, at);
        continue;
      }
      const others = this.sounding(note.pitch);
      const unison = others.some(
        (other) => Math.abs(other.start - note.start) < 1e-6,
      );
      if (!unison && others.length) {
        // Retriggering ended these voices: their old tails cannot own the new key.
        for (const old of others) this.active.delete(old.id);
        this.noteOff(note.pitch, at);
      }
      this.active.set(note.id, note);
      if (!unison && this.port) this.noteOn(note, at);
    }
    this.position = position;
    this.clock = base + (position - from) * milliseconds;
    if (held || !this.active.size) {
      this.clock = Math.max(now, this.lastEventAt);
    }
  }
}
