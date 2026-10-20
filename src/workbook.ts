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
export type AreaShape = "star" | "cloud" | "heart" | "blob";
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
export type WorkbookGame = "crayon-keys" | "color-by-note";
export const GAME_NAMES: Record<WorkbookGame, string> = {
  "crayon-keys": "Crayon Keys",
  "color-by-note": "Color by Note",
};
export interface WorkbookPage {
  page: number;
  title: string;
  /** The Lesson Book 3 page it goes with ("Use with page N"). */
  useWith: number;
  game: WorkbookGame;
  steps: Step[];
  /** The book names notes by letter only ("an F"), not by clef. */
  byLetter?: boolean;
  /** Color by Note pages only. */
  areas?: Area[];
  /** Crayon Keys pages with a staff: its notes, left to right. */
  staff?: { pitch: number; clef: Clef }[];
  /** The picture's height (it is 640 wide) and its areas' size, if not 300 and 1. */
  picture?: { height: number; scale: number };
}

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
export function instruction(page: WorkbookPage, step: Step) {
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
export function prompt(page: WorkbookPage, step: Step) {
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
  constructor(readonly page: WorkbookPage) {}
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
      if (this.painted.has(pitch)) return { kind: "again", pitch };
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
    // The nearest note still to find with this letter, if any.
    const [nearest] = this.left
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

/** The hint under the prompt after `outcome`, for a grown-up to read aloud. */
export function feedback(
  page: WorkbookPage,
  outcome: Outcome,
  target: Step | undefined,
) {
  const letters = "lettersShown" in outcome && outcome.lettersShown;
  const more = letters ? " The letters are on the keys now." : "";
  const done = `Page ${page.page} is done. ${pageAfter(page) ? "Next page: E2." : "This is the last page so far."}`;
  const want = wanted(target),
    // Several notes of one letter ("an F"), or of several (C to G).
    oneLetter = !want.includes(" or ");
  switch (outcome.kind) {
    case "painted":
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
