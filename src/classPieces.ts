import type { Finger, Note, Song } from "./song";

// Personal-practice transcriptions of the student parts from the user's piano
// book. Each bar lists what each hand plays, in quarter-note beats; null is a
// printed rest and an omitted hand rests for the whole bar. Finger numbers
// follow the printed five-finger position, which matches every printed number.
// The teacher duet parts are in recitalDuets.ts; the lyrics are not included.

type Pitches = number | readonly number[];
/** Pitches (one note or a chord), written beats, and an optional staccato dot. */
export type ClassStep = readonly [
  pitches: Pitches | null,
  beats: number,
  articulation?: "staccato",
];
type Dynamic = "p" | "mp" | "mf" | "f";
export type ClassBar = {
  left?: readonly ClassStep[];
  right?: readonly ClassStep[];
  /** Printed dynamic, which lasts until the next one. */
  dynamic?: Dynamic;
};
export type ClassPosition = "c" | "middle-c";
export type ClassPiece = {
  id: string;
  title: string;
  composer: string;
  description: string;
  bpm: number;
  beatsPerBar: 3 | 4;
  position: ClassPosition;
  bars: readonly ClassBar[];
};

const C3 = 48;
const D3 = 50;
const E3 = 52;
const F3 = 53;
const G3 = 55;
const A3 = 57;
const B3 = 59;
const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const G4 = 67;

const rightFingers: Record<number, Finger> = {
  [C4]: 1,
  [D4]: 2,
  [E4]: 3,
  [F4]: 4,
  [G4]: 5,
};
export const classPositions: Record<
  ClassPosition,
  {
    level: string;
    handPositions: { left: string; right: string };
    fingers: Record<"left" | "right", Record<number, Finger>>;
  }
> = {
  c: {
    level: "Beginner · C position",
    handPositions: {
      left: "C position · C3 (5) to G3 (1)",
      right: "C position · C4 (1) to G4 (5)",
    },
    fingers: {
      left: { [C3]: 5, [D3]: 4, [E3]: 3, [F3]: 2, [G3]: 1 },
      right: rightFingers,
    },
  },
  "middle-c": {
    level: "Beginner · Middle C position",
    handPositions: {
      left: "Middle C position · F3 (5) to C4 (1)",
      right: "Middle C position · C4 (1) to G4 (5)",
    },
    fingers: {
      left: { [F3]: 5, [G3]: 4, [A3]: 3, [B3]: 2, [C4]: 1 },
      right: rightFingers,
    },
  },
};

const velocities: Record<Dynamic, number> = {
  p: 0.45,
  mp: 0.52,
  mf: 0.6,
  f: 0.75,
};
const credit = "From your piano book";

const staccato = "staccato";

const farAwayVerse: readonly ClassBar[] = [
  {
    right: [
      [null, 1],
      [D4, 1],
      [D4, 2],
    ],
    left: [
      [B3, 1],
      [null, 1],
      [null, 2],
    ],
  },
  {
    left: [
      [B3, 1],
      [A3, 1],
      [G3, 2],
    ],
  },
  {
    right: [
      [null, 2],
      [D4, 1],
      [null, 1],
    ],
    left: [
      [A3, 1],
      [B3, 1],
      [null, 1],
      [B3, 1],
    ],
  },
  { left: [[A3, 4]] },
  {
    right: [
      [null, 1],
      [D4, 1],
      [D4, 2],
    ],
    left: [
      [B3, 1],
      [null, 1],
      [null, 2],
    ],
  },
  {
    left: [
      [B3, 1],
      [A3, 1],
      [G3, 2],
    ],
  },
  {
    left: [
      [A3, 1],
      [B3, 1],
      [A3, 1],
      [G3, 1],
    ],
  },
  { left: [[G3, 4]] },
];

const dancingShoesVerse: readonly ClassBar[] = [
  {
    right: [
      [C4, 1],
      [D4, 1],
      [E4, 1],
    ],
  },
  { right: [[F4, 3]] },
  {
    right: [
      [G4, 1],
      [F4, 1],
      [E4, 1],
    ],
  },
  { right: [[D4, 3]] },
  { right: [[C4, 3]] },
  { left: [[C3, 3]] },
  { right: [[C4, 3]] },
  { left: [[C3, 3]] },
];

