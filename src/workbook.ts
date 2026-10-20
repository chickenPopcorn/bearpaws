import { localDay } from "./practiceLog";
import { read, write } from "./storage";

/**
 * Music for Little Mozarts, Music Workbook 3: its pages as games played on
 * the piano. Crayon Keys pages paint keys on a drawn keyboard; Color by Note
 * pages paint the areas of a picture by the note in each. Both games share
 * one engine (PaintGame): play the note, and it paints. See
 * docs/workbook-games.md for every page and game.
 */
export const WORKBOOK_TITLE = "Music Workbook 3";
export const WORKBOOK_SERIES = "Music for Little Mozarts";

/** The crayons the book names. The child must see "yellow" as yellow. */
export const CRAYONS = {
  red: "#e0705c",
  orange: "#f0a04b",
  // The teacher duet's yellow.
  yellow: "#f2c12e",
  green: "#7cbf6a",
  blue: "#5b9be0",
  // The right hand's lavender.
  purple: "#a086e9",
  pink: "#ef8fb5",
  brown: "#a87a55",
  gray: "#a3a0ad",
} as const;
export type Crayon = keyof typeof CRAYONS;

/**
 * The piano's three zones, as MIDI numbers, so they are the same keys on a
 * 49-, 61- or 88-key piano. Every printed note is in the play zone.
 */
export const CONTROL_ZONE = [36, 41] as const; // C2–F2
export const PLAY_ZONE = [48, 72] as const; // C3–C5
export const ANSWER_ZONE = [79, 84] as const; // G5–C6
/** What each control key does. Back and Start over also wait for a hold. */
export const CONTROL_KEYS = {
  hint: 36, // C2
  back: 38, // D2: press for the previous page, hold to leave the workbook
  next: 40, // E2
  restart: 41, // F2: hold to start the page over
} as const;
/** How long Leave and Start over must be held, so a bump never triggers them. */
export const HOLD_MS = 2000;
/** Letter names appear on the keys after this many misses on one step. */
export const LETTER_MISSES = 2;

export type Zone = "control" | "play" | "answer";
/** Whether `pitch` is one of the keys the page's notes are on, C3 to C5. */
export const inPlayZone = (pitch: number) =>
  pitch >= PLAY_ZONE[0] && pitch <= PLAY_ZONE[1];
export function zoneOf(pitch: number): Zone {
  if (pitch >= CONTROL_ZONE[0] && pitch <= CONTROL_ZONE[1]) return "control";
  if (pitch >= ANSWER_ZONE[0] && pitch <= ANSWER_ZONE[1]) return "answer";
  return "play";
}

/** One numbered step on the page: its notes and the crayon they get. */
export interface Step {
  crayon: Crayon;
  /**
   * The notes this step paints. Several when the book names only a letter
   * ("an F"): every F in the picture, in either clef.
   */
  pitches: readonly number[];
  /** The book's own words, for a step the usual wording cannot say. */
  words?: { instruction: string; prompt: string };
}
export type AreaShape =
  | "star"
  | "cloud"
  | "heart"
  | "blob"
  | "card"
  /** A card tall enough for a grand staff. */
  | "tall";
export type Clef = "treble" | "bass";
/** One area of a Color by Note picture, holding one note on a small staff. */
export interface Area {
  shape: AreaShape;
  pitch: number;
  /** The area's centre in the picture's frame, 640 wide. */
  x: number;
  y: number;
  /** The staff's clef: treble from middle C up, unless the book writes bass. */
  clef?: Clef;
}
/**
 * One area of an interval page's picture, holding two notes on a small
 * staff: an interval.
 */
export interface IntervalArea {
  shape: AreaShape;
  /**
   * Its notes: the left one first, then the right one; or, written one
   * above the other, the lower one first. A grand staff card may hold one
   * note, its other hand resting.
   */
  notes: readonly number[];
  /** Written one above the other, to play together (harmonic). */
  harmonic: boolean;
  /**
   * A grand staff card (page 35): the treble staff's note, and the bass
   * staff's note or, when there is none, a rest.
   */
  grand?: { treble: number; bass?: number };
  /** The area's centre in the picture's frame, 640 wide. */
  x: number;
  y: number;
  /** The staff's clef: treble when both notes are middle C or up. */
  clef?: Clef;
}
/** One numbered step on an interval page: which intervals get its crayon. */
export interface IntervalStep {
  crayon: Crayon;
  /**
   * Intervals of a size (2 for 2nds, 1 for a repeat), played together or
   * not, or going up or not.
   */
  match:
    | { size: number }
    | { harmonic: boolean }
    | { up: boolean }
    /** Every card: a How far page's one step. */
    | { any: true };
  /** What the book calls these intervals, if not their size: "step". */
  name?: string;
  /** The book's own words for the step, where they differ. */
  words?: string;
}
/** An Interval Hop step that colors note heads: "Color each G orange." */
export interface ColorStep {
  crayon: Crayon;
  letter: string;
}
export type WorkbookGame =
  | "crayon-keys"
  | "color-by-note"
  | "color-by-interval"
  | "interval-hop"
  | "interval-find"
  | "interval-name"
  | "interval-twins"
  | "hold"
  | "note-snap"
  | "hands";
// Interval pages are Color by Note pages whose areas hold two notes.
export const GAME_NAMES: Record<WorkbookGame, string> = {
  "crayon-keys": "Crayon Keys",
  "color-by-note": "Color by Note",
  "color-by-interval": "Color by Note",
  "interval-hop": "Interval Hop",
  "interval-find": "Interval Hop",
  "interval-name": "Interval Hop",
  "interval-twins": "Interval Hop",
  hold: "Hold It!",
  "note-snap": "Note Snap",
  hands: "Together or Apart",
};
interface PageInfo {
  page: number;
  title: string;
  /** The Lesson Book 3 page it goes with ("Use with page N"). */
  useWith: number;
  /** The picture's height (it is 640 wide) and its areas' size, if not 300 and 1. */
  picture?: { height: number; scale: number };
  /** The game's name, where it is not the usual one for the page's kind. */
  gameName?: string;
}
/** The name of the game a page plays: "Crayon Keys", "Together or Apart". */
export const gameName = (page: PageInfo & { game: WorkbookGame }) =>
  page.gameName ?? GAME_NAMES[page.game];
/** An interval page: 2nds and 3rds, melodic and harmonic, 4ths and 5ths. */
export interface IntervalPage extends PageInfo {
  game: "color-by-interval";
  steps: IntervalStep[];
  areas: IntervalArea[];
}
/**
 * An Interval Hop page: cards of two notes, played one after the other.
 * Its color steps color note heads first; then its steps circle the cards.
 */
export interface HopPage extends PageInfo {
  game: "interval-hop";
  colors: ColorStep[];
  steps: IntervalStep[];
  /** The cards, all melodic. */
  areas: IntervalArea[];
}
/**
 * An Interval Hop page that finds one interval among mixed cards: the child
 * plays the cards that hold it and skips the others with the Skip key.
 */
export interface FindPage extends PageInfo {
  game: "interval-find";
  /**
   * The one step: what to circle (an interval's size, notes played together
   * or apart, or hands together) and its crayon.
   */
  steps: [IntervalStep];
  areas: IntervalArea[];
}
/** A page whose areas hold two notes. */
/**
 * An Interval Hop "How far?" page: the child plays each card, then says how
 * far apart its notes are on the answer keys.
 */
export interface NamePage extends PageInfo {
  game: "interval-name";
  /** The one step, matching every card: the crayon that circles answers. */
  steps: [IntervalStep];
  /** The answers to choose from, as printed on each card: 2, 3, 4. */
  choices: number[];
  areas: IntervalArea[];
}
/**
 * An Interval Hop "Same and Different" page: boxes of two cards, top and
 * bottom. The child plays both, then says whether their intervals are the
 * same. The book circles a character: one for same, one for different.
 */
export interface TwinsPage extends PageInfo {
  game: "interval-twins";
  /** The one step, matching every card: the crayon that circles answers. */
  steps: [IntervalStep];
  /** The answers, on the answer keys from G5 up. */
  choices: ["Same", "Different"];
  /** The characters the book circles for each answer. */
  characters: { same: string; different: string };
  /** The cards, each box's top one then its bottom one. */
  areas: IntervalArea[];
}
export type IntervalsPage =
  IntervalPage | HopPage | FindPage | NamePage | TwinsPage;
