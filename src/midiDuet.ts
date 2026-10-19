import type { Note } from "./song";

/** Closing an unplugged port can reject; the port is dropped either way. */
export function closeOutput(port: MIDIOutput) {
  void port.close().catch(() => {});
}
interface Message {
  at: number;
  data: number[];
  order: number;
}

/** Teacher-only output. Delayed messages stay in our cancellable queue, not the device. */
export class MidiDuet {
  private port?: MIDIOutput;
  private active = new Map<string, Note>();
  private started = new Set<string>();
  private sounding = new Map<number, number>();
  private position: number | undefined;
  private clock: number | undefined;
  private cycle = -1;
  private channel = 0;
  private generation = 0;
  private queue: Message[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private order = 0;
  private lastAt = 0;
  private batching = false;
  private finishing = false;
  constructor(private lost: () => void = () => {}) {}
  get connected() {
    return !!this.port;
  }
  get channelNumber() {
    return this.channel;
  }

  /** The caller advances the practice clock first, so expired notes cannot transfer. */
  setChannel(channel: number) {
    if (
      !Number.isInteger(channel) ||
      channel < 0 ||
      channel > 15 ||
      channel === this.channel
    )
      return;
    const notes = [...this.active.values()].filter(
      (n) => n.soundEnd > (this.position ?? -Infinity),
    );
    this.silence();
    this.channel = channel;
    for (const note of notes) {
      const unison = [...this.active.values()].some(
        (n) => n.pitch === note.pitch,
      );
      this.active.set(note.id, note);
      if (!unison) this.noteOn(note);
    }
  }
  setOutput(port?: MIDIOutput) {
    if (port === this.port) {
      this.generation++;
      return;
    }
    this.stop();
    const previous = this.port;
    this.port = port;
    this.generation++;
    if (previous) closeOutput(previous);
  }
  private clearQueue() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
  }
  private write(data: number[]) {
    const port = this.port,
      generation = this.generation;
    if (!port) return;
    try {
      // No future timestamps: Chrome has no MIDIOutput.clear().
      port.send(data);
      if ((data[0] & 0xf0) === 0x90 && data[2] > 0)
        this.sounding.set(data[1], data[2]);
      else if ((data[0] & 0xf0) === 0x80) this.sounding.delete(data[1]);
    } catch {
      this.clearQueue();
      this.port = undefined;
      this.active.clear();
      this.sounding.clear();
      this.cycle = -1;
      closeOutput(port);
      queueMicrotask(() => {
        if (this.generation === generation) this.lost();
      });
    }
  }
  private send(data: number[], at = performance.now()) {
    if (!this.port) return;
    this.lastAt = Math.max(this.lastAt, at);
    if (at <= performance.now() && !this.queue.length) this.write(data);
    else {
      this.queue.push({ data, at, order: this.order++ });
      if (!this.batching) this.arm();
    }
  }
  private arm() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.queue.length || !this.port) return;
    this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
    this.timer = setTimeout(
      () => this.pump(),
      Math.max(0, this.queue[0].at - performance.now()),
    );
  }
  private pump() {
    this.timer = undefined;
    if (!this.queue.length || !this.port) return;
    const now = performance.now(),
      due = this.queue[0].at;
    if (now < due) {
      this.arm();
      return;
    }
    // A stalled callback must not collapse several past notes into one burst.
    const delay = now - due;
    if (delay > 0) {
      for (const message of this.queue) message.at += delay;
      if (this.clock !== undefined) this.clock += delay;
      this.lastAt += delay;
    }
    while (this.queue.length && this.queue[0].at <= now + 1e-6) {
      const message = this.queue.shift()!;
      this.write(message.data);
      if (!this.port) return;
    }
    if (this.finishing && !this.queue.length) {
      this.stop();
      return;
    }
    this.arm();
  }
  private noteOff(pitch: number, at?: number) {
    this.send([0x80 | this.channel, pitch, 0], at);
  }
  private noteOn(note: Note, at?: number) {
    this.send(
      [
        0x90 | this.channel,
        note.pitch,
        Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
      ],
      at,
    );
  }
  private owners(pitch: number) {
    return [...this.active.values()].filter((n) => n.pitch === pitch);
  }

  /** Silence an input reset without replaying the passage's earlier notes. */
  silence() {
    this.clearQueue();
    this.active.clear();
    const pitches = [...this.sounding.keys()];
    for (const pitch of pitches) this.noteOff(pitch);
    this.clock = performance.now();
    this.lastAt = this.clock;
    this.finishing = false;
  }
  stop() {
    this.silence();
    this.started.clear();
    this.position = undefined;
    this.clock = undefined;
    this.cycle = -1;
  }
  /** Let the final queued notes finish, but keep explicit pause/seek cancellable. */
  finish() {
    const at = Math.max(performance.now(), this.lastAt);
    for (const pitch of new Set([...this.active.values()].map((n) => n.pitch)))
      this.noteOff(pitch, at);
    this.active.clear();
    this.finishing = true;
    if (!this.queue.length) this.stop();
  }
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
    this.finishing = false;
    if (cycle !== this.cycle) {
      if (this.cycle >= 0) {
        const boundary = Math.max(now, this.lastAt);
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
    const from = this.position ?? passStart,
      milliseconds = 1000 / Math.max(0.01, speed);
    const events: { time: number; on: boolean; note: Note }[] = [];
    const releases = (n: Note) =>
      n.soundEnd < position - 1e-9 || (!held && n.soundEnd <= position);
    for (const note of this.active.values())
      if (releases(note))
        events.push({ time: Math.max(from, note.soundEnd), on: false, note });
    for (const note of notes) {
      if (this.started.has(note.id) || note.start > position) continue;
      this.started.add(note.id);
      if (
        note.soundEnd <= note.start ||
        (note.start < from && note.soundEnd <= from)
      )
        continue;
      events.push({ time: Math.max(from, note.start), on: true, note });
      if (releases(note))
        events.push({ time: Math.max(from, note.soundEnd), on: false, note });
    }
    events.sort((a, b) => a.time - b.time || Number(a.on) - Number(b.on));
    now = performance.now();
    let base = this.clock ?? now - (position - from) * milliseconds;
    if (events.length)
      base += Math.max(
        0,
        now - (base + (events[0].time - from) * milliseconds),
      );
    this.batching = true;
    try {
      for (const { time, on, note } of events) {
        if (!this.port) return;
        const at = Math.max(now, base + (time - from) * milliseconds);
        if (!on) {
          if (!this.active.delete(note.id)) continue;
          if (!this.owners(note.pitch).length) this.noteOff(note.pitch, at);
        } else {
          const others = this.owners(note.pitch);
          const unison = others.some(
            (n) => Math.abs(n.start - note.start) < 1e-6,
          );
          if (!unison && others.length) {
            for (const old of others) this.active.delete(old.id);
            this.noteOff(note.pitch, at);
          }
          this.active.set(note.id, note);
          if (!unison) this.noteOn(note, at);
        }
      }
      this.position = position;
      this.clock = base + (position - from) * milliseconds;
      if (held || !this.active.size) this.clock = Math.max(now, this.lastAt);
    } finally {
      this.batching = false;
      this.arm();
    }
  }
}
