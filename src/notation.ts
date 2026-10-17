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

interface MeterSegment {
  beat: number;
  measure: number;
  numerator: number;
  denominator: number;
  beatsPerBar: number;
  beatUnit: number;
  writtenBeat: number;
}

/** Sparse bar geometry: even an hours-long MIDI only stores meter changes. */
export function createMeterMap(
  song: Pick<Song, "ppq" | "timeSignatures" | "beatsPerBar" | "leadInBeats">,
) {
  const leadIn = Number.isFinite(song.leadInBeats)
    ? Math.max(0, song.leadInBeats || 0)
    : 0;
  const fallback =
    Number.isFinite(song.beatsPerBar) && song.beatsPerBar! > 0
      ? song.beatsPerBar!
      : 4;
  const ppq = Number.isFinite(song.ppq) && song.ppq > 0 ? song.ppq : 480;
  const segments: MeterSegment[] = [
    {
      beat: 0,
      measure: 0,
      numerator: fallback,
      denominator: 4,
      beatsPerBar: fallback,
      beatUnit: 1,
      writtenBeat: 0,
    },
  ];
  const signatures = (song.timeSignatures || [])
    .filter(
      ({ numerator, denominator, tick }) =>
        Number.isInteger(numerator) &&
        numerator >= 1 &&
        numerator <= 255 &&
        Number.isInteger(denominator) &&
        denominator >= 1 &&
        denominator <= 1024 &&
        (denominator & (denominator - 1)) === 0 &&
        Number.isFinite(tick) &&
        tick >= 0 &&
        tick <= 2 ** 40,
    )
    .sort((a, b) => a.tick - b.tick);
  // Later events at the same tick win, like the tempo map.
  const changes = signatures.filter(
    (entry, index) => signatures[index + 1]?.tick !== entry.tick,
  );
  for (const change of changes) {
    const { numerator, denominator } = change;
    const beat = Math.max(0, change.tick / ppq - leadIn);
    const previous = segments[segments.length - 1];
    if (
      previous.numerator === numerator &&
      previous.denominator === denominator
    )
      continue;
    const segment = {
      beat,
      // A change inside a bar ends that partial bar at the change itself.
      measure:
        previous.measure +
        Math.ceil((beat - previous.beat) / previous.beatsPerBar - 1e-9),
      numerator,
      denominator,
      beatsPerBar: (numerator * 4) / denominator,
      beatUnit: 4 / denominator,
      writtenBeat:
        previous.writtenBeat + (beat - previous.beat) / previous.beatUnit,
    };
    if (beat === previous.beat) segments[segments.length - 1] = segment;
    else segments.push(segment);
  }
  const find = (value: number, key: "beat" | "measure") => {
    let low = 0,
      high = segments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (segments[middle][key] <= value) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  };
  const measureAt = (index: number) => {
    const measure = Math.max(0, Math.floor(index));
    const segmentIndex = find(measure, "measure");
    const segment = segments[segmentIndex];
    const start =
      segment.beat + (measure - segment.measure) * segment.beatsPerBar;
    const end = Math.min(
      start + segment.beatsPerBar,
      segments[segmentIndex + 1]?.beat ?? Infinity,
    );
    return { ...segment, measure, start, end, length: end - start };
  };
  const at = (rawBeat: number) => {
    const beat = Math.max(0, rawBeat);
    const segment = segments[find(beat, "beat")];
    const index =
      segment.measure +
      Math.floor((beat - segment.beat) / segment.beatsPerBar + 1e-10);
    const bar = measureAt(index);
    return { ...bar, offset: beat - bar.start };
  };
  const coordinate = (beat: number) => {
    if (beat < 0) return beat / measureAt(0).length;
    const bar = at(beat);
    return bar.measure + bar.offset / bar.length;
  };
  const beatAt = (coordinate: number) => {
    if (coordinate < 0) return coordinate * measureAt(0).length;
    const bar = measureAt(coordinate);
    return bar.start + (Math.max(0, coordinate) - bar.measure) * bar.length;
  };
  return { at, measureAt, coordinate, beatAt };
}

type MeterAxis = number | ReturnType<typeof createMeterMap>;
const measureCoordinate = (beat: number, meter: MeterAxis) =>
  typeof meter === "number" ? beat / meter : meter.coordinate(beat);
const beatAtCoordinate = (measure: number, meter: MeterAxis) =>
  typeof meter === "number" ? measure * meter : meter.beatAt(measure);

export function buildScore(song: Song) {
  const clock = createBeatClock(song.ppq, song.tempos);
  const meter = createMeterMap(song);
  const beatsPerBar = meter.measureAt(0).beatsPerBar;
  const leadInBeats = Math.max(0, song.leadInBeats || 0);
  const measures = new Map<number, ScoreNote[]>();
  let lastBeat = 0;
  for (const note of song.notes) {
    // Snap tiny floating-point errors at barlines, without moving performed MIDI.
    const rawBeat = Math.max(0, clock.at(note.start) - leadInBeats);
    const nearest = Math.round(rawBeat * 64) / 64;
    const beat = Math.abs(rawBeat - nearest) < 0.0001 ? nearest : rawBeat;
    const bar = meter.at(beat);
    const measure = bar.measure;
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
      offset: beat - bar.start,
      duration,
      rhythm,
    };
    const measureNotes = measures.get(measure) || [];
    measureNotes.push(item);
    measures.set(measure, measureNotes);
    lastBeat = Math.max(lastBeat, beat + duration);
  }
  for (const notes of measures.values())
    notes.sort((a, b) => a.beat - b.beat || a.note.pitch - b.note.pitch);
  return {
    clock,
    meter,
    beatsPerBar,
    leadInBeats,
    measureCount: Math.max(
      1,
      meter.at(Math.max(0, lastBeat - 0.0001)).measure + 1,
    ),
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
  beatsPerBar: MeterAxis,
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
      measureCoordinate(Math.max(0, beat), beatsPerBar) * measureWidth +
        24 -
        available * 0.34,
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
  beatsPerBar: MeterAxis,
  prefix = 88,
  offset = 0,
) {
  const last = Math.max(firstMeasure + 1, lastMeasure);
  const width = Math.max(36, measureWidth);
  return beatAtCoordinate(
    Math.max(
      firstMeasure,
      Math.min(last, firstMeasure + (x + offset - prefix - 24) / width),
    ),
    beatsPerBar,
  );
}

export function scoreTimeAtX(
  x: number,
  axis: {
    first: number;
    last: number;
    measureWidth: number;
    beatsPerBar: MeterAxis;
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