export type NoteValue = "quarter" | "half" | "dotted-half" | "whole";
export type RestValue = "quarter" | "half" | "whole";
/** One card of a Hold It! page. */
export type HoldCard =
  /** Hold a key for the note's counts. */
  | { kind: "note"; value: NoteValue }
  /** Play a note, then rest for the rest's counts, then play again. */
  | { kind: "rest"; value: RestValue }
  /** A quarter note to play short if it has a staccato dot, else a full count. */
  | { kind: "tap"; staccato: boolean };
/**
 * A Hold It! page: note values, staccato and rests, played on any key in
 * time with the laptop's metronome.
 */
export interface HoldPage extends PageInfo {
  game: "hold";
  /** The page's one step, in the book's words, and its crayon. */
  steps: [{ crayon: Crayon; words: string }];
  cards: HoldCard[];
}
/** One example of a Left Hand and Right Hand page. */
export interface HandExample {
  clef: Clef;
  /** Its notes, in order. */
  notes: number[];
  /** The hand that plays it, and the finger marked on its first note. */
  hand: "left" | "right";
  finger: number;
}
/**
 * A Left Hand and Right Hand page: for each example, the child says which
 * hand plays it on the answer keys, then plays it; with a slur, legato.
 */
export interface HandsPage extends PageInfo {
  game: "hands";
  steps: [{ crayon: Crayon; words: string }];
  examples: HandExample[];
  /** The examples are slurred: each key held until the next goes down. */
  slur: boolean;
}
export type WorkbookPage =
  | NotePage
  | IntervalPage
  | HopPage
  | FindPage
  | NamePage
  | TwinsPage
  | HoldPage
  | HandsPage;
/** A page whose cards are answered on the answer keys after playing. */
export type AnswerPage = NamePage | TwinsPage;
/** The answer key whose sticker says Skip: G5. */
export const SKIP_KEY: number = ANSWER_ZONE[0];
/** The answer keys in order, G5, A5, B5 and C6: a How far page's choices. */
export const ANSWER_KEYS = [79, 81, 83, 84];
/** A page of single notes: Crayon Keys, and Color by Note by notes. */
/** One column pair of a Note Snap page: letter cards and staff cards. */
export interface SnapColumn {
  /** The letter cards, top to bottom. */
  letters: string[];
  /** The staff cards, top to bottom. */
  notes: { pitch: number; clef: Clef }[];
}
export interface NotePage extends PageInfo {
  game: "crayon-keys" | "color-by-note" | "note-snap";
  steps: Step[];
  /** The book names notes by letter only ("an F"), not by clef. */
  byLetter?: boolean;
  /** Color by Note pages only. */
  areas?: Area[];
  /** Crayon Keys pages with a staff: its notes, left to right. */
  staff?: { pitch: number; clef: Clef }[];
  /** Note Snap pages: two columns of letter cards and staff cards. */
  snap?: SnapColumn[];
}
/** The book's line on the Note Snap pages. */
export const SNAP_WORDS =
  "Draw lines connecting the dots on the matching boxes.";
/**
 * A Note Snap page: each staff card in turn, top to bottom, left column
 * first, is a step whose note the child plays to draw its line.
 */
const snapPage = (
  page: number,
  title: string,
  useWith: number,
  snap: SnapColumn[],
): NotePage => ({
  page,
  title,
  useWith,
  game: "note-snap",
  snap,
  steps: snap.flatMap((column) =>
    column.notes.map(({ pitch }) => ({
      crayon: "blue" as const,
      pitches: [pitch],
      words: {
        instruction: SNAP_WORDS,
        prompt: "Play the note on the bright card",
      },
    })),
  ),
});
const LETTER_COLUMN = ["C", "D", "E", "F", "G"];

const area = (
  shape: AreaShape,
  pitch: number,
  x: number,
  y: number,
  clef?: Clef,
): Area => ({ shape, pitch, x, y, ...(clef && { clef }) });
/** Page 4's areas in three rows, rising to the right like its staircase. */
const staircase = (rows: [AreaShape, number, Clef?][][]) =>
  rows.flatMap((row, r) =>
    row.map(([shape, pitch, clef], c) =>
      area(shape, pitch, 60 + c * 105, 55 + r * 130 + (5 - c) * 10, clef),
    ),
  );

const melodic = (
  shape: AreaShape,
  first: number,
  second: number,
  x: number,
  y: number,
): IntervalArea => ({ shape, notes: [first, second], harmonic: false, x, y });
const harmonic = (
  shape: AreaShape,
  low: number,
  high: number,
  x: number,
  y: number,
): IntervalArea => ({ shape, notes: [low, high], harmonic: true, x, y });
/** An Interval Hop card: two notes, one after the other. */
const card = (first: number, second: number, x: number, y: number) =>
  melodic("card", first, second, x, y);
/** Six cards, three by two. */
const sixCards = (notes: [number, number][]) =>
  notes.map(([first, second], i) =>
    card(first, second, 110 + (i % 3) * 210, 75 + Math.floor(i / 3) * 140),
  );
/** A Find page: circle the cards of one interval, skip the others. */
const findPage = (
  page: number,
  useWith: number,
  crayon: Crayon,
  size: number,
  notes: [number, number][],
): FindPage => ({
  page,
  title: `${intervalName(size)}s`,
  useWith,
  game: "interval-find",
  steps: [
    {
      crayon,
      match: { size },
      words: `Using a ${crayon} crayon, circle each ${intervalName(size)}.`,
    },
  ],
  areas: sixCards(notes),
});
/**
 * A Together or Apart page: circle the cards played together (harmonic) or
 * apart (melodic), and skip the others.
 */
const togetherPage = (
  page: number,
  title: string,
  useWith: number,
  crayon: Crayon,
  harmonic: boolean,
  words: string,
  areas: IntervalArea[],
): FindPage => ({
  page,
  title,
  useWith,
  game: "interval-find",
  gameName: "Together or Apart",
  steps: [{ crayon, match: { harmonic }, words }],
  areas,
});
/** Six cards, three by two: [notes, harmonic]. */
const sixMixed = (cards: [number[], boolean][]) =>
  cards.map(([notes, harmonic], i) => ({
    shape: "card" as const,
    notes,
    harmonic,
    x: 110 + (i % 3) * 210,
    y: 75 + Math.floor(i / 3) * 140,
  }));
/** Page 35's grand staff cards: a treble note, and a bass note or a rest. */
const grandCards = (cards: [number, number | null][]) =>
  cards.map(([treble, bass], i) => ({
    shape: "tall" as const,
    notes: bass === null ? [treble] : [bass, treble],
    harmonic: bass !== null,
    grand: { treble, ...(bass !== null && { bass }) },
    x: 110 + (i % 3) * 210,
    y: 100 + Math.floor(i / 3) * 190,
  }));
/** Four boxes, two by two, each of a top and a bottom card. */
const twinBoxes = (boxes: [[number, number], [number, number]][]) =>
  boxes.flatMap(([top, bottom], i) => {
    const x = 170 + (i % 2) * 300,
      y = 55 + Math.floor(i / 2) * 190;
    return [card(...top, x, y), card(...bottom, x, y + 85)];
  });
/** A Same and Different page. */
const twinsPage = (
  page: number,
  useWith: number,
  same: string,
  different: string,
  boxes: [[number, number], [number, number]][],
): TwinsPage => ({
  page,
  title: "Same and Different",
  useWith,
  game: "interval-twins",
  steps: [
    {
      crayon: "red",
      match: { any: true },
      words: `Circle ${same} if the intervals are the same. Circle ${different} if the intervals are different.`,
    },
  ],
  choices: ["Same", "Different"],
  characters: { same, different },
  areas: twinBoxes(boxes),
  picture: { height: 390, scale: 0.75 },
});
/** Four cards, two by two. */
const fourCards = (notes: [number, number][]) =>
  notes.map(([first, second], i) =>
    card(first, second, 170 + (i % 2) * 300, 75 + Math.floor(i / 2) * 140),
  );
const bass = (...pitches: number[]) =>
  pitches.map((pitch) => ({ pitch, clef: "bass" as const }));
