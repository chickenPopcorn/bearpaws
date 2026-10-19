import type { Song } from "./song";
import type { MidiPlayer } from "./midiPlayer";
import { createMeterMap } from "./notation";
import { createBeatClock } from "./timeline";

/** A metronome click: when it sounds, in song seconds, and whether a bar starts there. */
export interface Click {
  time: number;
  accent: boolean;
}
type Timing = Pick<
  Song,
  "ppq" | "tempos" | "timeSignatures" | "beatsPerBar" | "leadInBeats"
> & { duration: number };
/** Bounds the work of one call, even for a meter of 1024th notes. */
const MAX_STEPS = 4096;

/**
 * The song's beat grid: one click per beat of its time signature (each
 * quarter in 4/4, each eighth in 6/8), accented on the first of each bar.
 * Before the first bar the grid carries on backwards in the first bar's
 * meter and tempo, so the lead-in beat and a count-in before the song fall
 * on it too. Times before 0 are such a count-in.
 */
export function createClickTrack(song: Timing) {
  const clock = createBeatClock(song.ppq, song.tempos);
  const meter = createMeterMap(song);
  const lead = meter.leadIn,
    first = meter.measureAt(0);
  /** The bar holding score beat `beat`, and the length of its beats. */
  const barAt = (beat: number) => {
    if (beat >= 0) {
      const bar = meter.at(beat);
      return { start: bar.start, end: bar.end, unit: bar.beatUnit };
    }
    const length = first.beatsPerBar,
      start = Math.floor(beat / length + 1e-9) * length;
    return { start, end: start + length, unit: first.beatUnit };
  };
  const beatOf = (time: number) => clock.at(time) - lead;
  const timeOf = (beat: number) => clock.time(beat + lead);
  return {
    /** The clicks from `from` up to `to`, in song seconds, in time order. */
    between(from: number, to: number): Click[] {
      const clicks: Click[] = [];
      const end = Math.min(to, song.duration);
      let bar = barAt(beatOf(from)),
        index = Math.max(
          0,
          Math.ceil((beatOf(from) - bar.start) / bar.unit - 1e-9),
        );
      for (let step = 0; step < MAX_STEPS; step++) {
        const beat = bar.start + index * bar.unit;
        if (beat >= bar.end - 1e-9) {
          bar = barAt(bar.end);
          index = 0;
          continue;
        }
        const time = timeOf(beat);
        if (time >= end) break;
        if (time >= from - 1e-9) clicks.push({ time, accent: index === 0 });
        index++;
      }
      return clicks;
    },
    /**
     * Where a count-in before `position` begins: at the start of its bar, so
     * the count leads into the music on the beat. When that leaves fewer
     * than two clicks, as on a bar's first beat, it begins a bar earlier.
     */
    countIn(position: number) {
      const beat = beatOf(position),
        bar = barAt(beat),
        before = Math.ceil((beat - bar.start) / bar.unit - 1e-9);
      return timeOf(before < 2 ? barAt(bar.start - 1e-6).start : bar.start);
    },
  };
}
export type ClickTrack = ReturnType<typeof createClickTrack>;

/** Where the clicks are: like a transport, but during a count-in too. */
export interface ClickClock {
  /** Song seconds now. A count-in runs before `start`, from before 0. */
  position: number;
  speed: number;
  /** Changes with each loop pass or seek. */
  pass: number;
  /** Where this pass begins clicking. */
  start: number;
  loop: readonly [number, number] | null;
}
/** How far ahead of the clock the laptop's clicks are scheduled, in seconds at 1x. */
const LOOKAHEAD_SECONDS = 0.12;
/** A click that a late tick passed still sounds, up to this late. */
const LATE_SECONDS = 0.05;
const CLICK_SECONDS = 0.05;
interface Scheduled {
  source: OscillatorNode;
  gain: GainNode;
  when: number;
  time: number;
  pass: Set<number>;
}
/**
 * The metronome's clicks: on the MIDI output if there is one, as GM
 * percussion, and otherwise on the laptop, apart from the piano's room.
 */
