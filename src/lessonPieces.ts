import type { ClassPiece } from "./classPieces";

// Personal-practice transcriptions of the student parts of Music for Little
// Mozarts, Lesson Book 3, from the user's photos. Each bar lists what each hand
// plays, in quarter-note beats; null is a printed rest and an omitted hand
// rests for the whole bar. Repeats and endings are written out in play order.
// The teacher duet parts are in lessonDuets.ts; the lyrics are not included.

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

const staccato = "staccato";
const credit = "From your piano book";

/** Music Lesson Book 3 in page order, pages 5 to 47. */
export const lessonPieces: readonly ClassPiece[] = [
  // Page 5
  {
    id: "pawpal-the-professors-rest-v1",
    title: "The Professor's Rest",
    composer: credit,
    description:
      "Quarter rests in Middle C position. The right hand climbs C, E, G and steps back down; then the left hand answers from middle C down to F and back up.",
    bpm: 96,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        right: [
          [C4, 2],
          [E4, 2],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [G4, 1],
          [null, 1],
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
      { right: [[C4, 4]] },
      {
        left: [
          [C4, 2],
          [A3, 2],
        ],
      },
      {
        left: [
          [F3, 1],
          [F3, 1],
          [F3, 1],
          [null, 1],
        ],
      },
      {
        left: [
          [F3, 1],
          [G3, 1],
          [A3, 1],
          [B3, 1],
        ],
      },
      { left: [[C4, 4]] },
    ],
  },
  // Page 6
  {
    id: "pawpal-the-playroom-surprise-v1",
    title: "The Playroom Surprise",
    composer: credit,
    description:
      "A waltz in Middle C position with long dotted half notes. The right hand plays G and E, then steps up C, D, E to D; then the left hand plays middle C and A, and climbs G, A, B back to middle C.",
    bpm: 120,
    beatsPerBar: 3,
    position: "middle-c",
    bars: [
      { right: [[G4, 3]], dynamic: "mf" },
      { right: [[E4, 3]] },
      {
        right: [
          [C4, 1],
          [D4, 1],
          [E4, 1],
        ],
      },
      { right: [[D4, 3]] },
      { left: [[C4, 3]] },
      { left: [[A3, 3]] },
      {
        left: [
          [G3, 1],
          [A3, 1],
          [B3, 1],
        ],
      },
      { left: [[C4, 3]] },
    ],
  },
  // Page 7
  {
    id: "pawpal-in-a-mess-v1",
    title: "In a Mess",
    composer: credit,
    description:
      "C position with quarter rests, played twice. The right hand plays middle C with rests in between; then the left hand plays the C below it (Bass Clef C) four times and three times.",
    bpm: 88,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [C4, 1],
          [null, 1],
          [C4, 1],
          [null, 1],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [C4, 1],
          [C4, 1],
          [C4, 1],
          [null, 1],
        ],
      },
      {
        left: [
          [C3, 1],
          [C3, 1],
          [C3, 1],
          [C3, 1],
        ],
      },
      {
        left: [
          [C3, 1],
          [C3, 1],
          [C3, 1],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 1],
          [null, 1],
          [C4, 1],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 1],
          [C4, 1],
          [C4, 1],
          [null, 1],
        ],
      },
      {
        left: [
          [C3, 1],
          [C3, 1],
          [C3, 1],
          [C3, 1],
        ],
      },
      {
        left: [
          [C3, 1],
          [C3, 1],
          [C3, 1],
          [null, 1],
        ],
      },
    ],
  },
  // Page 8
  {
    id: "pawpal-you-and-me-v1",
    title: "You and Me",
    composer: credit,
    description:
      "A slow waltz in C position. The right hand steps down G, F, E to G and E, D, C to E, with long notes between; then the left hand holds the C below middle C (Bass Clef C) for four bars.",
    bpm: 100,
    beatsPerBar: 3,
    position: "c",
    bars: [
      {
        right: [
          [G4, 1],
          [F4, 1],
          [E4, 1],
        ],
        dynamic: "p",
      },
      { right: [[G4, 3]] },
      {
        right: [
          [E4, 1],
          [D4, 1],
          [C4, 1],
        ],
      },
      { right: [[E4, 3]] },
      { left: [[C3, 3]] },
      { left: [[C3, 3]] },
      { left: [[C3, 3]] },
      { left: [[C3, 3]] },
    ],
  },
  // Page 9
  {
    id: "pawpal-three-d-lightful-friends-v1",
    title: 'Three "D"-lightful Friends',
    composer: credit,
    description:
      "C position with quarter rests. The right hand plays the D just above middle C (finger 2); then the left hand plays Bass Clef D on the middle line (finger 4).",
    bpm: 100,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [D4, 1],
          [null, 1],
          [D4, 1],
          [null, 1],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [D4, 1],
          [D4, 1],
          [D4, 1],
          [null, 1],
        ],
      },
      {
        left: [
          [D3, 1],
          [D3, 1],
          [D3, 1],
          [D3, 1],
        ],
      },
      {
        left: [
          [D3, 1],
          [D3, 1],
          [D3, 1],
          [null, 1],
        ],
      },
    ],
  },
  // Page 10
  {
    id: "pawpal-please-teach-us-v1",
    title: "Please Teach Us",
    composer: credit,
    description:
      "C position. The left hand rocks between Bass Clef D and C in half notes (fingers 4 and 5); the right hand answers with E, E, F, F to G, and later E, E, D, D down to middle C.",
    bpm: 76,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        left: [
          [D3, 2],
          [C3, 2],
        ],
        dynamic: "p",
      },
      {
        left: [
          [D3, 2],
          [C3, 2],
        ],
      },
      {
        right: [
          [E4, 1],
          [E4, 1],
          [F4, 1],
          [F4, 1],
        ],
      },
      { right: [[G4, 4]] },
      {
        left: [
          [D3, 2],
          [C3, 2],
        ],
      },
      {
        left: [
          [D3, 2],
          [C3, 2],
        ],
      },
      {
        right: [
          [E4, 1],
          [E4, 1],
          [D4, 1],
          [D4, 1],
        ],
      },
      { right: [[C4, 4]] },
    ],
  },
  // Page 11
  {
    id: "pawpal-finger-three-on-e-v1",
    title: "Finger 3 on E",
    composer: credit,
    description:
      "Finger 3 on E in C Position. The right hand plays E above middle C with finger 3 for two bars; then the left hand plays the E below middle C with finger 3 for two bars.",
    bpm: 100,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [E4, 1],
          [null, 1],
          [E4, 1],
          [null, 1],
        ],
        dynamic: "f",
      },
      {
        right: [
          [E4, 1],
          [E4, 1],
          [E4, 1],
          [null, 1],
        ],
      },
      {
        left: [
          [E3, 1],
          [E3, 1],
          [E3, 1],
          [E3, 1],
        ],
      },
      {
        left: [
          [E3, 1],
          [E3, 1],
          [E3, 1],
          [null, 1],
        ],
      },
    ],
  },
  // Page 12
  {
    id: "pawpal-steps-and-skips-v1",
    title: "Steps and Skips",
    composer: credit,
    description:
      "A waltz in C Position. The left hand plays long notes E, D, E, C that step and skip down; then the right hand plays G, F, E and steps and skips down to middle C.",
    bpm: 120,
    beatsPerBar: 3,
    position: "c",
    bars: [
      { left: [[E3, 3]], dynamic: "f" },
      { left: [[D3, 3]] },
      { left: [[E3, 3]] },
      { left: [[C3, 3]] },
      {
        right: [
          [G4, 1],
          [F4, 1],
          [E4, 1],
        ],
      },
      {
        right: [
          [D4, 2],
          [E4, 1],
        ],
      },
      {
        right: [
          [C4, 2],
          [E4, 1],
        ],
      },
      { right: [[C4, 3]] },
    ],
  },
  // Page 13
  {
    id: "pawpal-animals-at-school-v1",
    title: "Animals at School",
    composer: credit,
    description:
      "The tune of Mary Had a Little Lamb in C Position. The right hand plays the first half starting on E above middle C; then the left hand plays it in the bass, starting on the E below middle C and ending on C.",
    bpm: 104,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [E4, 1],
          [D4, 1],
          [C4, 1],
          [D4, 1],
        ],
        dynamic: "mf",
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
          [D4, 1],
          [D4, 1],
          [D4, 2],
        ],
      },
      {
        right: [
          [E4, 1],
          [G4, 1],
          [G4, 2],
        ],
      },
      {
        left: [
          [E3, 1],
          [D3, 1],
          [C3, 1],
          [D3, 1],
        ],
      },
      {
        left: [
          [E3, 1],
          [E3, 1],
          [E3, 2],
        ],
      },
      {
        left: [
          [D3, 1],
          [D3, 1],
          [E3, 1],
          [D3, 1],
        ],
      },
      { left: [[C3, 4]] },
    ],
  },
  // Page 14
  {
    id: "pawpal-great-big-day-v1",
    title: "Great Big Day",
    composer: credit,
    description:
      "A left-hand-only piece in C Position. The left hand climbs C, D, E, F to G, steps back down G, F, E, D and lands on C; the whole tune is played twice, once for each verse.",
    bpm: 96,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        left: [
          [C3, 1],
          [D3, 1],
          [E3, 1],
          [F3, 1],
        ],
        dynamic: "f",
      },
      {
        left: [
          [G3, 2],
          [G3, 2],
        ],
      },
      {
        left: [
          [G3, 1],
          [F3, 1],
          [E3, 1],
          [D3, 1],
        ],
      },
      { left: [[C3, 4]] },
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
          [G3, 2],
        ],
      },
      {
        left: [
          [G3, 1],
          [F3, 1],
          [E3, 1],
          [D3, 1],
        ],
      },
      { left: [[C3, 4]] },
    ],
  },
  // Page 15
  {
    id: "pawpal-bouncing-on-the-bus-v1",
    title: "Bouncing on the Bus",
    composer: credit,
    description:
      "Short, bouncy staccato notes in C Position. The left hand climbs C, D, E, F to G and bounces on G; then the right hand does the same from middle C and ends back on C.",
    bpm: 104,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        left: [
          [C3, 1, staccato],
          [D3, 1, staccato],
          [E3, 1, staccato],
          [F3, 1, staccato],
        ],
        dynamic: "mf",
      },
      {
        left: [
          [G3, 1, staccato],
          [G3, 1, staccato],
          [G3, 1, staccato],
          [null, 1],
        ],
      },
      {
        left: [
          [G3, 1, staccato],
          [null, 1],
          [G3, 1, staccato],
          [null, 1],
        ],
      },
      { left: [[G3, 4]] },
      {
        right: [
          [C4, 1, staccato],
          [D4, 1, staccato],
          [E4, 1, staccato],
          [F4, 1, staccato],
        ],
      },
      {
        right: [
          [G4, 1, staccato],
          [G4, 1, staccato],
          [G4, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [F4, 1, staccato],
          [null, 1],
          [E4, 1, staccato],
          [null, 1],
        ],
      },
      { right: [[C4, 4]] },
    ],
  },
  // Page 16
  {
    id: "pawpal-school-rules-v1",
    title: "School Rules",
    composer: credit,
    description:
      "Staccato notes in C Position, played twice. The hands take turns bouncing on C; then the right hand plays D, D, E, E and D, D, D, and later the left hand plays E, E, D, D and C, C, C.",
    bpm: 96,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [null, 1],
          [C4, 1, staccato],
          [null, 1],
          [C4, 1, staccato],
        ],
        left: [
          [C3, 1, staccato],
          [null, 1],
          [C3, 1, staccato],
          [null, 1],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [null, 1],
          [C4, 1, staccato],
          [null, 2],
        ],
        left: [
          [C3, 1, staccato],
          [null, 1],
          [C3, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [D4, 1, staccato],
          [D4, 1, staccato],
          [E4, 1, staccato],
          [E4, 1, staccato],
        ],
      },
      {
        right: [
          [D4, 1, staccato],
          [D4, 1, staccato],
          [D4, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [null, 1],
          [C4, 1, staccato],
          [null, 1],
          [C4, 1, staccato],
        ],
        left: [
          [C3, 1, staccato],
          [null, 1],
          [C3, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [null, 1],
          [C4, 1, staccato],
          [null, 2],
        ],
        left: [
          [C3, 1, staccato],
          [null, 1],
          [C3, 1, staccato],
          [null, 1],
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
          [C3, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [null, 1],
          [C4, 1, staccato],
          [null, 1],
          [C4, 1, staccato],
        ],
        left: [
          [C3, 1, staccato],
          [null, 1],
          [C3, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [null, 1],
          [C4, 1, staccato],
          [null, 2],
        ],
        left: [
          [C3, 1, staccato],
          [null, 1],
          [C3, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [D4, 1, staccato],
          [D4, 1, staccato],
          [E4, 1, staccato],
          [E4, 1, staccato],
        ],
      },
      {
        right: [
          [D4, 1, staccato],
          [D4, 1, staccato],
          [D4, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [null, 1],
          [C4, 1, staccato],
          [null, 1],
          [C4, 1, staccato],
        ],
        left: [
          [C3, 1, staccato],
          [null, 1],
          [C3, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [null, 1],
          [C4, 1, staccato],
          [null, 2],
        ],
        left: [
          [C3, 1, staccato],
          [null, 1],
          [C3, 1, staccato],
          [null, 1],
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
          [C3, 1, staccato],
          [null, 1],
        ],
      },
    ],
  },
  // Page 17
  {
    id: "pawpal-music-class-v1",
    title: "Music Class",
    composer: credit,
    description:
      "Middle C Position with staccato quarter notes. The right hand steps down from G to D and back up, then F, E and a long D; the left hand climbs F, G, A, B, steps back down from middle C, plays B twice and ends on a long middle C.",
    bpm: 96,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        right: [
          [G4, 1, staccato],
          [F4, 1, staccato],
          [E4, 1, staccato],
          [D4, 1, staccato],
        ],
        dynamic: "p",
      },
      {
        right: [
          [C4, 1, staccato],
          [D4, 1, staccato],
          [E4, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [F4, 1, staccato],
          [null, 1],
          [E4, 1, staccato],
          [null, 1],
        ],
      },
      { right: [[D4, 4]] },
      {
        left: [
          [F3, 1, staccato],
          [G3, 1, staccato],
          [A3, 1, staccato],
          [B3, 1, staccato],
        ],
      },
      {
        left: [
          [C4, 1, staccato],
          [B3, 1, staccato],
          [A3, 1, staccato],
          [null, 1],
        ],
      },
      {
        left: [
          [B3, 1, staccato],
          [null, 1],
          [B3, 1, staccato],
          [null, 1],
        ],
      },
      { left: [[C4, 4]] },
    ],
  },
  // Page 18
  {
    id: "pawpal-clara-remembers-v1",
    title: "Clara Remembers",
    composer: credit,
    description:
      "Staccato notes in Middle C Position, played twice for the two verses. The right hand plays F and D back and forth, then C, D, E and F, E, D, C down to a long D; the left hand answers with G and B, steps down from middle C, and ends on a long middle C.",
    bpm: 104,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        right: [
          [F4, 1, staccato],
          [D4, 1, staccato],
          [F4, 1, staccato],
          [D4, 1, staccato],
        ],
        dynamic: "p",
      },
      {
        right: [
          [C4, 1, staccato],
          [D4, 1, staccato],
          [E4, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [F4, 1, staccato],
          [E4, 1, staccato],
          [D4, 1, staccato],
          [C4, 1, staccato],
        ],
      },
      { right: [[D4, 4]] },
      {
        left: [
          [G3, 1, staccato],
          [B3, 1, staccato],
          [G3, 1, staccato],
          [B3, 1, staccato],
        ],
      },
      {
        left: [
          [C4, 1, staccato],
          [B3, 1, staccato],
          [A3, 1, staccato],
          [null, 1],
        ],
      },
      {
        left: [
          [G3, 1, staccato],
          [G3, 1, staccato],
          [A3, 1, staccato],
          [B3, 1, staccato],
        ],
      },
      { left: [[C4, 4]] },
      {
        right: [
          [F4, 1, staccato],
          [D4, 1, staccato],
          [F4, 1, staccato],
          [D4, 1, staccato],
        ],
      },
      {
        right: [
          [C4, 1, staccato],
          [D4, 1, staccato],
          [E4, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [F4, 1, staccato],
          [E4, 1, staccato],
          [D4, 1, staccato],
          [C4, 1, staccato],
        ],
      },
      { right: [[D4, 4]] },
      {
        left: [
          [G3, 1, staccato],
          [B3, 1, staccato],
          [G3, 1, staccato],
          [B3, 1, staccato],
        ],
      },
      {
        left: [
          [C4, 1, staccato],
          [B3, 1, staccato],
          [A3, 1, staccato],
          [null, 1],
        ],
      },
      {
        left: [
          [G3, 1, staccato],
          [G3, 1, staccato],
          [A3, 1, staccato],
          [B3, 1, staccato],
        ],
      },
      { left: [[C4, 4]] },
    ],
  },
  // Page 19
  {
    id: "pawpal-steps-and-seconds-v1",
    title: "Steps and Seconds",
    composer: credit,
    description:
      "A slow waltz in C Position, played twice for the two verses. The right hand steps up C to D twice, then E to F, and holds G; then the left hand steps down G to F twice, then E to D, and holds C.",
    bpm: 100,
    beatsPerBar: 3,
    position: "c",
    bars: [
      {
        right: [
          [C4, 2],
          [D4, 1],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [C4, 2],
          [D4, 1],
        ],
      },
      {
        right: [
          [E4, 2],
          [F4, 1],
        ],
      },
      { right: [[G4, 3]] },
      {
        left: [
          [G3, 2],
          [F3, 1],
        ],
      },
      {
        left: [
          [G3, 2],
          [F3, 1],
        ],
      },
      {
        left: [
          [E3, 2],
          [D3, 1],
        ],
      },
      { left: [[C3, 3]] },
      {
        right: [
          [C4, 2],
          [D4, 1],
        ],
      },
      {
        right: [
          [C4, 2],
          [D4, 1],
        ],
      },
      {
        right: [
          [E4, 2],
          [F4, 1],
        ],
      },
      { right: [[G4, 3]] },
      {
        left: [
          [G3, 2],
          [F3, 1],
        ],
      },
      {
        left: [
          [G3, 2],
          [F3, 1],
        ],
      },
      {
        left: [
          [E3, 2],
          [D3, 1],
        ],
      },
      { left: [[C3, 3]] },
    ],
  },
  // Page 20
  {
    id: "pawpal-talent-show-v1",
    title: "Talent Show!",
    composer: credit,
    description:
      "A grand, loud piece in C Position. The right hand plays C, D, C and D, E, D, climbs E, E, F, G and holds F; then the left hand answers G, F, G and F, E, F, rocks E, D, E, D and holds C.",
    bpm: 88,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [C4, 1],
          [D4, 1],
          [C4, 2],
        ],
        dynamic: "f",
      },
      {
        right: [
          [D4, 1],
          [E4, 1],
          [D4, 2],
        ],
      },
      {
        right: [
          [E4, 1],
          [E4, 1],
          [F4, 1],
          [G4, 1],
        ],
      },
      { right: [[F4, 4]] },
      {
        left: [
          [G3, 1],
          [F3, 1],
          [G3, 2],
        ],
      },
      {
        left: [
          [F3, 1],
          [E3, 1],
          [F3, 2],
        ],
      },
      {
        left: [
          [E3, 1],
          [D3, 1],
          [E3, 1],
          [D3, 1],
        ],
      },
      { left: [[C3, 4]] },
    ],
  },
  // Page 21
  {
    id: "pawpal-play-together-v1",
    title: "Play Together",
    composer: credit,
    description:
      "Quarter notes in Middle C position. The left hand rocks between neighbouring notes from middle C down to F and climbs back to middle C; then the right hand rocks up from middle C to F and walks down from G to middle C.",
    bpm: 100,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        left: [
          [C4, 1],
          [B3, 1],
          [C4, 1],
          [B3, 1],
        ],
        dynamic: "mf",
      },
      {
        left: [
          [A3, 1],
          [G3, 1],
          [A3, 1],
          [G3, 1],
        ],
      },
      {
        left: [
          [F3, 1],
          [G3, 1],
          [A3, 1],
          [B3, 1],
        ],
      },
      { left: [[C4, 4]] },
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
          [F4, 1],
          [E4, 1],
          [F4, 1],
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
      { right: [[C4, 4]] },
    ],
  },
  // Page 22
  {
    id: "pawpal-thirds-v1",
    title: "Thirds",
    composer: credit,
    description:
      "Skips of a third in C position, in 3/4 time. The right hand skips up C, E, G and back to E; then the left hand skips down G, E and ends on low C.",
    bpm: 76,
    beatsPerBar: 3,
    position: "c",
    bars: [
      { right: [[C4, 3]], dynamic: "mf" },
      { right: [[E4, 3]] },
      {
        right: [
          [G4, 2],
          [E4, 1],
        ],
      },
      { right: [[G4, 3]] },
      { left: [[G3, 3]] },
      { left: [[E3, 3]] },
      {
        left: [
          [G3, 2],
          [E3, 1],
        ],
      },
      { left: [[C3, 3]] },
    ],
  },
  // Page 23
  {
    id: "pawpal-a-happy-dance-v1",
    title: "A Happy Dance",
    composer: credit,
    description:
      "Skipping thirds in C position. The right hand skips C-E and taps G three times, then ends on E; the left hand answers with G-E skips, a C-E-G climb, and ends on low C.",
    bpm: 112,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [C4, 1],
          [E4, 1],
          [C4, 1],
          [E4, 1],
        ],
        dynamic: "f",
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [G4, 1],
          [null, 1],
        ],
      },
      {
        right: [
          [E4, 2],
          [C4, 2],
        ],
      },
      { right: [[E4, 4]] },
      {
        left: [
          [G3, 1],
          [E3, 1],
          [G3, 1],
          [E3, 1],
        ],
      },
      {
        left: [
          [C3, 1],
          [E3, 1],
          [G3, 1],
          [null, 1],
        ],
      },
      {
        left: [
          [E3, 2],
          [E3, 2],
        ],
      },
      { left: [[C3, 4]] },
    ],
  },
  // Page 24
  {
    id: "pawpal-haydns-symphony-v1",
    title: "Haydn's Symphony",
    composer: credit,
    description:
      "Short, detached (staccato) notes in Middle C position, on a tune from Haydn's Surprise Symphony. The right hand plays repeated notes in skips (C, E, G, F, D) and the left hand answers with B and G below middle C.",
    bpm: 96,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        right: [
          [C4, 1, staccato],
          [C4, 1, staccato],
          [E4, 1, staccato],
          [E4, 1, staccato],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [G4, 1, staccato],
          [G4, 1, staccato],
          [E4, 2],
        ],
      },
      {
        right: [
          [F4, 1, staccato],
          [F4, 1, staccato],
          [D4, 1, staccato],
          [D4, 1, staccato],
        ],
      },
      {
        left: [
          [B3, 1, staccato],
          [B3, 1, staccato],
          [G3, 2],
        ],
      },
      {
        right: [
          [C4, 1, staccato],
          [C4, 1, staccato],
          [E4, 1, staccato],
          [E4, 1, staccato],
        ],
      },
      {
        right: [
          [G4, 1, staccato],
          [G4, 1, staccato],
          [E4, 2],
        ],
      },
      {
        right: [
          [F4, 1, staccato],
          [D4, 1, staccato],
          [null, 2],
        ],
        left: [
          [null, 2],
          [B3, 1, staccato],
          [G3, 1, staccato],
        ],
      },
      {
        right: [
          [C4, 1, staccato],
          [E4, 1, staccato],
          [C4, 2],
        ],
      },
    ],
  },
  // Page 25
  {
    id: "pawpal-music-box-dance-v1",
    title: "Music Box Dance",
    composer: credit,
    description:
      "Half notes and whole notes in Middle C position. The right hand plays F-D, C-E and G (and later ends on middle C); in between, the left hand answers with B-G just below middle C.",
    bpm: 96,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        right: [
          [F4, 2],
          [D4, 2],
        ],
        dynamic: "mf",
      },
      {
        left: [
          [B3, 2],
          [G3, 2],
        ],
      },
      {
        right: [
          [C4, 2],
          [E4, 2],
        ],
      },
      { right: [[G4, 4]] },
      {
        right: [
          [F4, 2],
          [D4, 2],
        ],
      },
      {
        left: [
          [B3, 2],
          [G3, 2],
        ],
      },
      {
        right: [
          [C4, 2],
          [E4, 2],
        ],
      },
      { right: [[C4, 4]] },
    ],
  },
  // Page 26
  {
    id: "pawpal-honey-pot-v1",
    title: "Honey Pot",
    composer: credit,
    description:
      "Smooth, connected (legato) steps in Middle C Position. The right hand rocks between middle C and D and lands on E; then the left hand answers, rocking between middle C and B and landing on A. The whole piece is played twice.",
    bpm: 100,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        right: [
          [C4, 1],
          [D4, 1],
          [C4, 1],
          [D4, 1],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [E4, 2],
          [null, 2],
        ],
      },
      {
        left: [
          [C4, 1],
          [B3, 1],
          [C4, 1],
          [B3, 1],
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
          [E4, 2],
          [null, 2],
        ],
      },
      {
        left: [
          [C4, 1],
          [B3, 1],
          [C4, 1],
          [B3, 1],
        ],
      },
      { left: [[A3, 4]] },
    ],
  },
  // Page 27
  {
    id: "pawpal-the-hungry-tummy-v1",
    title: "The Hungry Tummy",
    composer: credit,
    description:
      "Smooth skips in Middle C Position. The right hand skips C-E-C-E, then plays D and back to C; the left hand answers with C-A-C-A, then B and back to C. The whole piece is played twice.",
    bpm: 76,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        right: [
          [C4, 1],
          [E4, 1],
          [C4, 1],
          [E4, 1],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [D4, 2],
          [C4, 1],
          [null, 1],
        ],
      },
      {
        left: [
          [C4, 1],
          [A3, 1],
          [C4, 1],
          [A3, 1],
        ],
      },
      {
        left: [
          [B3, 2],
          [C4, 1],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 1],
          [E4, 1],
          [C4, 1],
          [E4, 1],
        ],
      },
      {
        right: [
          [D4, 2],
          [C4, 1],
          [null, 1],
        ],
      },
      {
        left: [
          [C4, 1],
          [A3, 1],
          [C4, 1],
          [A3, 1],
        ],
      },
      {
        left: [
          [B3, 2],
          [C4, 1],
          [null, 1],
        ],
      },
    ],
  },
  // Page 28
  {
    id: "pawpal-finger-walk-v1",
    title: "Finger Walk",
    composer: credit,
    description:
      "Legato walking in C Position. The right hand steps C-D, C-D, then walks up C-D-E-F to G; then the left hand steps G-F, G-F, and walks down G-F-E-D to C.",
    bpm: 112,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [C4, 2],
          [D4, 2],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [C4, 2],
          [D4, 2],
        ],
      },
      {
        right: [
          [C4, 1],
          [D4, 1],
          [E4, 1],
          [F4, 1],
        ],
      },
      {
        right: [
          [G4, 2],
          [null, 2],
        ],
      },
      {
        left: [
          [G3, 2],
          [F3, 2],
        ],
      },
      {
        left: [
          [G3, 2],
          [F3, 2],
        ],
      },
      {
        left: [
          [G3, 1],
          [F3, 1],
          [E3, 1],
          [D3, 1],
        ],
      },
      {
        left: [
          [C3, 2],
          [null, 2],
        ],
      },
    ],
  },
  // Page 29
  {
    id: "pawpal-beethoven-bear-remembers-v1",
    title: "Beethoven Bear Remembers",
    composer: credit,
    description:
      "A gentle waltz in 3/4 in C Position. The right hand plays C-E-C and holds E, then G-E-C and holds D; the left hand answers with G-E-G and holds E, then G-E-D and holds C.",
    bpm: 108,
    beatsPerBar: 3,
    position: "c",
    bars: [
      {
        right: [
          [C4, 1],
          [E4, 1],
          [C4, 1],
        ],
        dynamic: "p",
      },
      {
        right: [
          [E4, 2],
          [null, 1],
        ],
      },
      {
        right: [
          [G4, 1],
          [E4, 1],
          [C4, 1],
        ],
      },
      {
        right: [
          [D4, 2],
          [null, 1],
        ],
      },
      {
        left: [
          [G3, 1],
          [E3, 1],
          [G3, 1],
        ],
      },
      {
        left: [
          [E3, 2],
          [null, 1],
        ],
      },
      {
        left: [
          [G3, 1],
          [E3, 1],
          [D3, 1],
        ],
      },
      {
        left: [
          [C3, 2],
          [null, 1],
        ],
      },
    ],
  },
  // Page 30
  {
    id: "pawpal-nannerls-lesson-v1",
    title: "Nannerl's Lesson",
    composer: credit,
    description:
      "Right hand only, in C Position. First a second (C and D) and a third (C and E) are played one note at a time, then both notes are played together. The whole piece is played twice.",
    bpm: 96,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [C4, 1],
          [D4, 1],
          [C4, 1],
          [D4, 1],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [C4, 1],
          [E4, 1],
          [C4, 1],
          [E4, 1],
        ],
      },
      {
        right: [
          [[C4, D4], 2],
          [[C4, D4], 2],
        ],
      },
      {
        right: [
          [[C4, E4], 2],
          [[C4, E4], 2],
        ],
      },
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
          [C4, 1],
          [E4, 1],
          [C4, 1],
          [E4, 1],
        ],
      },
      {
        right: [
          [[C4, D4], 2],
          [[C4, D4], 2],
        ],
      },
      {
        right: [
          [[C4, E4], 2],
          [[C4, E4], 2],
        ],
      },
    ],
  },
  // Page 31
  {
    id: "pawpal-a-mouses-turn-v1",
    title: "A Mouse's Turn",
    composer: credit,
    description:
      "Left hand only, in C Position. It plays G and F, then G and E, one note at a time, then plays the same keys together as seconds and thirds. The piece is played twice.",
    bpm: 96,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        left: [
          [G3, 1],
          [F3, 1],
          [G3, 1],
          [F3, 1],
        ],
        dynamic: "mf",
      },
      {
        left: [
          [G3, 1],
          [E3, 1],
          [G3, 1],
          [E3, 1],
        ],
      },
      {
        left: [
          [[F3, G3], 2],
          [[F3, G3], 2],
        ],
      },
      {
        left: [
          [[E3, G3], 2],
          [[E3, G3], 2],
        ],
      },
      {
        left: [
          [G3, 1],
          [F3, 1],
          [G3, 1],
          [F3, 1],
        ],
      },
      {
        left: [
          [G3, 1],
          [E3, 1],
          [G3, 1],
          [E3, 1],
        ],
      },
      {
        left: [
          [[F3, G3], 2],
          [[F3, G3], 2],
        ],
      },
      {
        left: [
          [[E3, G3], 2],
          [[E3, G3], 2],
        ],
      },
    ],
  },
  // Page 32
  {
    id: "pawpal-beethoven-bears-amazing-trick-v1",
    title: "Beethoven Bear's Amazing Trick",
    composer: credit,
    description:
      "A waltz in C Position. The left hand plays short two-note chords, first F and G together, then E and G together. Then the right hand plays G three times and slides down F, E, D to C. The piece is played twice.",
    bpm: 120,
    beatsPerBar: 3,
    position: "c",
    bars: [
      {
        left: [
          [[F3, G3], 1, staccato],
          [[F3, G3], 1, staccato],
          [[F3, G3], 1, staccato],
        ],
        dynamic: "f",
      },
      {
        left: [
          [[F3, G3], 1, staccato],
          [[F3, G3], 1, staccato],
          [[F3, G3], 1, staccato],
        ],
      },
      {
        left: [
          [[E3, G3], 1, staccato],
          [[E3, G3], 1, staccato],
          [[E3, G3], 1, staccato],
        ],
      },
      {
        left: [
          [[E3, G3], 1, staccato],
          [[E3, G3], 1, staccato],
          [[E3, G3], 1, staccato],
        ],
      },
      {
        right: [
          [G4, 1, staccato],
          [G4, 1, staccato],
          [G4, 1, staccato],
        ],
      },
      {
        right: [
          [F4, 1],
          [E4, 1],
          [D4, 1],
        ],
      },
      { right: [[C4, 3]] },
      { right: [[C4, 3]] },
      {
        left: [
          [[F3, G3], 1, staccato],
          [[F3, G3], 1, staccato],
          [[F3, G3], 1, staccato],
        ],
      },
      {
        left: [
          [[F3, G3], 1, staccato],
          [[F3, G3], 1, staccato],
          [[F3, G3], 1, staccato],
        ],
      },
      {
        left: [
          [[E3, G3], 1, staccato],
          [[E3, G3], 1, staccato],
          [[E3, G3], 1, staccato],
        ],
      },
      {
        left: [
          [[E3, G3], 1, staccato],
          [[E3, G3], 1, staccato],
          [[E3, G3], 1, staccato],
        ],
      },
      {
        right: [
          [G4, 1, staccato],
          [G4, 1, staccato],
          [G4, 1, staccato],
        ],
      },
      {
        right: [
          [F4, 1],
          [E4, 1],
          [D4, 1],
        ],
      },
      { right: [[C4, 3]] },
      { right: [[C4, 3]] },
    ],
  },
  // Page 33
  {
    id: "pawpal-bedtime-snacks-v1",
    title: "Bedtime Snacks",
    composer: credit,
    description:
      "Middle C Position. The right hand plays C and D together twice, then C and E together. Then the left hand climbs G, G, A, B up to middle C. The piece is played twice.",
    bpm: 104,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        right: [
          [[C4, D4], 1, staccato],
          [[C4, D4], 1, staccato],
          [[C4, E4], 2],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [[C4, D4], 1, staccato],
          [[C4, D4], 1, staccato],
          [[C4, E4], 2],
        ],
      },
      {
        left: [
          [G3, 1, staccato],
          [G3, 1, staccato],
          [A3, 1, staccato],
          [B3, 1, staccato],
        ],
      },
      {
        left: [
          [C4, 1, staccato],
          [C4, 1, staccato],
          [C4, 2],
        ],
      },
      {
        right: [
          [[C4, D4], 1, staccato],
          [[C4, D4], 1, staccato],
          [[C4, E4], 2],
        ],
      },
      {
        right: [
          [[C4, D4], 1, staccato],
          [[C4, D4], 1, staccato],
          [[C4, E4], 2],
        ],
      },
      {
        left: [
          [G3, 1, staccato],
          [G3, 1, staccato],
          [A3, 1, staccato],
          [B3, 1, staccato],
        ],
      },
      {
        left: [
          [C4, 1, staccato],
          [C4, 1, staccato],
          [C4, 2],
        ],
      },
    ],
  },
  // Page 34
  {
    id: "pawpal-hands-together-v1",
    title: "Hands Together",
    composer: credit,
    description:
      "The first hands-together piece, in C Position. The left hand holds low C for three beats in every bar. Over it the right hand plays C, C, C, then C-D-E, then E, E, E, then E-D-C. The piece is played twice.",
    bpm: 96,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [C4, 1, staccato],
          [C4, 1, staccato],
          [C4, 1, staccato],
          [null, 1],
        ],
        left: [
          [C3, 3],
          [null, 1],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [C4, 1],
          [D4, 1],
          [E4, 1],
          [null, 1],
        ],
        left: [
          [C3, 3],
          [null, 1],
        ],
      },
      {
        right: [
          [E4, 1, staccato],
          [E4, 1, staccato],
          [E4, 1, staccato],
          [null, 1],
        ],
        left: [
          [C3, 3],
          [null, 1],
        ],
      },
      {
        right: [
          [E4, 1],
          [D4, 1],
          [C4, 1],
          [null, 1],
        ],
        left: [
          [C3, 3],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 1, staccato],
          [C4, 1, staccato],
          [C4, 1, staccato],
          [null, 1],
        ],
        left: [
          [C3, 3],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 1],
          [D4, 1],
          [E4, 1],
          [null, 1],
        ],
        left: [
          [C3, 3],
          [null, 1],
        ],
      },
      {
        right: [
          [E4, 1, staccato],
          [E4, 1, staccato],
          [E4, 1, staccato],
          [null, 1],
        ],
        left: [
          [C3, 3],
          [null, 1],
        ],
      },
      {
        right: [
          [E4, 1],
          [D4, 1],
          [C4, 1],
          [null, 1],
        ],
        left: [
          [C3, 3],
          [null, 1],
        ],
      },
    ],
  },
  // Page 35
  {
    id: "pawpal-hands-together-again-v1",
    title: "Hands Together, Again",
    composer: credit,
    description:
      "Hands together in C Position, with the hands' jobs swapped. The right hand holds middle C for three beats in every bar. Under it the left hand plays E, E, E, then E-F-G, then G, G, G, then G-F-E. The piece is played twice.",
    bpm: 96,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [C4, 3],
          [null, 1],
        ],
        left: [
          [E3, 1, staccato],
          [E3, 1, staccato],
          [E3, 1, staccato],
          [null, 1],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [C4, 3],
          [null, 1],
        ],
        left: [
          [E3, 1],
          [F3, 1],
          [G3, 1],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 3],
          [null, 1],
        ],
        left: [
          [G3, 1, staccato],
          [G3, 1, staccato],
          [G3, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 3],
          [null, 1],
        ],
        left: [
          [G3, 1],
          [F3, 1],
          [E3, 1],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 3],
          [null, 1],
        ],
        left: [
          [E3, 1, staccato],
          [E3, 1, staccato],
          [E3, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 3],
          [null, 1],
        ],
        left: [
          [E3, 1],
          [F3, 1],
          [G3, 1],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 3],
          [null, 1],
        ],
        left: [
          [G3, 1, staccato],
          [G3, 1, staccato],
          [G3, 1, staccato],
          [null, 1],
        ],
      },
      {
        right: [
          [C4, 3],
          [null, 1],
        ],
        left: [
          [G3, 1],
          [F3, 1],
          [E3, 1],
          [null, 1],
        ],
      },
    ],
  },
  // Page 36
  {
    id: "pawpal-all-of-you-v1",
    title: "All of You",
    composer: credit,
    description:
      "Hands together in Middle C position. The right hand holds E above middle C while the left hand steps down from middle C to A and back up from G to B; then both hands play long notes together.",
    bpm: 96,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        right: [[E4, 4]],
        left: [
          [C4, 2],
          [B3, 1],
          [A3, 1],
        ],
        dynamic: "f",
      },
      {
        right: [[E4, 4]],
        left: [
          [G3, 2],
          [A3, 1],
          [B3, 1],
        ],
      },
      {
        right: [
          [E4, 2],
          [E4, 2],
        ],
        left: [
          [C4, 2],
          [C4, 2],
        ],
      },
      {
        right: [
          [E4, 2],
          [null, 2],
        ],
        left: [
          [C4, 2],
          [null, 2],
        ],
      },
      {
        right: [[E4, 4]],
        left: [
          [C4, 2],
          [B3, 1],
          [A3, 1],
        ],
      },
      {
        right: [[E4, 4]],
        left: [
          [G3, 2],
          [A3, 1],
          [B3, 1],
        ],
      },
      {
        right: [
          [E4, 2],
          [E4, 2],
        ],
        left: [
          [C4, 2],
          [C4, 2],
        ],
      },
      {
        right: [
          [E4, 2],
          [null, 2],
        ],
        left: [
          [C4, 2],
          [null, 2],
        ],
      },
    ],
  },
  // Page 37
  {
    id: "pawpal-a-special-dance-v1",
    title: "A Special Dance",
    composer: credit,
    description:
      "A waltz in Middle C position. The right hand walks up C, D, E to G and back down again, while the left hand holds the G below middle C for three beats in every bar.",
    bpm: 100,
    beatsPerBar: 3,
    position: "middle-c",
    bars: [
      {
        right: [
          [C4, 1],
          [D4, 1],
          [E4, 1],
        ],
        left: [[G3, 3]],
        dynamic: "mf",
      },
      {
        right: [
          [G4, 2],
          [G4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [E4, 1],
          [D4, 1],
          [C4, 1],
        ],
        left: [[G3, 3]],
      },
      { right: [[D4, 3]], left: [[G3, 3]] },
      {
        right: [
          [D4, 1],
          [E4, 1],
          [F4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [G4, 2],
          [G4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [F4, 1],
          [E4, 1],
          [D4, 1],
        ],
        left: [[G3, 3]],
      },
      { right: [[C4, 3]], left: [[G3, 3]] },
      {
        right: [
          [C4, 1],
          [D4, 1],
          [E4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [G4, 2],
          [G4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [E4, 1],
          [D4, 1],
          [C4, 1],
        ],
        left: [[G3, 3]],
      },
      { right: [[D4, 3]], left: [[G3, 3]] },
      {
        right: [
          [D4, 1],
          [E4, 1],
          [F4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [G4, 2],
          [G4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [F4, 1],
          [E4, 1],
          [D4, 1],
        ],
        left: [[G3, 3]],
      },
      { right: [[C4, 3]], left: [[G3, 3]] },
    ],
  },
  // Page 38
  {
    id: "pawpal-fourths-v1",
    title: "Fourths",
    composer: credit,
    description:
      "Short, bouncy (staccato) fourths in Middle C position. First the right hand hops between middle C and F, then the left hand hops between G and middle C.",
    bpm: 96,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        right: [
          [C4, 1, staccato],
          [F4, 1, staccato],
          [C4, 1, staccato],
          [F4, 1, staccato],
        ],
        dynamic: "f",
      },
      {
        right: [
          [C4, 1, staccato],
          [F4, 1, staccato],
          [F4, 2],
        ],
      },
      {
        left: [
          [G3, 1, staccato],
          [G3, 1, staccato],
          [G3, 1, staccato],
          [G3, 1, staccato],
        ],
      },
      {
        left: [
          [C4, 1, staccato],
          [C4, 1, staccato],
          [C4, 2],
        ],
      },
      {
        right: [
          [C4, 1, staccato],
          [F4, 1, staccato],
          [C4, 1, staccato],
          [F4, 1, staccato],
        ],
      },
      {
        right: [
          [C4, 1, staccato],
          [F4, 1, staccato],
          [F4, 2],
        ],
      },
      {
        left: [
          [G3, 1, staccato],
          [G3, 1, staccato],
          [G3, 1, staccato],
          [G3, 1, staccato],
        ],
      },
      {
        left: [
          [C4, 1, staccato],
          [C4, 1, staccato],
          [C4, 2],
        ],
      },
    ],
  },
  // Page 39
  {
    id: "pawpal-elgars-fourth-v1",
    title: "Elgar's Fourth",
    composer: credit,
    description:
      "Long, slow notes in C Position. The right hand plays D and G (a fourth apart) like a trombone call, then the left hand answers with G and D below middle C.",
    bpm: 96,
    beatsPerBar: 3,
    position: "c",
    bars: [
      { right: [[D4, 3]], dynamic: "p" },
      { right: [[G4, 3]] },
      {
        right: [
          [D4, 2],
          [G4, 1],
        ],
      },
      { right: [[G4, 3]] },
      { left: [[G3, 3]] },
      { left: [[D3, 3]] },
      {
        left: [
          [G3, 2],
          [D3, 1],
        ],
      },
      { left: [[G3, 3]] },
      { right: [[D4, 3]] },
      { right: [[G4, 3]] },
      {
        right: [
          [D4, 2],
          [G4, 1],
        ],
      },
      { right: [[G4, 3]] },
      { left: [[G3, 3]] },
      { left: [[D3, 3]] },
      {
        left: [
          [G3, 2],
          [D3, 1],
        ],
      },
      { left: [[G3, 3]] },
    ],
  },
  // Page 40
  {
    id: "pawpal-please-v1",
    title: "Please!",
    composer: credit,
    description:
      "Middle C position, played loud the first time and soft the second. The right hand plays E, C, D and D, E, C, and the left hand answers on G; then the left hand holds a G and middle C chord for four bars with the pedal down, getting softer each bar.",
    bpm: 96,
    beatsPerBar: 3,
    position: "middle-c",
    bars: [
      {
        right: [
          [E4, 1],
          [C4, 1],
          [D4, 1],
        ],
        dynamic: "f",
      },
      { left: [[G3, 3]] },
      {
        right: [
          [null, 1],
          [D4, 1],
          [E4, 1],
        ],
        left: [
          [G3, 1],
          [null, 1],
          [null, 1],
        ],
      },
      { right: [[C4, 3]] },
      {
        right: [
          [E4, 1],
          [C4, 1],
          [D4, 1],
        ],
        dynamic: "p",
      },
      { left: [[G3, 3]] },
      {
        right: [
          [null, 1],
          [D4, 1],
          [E4, 1],
        ],
        left: [
          [G3, 1],
          [null, 1],
          [null, 1],
        ],
      },
      { right: [[C4, 3]] },
      { left: [[[G3, C4], 3]], dynamic: "f" },
      { left: [[[G3, C4], 3]], dynamic: "mf" },
      { left: [[[G3, C4], 3]], dynamic: "mp" },
      { left: [[[G3, C4], 3]], dynamic: "p" },
    ],
  },
  // Page 41
  {
    id: "pawpal-nannerls-waltz-v1",
    title: "Nannerl's Waltz",
    composer: credit,
    description:
      "A gentle waltz in C Position, played twice. The right hand starts on G, E, F, then swings between D and G and ends on E, while the left-hand thumb holds G for every bar.",
    bpm: 100,
    beatsPerBar: 3,
    position: "c",
    bars: [
      {
        right: [
          [G4, 1],
          [E4, 1],
          [F4, 1],
        ],
        left: [[G3, 3]],
        dynamic: "mf",
      },
      {
        right: [
          [G4, 2],
          [E4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [D4, 2],
          [G4, 1],
        ],
        left: [[G3, 3]],
      },
      { right: [[D4, 3]], left: [[G3, 3]] },
      {
        right: [
          [D4, 2],
          [G4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [D4, 2],
          [G4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [F4, 1],
          [E4, 1],
          [D4, 1],
        ],
        left: [[G3, 3]],
      },
      { right: [[E4, 3]], left: [[G3, 3]] },
      {
        right: [
          [G4, 1],
          [E4, 1],
          [F4, 1],
        ],
        left: [[G3, 3]],
        dynamic: "mf",
      },
      {
        right: [
          [G4, 2],
          [E4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [D4, 2],
          [G4, 1],
        ],
        left: [[G3, 3]],
      },
      { right: [[D4, 3]], left: [[G3, 3]] },
      {
        right: [
          [D4, 2],
          [G4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [D4, 2],
          [G4, 1],
        ],
        left: [[G3, 3]],
      },
      {
        right: [
          [F4, 1],
          [E4, 1],
          [D4, 1],
        ],
        left: [[G3, 3]],
      },
      { right: [[E4, 3]], left: [[G3, 3]] },
    ],
  },
  // Page 42
  {
    id: "pawpal-fifths-v1",
    title: "Fifths",
    composer: credit,
    description:
      "Fifths in C Position, played twice. Each hand skips between C and G with short, detached notes; the right hand plays C and G together once, and the left hand ends with C and G together.",
    bpm: 104,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [null, 2],
          [C4, 1, staccato],
          [G4, 1, staccato],
        ],
        left: [
          [C3, 1, staccato],
          [G3, 1, staccato],
          [null, 2],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [null, 2],
          [[C4, G4], 2],
        ],
        left: [
          [C3, 1, staccato],
          [G3, 1, staccato],
          [null, 2],
        ],
      },
      {
        right: [
          [G4, 1, staccato],
          [C4, 1, staccato],
          [null, 2],
        ],
        left: [
          [null, 2],
          [G3, 1, staccato],
          [C3, 1, staccato],
        ],
      },
      {
        right: [
          [G4, 1, staccato],
          [C4, 1, staccato],
          [null, 2],
        ],
        left: [
          [null, 2],
          [[C3, G3], 2],
        ],
      },
      {
        right: [
          [null, 2],
          [C4, 1, staccato],
          [G4, 1, staccato],
        ],
        left: [
          [C3, 1, staccato],
          [G3, 1, staccato],
          [null, 2],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [null, 2],
          [[C4, G4], 2],
        ],
        left: [
          [C3, 1, staccato],
          [G3, 1, staccato],
          [null, 2],
        ],
      },
      {
        right: [
          [G4, 1, staccato],
          [C4, 1, staccato],
          [null, 2],
        ],
        left: [
          [null, 2],
          [G3, 1, staccato],
          [C3, 1, staccato],
        ],
      },
      {
        right: [
          [G4, 1, staccato],
          [C4, 1, staccato],
          [null, 2],
        ],
        left: [
          [null, 2],
          [[C3, G3], 2],
        ],
      },
    ],
  },
  // Page 43
  {
    id: "pawpal-j-s-bunnys-fifth-v1",
    title: "J. S. Bunny's Fifth",
    composer: credit,
    description:
      "Long dotted half notes in Middle C Position, played twice. The left hand plays F up to middle C, the right hand answers with G, C, E, G and F, and the left hand ends on F.",
    bpm: 100,
    beatsPerBar: 3,
    position: "middle-c",
    bars: [
      { left: [[F3, 3]], dynamic: "p" },
      { left: [[C4, 3]] },
      { right: [[G4, 3]] },
      { right: [[C4, 3]] },
      { right: [[E4, 3]] },
      { right: [[G4, 3]] },
      { right: [[F4, 3]] },
      { left: [[F3, 3]] },
      { left: [[F3, 3]], dynamic: "p" },
      { left: [[C4, 3]] },
      { right: [[G4, 3]] },
      { right: [[C4, 3]] },
      { right: [[E4, 3]] },
      { right: [[G4, 3]] },
      { right: [[F4, 3]] },
      { left: [[F3, 3]] },
    ],
  },
  // Page 44
  {
    id: "pawpal-the-bowing-song-v1",
    title: "The Bowing Song",
    composer: credit,
    description:
      "Harmonic fifths and steps in C Position. The right hand plays C and G together, loudly; then the left hand walks down and up from G, and at the end steps from G down to C.",
    bpm: 96,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [[C4, G4], 2],
          [[C4, G4], 2],
        ],
        dynamic: "f",
      },
      {
        right: [
          [[C4, G4], 1],
          [[C4, G4], 1],
          [[C4, G4], 2],
        ],
      },
      {
        left: [
          [G3, 1],
          [G3, 1],
          [F3, 1],
          [F3, 1],
        ],
        dynamic: "mf",
      },
      {
        left: [
          [E3, 1],
          [F3, 1],
          [G3, 2],
        ],
      },
      {
        right: [
          [[C4, G4], 2],
          [[C4, G4], 2],
        ],
        dynamic: "f",
      },
      {
        right: [
          [[C4, G4], 1],
          [[C4, G4], 1],
          [[C4, G4], 2],
        ],
      },
      {
        left: [
          [G3, 1],
          [F3, 1],
          [E3, 1],
          [D3, 1],
        ],
        dynamic: "mf",
      },
      {
        left: [
          [C3, 1],
          [C3, 1],
          [C3, 2],
        ],
      },
    ],
  },
  // Page 45
  {
    id: "pawpal-performance-rules-v1",
    title: "Performance Rules",
    composer: credit,
    description:
      "Middle C Position, played twice. The left hand plays F, F, A, A and the right hand answers with C, C, D and a long middle C; near the end the right hand plays two long F's and the left hand finishes on a long F.",
    bpm: 100,
    beatsPerBar: 4,
    position: "middle-c",
    bars: [
      {
        left: [
          [F3, 1],
          [F3, 1],
          [A3, 1],
          [A3, 1],
        ],
        dynamic: "f",
      },
      {
        right: [
          [C4, 1],
          [C4, 1],
          [D4, 2],
        ],
      },
      {
        left: [
          [F3, 1],
          [F3, 1],
          [A3, 1],
          [A3, 1],
        ],
      },
      { right: [[C4, 4]] },
      {
        left: [
          [F3, 1],
          [F3, 1],
          [A3, 1],
          [A3, 1],
        ],
      },
      {
        right: [
          [C4, 1],
          [C4, 1],
          [D4, 2],
        ],
      },
      {
        right: [
          [F4, 2],
          [F4, 2],
        ],
      },
      { left: [[F3, 4]] },
      {
        left: [
          [F3, 1],
          [F3, 1],
          [A3, 1],
          [A3, 1],
        ],
      },
      {
        right: [
          [C4, 1],
          [C4, 1],
          [D4, 2],
        ],
      },
      {
        left: [
          [F3, 1],
          [F3, 1],
          [A3, 1],
          [A3, 1],
        ],
      },
      { right: [[C4, 4]] },
      {
        left: [
          [F3, 1],
          [F3, 1],
          [A3, 1],
          [A3, 1],
        ],
      },
      {
        right: [
          [C4, 1],
          [C4, 1],
          [D4, 2],
        ],
      },
      {
        right: [
          [F4, 2],
          [F4, 2],
        ],
      },
      { left: [[F3, 4]] },
    ],
  },
  // Page 47
  {
    id: "pawpal-our-grand-finale-v1",
    title: "Our Grand Finale",
    composer: credit,
    description:
      "C Position. The left hand plays a C and G together on every beat while the right hand sings G and three C's; this part is played twice, loud then soft. Then the hands take turns (right hand G, G, F, G and D, D, D; left hand the same an octave lower) before the opening tune comes back loudly.",
    bpm: 96,
    beatsPerBar: 4,
    position: "c",
    bars: [
      {
        right: [
          [G4, 1],
          [C4, 1],
          [C4, 1],
          [C4, 1],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
        dynamic: "f",
      },
      {
        right: [
          [G4, 1],
          [C4, 1],
          [C4, 1],
          [C4, 1],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [F4, 1],
          [G4, 1],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
      },
      {
        right: [[C4, 4]],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
      },
      {
        right: [
          [G4, 1],
          [C4, 1],
          [C4, 1],
          [C4, 1],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
        dynamic: "p",
      },
      {
        right: [
          [G4, 1],
          [C4, 1],
          [C4, 1],
          [C4, 1],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [F4, 1],
          [G4, 1],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
      },
      {
        right: [[C4, 4]],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [F4, 1],
          [G4, 1],
        ],
        dynamic: "mf",
      },
      {
        right: [
          [D4, 1],
          [D4, 1],
          [D4, 2],
        ],
      },
      {
        left: [
          [G3, 1],
          [G3, 1],
          [F3, 1],
          [G3, 1],
        ],
      },
      {
        left: [
          [D3, 1],
          [D3, 1],
          [D3, 2],
        ],
      },
      {
        right: [
          [G4, 1],
          [C4, 1],
          [C4, 1],
          [C4, 1],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
        dynamic: "f",
      },
      {
        right: [
          [G4, 1],
          [C4, 1],
          [C4, 1],
          [C4, 1],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
      },
      {
        right: [
          [G4, 1],
          [G4, 1],
          [F4, 1],
          [G4, 1],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
        ],
      },
      {
        right: [
          [C4, 1],
          [C4, 1],
          [C4, 1],
          [null, 1],
        ],
        left: [
          [[C3, G3], 1],
          [[C3, G3], 1],
          [[C3, G3], 1],
          [null, 1],
        ],
      },
    ],
  },
];

export const lessonBookOrder: readonly string[] = lessonPieces.map(
  (piece) => piece.id,
);