const treble = (...pitches: number[]) =>
  pitches.map((pitch) => ({ pitch, clef: "treble" as const }));

export const WORKBOOK_PAGES: readonly WorkbookPage[] = [
  {
    page: 4,
    title: "Middle C Position Review",
    useWith: 4,
    game: "color-by-note",
    byLetter: true,
    steps: [
      { crayon: "pink", pitches: [57] },
      { crayon: "green", pitches: [59] },
      { crayon: "yellow", pitches: [60] },
      { crayon: "brown", pitches: [62] },
      { crayon: "red", pitches: [64] },
      { crayon: "blue", pitches: [53, 65] },
      { crayon: "orange", pitches: [55, 67] },
    ],
    // Flowers, the pot and a stair in the bass clef; the stairs and Haydn
    // Hippo's coat in the treble.
    areas: staircase([
      [
        ["cloud", 55],
        ["cloud", 60, "bass"],
        ["cloud", 57],
        ["cloud", 59],
        ["cloud", 59],
        ["heart", 65],
      ],
      [
        ["blob", 53],
        ["blob", 57],
        ["blob", 62],
        ["blob", 67],
        ["blob", 62],
        ["blob", 60],
      ],
      [
        ["blob", 62],
        ["blob", 64],
        ["blob", 62],
        ["blob", 64],
        ["blob", 62],
        ["blob", 62],
      ],
    ]),
    picture: { height: 400, scale: 0.72 },
  },
  {
    page: 5,
    title: "Left Hand and Right Hand",
    useWith: 5,
    game: "hands",
    steps: [
      {
        crayon: "red",
        words:
          "Using a red crayon, color the hand that plays the example. Then play the example on the keyboard.",
      },
    ],
    slur: false,
    examples: [
      { clef: "treble", notes: [60, 64, 67], hand: "right", finger: 1 },
      { clef: "bass", notes: [60, 57, 53], hand: "left", finger: 1 },
      { clef: "bass", notes: [53, 55, 57], hand: "left", finger: 5 },
      { clef: "treble", notes: [67, 65, 64], hand: "right", finger: 5 },
    ],
  },
  {
    page: 6,
    title: "Note Values",
    useWith: 6,
    game: "hold",
    steps: [
      {
        crayon: "purple",
        words:
          "Draw a line from each note to the number of counts it gets in 4/4 or 3/4 time.",
      },
    ],
    cards: [
      { kind: "note", value: "quarter" },
      { kind: "note", value: "half" },
      { kind: "note", value: "dotted-half" },
      { kind: "note", value: "whole" },
    ],
  },
  {
    page: 7,
    title: "Bass Clef C",
    useWith: 7,
    game: "crayon-keys",
    steps: [
      { crayon: "green", pitches: [60] },
      { crayon: "red", pitches: [48] },
    ],
  },
  {
    page: 8,
    title: "Middle C and Bass Clef C",
    useWith: 8,
    game: "color-by-note",
    steps: [
      { crayon: "red", pitches: [60] },
      { crayon: "green", pitches: [48] },
    ],
    // Two coats and three boxes.
    areas: [
      area("cloud", 48, 190, 80),
      area("heart", 60, 450, 80),
      area("blob", 48, 100, 215),
      area("blob", 60, 320, 220),
      area("blob", 48, 540, 215),
    ],
  },
  {
    page: 9,
    title: "Bass Clef D",
    useWith: 9,
    game: "crayon-keys",
    steps: [
      { crayon: "yellow", pitches: [62] },
      { crayon: "blue", pitches: [50] },
    ],
  },
  {
    page: 10,
    title: "Treble Clef D and Bass Clef D",
    useWith: 10,
    game: "color-by-note",
    steps: [
      { crayon: "yellow", pitches: [62] },
      { crayon: "blue", pitches: [50] },
      { crayon: "pink", pitches: [48] },
    ],
    areas: [
      area("star", 62, 90, 200),
      area("star", 62, 190, 105),
      area("star", 62, 330, 70),
      area("blob", 50, 300, 225),
      area("cloud", 50, 450, 150),
      area("heart", 48, 560, 70),
      area("cloud", 48, 555, 225),
    ],
  },
  {
    page: 11,
    title: "Bass Clef E",
    useWith: 11,
    game: "crayon-keys",
    steps: [
      { crayon: "red", pitches: [64] },
      { crayon: "green", pitches: [52] },
    ],
  },
  {
    page: 12,
    title: "Treble Clef E and Bass Clef E",
    useWith: 12,
    game: "color-by-note",
    steps: [
      { crayon: "blue", pitches: [64] },
      { crayon: "red", pitches: [52] },
      { crayon: "yellow", pitches: [50] },
      { crayon: "orange", pitches: [48] },
    ],
    // Six flowers, the vase and Haydn Hippo's coat.
    areas: [
      area("cloud", 52, 200, 70),
      area("cloud", 50, 340, 65),
      area("cloud", 48, 110, 170),
      area("cloud", 52, 270, 165),
      area("cloud", 50, 270, 255),
      area("cloud", 48, 420, 170),
      area("blob", 64, 90, 262),
      area("heart", 64, 560, 200),
    ],
    picture: { height: 300, scale: 0.85 },
  },
  {
    page: 13,
    title: "Steps, Skips and Repeats",
    useWith: 13,
    game: "interval-hop",
    colors: [],
    steps: [
      {
        crayon: "pink",
        match: { size: 2 },
        name: "step",
        words: "Using a pink crayon, circle each step.",
      },
      {
        crayon: "green",
        match: { size: 3 },
        name: "skip",
        words: "Using a green crayon, circle each skip.",
      },
      {
        crayon: "purple",
        match: { size: 1 },
        name: "repeat",
        words: "Using a purple crayon, circle each repeat (same note).",
      },
    ],
    areas: sixCards([
      [50, 50],
      [64, 67],
      [48, 50],
      [52, 48],
      [62, 60],
      [64, 64],
    ]),
  },
  {
    page: 14,
    title: "C Position for the Left Hand",
    useWith: 14,
    game: "crayon-keys",
    steps: [
      {
        crayon: "blue",
        pitches: [48, 50, 52, 53, 55],
        words: {
          instruction:
            "Color C, D, E, F and G from the Left Hand C POSITION blue.",
          prompt: "Find Left Hand C Position: C D E F G",
        },
      },
    ],
  },
  {
    page: 15,
    title: "Staccato",
    useWith: 15,
    game: "hold",
    steps: [
      {
        crayon: "orange",
        words:
          "Using an orange crayon, circle each note that is played STACCATO.",
      },
    ],
    // The page's eight notes, in reading order.
    cards: [false, true, true, false, false, false, true, true].map(
      (staccato) => ({ kind: "tap", staccato }),
    ),
  },
  {
    page: 16,
    title: "Rests",
    useWith: 16,
    game: "hold",
    steps: [
      {
        crayon: "purple",
        words:
          "Draw a line from each rest to the number of counts it gets in 4/4 time.",
      },
    ],
    cards: [
      { kind: "rest", value: "quarter" },
      { kind: "rest", value: "half" },
      { kind: "rest", value: "whole" },
    ],
  },
  {
    page: 19,
    title: "2nds",
    useWith: 19,
    game: "interval-hop",
    colors: [
      { crayon: "orange", letter: "G" },
      { crayon: "pink", letter: "F" },
    ],
    steps: [
      {
        crayon: "green",
        match: { up: true },
        words: "With a green crayon, circle each 2nd going UP.",
      },
      {
        crayon: "blue",
        match: { up: false },
        words: "With a blue crayon, circle each 2nd going DOWN.",
      },
    ],
    areas: fourCards([
      [67, 65],
      [65, 67],
      [53, 55],
      [55, 53],
    ]),
  },
  findPage(20, 19, "blue", 2, [
    [52, 50],
    [60, 64],
    [62, 64],
    [67, 65],
    [48, 50],
    [55, 52],
  ]),
  {
    page: 21,
    title: "C Position",
    useWith: 20,
    game: "color-by-note",
    byLetter: true,
    steps: [
      { crayon: "green", pitches: [48, 60] },
      { crayon: "blue", pitches: [50, 62] },
      { crayon: "red", pitches: [52, 64] },
      { crayon: "purple", pitches: [53, 65] },
      { crayon: "orange", pitches: [55, 67] },
    ],
    // The letters of TALENT SHOW, as stars: TALEN below, T SHOW above.
    areas: [
      area("star", 65, 70, 275),
      area("star", 55, 195, 255),
      area("star", 50, 320, 235),
      area("star", 60, 445, 215),
      area("star", 64, 570, 195),
      area("star", 67, 70, 150),
      area("star", 53, 195, 130),
      area("star", 48, 320, 110),
      area("star", 62, 445, 90),
      area("star", 52, 570, 70),
    ],
    picture: { height: 330, scale: 0.8 },
  },
  {
    page: 23,
    title: "3rds",
    useWith: 22,
    game: "interval-hop",
    colors: [
      { crayon: "orange", letter: "G" },
      { crayon: "red", letter: "E" },
    ],
    steps: [
      {
        crayon: "green",
        match: { up: true },
        words: "With a green crayon, circle each 3rd going UP.",
      },
      {
        crayon: "pink",
        match: { up: false },
        words: "With a pink crayon, circle each 3rd going DOWN.",
      },
    ],
    areas: fourCards([
      [64, 67],
      [67, 64],
      [55, 52],
      [52, 55],
    ]),
  },
  findPage(24, 23, "red", 3, [
    [60, 62],
    [48, 52],
    [64, 60],
    [52, 53],
    [64, 67],
    [55, 52],
  ]),
  {
    page: 26,
    title: "2nds and 3rds",
    useWith: 25,
    game: "color-by-interval",
    steps: [
      { crayon: "pink", match: { size: 2 } },
      { crayon: "purple", match: { size: 3 } },
    ],
    // Three dancers, each with a bodice and a tutu.
    areas: [
      melodic("blob", 65, 62, 110, 85),
      melodic("cloud", 60, 59, 110, 215),
      melodic("blob", 53, 55, 320, 85),
      melodic("cloud", 65, 67, 320, 215),
      melodic("blob", 59, 55, 530, 85),
      melodic("cloud", 60, 64, 530, 215),
    ],
  },
  twinsPage(28, 27, "Beethoven Bear", "Mozart Mouse", [
    [
      [60, 64],
      [60, 62],
    ],
    [
      [62, 60],
      [62, 60],
    ],
    [
      [60, 57],
      [60, 57],
    ],
    [
      [59, 60],
      [57, 60],
    ],
  ]),
  {
    page: 29,
    title: "Left Hand and Right Hand",
    useWith: 28,
    game: "hands",
    steps: [
      {
        crayon: "red",
        words:
          "Using a red crayon, color the hand that plays the example. Using a black crayon, trace the slur. Then play the example on the keyboard.",
      },
    ],
    slur: true,
    examples: [
      { clef: "treble", notes: [60, 62, 64], hand: "right", finger: 1 },
      { clef: "bass", notes: [55, 53, 52], hand: "left", finger: 1 },
      { clef: "bass", notes: [48, 50, 52], hand: "left", finger: 5 },
      { clef: "treble", notes: [67, 64, 60], hand: "right", finger: 5 },
    ],
  },
  snapPage(30, "C Position", 29, [
    {
      letters: LETTER_COLUMN,
      notes: bass(50, 48, 55, 53, 52),
    },
    {
      letters: LETTER_COLUMN,
      notes: treble(62, 60, 65, 67, 64),
    },
  ]),
  togetherPage(
    31,
    "Harmonic Intervals",
    30,
    "blue",
    true,
    "Using a blue crayon, circle the notes that are played together (harmonic intervals).",
    sixMixed([
      [[60, 64], false],
      [[60, 62], false],
      [[60, 64], true],
      [[60, 62], true],
      [[60, 64], true],
      [[64, 60], false],
    ]),
  ),
  togetherPage(
    32,
    "Melodic Intervals",
    31,
    "purple",
    false,
    "Using a purple crayon, circle the notes that are played separately (melodic intervals).",
    sixMixed([
      [[53, 55], true],
      [[52, 55], false],
      [[55, 53], false],
      [[53, 55], false],
      [[52, 55], true],
      [[53, 55], true],
    ]),
  ),
  {
    page: 33,
    title: "Melodic and Harmonic Intervals",
    useWith: 32,
    game: "color-by-interval",
    steps: [
      { crayon: "green", match: { harmonic: false } },
      { crayon: "blue", match: { harmonic: true } },
    ],
    // Five swirls around George Bear, conducting.
    areas: [
      harmonic("cloud", 53, 55, 150, 90),
      melodic("cloud", 64, 65, 490, 70),
      harmonic("cloud", 52, 55, 490, 180),
      melodic("cloud", 67, 65, 150, 250),
      melodic("cloud", 60, 62, 490, 290),
    ],
    picture: { height: 345, scale: 1 },
  },
  snapPage(34, "Middle C Position", 33, [
    {
      letters: ["F", "G", "A", "B", "C"],
      notes: bass(55, 57, 60, 59, 53),
    },
    {
      letters: LETTER_COLUMN,
      notes: treble(62, 60, 65, 67, 64),
    },
  ]),
  {
    ...togetherPage(
      35,
      "Hands Together",
      34,
      "yellow",
      true,
      "Using a yellow crayon, circle the examples that are played hands together.",
      grandCards([
        [60, null],
        [60, 48],
        [64, 48],
        [62, null],
        [64, 48],
        [64, null],
      ]),
    ),
    picture: { height: 390, scale: 1 },
  },
  {
    page: 36,
    title: "C, D, E, F and G",
    useWith: 35,
    game: "crayon-keys",
    steps: [
      { crayon: "green", pitches: [48] },
      { crayon: "yellow", pitches: [50] },
      { crayon: "red", pitches: [52] },
      { crayon: "pink", pitches: [53] },
      { crayon: "orange", pitches: [55] },
    ],
    staff: bass(52, 50, 53, 55, 48),
  },
  {
    page: 37,
    title: "C and E",
    useWith: 36,
    game: "crayon-keys",
    byLetter: true,
    steps: [
      { crayon: "green", pitches: [60] },
      { crayon: "red", pitches: [64] },
    ],
    // Middle C sits on a ledger line above the bass staff.
    staff: [...treble(64), ...bass(60)],
  },
  {
    page: 38,
    title: "D and G",
    useWith: 37,
    game: "crayon-keys",
    byLetter: true,
    steps: [
      { crayon: "yellow", pitches: [62] },
      { crayon: "orange", pitches: [55] },
    ],
    staff: [...treble(62), ...bass(55)],
  },
  {
    page: 39,
    title: "4ths",
    useWith: 38,
    game: "interval-hop",
    colors: [
      { crayon: "green", letter: "C" },
      { crayon: "pink", letter: "F" },
      { crayon: "orange", letter: "G" },
    ],
    steps: [
      {
        crayon: "red",
        match: { up: true },
        words: "Using a red crayon, circle each 4th going UP.",
      },
      {
        crayon: "blue",
        match: { up: false },
        words: "Using a blue crayon, circle each 4th going DOWN.",
      },
    ],
    areas: fourCards([
      [65, 60],
      [60, 65],
      [55, 60],
      [60, 55],
    ]),
  },
  findPage(40, 39, "purple", 4, [
    [64, 67],
    [53, 55],
    [55, 50],
    [65, 64],
    [62, 67],
    [52, 48],
  ]),
  {
    page: 41,
    title: "2nds, 3rds and 4ths",
    useWith: 40,
    game: "interval-name",
    steps: [
      {
        crayon: "purple",
        match: { any: true },
        words:
          "Identify each interval: circle 2 for the 2nd, 3 for the 3rd and 4 for the 4th.",
      },
    ],
    choices: [2, 3, 4],
    // Three cards, stepping down the page as printed.
    areas: [
      card(62, 64, 120, 80),
      { ...card(55, 60, 320, 165), harmonic: true },
      card(64, 60, 520, 250),
    ],
    picture: { height: 320, scale: 1 },
  },
  {
    page: 42,
    title: "F and G",
    useWith: 41,
    game: "crayon-keys",
    steps: [
      { crayon: "pink", pitches: [65] },
      { crayon: "orange", pitches: [55] },
    ],
    staff: [...treble(65), ...bass(55)],
  },
  {
    page: 43,
    title: "5ths",
    useWith: 42,
    game: "interval-hop",
    colors: [
      { crayon: "green", letter: "C" },
      { crayon: "orange", letter: "G" },
    ],
    steps: [
      {
        crayon: "red",
        match: { up: true },
        words: "Using a red crayon, circle each 5th going UP.",
      },
      {
        crayon: "blue",
        match: { up: false },
        words: "Using a blue crayon, circle each 5th going DOWN.",
      },
    ],
    areas: fourCards([
      [60, 67],
      [67, 60],
      [55, 48],
      [48, 55],
    ]),
  },
  findPage(44, 43, "green", 5, [
    [53, 60],
    [64, 67],
    [53, 57],
    [67, 65],
    [55, 60],
    [67, 60],
  ]),
  {
    page: 45,
    title: "4ths and 5ths",
    useWith: 44,
    game: "color-by-interval",
    steps: [
      { crayon: "green", match: { size: 4 } },
      { crayon: "yellow", match: { size: 5 } },
    ],
    // The left curtain, the middle curtain and the bunny, the right curtain.
    areas: [
      melodic("cloud", 60, 65, 110, 70),
      melodic("blob", 53, 60, 110, 190),
      melodic("cloud", 62, 67, 110, 310),
      harmonic("blob", 60, 67, 320, 130),
      harmonic("blob", 60, 65, 320, 270),
      harmonic("cloud", 55, 60, 530, 70),
      melodic("blob", 48, 55, 530, 190),
      melodic("cloud", 55, 50, 530, 310),
    ],
    picture: { height: 380, scale: 0.9 },
  },
  twinsPage(47, 46, "Haydn Hippo", "Clara Schumann-Cat", [
    [
      [67, 60],
      [67, 62],
    ],
    [
      [67, 65],
      [67, 65],
    ],
    [
      [55, 50],
      [55, 50],
    ],
    [
      [55, 53],
      [55, 52],
    ],
  ]),
  {
    page: 48,
    title: "C Position and Middle C Position",
    useWith: 48,
    game: "color-by-note",
    byLetter: true,
    steps: [
      { crayon: "pink", pitches: [57] },
      { crayon: "gray", pitches: [59] },
      { crayon: "green", pitches: [48, 60] },
      { crayon: "blue", pitches: [50, 62] },
      { crayon: "purple", pitches: [52, 64] },
      { crayon: "yellow", pitches: [53, 65] },
      { crayon: "orange", pitches: [55, 67] },
    ],
    // The market: a cloud, the awning's bar and seven scallops, two hats,
    // the tree, its pot, the table, the door and the mat.
    areas: [
      area("cloud", 50, 320, 48),
      area("blob", 59, 220, 140),
      area("blob", 60, 420, 140),
      area("blob", 60, 60, 245, "bass"),
      area("blob", 65, 147, 245),
      area("blob", 67, 234, 245),
      area("blob", 57, 320, 245),
      area("blob", 64, 406, 245),
      area("blob", 62, 493, 245),
      area("blob", 53, 580, 245),
      area("cloud", 57, 60, 350),
      area("cloud", 59, 165, 350),
      area("star", 48, 270, 350),
      area("blob", 55, 375, 350),
      area("blob", 50, 480, 350),
      area("blob", 52, 585, 350),
    ],
    picture: { height: 400, scale: 0.68 },
  },
];

