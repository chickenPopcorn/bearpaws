import type { Mode } from "./engine";
import type { Note, Song, Tempo } from "./song";

/** The inverse of the MIDI tick clock, so the staff follows tempo changes. */
export function createBeatClock(ppq: number, changes: Tempo[]) {
  const resolution = ppq > 0 ? ppq : 480;
  const sorted = [{ tick: 0, microseconds: 500000 }, ...changes].sort(
    (a, b) => a.tick - b.tick,
  );
  let seconds = 0,
    lastTick = 0,
    tempo = 500000;
  const segments = sorted.map((change) => {
    seconds += ((change.tick - lastTick) * tempo) / resolution / 1e6;
    lastTick = change.tick;
    tempo = change.microseconds;
    return {
      beat: change.tick / resolution,
      seconds,
      secondsPerBeat: change.microseconds / 1e6,
    };
  });
  const find = (value: number, key: "beat" | "seconds") => {
    let low = 0,
      high = segments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (segments[middle][key] <= value) low = middle + 1;
      else high = middle;
    }
    return segments[Math.max(0, low - 1)];
  };
  return {
    at(time: number) {
      const segment = find(time, "seconds");
      return segment.beat + (time - segment.seconds) / segment.secondsPerBeat;
    },
    time(beat: number) {
      const segment = find(beat, "beat");
      return segment.seconds + (beat - segment.beat) * segment.secondsPerBeat;
    },
  };
}

export interface Rhythm {
  beats: number;
  baseBeats: number;
  dotted: boolean;
  flags: number;
  filled: boolean;
  stem: boolean;
}

/** MIDI has performed lengths; use the nearest conventional printed value. */
export function rhythmForBeats(value: number): Rhythm {
  const length = Number.isFinite(value) && value > 0 ? value : 0.25;
  let beats = 1,
    baseBeats = 1,
    dotted = false,
    difference = Infinity;
  for (const base of [4, 2, 1, 0.5, 0.25, 0.125, 0.0625]) {
    for (const dot of [false, true]) {
      const candidate = base * (dot ? 1.5 : 1);
      const distance = Math.abs(Math.log(length / candidate));
      if (distance < difference) {
        difference = distance;
        beats = candidate;
        baseBeats = base;
        dotted = dot;
      }
    }
  }
  return {
    beats,
    baseBeats,
    dotted,
    flags: Math.max(0, Math.round(-Math.log2(baseBeats))),
    filled: baseBeats < 2,
    stem: baseBeats < 4,
  };
}

export interface ScoreNote {
  note: Note;
  /** Quarter-note beats after the count-in. */
  beat: number;
  measure: number;
  offset: number;
  duration: number;
  rhythm: Rhythm;
}

export function buildScore(song: Song) {
  const clock = createBeatClock(song.ppq, song.tempos);
  const beatsPerBar = Math.max(1, song.beatsPerBar || 4);
  const leadInBeats = Math.max(0, song.leadInBeats || 0);
  const measures = new Map<number, ScoreNote[]>();
  let lastBeat = 0;
  for (const note of song.notes) {
    // Snap tiny floating-point errors at barlines, without moving performed MIDI.
    const rawBeat = Math.max(0, clock.at(note.start) - leadInBeats);
    const nearest = Math.round(rawBeat * 64) / 64;
    const beat = Math.abs(rawBeat - nearest) < 0.0001 ? nearest : rawBeat;
    const measure = Math.floor(beat / beatsPerBar);
    const performed = Math.max(
      0.0625,
      clock.at(note.end) - clock.at(note.start),
    );
    const duration = note.notatedBeats ?? rhythmForBeats(performed).beats;
    const rhythm = rhythmForBeats(duration);
    const item = {
      note,
      beat,
      measure,
      offset: beat - measure * beatsPerBar,
      duration,
      rhythm,
    };
    const bar = measures.get(measure) || [];
    bar.push(item);
    measures.set(measure, bar);
    lastBeat = Math.max(lastBeat, beat + duration);
  }
  for (const notes of measures.values())
    notes.sort((a, b) => a.beat - b.beat || a.note.pitch - b.note.pitch);
  return {
    clock,
    beatsPerBar,
    leadInBeats,
    measureCount: Math.max(1, Math.ceil((lastBeat - 0.0001) / beatsPerBar)),
    measures,
  };
}

