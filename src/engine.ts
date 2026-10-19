import type { Note } from "./song";
export type Mode = "listen" | "wait" | "rhythm";
// Keep inclusive timing windows stable after converting song time to wall time.
export const TIMING_EPSILON = 1e-6;
/** Speed slider range and step, in percent of the written tempo. */
export const SPEED_PERCENT = { min: 20, max: 140, step: 20 };
export interface Group {
  start: number;
  notes: Note[];
}
export function chords(notes: Note[]): Group[] {
  const groups: Group[] = [];
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    const last = groups.at(-1);
    if (last && Math.abs(last.start - n.start) < 0.001) last.notes.push(n);
    else groups.push({ start: n.start, notes: [n] });
  }
  return groups;
}
export class Transport {
  position = 0;
  speed = 1;
  playing = false;
  held = false;
  anchor = 0;
  duration: number;
  loop: [number, number] | null = null;
  cycle = 0;
  private history: {
    time: number;
    position: number;
    speed: number;
    playing: boolean;
    loop: [number, number] | null;
  }[] = [];
  private record(now: number) {
    if (this.history.at(-1) && this.history.at(-1)!.time > now)
      this.history = [];
    this.history.push({
      time: now,
      position: this.position,
      speed: this.speed,
      playing: this.playing && !this.held,
      loop: this.loop ? [...this.loop] : null,
    });
    if (this.history.length > 256) this.history.shift();
  }
  eventAt(when: number) {
    const h = [...this.history].reverse().find((h) => h.time <= when);
    if (!h) return { position: this.at(when), speed: this.speed };
    let p = h.position + (h.playing ? (when - h.time) * h.speed : 0);
    if (h.loop && p >= h.loop[1])
      p = h.loop[0] + ((p - h.loop[0]) % (h.loop[1] - h.loop[0]));
    return {
      position: Math.max(0, Math.min(this.duration, p)),
      speed: h.speed,
    };
  }
  constructor(duration: number) {
    this.duration = duration;
  }
  raw(now: number) {
    return (
      this.position +
      (this.playing && !this.held ? (now - this.anchor) * this.speed : 0)
    );
  }
  at(now: number) {
    const p = this.raw(now);
    if (this.loop && p >= this.loop[1])
      return (
        this.loop[0] + ((p - this.loop[0]) % (this.loop[1] - this.loop[0]))
      );
    return Math.min(this.duration, Math.max(0, p));
  }
  seek(position: number, now: number) {
    this.held = false;
    this.position = Math.max(0, Math.min(this.duration, position));
    this.anchor = now;
    this.cycle++;
    this.record(now);
  }
  /**
   * Move on from `position` after a Wait gate, in the same pass: unlike
   * seek(), sounding notes are not struck again.
   */
  resume(position: number, now: number) {
    this.held = false;
    this.position = Math.max(0, Math.min(this.duration, position));
    this.anchor = now;
    this.record(now);
  }
  play(now: number) {
    if (this.position >= this.duration) this.seek(this.loop?.[0] || 0, now);
    this.anchor = now;
    this.held = false;
    this.playing = true;
    this.record(now);
  }
  pause(now: number) {
    if (this.playing) this.update(now, this.held ? this.position : undefined);
    this.position = this.at(now);
    this.anchor = now;
    this.held = false;
    this.playing = false;
    this.record(now);
  }
  setSpeed(speed: number, now: number) {
    if (this.playing) this.update(now, this.held ? this.position : undefined);
    this.position = this.at(now);
    this.anchor = now;
    this.speed = Math.min(
      SPEED_PERCENT.max / 100,
      Math.max(SPEED_PERCENT.min / 100, speed),
    );
    this.record(now);
  }
  update(now: number, gate?: number) {
    if (this.held && gate !== this.position) {
      this.held = false;
      this.record(this.anchor);
    }
    let raw = this.raw(now);
    if (gate !== undefined && raw >= gate && gate >= this.position) {
      if (this.position === gate) {
        if (!this.held) {
          this.held = true;
          this.record(this.anchor);
        }
        this.anchor = now;
        return gate;
      }
      const reached = this.anchor + (gate - this.position) / this.speed;
      this.position = gate;
      this.held = true;
      this.anchor = now;
      this.record(reached);
      this.history.at(-1)!.playing = false;
      return gate;
    }
    if (this.loop && raw >= this.loop[1]) {
      this.position = this.at(now);
      this.anchor = now;
      this.cycle++;
      raw = this.position;
    }
    if (gate !== undefined && raw >= gate) {
      this.position = gate;
      this.anchor = now;
      return gate;
    }
    if (raw >= this.duration) {
      this.position = this.duration;
      this.playing = false;
      this.anchor = now;
    }
    return this.at(now);
  }
}
export interface Feedback {
  kind: "hit" | "wrong" | "early" | "late" | "miss";
  pitch: number;
  at: number;
  offset?: number;
}
interface Target {
  note: Note;
  /** Start in the current pass's song time. */
  start: number;
  /** The loop pass the note belongs to, relative to the current one. */
  pass: -1 | 0 | 1;
}
export class Practice {
  notes: Note[];
  groups: Group[];
  loop: [number, number] | null;
  from = 0;
  hit = new Set<string>();
  missed = new Set<string>();
  feedback: Feedback[] = [];
  gateIndex = 0;
  private wrongCount = 0;
  private timingCount = 0;
  private timingAbsTotal = 0;
  private missFeedback: Feedback[] = [];
  // Rhythm presses just before a loop wrap that were early for the next pass.
  private nextHit = new Set<string>();
  private nextFeedback: Feedback[] = [];
  // The previous pass's unscored final notes, which can still be played late.
  private previous: Target[] = [];
  get stats() {
    return {
      wrong: this.wrongCount,
      matched: this.hit.size,
      missed: this.missed.size,
      timingCount: this.timingCount,
      timingAbsTotal: this.timingAbsTotal,
    };
  }
  get recentMisses() {
    return this.missFeedback;
  }
  private recordFeedback(item: Feedback) {
    if (item.kind === "wrong") this.wrongCount++;
    if (item.offset !== undefined) {
      this.timingCount++;
      this.timingAbsTotal += Math.abs(item.offset);
    }
    this.feedback.push(item);
    if (this.feedback.length > 256)
      this.feedback.splice(0, this.feedback.length - 256);
    if (item.kind === "miss") {
      this.missFeedback.push(item);
      if (this.missFeedback.length > 6) this.missFeedback.shift();
    }
  }
  constructor(notes: Note[], loop: [number, number] | null = null) {
    this.notes = notes;
    this.groups = chords(notes);
    this.loop = loop;
  }
  reset(position: number) {
    this.from = position;
    this.hit.clear();
    this.missed.clear();
    this.feedback = [];
    this.missFeedback = [];
    this.wrongCount = this.timingCount = this.timingAbsTotal = 0;
    this.nextHit = new Set();
    this.nextFeedback = [];
    this.previous = [];
    this.gateIndex = this.groups.findIndex((g) => g.start >= position - 0.001);
    if (this.gateIndex < 0) this.gateIndex = this.groups.length;
  }
  /** Start the loop's next pass, keeping Rhythm presses that span the wrap. */
  wrap() {
    const [start, end] = this.loop!;
    const previous = this.notes
      .filter(
        (n) =>
          n.start >= this.from - 0.001 &&
          !this.hit.has(n.id) &&
          !this.missed.has(n.id),
      )
      .map((note) => ({
        note,
        start: note.start - (end - start),
        pass: -1 as const,
      }));
    const nextHit = this.nextHit,
      nextFeedback = this.nextFeedback;
    this.reset(start);
    this.previous = previous;
    for (const id of nextHit) this.hit.add(id);
    for (const item of nextFeedback) this.recordFeedback(item);
  }
  /** Unscored Rhythm notes of this pitch, in the current pass's song time. */
  private targets(pitch: number): Target[] {
    const current = this.notes
      .filter(
        (n) =>
          n.start >= this.from - 0.001 &&
          n.pitch === pitch &&
          !this.hit.has(n.id),
      )
      .map((note) => ({ note, start: note.start, pass: 0 as const }));
    if (!this.loop) return current;
    // The timing window spans the wrap: a press just after it can be late for
    // the previous pass's last notes, and one just before it can be early for
    // the next pass's first notes.
    const length = this.loop[1] - this.loop[0];
    return [
      ...this.previous.filter((t) => t.note.pitch === pitch),
      ...current,
      ...this.notes
        .filter((n) => n.pitch === pitch && !this.nextHit.has(n.id))
        .map((note) => ({
          note,
          start: note.start + length,
          pass: 1 as const,
        })),
    ];
  }
  get gate() {
    return this.groups[this.gateIndex];
  }
  input(
    pitch: number,
    position: number,
    mode: Mode,
    tolerance: number,
    speed: number,
    physical: Set<number>,
  ) {
    if (mode === "listen") return;
    if (mode === "wait") {
      const gate = this.gate;
      if (
        !gate ||
        Math.abs(position - gate.start) / speed > tolerance + TIMING_EPSILON
      )
        return;
      const expected = gate.notes.filter((n) => n.pitch === pitch);
      if (!expected.length) {
        this.recordFeedback({ kind: "wrong", pitch, at: position });
        return;
      }
      for (const n of expected) this.hit.add(n.id);
      // Every chord pitch must be physically down at completion. Pedal cannot fill a chord.
      if (
        gate.notes.every((n) => this.hit.has(n.id) && physical.has(n.pitch))
      ) {
        this.recordFeedback({ kind: "hit", pitch, at: position });
        this.gateIndex++;
        return true;
      }
      return;
    }
    const candidates = this.targets(pitch);
    const nearest = candidates.sort(
      (a, b) => Math.abs(a.start - position) - Math.abs(b.start - position),
    )[0];
    const offset = nearest ? (position - nearest.start) / speed : Infinity;
    if (nearest && Math.abs(offset) <= tolerance + TIMING_EPSILON) {
      const chord = candidates.filter(
        (t) =>
          t.pass === nearest.pass && Math.abs(t.start - nearest.start) < 0.001,
      );
      const feedback: Feedback = {
        kind: offset < -0.05 ? "early" : offset > 0.05 ? "late" : "hit",
        pitch,
        at: position,
        offset,
      };
      if (nearest.pass === 1) {
        // The wrap is about to reset this pass, so credit the next one then.
        for (const t of chord) this.nextHit.add(t.note.id);
        this.nextFeedback.push(feedback);
        return;
      }
      if (nearest.pass === -1) {
        // That pass's review was reset at the wrap; only the timing remains.
        this.previous = this.previous.filter((t) => !chord.includes(t));
      } else {
        for (const t of chord) {
          this.hit.add(t.note.id);
          this.missed.delete(t.note.id);
        }
        this.feedback = this.feedback.filter(
          (f) =>
            !(
              f.kind === "miss" &&
              f.pitch === pitch &&
              Math.abs(f.at - nearest.start) < 0.001
            ),
        );
        this.missFeedback = this.missFeedback.filter(
          (f) => !(f.pitch === pitch && Math.abs(f.at - nearest.start) < 0.001),
        );
      }
      this.recordFeedback(feedback);
    } else this.recordFeedback({ kind: "wrong", pitch, at: position });
  }
  expire(position: number, tolerance: number, speed: number) {
    for (const n of this.notes)
      if (
        n.start >= this.from - 0.001 &&
        n.start < position - (tolerance + TIMING_EPSILON) * speed &&
        !this.hit.has(n.id) &&
        !this.missed.has(n.id)
      ) {
        this.missed.add(n.id);
        this.recordFeedback({ kind: "miss", pitch: n.pitch, at: n.start });
      }
  }
}
export class MidiState {
  down = new Set<number>();
  sounding = new Set<number>();
  pedals = new Set<number>();
  private keys = new Map<string, number>();
  private sustained = new Map<string, number>();
  get sustain() {
    return this.pedals.size > 0;
  }
  clear() {
    this.down.clear();
    this.sounding.clear();
    this.pedals.clear();
    this.keys.clear();
    this.sustained.clear();
  }
  private refresh() {
    this.down = new Set(this.keys.values());
    this.sounding = new Set([
      ...this.keys.values(),
      ...this.sustained.values(),
    ]);
  }
  message(
    data: ArrayLike<number>,
  ): { pitch: number; velocity: number } | undefined {
    const [status, pitch, value] = Array.from(data);
    const type = status & 0xf0,
      channel = status & 15,
      key = `${channel}:${pitch}`;
    if (type === 0xb0 && pitch === 64) {
      if (value >= 64) this.pedals.add(channel);
      else {
        this.pedals.delete(channel);
        for (const k of this.sustained.keys())
          if (k.startsWith(`${channel}:`)) this.sustained.delete(k);
      }
      this.refresh();
      return;
    }
    if (type === 0xb0 && (pitch === 120 || pitch === 123)) {
      for (const k of this.keys.keys())
        if (k.startsWith(`${channel}:`)) this.keys.delete(k);
      for (const k of this.sustained.keys())
        if (k.startsWith(`${channel}:`)) this.sustained.delete(k);
      this.pedals.delete(channel);
      this.refresh();
      return;
    }
    if (type === 0x90 && value > 0) {
      const edge = !this.keys.has(key);
      this.keys.set(key, pitch);
      this.sustained.delete(key);
      this.refresh();
      if (edge) return { pitch, velocity: value };
    } else if (type === 0x80 || (type === 0x90 && value === 0)) {
      const held = this.keys.has(key);
      this.keys.delete(key);
      if (this.pedals.has(channel) && held) this.sustained.set(key, pitch);
      else if (!this.pedals.has(channel)) this.sustained.delete(key);
      this.refresh();
    }
  }
}