/** The built page after `page`, if any. */
export const pageAfter = (page: WorkbookPage) =>
  WORKBOOK_PAGES.find((p) => p.page > page.page);
/** The built page before `page`, if any. */
export const pageBefore = (page: WorkbookPage) =>
  WORKBOOK_PAGES.filter((p) => p.page < page.page).at(-1);

const LETTERS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
/** The note's letter, without its octave. */
export const letterName = (pitch: number) => LETTERS[pitch % 12];
export const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);
/** The note as the book names it: MIDDLE C, BASS CLEF D, TREBLE CLEF E. */
export function bookName(pitch: number) {
  if (pitch === 60) return "MIDDLE C";
  const letter = letterName(pitch);
  if (pitch >= PLAY_ZONE[0] && pitch < 60) return `BASS CLEF ${letter}`;
  if (pitch > 60 && pitch <= PLAY_ZONE[1]) return `TREBLE CLEF ${letter}`;
  return letter;
}
/** "an A", "a B": the letter as the book's steps say it. */
const withArticle = (letter: string) =>
  `${"AEF".includes(letter) ? "an" : "a"} ${letter}`;
/** A step's line on the page, in the book's words. */
export function instruction(page: NotePage, step: Step) {
  if (step.words) return step.words.instruction;
  const letter = letterName(step.pitches[0]);
  if (page.staff)
    return `Color the ${page.byLetter ? letter : bookName(step.pitches[0])} on the keyboard and staff ${step.crayon}.`;
  const note = page.byLetter ? withArticle(letter) : bookName(step.pitches[0]);
  return page.game === "color-by-note"
    ? `Color the areas containing ${note} ${step.crayon}.`
    : `Color ${note} ${step.crayon}.`;
}
/** What the child looks for now: "Find BASS CLEF D", "Play every F". */
export function prompt(page: NotePage, step: Step) {
  if (step.words) return step.words.prompt;
  const letter = letterName(step.pitches[0]);
  if (page.game === "crayon-keys")
    return page.byLetter
      ? `Play the ${letter} on the staff`
      : `Find ${bookName(step.pitches[0])}`;
  return page.byLetter
    ? `Play every ${letter}`
    : `Play ${bookName(step.pitches[0])}`;
}
/** A step's letters, as a hint says them: "D", or "C, D, E, F or G". */
function wanted(step: Step | undefined) {
  const letters = [...new Set(step?.pitches.map(letterName))];
  return letters.length > 1
    ? `${letters.slice(0, -1).join(", ")} or ${letters.at(-1)}`
    : (letters[0] ?? "");
}

