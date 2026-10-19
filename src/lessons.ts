import { tempoConverter, type Finger, type Note, type Song } from "./song";
import { starterPieces, type StarterPiece } from "./starterPieces";
import { popsPieces } from "./popsPieces";
import { midiSongs } from "./midiPieces";
import { classPieces, classSong, georgeClassesOrder } from "./classPieces";

const rightFingers: Record<number, Finger> = {
  60: 1,
  62: 2,
  64: 3,
  65: 4,
  67: 5,
};
const leftFingers: Record<number, Finger> = {
  48: 5,
  50: 4,
  52: 3,
  53: 2,
  55: 1,
};

function makeLesson(lesson: StarterPiece): Song {
  const ppq = 480;
  const tempos = [{ tick: 0, microseconds: 60_000_000 / lesson.bpm }];
  const time = tempoConverter(ppq, tempos);
  const notes: Note[] = [];
  const counts = [0, 0];
  const melodyFingers = { ...rightFingers, ...lesson.rightFingers };
  const add = (
    pitch: number,
    beat: number,
    beats: number,
    track: 0 | 1,
    finger?: Finger,
  ) => {
    const start = time((beat + 1) * ppq);
    // Small release gaps keep repeated notes distinct, without shortening long phrases.
    const end = time((beat + 1 + beats) * ppq) - 0.055;
    notes.push({
      id: `${lesson.id}-${track}-${counts[track]++}`,
      pitch,
      start,
      end,
      soundEnd: end,
      velocity: track === 1 ? 0.7 : 0.48,
      track,
      channel: track,
      finger: finger ?? (track === 1 ? melodyFingers : leftFingers)[pitch],
      fingerHand: track === 1 ? "right" : "left",
      notatedBeats: beats,
    });
  };
  lesson.melody.forEach((bar, index) => {
    let beat = index * lesson.beatsPerBar;
    for (const [pitch, beats, finger] of bar) {
      if (pitch !== null) add(pitch, beat, beats, 1, finger);
      beat += beats;
    }
    add(lesson.bass[index], index * lesson.beatsPerBar, lesson.beatsPerBar, 0);
  });
  return {
    id: lesson.id,
    title: lesson.title,
    notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch),
    tracks: [
      {
        id: 0,
        name: "Left · one bass note per bar",
        hand: "left",
        count: counts[0],
      },
      { id: 1, name: "Right · melody", hand: "right", count: counts[1] },
    ],
    duration: time((lesson.melody.length * lesson.beatsPerBar + 1) * ppq) + 0.5,
    beatsPerBar: lesson.beatsPerBar,
    ppq,
    leadInBeats: 1,
    tempos,
    warnings: [],
    lesson: {
      composer: lesson.composer,
      description: lesson.description,
      level: lesson.level ?? "Beginner · five-finger position",
      bpm: lesson.bpm,
      handPositions: {
        left: "C position · C3 (5) to G3 (1)",
        right: lesson.rightPosition ?? "C position · C4 (1) to G4 (5)",
      },
    },
  };
}

const odeToJoy: StarterPiece = {
  id: "cadence-ode-to-joy-v1",
  title: "Ode to Joy",
  composer: "Ludwig van Beethoven · easy arrangement",
  description:
    "A familiar eight-bar melody. Keep your right hand in C position; hold one gentle bass note per bar.",
  bpm: 80,
  beatsPerBar: 4,
  melody: [
    [
      [64, 1],
      [64, 1],
      [65, 1],
      [67, 1],
    ],
    [
      [67, 1],
      [65, 1],
      [64, 1],
      [62, 1],
    ],
    [
      [60, 1],
      [60, 1],
      [62, 1],
      [64, 1],
    ],
    [
      [64, 1.5],
      [62, 0.5],
      [62, 2],
    ],
    [
      [64, 1],
      [64, 1],
      [65, 1],
      [67, 1],
    ],
    [
      [67, 1],
      [65, 1],
      [64, 1],
      [62, 1],
    ],
    [
      [60, 1],
      [60, 1],
      [62, 1],
      [64, 1],
    ],
    [
      [62, 1.5],
      [60, 0.5],
      [60, 2],
    ],
  ],
  bass: [48, 55, 48, 55, 48, 55, 55, 48],
};

