import type { Finger } from "./song";

/** Quarter-note beats; the optional third value overrides the suggested finger. */
export type Step = readonly [
  pitch: number | null,
  beats: number,
  finger?: Finger,
];

export type StarterPiece = {
  id: string;
  title: string;
  composer: string;
  description: string;
  bpm: number;
  beatsPerBar: number;
  melody: readonly (readonly Step[])[];
  bass: readonly number[];
  level?: string;
  rightPosition?: string;
  rightFingers?: Record<number, Finger>;
};

// These are new, deliberately simple Cadence arrangements of older melodies,
// rather than third-party MIDI performances or modern teaching arrangements.
// The held bass notes, within C3–G3, are an optional accompaniment for this app.
// Historical melody references (not copied accompaniment):
// The Everyday Song Book, Cable Company, 1927, including earlier 1915 material:
// https://trillian.mit.edu/~jc/music/book/EverydaySongBook/
// Its ABC transcriptions link to the original University of Pittsburgh scan.
// London Bridge: 018; Jingle Bells: 062; Mary: 077; Lightly Row: 097;
// Frère Jacques / Are You Sleeping?: 104.
// Older source scores for two other melodies:
// https://imslp.org/wiki/Go_Tell_Aunt_Rhody_(English_Folk_Music)
// https://www.loc.gov/item/2023864951/ (Long, Long Ago variations, 1845).
// The title/description explicitly identify incomplete themes and the chorus.

const c = 60;
const d = 62;
const e = 64;
const f = 65;
const g = 67;
const a = 69;
const lowG = 55;

// For six-note melodies, a small move to D position is easier than holding a
// stretched sixth. The thumb returns to C when the phrase resolves there.
const movingRightFingers: Record<number, Finger> = {
  [c]: 1,
  [d]: 1,
  [e]: 2,
  [f]: 3,
  [g]: 4,
  [a]: 5,
};