/** What one key press on the play zone did. */
export type Outcome =
  | {
      kind: "painted";
      pitch: number;
      /** The step's notes still to find. */
      left: number;
      finished: boolean;
    }
  /** One of the step's notes that is already painted. */
  | { kind: "again"; pitch: number }
  | {
      kind: "octave";
      pitch: number;
      direction: "higher" | "lower";
      lettersShown: boolean;
    }
  | { kind: "wrong"; pitch: number; lettersShown: boolean }
  | { kind: "finished" };

/**
 * One page being painted. The steps go one at a time, in the book's order:
 * only the current step's notes paint, and the step is done once each of
 * them is played. A wrong key gets a hint and the child tries again; nothing
 * is scored.
 */
export class PaintGame {
  step = 0;
  /** Letter names show on the keys, after misses or the hint key. */
  letters = false;
  private misses = 0;
  /** Each painted note and its crayon. */
  readonly painted = new Map<number, Crayon>();
  constructor(readonly page: NotePage) {}
  get current(): Step | undefined {
    return this.page.steps[this.step];
  }
  get finished() {
    return this.step >= this.page.steps.length;
  }
  /** The current step's notes not painted yet. */
  get left() {
    return this.current?.pitches.filter((p) => !this.painted.has(p)) ?? [];
  }
  play(pitch: number): Outcome {
    const target = this.current;
    if (!target) return { kind: "finished" };
    if (target.pitches.includes(pitch)) {
      // A letter step's note played twice; one note's step moves on at once,
      // so its note is new to it even if an earlier step painted it.
      if (target.pitches.length > 1 && this.painted.has(pitch))
        return { kind: "again", pitch };
      this.painted.set(pitch, target.crayon);
      const left = this.left.length;
      if (!left) {
        this.step++;
        this.misses = 0;
        this.letters = false;
      }
      return { kind: "painted", pitch, left, finished: this.finished };
    }
    this.misses++;
    const lettersShown = !this.letters && this.misses >= LETTER_MISSES;
    if (lettersShown) this.letters = true;
    // The nearest note still to find with this letter, if any. A one-note
    // step's note is still to find even if an earlier step painted it.
    const looking = target.pitches.length > 1 ? this.left : target.pitches;
    const [nearest] = looking
      .filter((p) => letterName(p) === letterName(pitch) && !isBlack(pitch))
      .sort((a, b) => Math.abs(a - pitch) - Math.abs(b - pitch));
    if (nearest !== undefined)
      return {
        kind: "octave",
        pitch,
        direction: pitch < nearest ? "higher" : "lower",
        lettersShown,
      };
    return { kind: "wrong", pitch, lettersShown };
  }
  /** The hint key shows the letter names until the step is done. */
  hint() {
    if (!this.finished) this.letters = true;
  }
}