const tiptoeingVerse: readonly ClassBar[] = [
  {
    right: [
      [F4, 1, staccato],
      [F4, 1, staccato],
      [F4, 1, staccato],
    ],
  },
  {
    right: [
      [D4, 1, staccato],
      [D4, 1, staccato],
      [D4, 1, staccato],
    ],
  },
  {
    right: [
      [C4, 1, staccato],
      [D4, 1, staccato],
      [E4, 1, staccato],
    ],
  },
  { right: [[D4, 3]] },
  {
    left: [
      [G3, 1, staccato],
      [G3, 1, staccato],
      [G3, 1, staccato],
    ],
  },
  {
    left: [
      [B3, 1, staccato],
      [B3, 1, staccato],
      [B3, 1, staccato],
    ],
  },
  {
    left: [
      [G3, 1, staccato],
      [A3, 1, staccato],
      [B3, 1, staccato],
    ],
  },
  { left: [[C4, 3]] },
];

const mayIDanceVerse: readonly ClassBar[] = [
  {
    right: [
      [D4, 2],
      [F4, 1],
    ],
  },
  { right: [[D4, 3]] },
  {
    left: [
      [B3, 2],
      [G3, 1],
    ],
  },
  { left: [[B3, 3]] },
  {
    right: [
      [F4, 2],
      [D4, 1],
    ],
  },
  {
    left: [
      [B3, 2],
      [G3, 1],
    ],
  },
  {
    right: [
      [C4, 2],
      [C4, 1],
    ],
  },
  { right: [[C4, 3]] },
];

const specialTuneVerse: readonly ClassBar[] = [
  {
    left: [
      [C4, 1],
      [B3, 1],
      [C4, 1],
      [B3, 1],
    ],
  },
  {
    left: [
      [C4, 1],
      [B3, 1],
      [A3, 1],
      [null, 1],
    ],
  },
  {
    left: [
      [C4, 2],
      [B3, 2],
    ],
  },
  { left: [[A3, 4]] },
  {
    right: [
      [C4, 1],
      [D4, 1],
      [C4, 1],
      [D4, 1],
    ],
  },
  {
    right: [
      [E4, 1],
      [D4, 1],
      [C4, 1],
      [null, 1],
    ],
  },
  {
    right: [
      [C4, 2],
      [D4, 2],
    ],
  },
  { right: [[C4, 4]] },
];

const sleepTightVerse: readonly ClassBar[] = [
  { left: [[G3, 3]] },
  { right: [[C4, 3]] },
  {
    right: [
      [null, 1],
      [C4, 1],
      [D4, 1],
    ],
    left: [
      [G3, 1],
      [null, 2],
    ],
  },
  { right: [[E4, 3]] },
  { left: [[G3, 3]] },
  { right: [[D4, 3]] },
  {
    right: [
      [null, 1],
      [E4, 1],
      [D4, 1],
    ],
    left: [
      [G3, 1],
      [null, 2],
    ],
  },
  { right: [[C4, 3]] },
];

const bridalOpening: readonly ClassBar[] = [
  {
    right: [
      [null, 2],
      [C4, 1],
      [C4, 1],
    ],
    left: [
      [G3, 2],
      [null, 2],
    ],
  },
  { right: [[C4, 4]] },
  {
    right: [
      [null, 2],
      [D4, 1],
      [null, 1],
    ],
    left: [
      [G3, 2],
      [null, 1],
      [B3, 1],
    ],
  },
  { left: [[C4, 4]] },
];

const mozartFanfare: readonly ClassBar[] = [
  {
    right: [
      [[C4, G4], 1],
      [[C4, G4], 1],
      [[C4, G4], 1],
      [[C4, G4], 1],
    ],
  },
  {
    right: [
      [[C4, G4], 2],
      [[C4, G4], 2],
    ],
  },
  {
    left: [
      [[C3, G3], 1],
      [[C3, G3], 1],
      [[C3, G3], 1],
      [[C3, G3], 1],
    ],
  },
  {
    left: [
      [[C3, G3], 2],
      [[C3, G3], 2],
    ],
  },
];