/** A bounded, following window; a very long MIDI never creates a huge SVG. */
export function scoreWindow(measure: number, total: number, count = 3) {
  const size = Math.max(1, Math.min(Math.floor(count), Math.max(1, total)));
  const current = Math.max(0, Math.min(total - 1, Math.floor(measure)));
  const first = Math.max(0, Math.min(current - 1, total - size));
  return { first, last: first + size };
}

/** Follow the music continuously, retaining one extra bar at the incoming edge. */
export function scoreViewport(
  beat: number,
  total: number,
  beatsPerBar: number,
  count = 3,
  width = 960,
) {
  const measures = Math.max(1, Math.floor(total));
  const size = Math.max(1, Math.min(Math.floor(count), measures));
  const viewWidth = Math.max(320, width);
  const available = viewWidth - 88 - 15;
  // Leave room for the opening inset and the final note's head and label.
  const measureWidth = (available - 48) / size;
  // Let the opening notes move across the page, then hold the reading position
  // near the first third while leaving most of the score available to look ahead.
  const camera = Math.max(
    0,
    Math.min(
      (measures - size) * measureWidth,
      (Math.max(0, beat) / beatsPerBar) * measureWidth + 24 - available * 0.34,
    ),
  );
  const first = Math.min(measures - size, Math.floor(camera / measureWidth));
  return {
    first,
    last: Math.min(measures, first + size + 1),
    viewWidth,
    measureWidth,
    offset: camera - first * measureWidth,
  };
}

/** Invert the same continuous beat axis used by the moving score. */
export function scoreBeatAtX(
  x: number,
  firstMeasure: number,
  lastMeasure: number,
  measureWidth: number,
  beatsPerBar: number,
  prefix = 88,
  offset = 0,
) {
  const last = Math.max(firstMeasure + 1, lastMeasure);
  const width = Math.max(36, measureWidth);
  return Math.max(
    firstMeasure * beatsPerBar,
    Math.min(
      last * beatsPerBar,
      (firstMeasure + (x + offset - prefix - 24) / width) * beatsPerBar,
    ),
  );
}

export function scoreTimeAtX(
  x: number,
  axis: {
    first: number;
    last: number;
    measureWidth: number;
    beatsPerBar: number;
    offset?: number;
  },
  clock: ReturnType<typeof createBeatClock>,
  leadInBeats: number,
  duration: number,
) {
  const beat = scoreBeatAtX(
    x,
    axis.first,
    axis.last,
    axis.measureWidth,
    axis.beatsPerBar,
    88,
    axis.offset,
  );
  return Math.max(0, Math.min(duration, clock.time(beat + leadInBeats)));
}

export function isNotePlayed(
  note: Pick<Note, "id" | "start">,
  mode: Mode,
  hit: ReadonlySet<string>,
  position: number,
  from = 0,
) {
  return mode === "listen"
    ? note.start >= from - 0.001 && position > note.start + 0.001
    : hit.has(note.id);
}

/** Staff y coordinates, using a sharp spelling when MIDI has no key signature. */
export function pitchPosition(pitch: number, hand: "left" | "right") {
  const chromatic = ((pitch % 12) + 12) % 12;
  const letter = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][chromatic];
  const octave = Math.floor(pitch / 12) - 1;
  const step = octave * 7 + letter;
  return {
    step,
    y: hand === "right" ? 104 - (step - 30) * 5 : 212 - (step - 18) * 5,
    sharp: [1, 3, 6, 8, 10].includes(chromatic),
  };
}