/** What a finished page says. */
export const doneText = (page: WorkbookPage) =>
  `Page ${page.page} is done. ${pageAfter(page) ? "Next page: E2." : "This is the last page so far."}`;
const lettersText = (outcome: { lettersShown?: boolean }) =>
  outcome.lettersShown ? " The letters are on the keys now." : "";

/** The hint under the prompt after `outcome`, for a grown-up to read aloud. */
export function feedback(
  page: NotePage,
  outcome: Outcome,
  target: Step | undefined,
) {
  const more = "lettersShown" in outcome ? lettersText(outcome) : "";
  const done = doneText(page);
  const want = wanted(target),
    // Several notes of one letter ("an F"), or of several (C to G).
    oneLetter = !want.includes(" or ");
  switch (outcome.kind) {
    case "painted":
      if (page.game === "note-snap" && target)
        return `Yes! That is ${letterName(target.pitches[0])}: line drawn.${outcome.finished ? ` ${done}` : ""}`;
      return outcome.finished
        ? done
        : !outcome.left
          ? "Yes! Next crayon."
          : oneLetter
            ? `Yes! Now find the other ${want}.`
            : `Yes! ${outcome.left} more to find.`;
    case "again":
      return oneLetter
        ? `That ${want} is painted. Find the other ${want}.`
        : `That ${letterName(outcome.pitch)} is painted.`;
    case "octave":
      return `That is ${bookName(outcome.pitch)}. Go ${outcome.direction}.${more}`;
    case "wrong":
      return isBlack(outcome.pitch)
        ? `That is a black key. ${want} is a white key.${more}`
        : `That is ${letterName(outcome.pitch)}. Look for ${want}.${more}`;
    case "finished":
      return done;
  }
}

/** Notes that start this close together, in milliseconds, sound together. */
export const TOGETHER_MS = 150;
/** A note that comes this long after the other is a new try, not "apart". */
export const RETRY_MS = 2000;
const LETTER_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
/** The note's place on the staff, counted in steps (lines and spaces). */
const staffStep = (pitch: number) =>
  Math.floor(pitch / 12) * 7 + LETTER_STEP[pitch % 12];
/** An interval's size: 2 for a 2nd, 3 for a 3rd. */
export const intervalSize = ([a, b = a]: readonly number[]) =>
  Math.abs(staffStep(a) - staffStep(b)) + 1;
/**
 * "2nd", "3rd", "4th", "5th". A function, so the page list above can name
 * its pages with it.
 */
export function intervalName(size: number) {
  return size === 2 ? "2nd" : size === 3 ? "3rd" : `${size}th`;
}
/** Whether `step` colors `area`. */
export const stepColors = (step: IntervalStep, area: IntervalArea) =>
  "any" in step.match
    ? true
    : "size" in step.match
      ? intervalSize(area.notes) === step.match.size
      : "up" in step.match
        ? area.notes[1] > area.notes[0] === step.match.up
        : area.harmonic === step.match.harmonic;
/** A step's line on an interval page, in the book's words. */
export function intervalInstruction(step: IntervalStep) {
  if (step.words) return step.words;
  if ("any" in step.match) return `Color each card ${step.crayon}.`;
  if ("up" in step.match)
    return `Circle each interval going ${step.match.up ? "UP" : "DOWN"} ${step.crayon}.`;
  return "size" in step.match
    ? `Color the areas containing ${intervalName(step.match.size)}s ${step.crayon}.`
    : `Color the areas containing a ${step.match.harmonic ? "harmonic" : "melodic"} interval ${step.crayon}.`;
}
/** What the child does with the bright area now. */
export const intervalPrompt = (area: IntervalArea) =>
  area.harmonic
    ? "Play the two notes together"
    : "Play the two notes, left then right";

/** What one key press on an interval page did. */
export type IntervalOutcome =
  | { kind: "painted"; finished: boolean }
  /** The left note of a melodic interval: now the right one. */
  | { kind: "next" }
  /** One note of a harmonic interval, so far. */
  | { kind: "waiting" }
  /** The right note of a melodic interval, before the left one. */
  | { kind: "order" }
  /** Both notes of a melodic interval at once. */
  | { kind: "together" }
  /** A harmonic interval's notes, one after the other. */
  | { kind: "apart" }
  | {
      kind: "octave";
      pitch: number;
      direction: "higher" | "lower";
      lettersShown: boolean;
    }
  | { kind: "wrong"; pitch: number; lettersShown: boolean }
  /** Find pages: a card's notes, played, that do not hold the interval. */
  | { kind: "not-it"; size: number }
  /** Find pages: Skip on a card that holds the interval. */
  | { kind: "look-again"; size: number }
  /** Find pages: a card without the interval, skipped. */
  | { kind: "skipped"; finished: boolean }
  /** How far and Same and Different pages: the card played, now its answer. */
  | { kind: "played" }
  /** Same and Different pages: the top card played, now the bottom one. */
  | { kind: "played-first" }
  /** How far pages: the card again, while its answer is due. */
  | { kind: "answer-now" }
  /** How far pages: an answer key before the card is played. */
  | { kind: "play-first" }
  /** How far and Same and Different pages: not that answer. */
  | { kind: "wrong-answer"; choice: number | string }
  | { kind: "finished" };

/**
 * An interval page being painted. One area at a time, in the book's step
 * order: the child plays its two notes as written, together or one after
 * the other, and the area takes its interval's crayon. Nothing is scored.
 */