const camptownLine: readonly ClassBar[] = [
  {
    right: [
      [C4, 1],
      [C4, 1],
      [null, 1],
      [C4, 1],
    ],
    left: [
      [null, 2],
      [A3, 1],
      [null, 1],
    ],
  },
  {
    right: [
      [D4, 1],
      [C4, 1],
      [null, 2],
    ],
    left: [
      [null, 2],
      [A3, 2],
    ],
  },
];

const hushPhrase: readonly ClassBar[] = [
  {
    right: [
      [null, 2],
      [D4, 1],
      [D4, 1],
    ],
    left: [
      [G3, 1],
      [G3, 1],
      [null, 2],
    ],
  },
  {
    right: [
      [D4, 2],
      [D4, 1],
      [E4, 1],
    ],
  },
  {
    right: [
      [D4, 2],
      [C4, 2],
    ],
  },
  { right: [[C4, 4]] },
];

const macDonaldLine: readonly ClassBar[] = [
  {
    right: [
      [G4, 1],
      [G4, 1],
      [G4, 1],
      [D4, 1],
    ],
  },
  {
    right: [
      [E4, 1],
      [E4, 1],
      [D4, 2],
    ],
  },
  {
    left: [
      [B3, 1],
      [B3, 1],
      [A3, 1],
      [A3, 1],
    ],
  },
];
const macDonaldPickup: ClassBar = {
  right: [
    [null, 3],
    [D4, 1],
  ],
  left: [
    [G3, 3],
    [null, 1],
  ],
};
const quackPair: ClassBar = {
  right: [
    [G4, 1],
    [G4, 1],
    [null, 2],
  ],
  left: [
    [null, 2],
    [G3, 1],
    [G3, 1],
  ],
};

const blackbird: readonly ClassBar[] = [
  {
    left: [
      [G3, 1],
      [C4, 1],
      [B3, 1],
      [C4, 1],
    ],
  },
  {
    right: [
      [D4, 1],
      [null, 1],
      [D4, 2],
    ],
    left: [
      [null, 1],
      [A3, 1],
      [null, 2],
    ],
  },
  {
    left: [
      [C4, 1],
      [B3, 1],
      [A3, 1],
      [B3, 1],
    ],
  },
  { left: [[C4, 4]] },
];

/**
 * Book order: Music for Little Mozarts, Recital Book 3. The story pieces run
 * from page 4 (Far Away) to page 21 (Mozart Mouse's Special Music), with
 * Dancing Raindrops on page 13, and the Challenge Repertoire follows on odd
 * pages 23 to 31.
 */