export const starterPieces: readonly StarterPiece[] = [
  {
    id: "cadence-hot-cross-buns-v1",
    title: "Hot Cross Buns",
    composer: "Traditional English · easy arrangement",
    description:
      "Three melody notes and a playful run of repeated notes. Keep fingers 1, 2 and 3 ready over C, D and E.",
    bpm: 76,
    beatsPerBar: 4,
    melody: [
      [
        [e, 1],
        [d, 1],
        [c, 2],
      ],
      [
        [e, 1],
        [d, 1],
        [c, 2],
      ],
      [
        [c, 0.5],
        [c, 0.5],
        [c, 0.5],
        [c, 0.5],
        [d, 0.5],
        [d, 0.5],
        [d, 0.5],
        [d, 0.5],
      ],
      [
        [e, 1],
        [d, 1],
        [c, 2],
      ],
    ],
    bass: [48, 48, 55, 48],
  },
  {
    id: "cadence-mary-had-a-little-lamb-v1",
    title: "Mary Had a Little Lamb",
    composer: "Traditional nursery tune · easy arrangement",
    description:
      "An eight-bar nursery melody in C position. Notice how the repeated opening returns with a different ending.",
    bpm: 82,
    beatsPerBar: 4,
    melody: [
      [
        [e, 1],
        [d, 1],
        [c, 1],
        [d, 1],
      ],
      [
        [e, 1],
        [e, 1],
        [e, 2],
      ],
      [
        [d, 1],
        [d, 1],
        [d, 2],
      ],
      [
        [e, 1],
        [g, 1],
        [g, 2],
      ],
      [
        [e, 1],
        [d, 1],
        [c, 1],
        [d, 1],
      ],
      [
        [e, 1],
        [e, 1],
        [e, 1],
        [e, 1],
      ],
      [
        [d, 1],
        [d, 1],
        [e, 1],
        [d, 1],
      ],
      [[c, 4]],
    ],
    bass: [48, 48, 55, 48, 48, 48, 55, 48],
  },
  {
    id: "cadence-lightly-row-v1",
    title: "Lightly Row",
    composer: "Traditional German melody · easy arrangement",
    description:
      "A gentle sixteen-bar tune using just C to G. Let the little rests at the ends of the phrases breathe.",
    bpm: 88,
    beatsPerBar: 4,
    // The historical Lightly Row variant finishes on the third of the chord.
    // Note lengths are doubled from the source's 2/4 eighth-note units.
    melody: [
      [
        [g, 1],
        [e, 1],
        [e, 2],
      ],
      [
        [f, 1],
        [d, 1],
        [d, 2],
      ],
      [
        [c, 1],
        [d, 1],
        [e, 1],
        [f, 1],
      ],
      [
        [g, 1],
        [g, 1],
        [g, 2],
      ],
      [
        [g, 1],
        [e, 1],
        [e, 2],
      ],
      [
        [f, 1],
        [d, 1],
        [d, 2],
      ],
      [
        [c, 1],
        [e, 1],
        [g, 1],
        [g, 1],
      ],
      [
        [e, 2],
        [null, 2],
      ],
      [
        [d, 1],
        [d, 1],
        [d, 1],
        [d, 1],
      ],
      [
        [d, 1],
        [e, 1],
        [f, 2],
      ],
      [
        [e, 1],
        [e, 1],
        [e, 1],
        [e, 1],
      ],
      [
        [e, 1],
        [f, 1],
        [g, 2],
      ],
      [
        [g, 1],
        [e, 1],
        [e, 2],
      ],
      [
        [f, 1],
        [d, 1],
        [d, 2],
      ],
      [
        [c, 1],
        [e, 1],
        [g, 1],
        [g, 1],
      ],
      [
        [e, 2],
        [null, 2],
      ],
    ],
    bass: [48, 55, 48, 48, 48, 55, 48, 48, 55, 55, 48, 55, 48, 55, 48, 48],
  },
  {
    id: "cadence-go-tell-aunt-rhody-v1",
    title: "Go Tell Aunt Rhody",
    composer: "Traditional · melody after Rousseau · easy arrangement",
    description:
      "A quiet eight-bar folk melody in C position. Listen for the answer to each long opening note.",
    bpm: 80,
    beatsPerBar: 4,
    melody: [
      [
        [e, 2],
        [e, 1],
        [d, 1],
      ],
      [
        [c, 2],
        [c, 2],
      ],
      [
        [d, 2],
        [d, 1],
        [f, 1],
      ],
      [
        [e, 1],
        [d, 1],
        [c, 2],
      ],
      [
        [g, 2],
        [g, 1],
        [f, 1],
      ],
      [
        [e, 2],
        [c, 2],
      ],
      [
        [d, 1],
        [f, 1],
        [e, 1],
        [d, 1],
      ],
      [[c, 4]],
    ],
    bass: [48, 48, 55, 48, 55, 48, 55, 48],
  },
  {
    id: "cadence-au-clair-de-la-lune-theme-v1",
    title: "Au clair de la lune · theme",
    composer: "Traditional French · easy arrangement",
    description:
      "The familiar opening theme, played twice. Only C, D and E are needed for this short first lesson.",
    bpm: 78,
    beatsPerBar: 4,
    melody: [
      [
        [c, 1],
        [c, 1],
        [c, 1],
        [d, 1],
      ],
      [
        [e, 2],
        [d, 2],
      ],
      [
        [c, 1],
        [e, 1],
        [d, 1],
        [d, 1],
      ],
      [[c, 4]],
      [
        [c, 1],
        [c, 1],
        [c, 1],
        [d, 1],
      ],
      [
        [e, 2],
        [d, 2],
      ],
      [
        [c, 1],
        [e, 1],
        [d, 1],
        [d, 1],
      ],
      [[c, 4]],
    ],
    bass: [48, 55, 55, 48, 48, 55, 55, 48],
  },
  {
    id: "cadence-jingle-bells-chorus-v1",
    title: "Jingle Bells · chorus",
    composer: "James Lord Pierpont · easy arrangement",
    description:
      "The complete familiar chorus, with a different ending on its second half. Stay in C position and keep the repeated notes light.",
    bpm: 104,
    beatsPerBar: 4,
    melody: [
      [
        [e, 1],
        [e, 1],
        [e, 2],
      ],
      [
        [e, 1],
        [e, 1],
        [e, 2],
      ],
      [
        [e, 1],
        [g, 1],
        [c, 1.5],
        [d, 0.5],
      ],
      [[e, 4]],
      [
        [f, 1],
        [f, 1],
        [f, 1],
        [f, 1],
      ],
      [
        [f, 1],
        [e, 1],
        [e, 1],
        [e, 0.5],
        [e, 0.5],
      ],
      [
        [e, 1],
        [d, 1],
        [d, 1],
        [e, 1],
      ],
      [
        [d, 2],
        [g, 2],
      ],
      [
        [e, 1],
        [e, 1],
        [e, 2],
      ],
      [
        [e, 1],
        [e, 1],
        [e, 2],
      ],
      [
        [e, 1],
        [g, 1],
        [c, 1.5],
        [d, 0.5],
      ],
      [[e, 4]],
      [
        [f, 1],
        [f, 1],
        [f, 1],
        [f, 1],
      ],
      [
        [f, 1],
        [e, 1],
        [e, 1],
        [e, 0.5],
        [e, 0.5],
      ],
      [
        [g, 1],
        [g, 1],
        [f, 1],
        [d, 1],
      ],
      [[c, 4]],
    ],
    bass: [48, 48, 48, 48, 53, 48, 55, 55, 48, 48, 48, 48, 53, 48, 55, 48],
  },
  {
    id: "cadence-when-the-saints-v1",
    title: "When the Saints Go Marching In",
    composer: "Traditional American spiritual · easy arrangement",
    description:
      "A relaxed march in C position. The melody begins after a one-beat rest; use the long notes to hear the next phrase coming.",
    bpm: 100,
    beatsPerBar: 4,
    // Pad the three-note pickup with a rest, keeping a regular bar grid.
    melody: [
      [
        [null, 1],
        [c, 1],
        [e, 1],
        [f, 1],
      ],
      [[g, 4]],
      [
        [null, 1],
        [c, 1],
        [e, 1],
        [f, 1],
      ],
      [[g, 4]],
      [
        [null, 1],
        [c, 1],
        [e, 1],
        [f, 1],
      ],
      [
        [g, 2],
        [e, 2],
      ],
      [
        [c, 2],
        [e, 2],
      ],
      [[d, 4]],
      [
        [null, 1],
        [e, 1],
        [e, 1],
        [d, 1],
      ],
      [[c, 4]],
      [
        [e, 2],
        [g, 2],
      ],
      [
        [g, 1],
        [f, 3],
      ],
      [
        [null, 2],
        [e, 1],
        [f, 1],
      ],
      [
        [g, 2],
        [e, 2],
      ],
      [
        [c, 2],
        [d, 2],
      ],
      [[c, 4]],
    ],
    bass: [48, 48, 48, 48, 48, 48, 48, 55, 55, 48, 48, 53, 48, 48, 55, 48],
  },
  {
    id: "cadence-twinkle-twinkle-v1",
    title: "Twinkle, Twinkle, Little Star",
    composer: "Traditional French melody · easy arrangement",
    description:
      "The complete twelve-bar melody. Move your hand gently upward for G and A, then return the thumb to C at each phrase ending.",
    bpm: 86,
    beatsPerBar: 4,
    level: "Beginner · small hand shifts",
    rightPosition:
      "C4 to A4 · move up for G (4) and A (5), then return to C (1)",
    rightFingers: movingRightFingers,
    melody: [
      [
        [c, 1, 1],
        [c, 1, 1],
        [g, 1, 4],
        [g, 1, 4],
      ],
      [
        [a, 1, 5],
        [a, 1, 5],
        [g, 2, 4],
      ],
      [
        [f, 1, 3],
        [f, 1, 3],
        [e, 1, 2],
        [e, 1, 2],
      ],
      [
        [d, 1, 1],
        [d, 1, 1],
        [c, 2, 1],
      ],
      [
        [g, 1, 4],
        [g, 1, 4],
        [f, 1, 3],
        [f, 1, 3],
      ],
      [
        [e, 1, 2],
        [e, 1, 2],
        [d, 2, 1],
      ],
      [
        [g, 1, 4],
        [g, 1, 4],
        [f, 1, 3],
        [f, 1, 3],
      ],
      [
        [e, 1, 2],
        [e, 1, 2],
        [d, 2, 1],
      ],
      [
        [c, 1, 1],
        [c, 1, 1],
        [g, 1, 4],
        [g, 1, 4],
      ],
      [
        [a, 1, 5],
        [a, 1, 5],
        [g, 2, 4],
      ],
      [
        [f, 1, 3],
        [f, 1, 3],
        [e, 1, 2],
        [e, 1, 2],
      ],
      [
        [d, 1, 1],
        [d, 1, 1],
        [c, 2, 1],
      ],
    ],
    bass: [48, 48, 53, 55, 48, 55, 48, 55, 48, 48, 53, 48],
  },
  {
    id: "cadence-london-bridge-v1",
    title: "London Bridge",
    composer: "Traditional English · easy arrangement",
    description:
      "A lilting eight-bar melody. Begin with finger 4 on G; the thumb steps down from D to C for the final answer.",
    bpm: 90,
    beatsPerBar: 4,
    level: "Beginner · dotted rhythm and small shift",
    rightPosition: "D position · D4 (1) to A4 (5); return to C4 (1) at the end",
    rightFingers: movingRightFingers,
    melody: [
      [
        [g, 1.5, 4],
        [a, 0.5, 5],
        [g, 1, 4],
        [f, 1, 3],
      ],
      [
        [e, 1, 2],
        [f, 1, 3],
        [g, 2, 4],
      ],
      [
        [d, 1, 1],
        [e, 1, 2],
        [f, 2, 3],
      ],
      [
        [e, 1, 2],
        [f, 1, 3],
        [g, 2, 4],
      ],
      [
        [g, 1.5, 4],
        [a, 0.5, 5],
        [g, 1, 4],
        [f, 1, 3],
      ],
      [
        [e, 1, 2],
        [f, 1, 3],
        [g, 2, 4],
      ],
      [
        [d, 2, 1],
        [g, 2, 4],
      ],
      [
        [e, 1, 2],
        [c, 2, 1],
        [null, 1],
      ],
    ],
    bass: [48, 48, 55, 48, 48, 48, 55, 48],
  },
  {
    id: "cadence-frere-jacques-v1",
    title: "Frère Jacques",
    composer: "Traditional French round · easy arrangement",
    description:
      "Play one voice of the complete round. Move up for A in the bell-ringing phrase, then move down for the final G3–C4 bells.",
    bpm: 84,
    beatsPerBar: 4,
    level: "Beginner · eighth notes and hand shifts",
    rightPosition:
      "Start at C4; move up for A4, then down to G3 (1)–C4 (5) for the bells",
    rightFingers: { ...movingRightFingers, [lowG]: 1 },
    melody: [
      [
        [c, 1, 1],
        [d, 1, 2],
        [e, 1, 3],
        [c, 1, 1],
      ],
      [
        [c, 1, 1],
        [d, 1, 2],
        [e, 1, 3],
        [c, 1, 1],
      ],
      [
        [e, 1, 3],
        [f, 1, 4],
        [g, 2, 5],
      ],
      [
        [e, 1, 3],
        [f, 1, 4],
        [g, 2, 5],
      ],
      [
        [g, 0.5, 4],
        [a, 0.5, 5],
        [g, 0.5, 4],
        [f, 0.5, 3],
        [e, 1, 2],
        [c, 1, 1],
      ],
      [
        [g, 0.5, 4],
        [a, 0.5, 5],
        [g, 0.5, 4],
        [f, 0.5, 3],
        [e, 1, 2],
        [c, 1, 1],
      ],
      [
        [c, 1, 5],
        [lowG, 1, 1],
        [c, 2, 5],
      ],
      [
        [c, 1, 5],
        [lowG, 1, 1],
        [c, 2, 5],
      ],
    ],
    bass: [48, 48, 48, 48, 48, 48, 48, 48],
  },
  {
    id: "cadence-this-old-man-v1",
    title: "This Old Man",
    composer: "Traditional English · easy arrangement",
    description:
      "A complete verse of the counting song. The tiny quick notes near the middle give the tune its cheerful bounce.",
    bpm: 92,
    beatsPerBar: 4,
    level: "Beginner · eighth notes and small shifts",
    rightPosition: "C4 to A4 · move between C (1) and the D4–A4 hand position",
    rightFingers: movingRightFingers,
    melody: [
      [
        [g, 1, 4],
        [e, 1, 2],
        [g, 2, 4],
      ],
      [
        [g, 1, 4],
        [e, 1, 2],
        [g, 2, 4],
      ],
      [
        [a, 1, 5],
        [g, 1, 4],
        [f, 1, 3],
        [e, 1, 2],
      ],
      [
        [d, 1, 1],
        [e, 1, 2],
        [f, 1, 3],
        [e, 0.5, 2],
        [f, 0.5, 3],
      ],
      [
        [g, 1, 4],
        [c, 1, 1],
        [c, 0.5, 1],
        [c, 0.5, 1],
        [c, 1, 1],
      ],
      [
        [c, 0.5, 1],
        [d, 0.5, 1],
        [e, 0.5, 2],
        [f, 0.5, 3],
        [g, 2, 4],
      ],
      [
        [g, 1, 4],
        [d, 1, 1],
        [d, 1, 1],
        [f, 1, 3],
      ],
      [
        [e, 1, 2],
        [d, 1, 1],
        [c, 2, 1],
      ],
    ],
    bass: [48, 48, 48, 55, 48, 48, 55, 48],
  },
  {
    id: "cadence-long-long-ago-theme-v1",
    title: "Long, Long Ago · theme",
    composer: "Thomas Haynes Bayly · easy arrangement",
    description:
      "The opening eight-bar theme of Bayly's song. Short pairs of notes lead to a quiet held answer; move gently upward for A4.",
    bpm: 78,
    beatsPerBar: 4,
    level: "Beginner · eighth notes and small shifts",
    rightPosition:
      "C4 to A4 · move up for G (4) and A (5), then return to C (1)",
    rightFingers: movingRightFingers,
    melody: [
      [
        [c, 1, 1],
        [c, 0.5, 1],
        [d, 0.5, 1],
        [e, 1, 2],
        [e, 0.5, 2],
        [f, 0.5, 3],
      ],
      [
        [g, 1, 4],
        [a, 0.5, 5],
        [g, 0.5, 4],
        [e, 2, 2],
      ],
      [
        [g, 1, 4],
        [f, 0.5, 3],
        [e, 0.5, 2],
        [d, 2, 1],
      ],
      [
        [f, 1, 3],
        [e, 0.5, 2],
        [d, 0.5, 1],
        [c, 2, 1],
      ],
      [
        [c, 1, 1],
        [c, 0.5, 1],
        [d, 0.5, 1],
        [e, 1, 2],
        [e, 0.5, 2],
        [f, 0.5, 3],
      ],
      [
        [g, 1, 4],
        [a, 0.5, 5],
        [g, 0.5, 4],
        [e, 2, 2],
      ],
      [
        [g, 1, 4],
        [f, 0.5, 3],
        [e, 0.5, 2],
        [d, 1, 1],
        [e, 0.5, 2],
        [d, 0.5, 1],
      ],
      [[c, 4, 1]],
    ],
    bass: [48, 48, 55, 48, 48, 48, 55, 48],
  },
];