export class IntervalGame {
  /** The areas in playing order, by their index on the page. */
  readonly order: readonly number[];
  private at = 0;
  /** Letter names show on the keys, after misses or the hint key. */
  letters = false;
  private misses = 0;
  /** Each painted area's crayon, by its index on the page. */
  readonly painted = new Map<number, Crayon>();
  /** Find pages: the cards skipped, by their index on the page. */
  readonly skipped = new Set<number>();
  /** The last area painted, for a hop between its notes. */
  lastHop: { from: number; to: number; count: number } | null = null;
  /** How far pages: the card is played and its answer is due. */
  answering = false;
  /** How far and Same and Different pages: each answer, by card index. */
  readonly answers = new Map<number, number | string>();
  /** When each of the current area's notes was pressed. */
  private pressed = new Map<number, number>();
  constructor(readonly page: IntervalsPage) {
    // Find and How far pages go through every card, in order; the others go
    // through each step's areas in turn.
    this.order =
      page.game === "interval-find" ||
      page.game === "interval-name" ||
      page.game === "interval-twins"
        ? page.areas.map((_, i) => i)
        : page.steps.flatMap((step) =>
            page.areas.flatMap((area, i) =>
              stepColors(step, area) ? [i] : [],
            ),
          );
  }
  /** Whether a step colors `area`: on a Find page, whether to play it. */
  private wanted(area: IntervalArea) {
    return this.page.steps.some((s) => stepColors(s, area));
  }
  get finished() {
    return this.at >= this.order.length;
  }
  /** The area to play now, by its index on the page. */
  get current(): number | undefined {
    return this.order[this.at];
  }
  /** The step whose crayon the current area gets. */
  get step() {
    const index = this.current;
    if (index === undefined) return this.page.steps.length;
    // A Find page's cards to skip still belong to its one step.
    return Math.max(
      0,
      this.page.steps.findIndex((s) => stepColors(s, this.page.areas[index])),
    );
  }
  /**
   * The key `pitch` went down at `time` (ms); `down` holds every key down
   * now, `pitch` included.
   */
  play(
    pitch: number,
    time: number,
    down: ReadonlySet<number>,
  ): IntervalOutcome {
    const index = this.current;
    if (index === undefined) return { kind: "finished" };
    if (this.answering) return { kind: "answer-now" };
    const area = this.page.areas[index];
    const [first, second] = area.notes;
    if (!area.notes.includes(pitch)) return this.miss(pitch, area);
    // One hand's note alone, the other resting.
    if (area.notes.length === 1) return this.played(index);
    if (area.harmonic) {
      const other = pitch === first ? second : first,
        then = this.pressed.get(other);
      this.pressed.set(pitch, time);
      if (then === undefined) return { kind: "waiting" };
      if (down.has(other) && time - then <= TOGETHER_MS)
        return this.played(index);
      if (!down.has(other) && time - then > RETRY_MS) {
        this.pressed.delete(other);
        return { kind: "waiting" };
      }
      this.pressed.clear();
      return { kind: "apart" };
    }
    // A repeat's second note is its first one again.
    const repeat = first === second;
    if (pitch === first && !(repeat && this.pressed.has(first))) {
      this.pressed.set(first, time);
      return { kind: "next" };
    }
    const then = this.pressed.get(first);
    if (then === undefined) return { kind: "order" };
    if (!repeat && time - then < TOGETHER_MS) {
      this.pressed.clear();
      return { kind: "together" };
    }
    return this.played(index);
  }
  /**
   * An answer key, on a How far page: how far apart the card's notes are,
   * once the card is played.
   */
  answer(choice: number | string): IntervalOutcome {
    const index = this.current;
    if (index === undefined) return { kind: "finished" };
    if (!this.answering) return { kind: "play-first" };
    if (choice !== rightAnswer(this.page, index))
      return { kind: "wrong-answer", choice };
    this.answers.set(index, choice);
    this.answering = false;
    // The card hopped as it was played; the answer only paints it.
    return this.paint(index, false);
  }
  /**
   * A card played as written: painted; on a How far page, to answer; on a
   * Same and Different page, the top card leads on to the bottom one.
   */
  private played(index: number): IntervalOutcome {
    const { game } = this.page;
    if (!this.wanted(this.page.areas[index])) {
      this.pressed.clear();
      return {
        kind: "not-it",
        size: intervalSize(this.page.areas[index].notes),
      };
    }
    if (game !== "interval-name" && game !== "interval-twins")
      return this.paint(index);
    if (game === "interval-twins" && index % 2 === 0) {
      this.hop(index);
      this.next();
      return { kind: "played-first" };
    }
    this.hop(index);
    this.answering = true;
    this.pressed.clear();
    return { kind: "played" };
  }
  private hop(index: number) {
    const [from, to] = this.page.areas[index].notes;
    this.lastHop = { from, to, count: (this.lastHop?.count ?? 0) + 1 };
  }
  /**
   * The Skip key, on a Find page: passes over a card without the interval,
   * and sends the child back to one that holds it.
   */
  skip(): IntervalOutcome {
    const index = this.current;
    if (index === undefined) return { kind: "finished" };
    const area = this.page.areas[index];
    if (this.wanted(area))
      return { kind: "look-again", size: intervalSize(area.notes) };
    this.skipped.add(index);
    this.next();
    return { kind: "skipped", finished: this.finished };
  }
  /** The hint key shows the letter names until the area is done. */
  hint() {
    if (!this.finished) this.letters = true;
  }
  private paint(index: number, hop = true): IntervalOutcome {
    this.painted.set(index, this.page.steps[this.step].crayon);
    if (hop) this.hop(index);
    this.next();
    return { kind: "painted", finished: this.finished };
  }
  private next() {
    this.at++;
    this.pressed.clear();
    this.misses = 0;
    this.letters = false;
  }
  private miss(pitch: number, area: IntervalArea): IntervalOutcome {
    this.pressed.clear();
    this.misses++;
    const lettersShown = !this.letters && this.misses >= LETTER_MISSES;
    if (lettersShown) this.letters = true;
    const [nearest] = area.notes
      .filter((p) => letterName(p) === letterName(pitch) && !isBlack(pitch))
      .sort((a, b) => Math.abs(a - pitch) - Math.abs(b - pitch));
    if (nearest !== undefined)
      return {
        kind: "octave",
        pitch,
        direction: pitch < nearest ? "higher" : "lower",
        lettersShown,
      };
    return { kind: "wrong", pitch, lettersShown };
  }
}

/** The interval a Find page looks for. */
const findSize = (page: IntervalsPage) => {
  const { match } = page.steps[0];
  return "size" in match ? match.size : 0;
};
/** What a Find page looks for: an interval, notes together or apart, or hands together. */
const findKind = (page: IntervalsPage) => {
  const { match } = page.steps[0];
  if ("size" in match) return "size";
  if (page.areas.some((a) => a.grand)) return "hands";
  return "harmonic" in match && match.harmonic ? "together" : "apart";
};
/** What the child does with the outlined card on a Find page. */
export function findPrompt(page: FindPage) {
  switch (findKind(page)) {
    case "size":
      return `Is it a ${intervalName(findSize(page))}? Play it, or press Skip`;
    case "together":
      return "Played together? Play the notes together, or press Skip";
    case "apart":
      return "Played separately? Play them left then right, or press Skip";
    case "hands":
      return "Hands together? Play both notes together, or press Skip";
  }
}

/** What the child does with the outlined card on a How far page. */
export function namePrompt(game: IntervalGame, area: IntervalArea) {
  if (game.page.game !== "interval-twins")
    return game.answering
      ? "How far apart? Press 2, 3 or 4"
      : intervalPrompt(area);
  if (game.answering) return "Same or different? Press G5 or A5";
  return `Play the ${(game.current ?? 0) % 2 ? "bottom" : "top"} card, left then right`;
}
/** A How far or Same and Different card's right answer, by its index. */
export function rightAnswer(page: IntervalsPage, index: number) {
  if (page.game !== "interval-twins")
    return intervalSize(page.areas[index].notes);
  return intervalSize(page.areas[index - 1].notes) ===
    intervalSize(page.areas[index].notes)
    ? "Same"
    : "Different";
}

/**
 * The hint after an interval page's `outcome`, or null to keep the one
 * shown (one note of a harmonic interval is half of a try, not a mistake).
 */
export function intervalFeedback(
  page: IntervalsPage,
  outcome: IntervalOutcome,
  area: IntervalArea | undefined,
): string | null {
  switch (outcome.kind) {
    case "painted": {
      if (!area) return doneText(page);
      // An answer page's last answer is praised too, before the page ends.
      const done = outcome.finished ? ` ${doneText(page)}` : "";
      if (page.game === "interval-name") {
        const size = intervalSize(area.notes);
        return `Yes! ${size}: that is a ${intervalName(size)}.${done}`;
      }
      if (page.game === "interval-twins") {
        const top = page.areas[page.areas.indexOf(area) - 1],
          [a, b] = [top, area].map((card) => intervalSize(card.notes));
        return a === b
          ? `Yes! Both are ${intervalName(a)}s: ${page.characters.same}.${done}`
          : `Yes! A ${intervalName(a)} and a ${intervalName(b)}: ${page.characters.different}.${done}`;
      }
      if (outcome.finished) return doneText(page);
      const step = page.steps.find((s) => stepColors(s, area))!;
      if (page.game === "interval-find" && findKind(page) === "hands")
        return `Yes! Hands together: ${step.crayon}.`;
      if (step.name) return `Yes! That is a ${step.name}: ${step.crayon}.`;
      if ("up" in step.match)
        return `Yes! A ${intervalName(intervalSize(area.notes))} going ${step.match.up ? "up" : "down"}: ${step.crayon}.`;
      return "size" in step.match
        ? `Yes! That is a ${intervalName(step.match.size)}: ${step.crayon}.`
        : `Yes! ${area.harmonic ? "Together, so it is harmonic" : "One after the other, so it is melodic"}: ${step.crayon}.`;
    }
    case "played":
      return page.game === "interval-twins"
        ? "Same or different? Same is G5, Different is A5."
        : "How far apart? Press 2, 3 or 4.";
    case "played-first":
      return "Now play the bottom card, left then right.";
    case "answer-now":
      return page.game === "interval-twins"
        ? "Now press Same (G5) or Different (A5)."
        : "Now press how far apart: 2, 3 or 4.";
    case "play-first":
      return page.game === "interval-twins"
        ? "Play both cards first, then press Same or Different."
        : "Play the card first, then press how far apart.";
    case "wrong-answer":
      return page.game === "interval-twins"
        ? "Look again: count how far apart the notes on each card are."
        : `Not ${outcome.choice}. Count each line and space from one note to the other.`;
    case "not-it":
      switch (findKind(page)) {
        case "size":
          return `That is a ${intervalName(outcome.size)}, not a ${intervalName(findSize(page))}. Press Skip (G5).`;
        case "together":
          return "Those notes are played one after the other. Press Skip (G5).";
        case "apart":
          return "Those notes are played together. Press Skip (G5).";
        case "hands":
          return "Only the right hand plays here: the left hand rests. Press Skip (G5).";
      }
      break;
    case "look-again":
      switch (findKind(page)) {
        case "size":
          return `Look again: that is a ${intervalName(outcome.size)}. Play it, left then right.`;
        case "together":
          return "Look again: those notes are stacked. Play them together.";
        case "apart":
          return "Look again: those notes are side by side. Play them, left then right.";
        case "hands":
          return "Look again: both hands play here. Play both notes together.";
      }
      break;
    case "skipped":
      if (outcome.finished) return doneText(page);
      switch (findKind(page)) {
        case "size":
          return `Right: no ${intervalName(findSize(page))} there. Next card.`;
        case "together":
          return "Right: those are played separately. Next card.";
        case "apart":
          return "Right: those are played together. Next card.";
        case "hands":
          return "Right: one hand only. Next card.";
      }
      break;
    case "next":
      return area && area.notes[0] === area.notes[1]
        ? "Now the same note again."
        : "Now the note on the right.";
    case "waiting":
      return null;
    case "order":
      return "Start with the note on the left.";
    case "together":
      return "These go one after the other: the left note, then the right.";
    case "apart":
      return "These notes are stacked: play them at the same time.";
    case "octave":
      return `That is ${bookName(outcome.pitch)}. Go ${outcome.direction}.${lettersText(outcome)}`;
    case "wrong":
      return isBlack(outcome.pitch)
        ? `That is a black key. Both notes are on white keys.${lettersText(outcome)}`
        : `That is ${letterName(outcome.pitch)}. Look at the notes again.${lettersText(outcome)}`;
    case "finished":
      return doneText(page);
  }
}