export const classPieces: readonly ClassPiece[] = [
  {
    id: "pawpal-far-away-v1",
    title: "Far Away",
    composer: `Anton Dvořák · ${credit.toLowerCase()}`,
    description:
      "The theme from the New World Symphony, played twice. The left hand sings most of the tune on G, A and B; the right hand answers on D.",
    bpm: 72,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      { ...farAwayVerse[0], dynamic: "p" },
      ...farAwayVerse.slice(1),
      ...farAwayVerse,
    ],
  },
  {
    id: "pawpal-dancing-shoes-v1",
    title: "Dancing Shoes",
    composer: credit,
    description:
      "A 3/4 dance, played twice. The right hand climbs and steps back down in C position; the left hand answers with a low C.",
    bpm: 100,
    beatsPerBar: 3,
    position: "c",
    bars: [
      { ...dancingShoesVerse[0], dynamic: "mf" },
      ...dancingShoesVerse.slice(1),
      ...dancingShoesVerse,
    ],
  },
  {
    id: "pawpal-on-my-grandpas-knee-v1",
    title: "On My Grandpa's Knee",
    composer: credit,
    description:
      "A soft, sweet song. The left hand starts on E, D and C; the right hand finishes on E, F and G, coming home to middle C.",
    bpm: 84,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        left: [
          [E3, 2],
          [D3, 2],
        ],
        dynamic: "p",
      },
      {
        left: [
          [E3, 1],
          [E3, 1],
          [D3, 2],
        ],
      },
      {
        left: [
          [E3, 2],
          [C3, 2],
        ],
      },
      {
        left: [
          [E3, 1],
          [E3, 1],
          [D3, 2],
        ],
      },
      {
        right: [
          [E4, 2],
          [F4, 2],
        ],
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [F4, 2],
        ],
      },
      {
        right: [
          [E4, 2],
          [D4, 2],
        ],
      },
      {
        right: [
          [C4, 1],
          [C4, 1],
          [C4, 2],
        ],
      },
    ],
  },
  {
    id: "pawpal-the-conductor-v1",
    title: "The Conductor",
    composer: credit,
    description:
      "A steady march of short, bouncy staccato notes and quarter rests: four bars for the right hand, then four for the left.",
    bpm: 100,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [G4, 1, staccato],
          [G4, 1, staccato],
          [F4, 1, staccato],
          [F4, 1, staccato],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [E4, 1, staccato],
          [D4, 1, staccato],
          [C4, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [D4, 1, staccato],
          [null, 1],
          [E4, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [F4, 1, staccato],
          [E4, 1, staccato],
          [D4, 1, staccato],
          [null, 1],
        ],
      },
      {
        left: [
          [G3, 1, staccato],
          [G3, 1, staccato],
          [F3, 1, staccato],
          [F3, 1, staccato],
        ],
      },
      {
        left: [
          [E3, 1, staccato],
          [D3, 1, staccato],
          [C3, 1, staccato],
          [null, 1],
        ],
      },
      {
        left: [
          [G3, 1, staccato],
          [null, 1],
          [E3, 1, staccato],
          [null, 1],
        ],
      },
      {
        left: [
          [C3, 1, staccato],
          [C3, 1, staccato],
          [C3, 1, staccato],
          [null, 1],
        ],
      },
    ],
  },
  {
    id: "pawpal-tiptoeing-v1",
    title: "Tiptoeing",
    composer: credit,
    description:
      "A quiet 3/4 piece, played twice. Play the dotted notes short and light, like tiptoeing, and let the long notes ring.",
    bpm: 104,
    beatsPerBar: 3,
    position: "middle-c",
    bars: [
      { ...tiptoeingVerse[0], dynamic: "p" },
      ...tiptoeingVerse.slice(1),
      ...tiptoeingVerse,
    ],
  },
  {
    id: "pawpal-the-search-v1",
    title: "The Search",
    composer: credit,
    description:
      "A bold piece in C position. Short notes lead into long ones: the right hand climbs from C to G, then the left hand steps down from G to C.",
    bpm: 104,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [C4, 1, staccato],
          [D4, 1, staccato],
          [E4, 2],
        ],
        dynamic: "f",
      },
      {
        right: [
          [D4, 1, staccato],
          [E4, 1, staccato],
          [E4, 2],
        ],
      },
      {
        right: [
          [E4, 1, staccato],
          [E4, 1, staccato],
          [F4, 1, staccato],
          [F4, 1, staccato],
        ],
      },
      {
        right: [
          [G4, 1, staccato],
          [F4, 1, staccato],
          [E4, 2],
        ],
      },
      {
        left: [
          [G3, 1, staccato],
          [F3, 1, staccato],
          [F3, 2],
        ],
      },
      {
        left: [
          [F3, 1, staccato],
          [E3, 1, staccato],
          [E3, 2],
        ],
      },
      {
        left: [
          [E3, 1, staccato],
          [E3, 1, staccato],
          [D3, 1, staccato],
          [D3, 1, staccato],
        ],
      },
      {
        left: [
          [C3, 1, staccato],
          [C3, 1, staccato],
          [C3, 2],
        ],
      },
    ],
  },
  {
    id: "pawpal-may-i-dance-v1",
    title: "May I Dance?",
    composer: credit,
    description:
      "A tender waltz in Middle C position, played twice. The hands take turns: the right hand around D and F, the left hand on B and G.",
    bpm: 96,
    beatsPerBar: 3,
    position: "middle-c",
    bars: [
      { ...mayIDanceVerse[0], dynamic: "p" },
      ...mayIDanceVerse.slice(1),
      ...mayIDanceVerse,
    ],
  },
  {
    id: "pawpal-a-special-tune-v1",
    title: "A Special Tune",
    composer: credit,
    description:
      "A strong, majestic tune, played twice. Both thumbs share middle C: the left hand starts, then the right hand answers.",
    bpm: 88,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      { ...specialTuneVerse[0], dynamic: "f" },
      ...specialTuneVerse.slice(1),
      ...specialTuneVerse,
    ],
  },
  {
    id: "pawpal-mister-moon-v1",
    title: "Mister Moon",
    composer: credit,
    description:
      "A gentle wish to the moon. The left hand leaps between G and E, the right hand between C and E, and both walk home to C.",
    bpm: 88,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        left: [
          [G3, 2],
          [E3, 2],
        ],
        dynamic: "mf",
      },
      {
        left: [
          [G3, 2],
          [E3, 2],
        ],
      },
      {
        left: [
          [C3, 1],
          [D3, 1],
          [E3, 1],
          [F3, 1],
        ],
      },
      {
        left: [
          [G3, 2],
          [null, 2],
        ],
      },
      {
        right: [
          [C4, 2],
          [E4, 2],
        ],
      },
      {
        right: [
          [C4, 2],
          [E4, 2],
        ],
      },
      {
        right: [
          [G4, 1],
          [F4, 1],
          [E4, 1],
          [D4, 1],
        ],
      },
      {
        right: [
          [C4, 3],
          [null, 1],
        ],
      },
    ],
  },
  {
    id: "pawpal-five-oclock-v1",
    title: "Five O'Clock",
    composer: credit,
    description:
      "A quiet clock chime in 3/4. The right hand holds D; the left hand rings B and G, then walks down to G and up to middle C.",
    bpm: 88,
    beatsPerBar: 3,
    position: "middle-c",
    bars: [
      { right: [[D4, 3]], left: [[B3, 3]], dynamic: "p" },
      { left: [[G3, 3]] },
      { right: [[D4, 3]], left: [[B3, 3]] },
      { left: [[G3, 3]] },
      {
        right: [[D4, 3]],
        left: [
          [B3, 1],
          [A3, 1],
          [G3, 1],
        ],
      },
      {
        right: [[D4, 3]],
        left: [
          [B3, 1],
          [A3, 1],
          [G3, 1],
        ],
      },
      {
        right: [[D4, 3]],
        left: [
          [B3, 1],
          [A3, 1],
          [B3, 1],
        ],
      },
      { left: [[C4, 3]] },
    ],
  },
  {
    id: "pawpal-tell-us-please-v1",
    title: "Tell Us, Please!",
    composer: credit,
    description:
      "Right hand asks the question, left hand answers. Play the dotted notes short and bouncy, and let the half notes ring.",
    bpm: 96,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [C4, 2],
          [F4, 2],
        ],
        dynamic: "f",
      },
      {
        right: [
          [C4, 1, "staccato"],
          [C4, 1, "staccato"],
          [F4, 2],
        ],
      },
      {
        right: [
          [D4, 2],
          [G4, 2],
        ],
      },
      {
        right: [
          [D4, 1, "staccato"],
          [D4, 1, "staccato"],
          [G4, 2],
        ],
      },
      {
        left: [
          [G3, 2],
          [D3, 2],
        ],
      },
      {
        left: [
          [G3, 1, "staccato"],
          [G3, 1, "staccato"],
          [D3, 2],
        ],
      },
      {
        left: [
          [G3, 1, "staccato"],
          [F3, 1, "staccato"],
          [E3, 1, "staccato"],
          [D3, 1, "staccato"],
        ],
      },
      { left: [[C3, 4]] },
    ],
  },
  {
    id: "pawpal-sleep-tight-mozart-mouse-v1",
    title: "Sleep Tight, Mozart Mouse",
    composer: credit,
    description:
      "A gentle 3/4 lullaby, played twice: loud the first time, soft the second. The ending holds G and C together in the left hand; the book asks you to hold the right pedal to the end.",
    bpm: 92,
    beatsPerBar: 3,
    position: "middle-c",
    bars: [
      { ...sleepTightVerse[0], dynamic: "f" },
      ...sleepTightVerse.slice(1),
      { ...sleepTightVerse[0], dynamic: "p" },
      ...sleepTightVerse.slice(1),
      { left: [[[G3, C4], 3]] },
      { left: [[[G3, C4], 3]] },
      {
        left: [
          [[G3, C4], 2],
          [[G3, C4], 1],
        ],
      },
      { left: [[[G3, C4], 3]] },
    ],
  },
  {
    id: "pawpal-something-for-you-v1",
    title: "Something for You",
    composer: credit,
    description:
      "The hands take turns, two bars each. Watch the left hand's jump from F up to middle C, and the right hand's jump from G down to C.",
    bpm: 100,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        left: [
          [F3, 1],
          [F3, 1],
          [C4, 1],
          [C4, 1],
        ],
        dynamic: "mf",
      },
      {
        left: [
          [A3, 1],
          [A3, 1],
          [C4, 2],
        ],
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [C4, 1],
          [C4, 1],
        ],
      },
      {
        right: [
          [F4, 1],
          [F4, 1],
          [F4, 2],
        ],
      },
      {
        left: [
          [F3, 1],
          [F3, 1],
          [C4, 1],
          [C4, 1],
        ],
      },
      {
        left: [
          [A3, 1],
          [A3, 1],
          [C4, 2],
        ],
      },
      {
        right: [
          [G4, 1],
          [C4, 1],
          [D4, 1],
          [E4, 1],
        ],
      },
      {
        right: [
          [F4, 1],
          [F4, 1],
          [F4, 2],
        ],
      },
    ],
  },
  {
    id: "pawpal-bridal-chorus-v1",
    title: "Bridal Chorus",
    composer: `Richard Wagner · ${credit.toLowerCase()}`,
    description:
      "The wedding march “Here Comes the Bride” in Middle C position. Both thumbs share middle C, so watch which hand plays it.",
    bpm: 76,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      { ...bridalOpening[0], dynamic: "mf" },
      ...bridalOpening.slice(1),
      {
        right: [
          [null, 2],
          [C4, 1],
          [F4, 1],
        ],
        left: [
          [G3, 2],
          [null, 2],
        ],
      },
      {
        right: [
          [F4, 2],
          [E4, 1],
          [D4, 1],
        ],
      },
      {
        right: [
          [C4, 2],
          [null, 2],
        ],
        left: [
          [null, 2],
          [B3, 1],
          [C4, 1],
        ],
      },
      { right: [[D4, 4]] },
      ...bridalOpening,
      {
        right: [
          [null, 2],
          [C4, 1],
          [E4, 1],
        ],
        left: [
          [G3, 2],
          [null, 2],
        ],
      },
      {
        right: [
          [G4, 2],
          [E4, 1],
          [C4, 1],
        ],
      },
      {
        right: [
          [null, 2],
          [D4, 1],
          [E4, 1],
        ],
        left: [
          [A3, 2],
          [null, 2],
        ],
      },
      { right: [[C4, 4]] },
    ],
  },
  {
    id: "pawpal-mozart-mouses-special-music-v1",
    title: "Mozart Mouse's Special Music",
    composer: credit,
    description:
      "A brave fanfare of C and G played together, first in the right hand, then in the left. Play the second half louder.",
    bpm: 96,
    beatsPerBar: 4,
    position: "c",
    bars: [
      { ...mozartFanfare[0], dynamic: "mf" },
      ...mozartFanfare.slice(1),
      {
        right: [
          [D4, 1],
          [D4, 1],
          [D4, 1],
          [F4, 1],
        ],
        left: [[G3, 4]],
      },
      {
        right: [
          [G4, 2],
          [F4, 2],
        ],
        left: [[G3, 4]],
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [F4, 1],
          [D4, 1],
        ],
        left: [[G3, 4]],
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [G4, 2],
        ],
        left: [[G3, 4]],
      },
      { ...mozartFanfare[0], dynamic: "f" },
      ...mozartFanfare.slice(1),
      {
        right: [
          [D4, 1],
          [F4, 1],
          [G4, 2],
        ],
        left: [[G3, 4]],
      },
      {
        right: [
          [D4, 1],
          [F4, 1],
          [G4, 2],
        ],
        left: [[G3, 4]],
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [F4, 1],
          [D4, 1],
        ],
        left: [[G3, 4]],
      },
      {
        right: [
          [[C4, G4], 1],
          [[C4, G4], 1],
          [[C4, G4], 2],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 2],
        ],
      },
    ],
  },
  {
    id: "pawpal-camptown-races-v1",
    title: "Camptown Races",
    composer: `Stephen Foster · ${credit.toLowerCase()}`,
    description:
      "The right hand starts each line on middle C; the left hand sings the “doo-dah” answers on A and G.",
    bpm: 92,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      { ...camptownLine[0], dynamic: "mf" },
      camptownLine[1],
      {
        left: [
          [A3, 1],
          [G3, 3],
        ],
      },
      {
        left: [
          [A3, 1],
          [G3, 3],
        ],
      },
      ...camptownLine,
      {
        left: [
          [G3, 2],
          [A3, 1],
          [G3, 1],
        ],
      },
      { left: [[F3, 4]] },
    ],
  },
  {
    id: "pawpal-hush-little-baby-v1",
    title: "Hush, Little Baby",
    composer: `Southern lullaby · ${credit.toLowerCase()}`,
    description:
      "Play gently. Each phrase begins with the left-hand thumb on G, then the right hand sings the melody in C position.",
    bpm: 80,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [null, 2],
          [E4, 1],
          [E4, 1],
        ],
        left: [
          [G3, 2],
          [null, 2],
        ],
        dynamic: "p",
      },
      {
        right: [
          [E4, 2],
          [F4, 2],
        ],
      },
      {
        right: [
          [E4, 2],
          [D4, 1],
          [D4, 1],
        ],
      },
      { right: [[D4, 4]] },
      ...hushPhrase,
      {
        right: [
          [null, 2],
          [E4, 2],
        ],
        left: [
          [G3, 2],
          [null, 2],
        ],
      },
      {
        right: [
          [E4, 2],
          [F4, 2],
        ],
      },
      {
        right: [
          [E4, 2],
          [D4, 2],
        ],
      },
      { right: [[D4, 4]] },
      ...hushPhrase,
    ],
  },
  {
    id: "pawpal-wheels-on-the-bus-v1",
    title: "The Wheels on the Bus",
    composer: `Traditional · ${credit.toLowerCase()}`,
    description:
      "The left hand gives the starting G, the right hand drives the first verse, and the left hand drives the second. End with two big “Honk!” notes.",
    bpm: 100,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        left: [
          [null, 2],
          [G3, 2],
        ],
        dynamic: "f",
      },
      {
        right: [
          [C4, 2],
          [C4, 1],
          [C4, 1],
        ],
      },
      {
        right: [
          [C4, 2],
          [E4, 2],
        ],
      },
      {
        right: [
          [G4, 2],
          [E4, 2],
        ],
      },
      { right: [[C4, 4]] },
      {
        right: [
          [D4, 2],
          [D4, 2],
        ],
      },
      { right: [[D4, 4]] },
      {
        right: [
          [G4, 2],
          [E4, 2],
        ],
      },
      {
        right: [
          [C4, 2],
          [null, 2],
        ],
        left: [
          [null, 2],
          [G3, 2],
        ],
      },
      {
        left: [
          [C3, 2],
          [C3, 1],
          [C3, 1],
        ],
      },
      {
        left: [
          [C3, 2],
          [E3, 2],
        ],
      },
      {
        left: [
          [G3, 2],
          [E3, 2],
        ],
      },
      { left: [[C3, 4]] },
      {
        right: [
          [D4, 2],
          [F4, 2],
        ],
      },
      {
        right: [
          [E4, 2],
          [D4, 2],
        ],
      },
      { right: [[C4, 4]] },
      {
        left: [
          [C3, 2],
          [C3, 2],
        ],
      },
    ],
  },
  {
    id: "pawpal-old-macdonald-v1",
    title: "Old MacDonald Had a Farm",
    composer: `Traditional · ${credit.toLowerCase()}`,
    description:
      "A lively farm song. The right hand plays the words, the left hand plays each “E-I-E-I-O” on B, A and G.",
    bpm: 108,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      { ...macDonaldLine[0], dynamic: "mf" },
      ...macDonaldLine.slice(1),
      macDonaldPickup,
      ...macDonaldLine,
      macDonaldPickup,
      macDonaldLine[0],
      {
        right: [
          [G4, 1],
          [G4, 1],
          [G4, 2],
        ],
      },
      quackPair,
      quackPair,
      ...macDonaldLine,
      { left: [[G3, 4]] },
    ],
  },
  {
    id: "pawpal-aura-lee-v1",
    title: "Aura Lee",
    composer: `Traditional · ${credit.toLowerCase()}`,
    description:
      "A tender melody that starts in the left hand around middle C. The right hand joins on D, then sings the middle section on E.",
    bpm: 76,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      { ...blackbird[0], dynamic: "p" },
      ...blackbird.slice(1),
      ...blackbird,
      {
        right: [
          [E4, 1],
          [E4, 1],
          [E4, 2],
        ],
      },
      {
        right: [
          [E4, 1],
          [E4, 1],
          [E4, 2],
        ],
      },
      {
        right: [
          [E4, 1],
          [D4, 1],
          [C4, 1],
          [D4, 1],
        ],
      },
      { right: [[E4, 4]] },
      {
        right: [
          [E4, 1],
          [E4, 1],
          [F4, 1],
          [E4, 1],
        ],
      },
      {
        right: [
          [D4, 1],
          [null, 1],
          [D4, 1],
          [D4, 1],
        ],
        left: [
          [null, 1],
          [A3, 1],
          [null, 2],
        ],
      },
      ...blackbird.slice(2),
    ],
  },
];

