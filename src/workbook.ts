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

/** One numbered step on the page: a note and the crayon it gets. */
export interface Step {
  crayon: Crayon;
  pitch: number;
}
export type AreaShape = "star" | "cloud" | "heart" | "blob";
/** One area of a Color by Note picture, holding one note on a small staff. */
export interface Area {
  shape: AreaShape;
  pitch: number;
  /** The area's centre in the picture's 640 × 300 frame. */
  x: number;
  y: number;
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
  /** Color by Note pages only. */
  areas?: Area[];
}

export const WORKBOOK_PAGES: readonly WorkbookPage[] = [
  {
    page: 7,
    title: "Bass Clef C",
    useWith: 7,
    game: "crayon-keys",
    steps: [
      { crayon: "green", pitch: 60 },
      { crayon: "red", pitch: 48 },
    ],
  },
  {
    page: 9,
    title: "Bass Clef D",
    useWith: 9,
    game: "crayon-keys",
    steps: [
      { crayon: "yellow", pitch: 62 },
      { crayon: "blue", pitch: 50 },
    ],
  },
  {
    page: 10,
    title: "Treble Clef D and Bass Clef D",
    useWith: 10,
    game: "color-by-note",
    steps: [
      { crayon: "yellow", pitch: 62 },
      { crayon: "blue", pitch: 50 },
      { crayon: "pink", pitch: 48 },
    ],
    areas: [
      { shape: "star", pitch: 62, x: 90, y: 200 },
      { shape: "star", pitch: 62, x: 190, y: 105 },
      { shape: "star", pitch: 62, x: 330, y: 70 },
      { shape: "blob", pitch: 50, x: 300, y: 225 },
      { shape: "cloud", pitch: 50, x: 450, y: 150 },
      { shape: "heart", pitch: 48, x: 560, y: 70 },
      { shape: "cloud", pitch: 48, x: 555, y: 225 },
    ],
  },
  {
    page: 11,
    title: "Bass Clef E",
    useWith: 11,
    game: "crayon-keys",
    steps: [
      { crayon: "red", pitch: 64 },
      { crayon: "green", pitch: 52 },
    ],
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
/** A step's line on the page, in the book's words. */
export function instruction(page: WorkbookPage, step: Step) {
  return page.game === "color-by-note"
    ? `Color the areas containing ${bookName(step.pitch)} ${step.crayon}.`
    : `Color ${bookName(step.pitch)} ${step.crayon}.`;
}

/** What one key press on the play zone did. */
export type Outcome =
  | { kind: "painted"; pitch: number; finished: boolean }
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
 * only the current step's note paints. A wrong key gets a hint and the child
 * tries again; nothing is scored.
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
  play(pitch: number): Outcome {
    const target = this.current;
    if (!target) return { kind: "finished" };
    if (pitch === target.pitch) {
      this.painted.set(pitch, target.crayon);
      this.step++;
      this.misses = 0;
      this.letters = false;
      return { kind: "painted", pitch, finished: this.finished };
    }
    this.misses++;
    const lettersShown = !this.letters && this.misses >= LETTER_MISSES;
    if (lettersShown) this.letters = true;
    if (letterName(pitch) === letterName(target.pitch) && !isBlack(pitch))
      return {
        kind: "octave",
        pitch,
        direction: pitch < target.pitch ? "higher" : "lower",
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
  switch (outcome.kind) {
    case "painted":
      return outcome.finished ? done : "Yes! Next crayon.";
    case "octave":
      return `That is ${bookName(outcome.pitch)}. Go ${outcome.direction}.${more}`;
    case "wrong": {
      const want = target ? letterName(target.pitch) : "";
      return isBlack(outcome.pitch)
        ? `That is a black key. ${want} is a white key.${more}`
        : `That is ${letterName(outcome.pitch)}. Look for ${want}.${more}`;
    }
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
