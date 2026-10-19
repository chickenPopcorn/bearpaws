import type { Note, Song } from "./song";

/**
 * A printed teacher duet. Each bar lists one string per voice, and every voice
 * fills the whole bar. Tokens are separated by spaces:
 * - a dynamic (`pp`, `p`, `mp`, `mf`, `f`), which lasts until the next one;
 * - `HEAD/BEATS`, where HEAD is `r` for a rest or pitches joined with `+`
 *   (`G2`, `B3+D4`, `F#3`, `Bb2`; C4 is middle C) and BEATS is the written
 *   length in quarter-note beats, or `g` for a grace note just before the next
 *   token. A trailing `'` plays the note staccato, and a pitch ending in `~` is
 *   tied to the same pitch where it ends.
 */
export type DuetPart = {
  /**
   * How many octaves the book moves the student part with the duet: negative
   * is lower, and 0 plays it as written.
   */
  octaves: -1 | 0 | 1 | 2;
  /** Eighth notes are swung: the second of each pair falls on the triplet. */
  swing?: boolean;
  bars: readonly (readonly string[])[];
};

const steps: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const velocities: Record<string, number> = {
  pp: 0.3,
  p: 0.4,
  mp: 0.5,
  mf: 0.6,
  f: 0.72,
};
/** Grace notes sound this many beats before the note they lead into. */
const GRACE_BEATS = 0.125;

export function parsePitch(text: string) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(text);
  if (!match) throw new Error(`Unknown pitch "${text}"`);
  const [, letter, accidental, octave] = match;
  return (
    12 * (Number(octave) + 1) +
    steps[letter] +
    (accidental === "#" ? 1 : accidental === "b" ? -1 : 0)
  );
}

/** Where a written beat sounds: swung off-beat eighths fall on the triplet. */
const swung = (beat: number) => {
  const whole = Math.floor(beat + 1e-9),
    part = beat - whole;
  return (
    whole + (part <= 0.5 ? (part * 4) / 3 : 2 / 3 + ((part - 0.5) * 2) / 3)
  );
};

type Attack = Note & { written: number; tied: boolean };

/** The duet's notes, after a lead-in, on track and channel 2. */
export function duetNotes(
  id: string,
  part: DuetPart,
  bpm: number,
  beatsPerBar: number,
  leadInBeats = 1,
): Note[] {
  const beatSeconds = 60 / bpm;
  const at = (beat: number) =>
    (leadInBeats + (part.swing ? swung(beat) : beat)) * beatSeconds;
  const attacks: Attack[] = [];
  let velocity = velocities.mp;
  part.bars.forEach((voices, barIndex) => {
    for (const voice of voices) {
      let beat = barIndex * beatsPerBar;
      let graces: string[] = [];
      for (const token of voice.trim().split(/\s+/)) {
        if (token in velocities) {
          velocity = velocities[token];
          continue;
        }
        const match = /^([^/]+)\/([\d.]+|g)(')?$/.exec(token);
        if (!match) throw new Error(`Unknown duet token "${token}"`);
        const [, head, length, staccato] = match;
        if (length === "g") {
          graces.push(head);
          continue;
        }
        const beats = Number(length);
        const start = at(beat),
          written = at(beat + beats);
        graces.forEach((grace, index) => {
          const graceStart = at(beat - GRACE_BEATS * (graces.length - index));
          for (const pitch of grace.split("+"))
            attacks.push({
              id: "",
              pitch: parsePitch(pitch),
              start: graceStart,
              end: graceStart + GRACE_BEATS * beatSeconds,
              soundEnd: graceStart + GRACE_BEATS * beatSeconds,
              velocity,
              track: 2,
              channel: 2,
              written: graceStart + GRACE_BEATS * beatSeconds,
              tied: false,
            });
        });
        graces = [];
        if (head !== "r")
          for (const text of head.split("+")) {
            const tied = text.endsWith("~");
            // Staccato sounds briefly; a small gap keeps repeated notes distinct.
            const end = staccato
              ? start + 0.45 * Math.min(1, beats) * beatSeconds
              : written - 0.04;
            attacks.push({
              id: "",
              pitch: parsePitch(tied ? text.slice(0, -1) : text),
              start,
              end,
              soundEnd: end,
              velocity,
              track: 2,
              channel: 2,
              written,
              tied,
            });
          }
        beat += beats;
      }
    }
  });
  attacks.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  // A tied note holds through the note it is tied to, which is not struck.
  const merged = new Set<Attack>();
  for (const note of attacks) {
    if (merged.has(note)) continue;
    let tail = note;
    while (tail.tied) {
      const next = attacks.find(
        (other) =>
          !merged.has(other) &&
          other !== tail &&
          other.pitch === tail.pitch &&
          Math.abs(other.start - tail.written) < 1e-6,
      );
      if (!next) break;
      merged.add(next);
      tail = next;
    }
    note.end = note.soundEnd = tail.end;
  }
  return attacks
    .filter((note) => !merged.has(note))
    .map(({ written: _written, tied: _tied, ...note }, index) => ({
      ...note,
      id: `${id}-duet-${index}`,
    }));
}

/** Give a lesson its teacher duet, which plays in the lesson's tempo and meter. */
export function attachDuet(song: Song, part: DuetPart | undefined): Song {
  if (!part || !song.lesson || !song.beatsPerBar) return song;
  const notes = duetNotes(
    song.id,
    part,
    song.lesson.bpm,
    song.beatsPerBar,
    song.leadInBeats,
  );
  return {
    ...song,
    duet: { notes, octaves: part.octaves },
    duration: Math.max(
      song.duration,
      ...notes.map((note) => note.soundEnd + 0.5),
    ),
  };
}