/** What one key press on an Interval Hop page did, in which part of it. */
export type HopOutcome =
  | { phase: "color"; outcome: Outcome; target: Step | undefined }
  | {
      phase: "circle";
      outcome: IntervalOutcome;
      area: IntervalArea | undefined;
    };

/**
 * An Interval Hop page being played. First its color steps, by letter, as on
 * a Color by Note page: every G on the cards, then every F. Then its circle
 * steps, one card at a time, as on an interval page: the child plays the
 * card's two notes, left then right, and the card is circled in its step's
 * crayon.
 */
export class HopGame {
  /** The color steps, as a page of note heads to color by letter. */
  readonly colors: PaintGame;
  /** The circle steps. */
  readonly cards: IntervalGame;
  constructor(readonly page: HopPage) {
    const notes = [...new Set(page.areas.flatMap((a) => a.notes))].sort(
      (a, b) => a - b,
    );
    this.colors = new PaintGame({
      page: page.page,
      title: page.title,
      useWith: page.useWith,
      game: "color-by-note",
      byLetter: true,
      steps: page.colors.map(({ crayon, letter }) => ({
        crayon,
        pitches: notes.filter((p) => letterName(p) === letter),
      })),
    });
    this.cards = new IntervalGame(page);
  }
  get coloring() {
    return !this.colors.finished;
  }
  /** The last card circled, for the hop between its notes. */
  get lastHop() {
    return this.cards.lastHop;
  }
  get finished() {
    return this.colors.finished && this.cards.finished;
  }
  /** The step now, counting the color steps first. */
  get step() {
    return this.coloring
      ? this.colors.step
      : this.page.colors.length + this.cards.step;
  }
  get letters() {
    return this.coloring ? this.colors.letters : this.cards.letters;
  }
  hint() {
    if (this.coloring) this.colors.hint();
    else this.cards.hint();
  }
  /** The card to play now, once coloring is done. */
  get current() {
    return this.coloring ? undefined : this.cards.current;
  }
  play(pitch: number, time: number, down: ReadonlySet<number>): HopOutcome {
    if (this.coloring) {
      const target = this.colors.current;
      return { phase: "color", outcome: this.colors.play(pitch), target };
    }
    const index = this.cards.current;
    const area = index === undefined ? undefined : this.page.areas[index];
    const outcome = this.cards.play(pitch, time, down);
    return { phase: "circle", outcome, area };
  }
}

/** The hint after an Interval Hop page's `played`, or null to keep the one shown. */
export function hopFeedback(game: HopGame, played: HopOutcome): string | null {
  if (played.phase === "circle")
    return intervalFeedback(game.page, played.outcome, played.area);
  const { outcome, target } = played;
  // The last color step leads on to the cards, not to the next page.
  if (outcome.kind === "painted" && outcome.finished)
    return "Yes! Now play each card, left then right.";
  return feedback(game.colors.page, outcome, target);
}

export type ControlAction =
  | "hint"
  | "back"
  | "next"
  | "leave"
  | "restart"
  /** Start over was let go before the hold finished. */
  | "restart-short"
  /** A hold has begun: the screen says to keep holding. */
  | "holding-leave"
  | "holding-restart";

/**
 * The control keys: C2 hint, D2 back (hold: leave), E2 next, F2 hold: start
 * over. Holds wait HOLD_MS so a bump never loses the page.
 */
export class ControlKeys {
  private holds = new Map<number, ReturnType<typeof setTimeout>>();
  /**
   * `isDown` says whether a key is still held when its hold ends: keys can be
   * let go without a release reaching here, as when the window loses focus.
   */
  constructor(
    private act: (action: ControlAction) => void,
    private isDown: (pitch: number) => boolean = () => true,
    private holdMs = HOLD_MS,
  ) {}
  /** A key went down. False when it is not a control key. */
  down(pitch: number) {
    if (zoneOf(pitch) !== "control") return false;
    if (pitch === CONTROL_KEYS.hint) this.act("hint");
    else if (pitch === CONTROL_KEYS.next) this.act("next");
    else if (pitch === CONTROL_KEYS.back) this.hold(pitch, "leave");
    else if (pitch === CONTROL_KEYS.restart) this.hold(pitch, "restart");
    return true;
  }
  /** A key came up. False when it is not a control key. */
  up(pitch: number) {
    if (zoneOf(pitch) !== "control") return false;
    const pending = this.holds.get(pitch);
    if (pending === undefined) return true;
    clearTimeout(pending);
    this.holds.delete(pitch);
    if (pitch === CONTROL_KEYS.back) this.act("back");
    else this.act("restart-short");
    return true;
  }
  /**
   * A key was let go without its release reaching here, as when the window
   * loses focus: its hold ends without acting. False when it is not a
   * control key.
   */
  cancel(pitch: number) {
    if (zoneOf(pitch) !== "control") return false;
    clearTimeout(this.holds.get(pitch));
    this.holds.delete(pitch);
    return true;
  }
  /** Forget held keys, as when the page closes. */
  clear() {
    for (const timer of this.holds.values()) clearTimeout(timer);
    this.holds.clear();
  }
  private hold(pitch: number, action: "leave" | "restart") {
    if (this.holds.has(pitch)) return;
    this.act(action === "leave" ? "holding-leave" : "holding-restart");
    this.holds.set(
      pitch,
      setTimeout(() => {
        this.holds.delete(pitch);
        if (this.isDown(pitch)) this.act(action);
      }, this.holdMs),
    );
  }
}

/** Finished pages and the day each was finished (YYYY-MM-DD), in this browser. */
export type Stamps = Record<number, string>;
const STAMPS_KEY = "workbook-3:stamps";
export function readStamps(): Stamps {
  const saved = read<unknown>(STAMPS_KEY, {});
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  return Object.fromEntries(
    Object.entries(saved).filter(
      ([page, day]) =>
        Number.isSafeInteger(Number(page)) &&
        typeof day === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(day),
    ),
  );
}
/** Stamp `page` with today. Returns the stamps, and whether they were saved. */
export function stampPage(page: number, now = new Date()) {
  const stamps = { ...readStamps(), [page]: localDay(now) };
  return { stamps, saved: write(STAMPS_KEY, stamps) };
}
const MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
/** A stamp's day as the teacher's stamp prints it: OCT 20 2026. */
export function stampText(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return `${MONTHS[month - 1]} ${date} ${year}`;
}