/**
 * Music Recital Book 3 in display order: the single source for the built-in
 * song order and George Bear’s Classes. Dancing Raindrops (built in
 * lessons.ts) is page 13, between Mister Moon and Five O'Clock.
 */
const raindropsPage =
  classPieces.findIndex((piece) => piece.id === "pawpal-mister-moon-v1") + 1;
export const georgeClassesOrder: readonly string[] = [
  ...classPieces.slice(0, raindropsPage).map((piece) => piece.id),
  "cadence-dancing-raindrops-v1",
  ...classPieces.slice(raindropsPage).map((piece) => piece.id),
];

/** Build a two-hand lesson with the printed rhythm, rests, dynamics and fingers. */
export function classSong(piece: ClassPiece): Song {
  const { id, bpm, beatsPerBar } = piece;
  const position = classPositions[piece.position];
  const beatSeconds = 60 / bpm;
  const notes: Note[] = [];
  const counts = [0, 0];
  let velocity = velocities.mf;
  piece.bars.forEach((bar, barIndex) => {
    if (bar.dynamic) velocity = velocities[bar.dynamic];
    for (const [track, hand] of [
      [0, "left"],
      [1, "right"],
    ] as const) {
      let beat = barIndex * beatsPerBar;
      for (const [pitches, beats, articulation] of bar[hand] ?? []) {
        const start = (1 + beat) * beatSeconds;
        beat += beats;
        if (pitches === null) continue;
        const staccato = articulation === "staccato";
        // Staccato dots sound briefly; a small release gap keeps repeated notes distinct.
        const end = staccato
          ? start + 0.45 * beatSeconds
          : start + beats * beatSeconds - 0.055;
        for (const pitch of typeof pitches === "number" ? [pitches] : pitches) {
          notes.push({
            id: `${id}-${track}-${counts[track]++}`,
            pitch,
            start,
            end,
            soundEnd: end,
            velocity,
            track,
            channel: track,
            finger: position.fingers[hand][pitch],
            fingerHand: hand,
            notatedBeats: beats,
            ...(staccato ? { staccato } : {}),
          });
        }
      }
    }
  });
  return {
    id,
    title: piece.title,
    notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch),
    tracks: [
      { id: 0, name: "Left hand", hand: "left", count: counts[0] },
      { id: 1, name: "Right hand", hand: "right", count: counts[1] },
    ],
    duration: (1 + piece.bars.length * beatsPerBar) * beatSeconds + 0.5,
    ppq: 480,
    beatsPerBar,
    leadInBeats: 1,
    tempos: [{ tick: 0, microseconds: 60_000_000 / bpm }],
    warnings: [],
    lesson: {
      composer: piece.composer,
      description: piece.description,
      level: position.level,
      bpm,
      handPositions: { ...position.handPositions },
    },
  };
}