function dancingRaindrops(): Song {
  const id = "cadence-dancing-raindrops-v1";
  const bpm = 80;
  const beatSeconds = 60 / bpm;
  const notes: Note[] = [];
  const counts = [0, 0];
  // Each entry is one quarter-note beat; null is the printed quarter rest.
  // The inactive hand rests for the entire bar. Pitches follow the supplied score.
  const bars: readonly {
    track: 0 | 1;
    beats: readonly (readonly number[] | null)[];
    legato?: boolean;
  }[] = [
    { track: 0, beats: [[55], [55], [52], [48]] },
    { track: 0, beats: [[52, 55], [52, 55], [52, 55], null] },
    { track: 0, beats: [[53, 55], [53, 55], [53, 55], null] },
    { track: 0, beats: [[52, 55], [52, 55], [52, 55], null] },
    { track: 1, beats: [[60], [60], [64], [67]] },
    { track: 1, beats: [[60, 64], [60, 64], [60, 64], null] },
    { track: 1, beats: [[67], [65], [64], [62]], legato: true },
    { track: 1, beats: [[60], [60], [60], null] },
  ];
  bars.forEach((bar, barIndex) => {
    bar.beats.forEach((pitches, beatIndex) => {
      if (!pitches) return;
      const start = (1 + barIndex * 4 + beatIndex) * beatSeconds;
      // Short attacks represent staccato; the slurred descent connects into bar eight.
      const end = start + (bar.legato ? 1 : 0.45) * beatSeconds;
      for (const pitch of pitches) {
        notes.push({
          id: `${id}-${bar.track}-${counts[bar.track]++}`,
          pitch,
          start,
          end,
          soundEnd: end,
          velocity: 0.65,
          track: bar.track,
          channel: bar.track,
          finger: (bar.track === 0 ? leftFingers : rightFingers)[pitch],
          fingerHand: bar.track === 0 ? "left" : "right",
          notatedBeats: 1,
          staccato: !bar.legato,
        });
      }
    });
  });
  return {
    id,
    title: "Dancing Raindrops",
    notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch),
    tracks: [
      { id: 0, name: "Left · bars 1–4", hand: "left", count: counts[0] },
      { id: 1, name: "Right · bars 5–8", hand: "right", count: counts[1] },
    ],
    duration: (1 + bars.length * 4) * beatSeconds + 0.5,
    ppq: 480,
    beatsPerBar: 4,
    leadInBeats: 1,
    tempos: [{ tick: 0, microseconds: 60_000_000 / bpm }],
    warnings: [],
    lesson: {
      composer: "From your piano book",
      description:
        "Eight bars in C position. Left hand first, then right. Play the staccato notes lightly and connect the descending phrase near the end.",
      level: "Beginner · C position",
      bpm,
      handPositions: {
        left: "C position · C3 (5) to G3 (1)",
        right: "C position · C4 (1) to G4 (5)",
      },
    },
  };
}

function classLesson(id: string): Song {
  if (id === "cadence-dancing-raindrops-v1") return dancingRaindrops();
  return classSong(classPieces.find((piece) => piece.id === id)!);
}

/** Fresh objects keep track assignments and library edits local to each caller. */
export function builtInSongs(): Song[] {
  return [
    makeLesson(odeToJoy),
    ...georgeClassesOrder.map(classLesson),
    ...starterPieces.map(makeLesson),
    ...popsPieces.map(makeLesson),
    ...midiSongs(),
  ];
}

/** The studio's library: George Bear’s Classes, in book order. */
export function classSongs(): Song[] {
  return georgeClassesOrder.map(classLesson);
}
