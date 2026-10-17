import type { StarterPiece } from "./starterPieces";

// A new, deliberately simple Paw Pal arrangement of the traditional Jiangsu
// melody, not a commercial piano arrangement or a sampled performance.
// Melody reference: Carnegie Hall, Musical Explorers, Chinese Traditional with
// Qian Yi, Lesson 1, printed p. 82 (PDF p. 84), "Mo Li Hua":
// https://www.carnegiehall.org/-/media/CarnegieHall/Files/PDFs/Education/Educators/Musical-Explorers/Digital/ME-Teacher-Guide-Program-5-and-6-v3.pdf
// Companion lesson:
// https://www.carnegiehall.org/Education/Programs/Musical-Explorers/Digital/Program-Six/Qian-Yi/Lesson-1
// The guide's acknowledgments on p. 111 identify it as a traditional Chinese
// song. The guide itself does not give an open license, so no page artwork,
// recording, accompaniment, or lyrics from it are included here. This is the
// recognizable eight-bar opening chorus, transposed from D major to C major.
// The held bass notes and suggested piano fingering are newly authored here.

const c = 60;
const d = 62;
const e = 64;
const g = 67;
const a = 69;
const highC = 72;

export const popsPieces: readonly StarterPiece[] = [
  {
    id: "bearpaws-jasmine-flower-v1",
    title: "好一朵茉莉花 · chorus",
    composer: "Traditional Jiangsu melody · Jasmine Flower / Mo Li Hua",
    description:
      "The familiar eight-bar opening chorus, transposed to C major. Let your right hand move gently between E4 and C5, then shift down to C position for the final two bars. The simple bass notes and suggested fingering are a new easy arrangement.",
    level: "Beginner · opening chorus with a hand shift",
    rightPosition:
      "Start E4 (1), G4 (2), A4 (3), C5 (5) · shift to C4–G4 (1–5) in bar 7",
    bpm: 78,
    beatsPerBar: 4,
    melody: [
      [
        [e, 1, 1],
        [e, 0.5, 1],
        [g, 0.5, 2],
        [a, 0.5, 3],
        [highC, 0.5, 5],
        [highC, 0.5, 5],
        [a, 0.5, 3],
      ],
      [
        [g, 1, 2],
        [g, 0.5, 2],
        [a, 0.5, 3],
        [g, 2, 2],
      ],
      [
        [e, 1, 1],
        [e, 0.5, 1],
        [g, 0.5, 2],
        [a, 0.5, 3],
        [highC, 0.5, 5],
        [highC, 0.5, 5],
        [a, 0.5, 3],
      ],
      [
        [g, 1, 2],
        [g, 0.5, 2],
        [a, 0.5, 3],
        [g, 2, 2],
      ],
      [
        [g, 1, 2],
        [g, 1, 2],
        [g, 1, 2],
        [e, 0.5, 1],
        [g, 0.5, 2],
      ],
      [
        [a, 1, 3],
        [a, 1, 3],
        [g, 2, 2],
      ],
      [
        [e, 1, 3],
        [d, 0.5, 2],
        [e, 0.5, 3],
        [g, 1, 5],
        [e, 0.5, 3],
        [d, 0.5, 2],
      ],
      [
        [c, 1, 1],
        [c, 0.5, 1],
        [d, 0.5, 2],
        [c, 2, 1],
      ],
    ],
    bass: [48, 55, 48, 55, 48, 53, 55, 48],
  },
];