export class Metronome {
  /** Click times sounded or scheduled in this pass, and in the next loop pass. */
  private played = new Set<number>();
  private ahead = new Set<number>();
  private pass = -1;
  /** This pass's last tick on a MIDI output, or undefined before its first. */
  private last: number | undefined;
  private sources = new Set<Scheduled>();
  /** One practice tick: sound the clicks that `clock` has reached. */
  tick(
    track: ClickTrack,
    clock: ClickClock,
    now: number,
    context: AudioContext | null,
    midi: MidiPlayer,
  ) {
    if (clock.pass !== this.pass) {
      // A new loop pass keeps the clicks scheduled ahead for it. Seeks
      // call stop(), which clears them.
      this.played = this.ahead;
      this.ahead = new Set();
      this.pass = clock.pass;
      this.last = undefined;
    }
    const { position, speed, loop } = clock,
      earliest = Math.max(clock.start, position - LATE_SECONDS * speed);
    if (midi.connected) {
      // MIDI goes out on the practice clock, as the notes do.
      for (const click of track.between(this.last ?? earliest, position + 1e-9))
        if (!this.played.has(click.time)) {
          this.played.add(click.time);
          midi.click(click.accent);
        }
      this.last = position;
      return;
    }
    if (!context || context.state !== "running") return;
    const end = loop?.[1] ?? Infinity,
      to = position + LOOKAHEAD_SECONDS * speed;
    for (const click of track.between(earliest, Math.min(to, end)))
      this.schedule(click, click.time, clock, now, context, this.played);
    // The next pass's first clicks too, so the loop keeps its beat.
    if (loop && to > end)
      for (const click of track.between(loop[0], loop[0] + to - end))
        this.schedule(
          click,
          click.time + end - loop[0],
          clock,
          now,
          context,
          this.ahead,
        );
  }
  /** Play `click` at song time `at` of the current pass, once per pass. */
  private schedule(
    click: Click,
    at: number,
    clock: ClickClock,
    now: number,
    context: AudioContext,
    pass: Set<number>,
  ) {
    if (pass.has(click.time)) return;
    pass.add(click.time);
    const when = Math.max(now, now + (at - clock.position) / clock.speed);
    try {
      const source = context.createOscillator(),
        gain = context.createGain(),
        level = click.accent ? 0.4 : 0.25;
      // A short, bright tick: a quick attack and a fast decay.
      source.frequency.value = click.accent ? 1760 : 1320;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(level, when + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.001, when + CLICK_SECONDS);
      source.connect(gain);
      gain.connect(context.destination);
      const scheduled = { source, gain, when, time: click.time, pass };
      this.sources.add(scheduled);
      source.onended = () => this.cancel(scheduled);
      source.start(when);
      source.stop(when + CLICK_SECONDS);
    } catch {
      // A click that cannot play is left out; the music plays on.
    }
  }
  /**
   * Cancel the clicks that have not sounded, so the next tick schedules
   * them again, as for a speed change.
   */
  reschedule(now: number) {
    for (const scheduled of this.sources)
      if (scheduled.when > now) {
        scheduled.pass.delete(scheduled.time);
        this.cancel(scheduled);
      }
  }
  /**
   * Cancel every click to come and start over, as for a pause or seek. A
   * click already sounding ends by itself.
   */
  stop(now: number) {
    for (const scheduled of this.sources)
      if (scheduled.when > now) this.cancel(scheduled);
    this.played = new Set();
    this.ahead = new Set();
    this.pass = -1;
    this.last = undefined;
  }
  /** Stop a click, if it has not ended, and let go of its nodes. */
  private cancel(scheduled: Scheduled) {
    this.sources.delete(scheduled);
    try {
      scheduled.source.stop();
    } catch {}
    scheduled.source.disconnect();
    scheduled.gain.disconnect();
  }
}
