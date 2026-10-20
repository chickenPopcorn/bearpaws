import {
  LETTER_MISSES,
  bookName,
  doneText,
  isBlack,
  letterName,
  type HandExample,
  type HandsPage,
} from "./workbook";

/**
 * Left Hand and Right Hand pages: the child says which hand plays each
 * example on the answer keys, then plays it. With a slur, the notes are
 * played legato: each key is held until the next one goes down. Times are
 * in milliseconds, on the key events' clock.
 */

/** A slurred note may start this long after the one before is let go. */
export const LEGATO_GAP_MS = 120;

export type Hand = "left" | "right";
export type HandsOutcome =
  /** A note before the hand was chosen. */
  | { kind: "choose-first" }
  | { kind: "hand-right"; hand: Hand }
  | { kind: "hand-wrong"; hand: Hand }
  /** The answer keys again, once the hand is chosen. */
  | { kind: "ignored" }
  /** The example's next note, played. */
  | { kind: "next-note" }
  /** A slurred note started after the one before was let go. */
  | { kind: "not-legato" }
  | {
      kind: "octave";
      pitch: number;
      direction: "higher" | "lower";
      lettersShown: boolean;
    }
  | { kind: "wrong"; pitch: number; lettersShown: boolean }
  | { kind: "done"; finished: boolean }
  | { kind: "finished" };

export class HandsGame {
  private at = 0;
  /** Letter names show on the keys, after misses or the hint key. */
  letters = false;
  private misses = 0;
  /** Each example's hand, once chosen rightly, by index. */
  readonly chosen = new Map<number, Hand>();
  /** The examples played, by index. */
  readonly done = new Set<number>();
  /** How many of the current example's notes are played. */
  private played = 0;
  /** When the last note played was let go, or null while it is held. */
  private releasedAt: number | null = null;
  constructor(readonly page: HandsPage) {}
  get finished() {
    return this.at >= this.page.examples.length;
  }
  get current(): number | undefined {
    return this.finished ? undefined : this.at;
  }
  /** The page has one step. */
  get step() {
    return this.finished ? 1 : 0;
  }
  /** Whether the current example's hand is chosen, and it is to be played. */
  get playing() {
    return this.chosen.has(this.at);
  }
  /** How many of the current example's notes are played. */
  get progress() {
    return this.played;
  }
  hint() {
    if (!this.finished) this.letters = true;
  }
  /** An answer key: which hand plays the example. */
  answer(hand: Hand): HandsOutcome {
    const example = this.page.examples[this.at];
    if (!example) return { kind: "finished" };
    if (this.chosen.has(this.at)) return { kind: "ignored" };
    if (hand !== example.hand) return { kind: "hand-wrong", hand };
    this.chosen.set(this.at, hand);
    return { kind: "hand-right", hand };
  }
  down(pitch: number, time: number): HandsOutcome {
    const example = this.page.examples[this.at];
    if (!example) return { kind: "finished" };
    if (!this.chosen.has(this.at)) return { kind: "choose-first" };
    const want = example.notes[this.played];
    if (pitch !== want) return this.miss(pitch, want);
    if (
      this.page.slur &&
      this.played > 0 &&
      this.releasedAt !== null &&
      time - this.releasedAt > LEGATO_GAP_MS
    ) {
      // Start the example again, joined this time.
      this.played = 0;
      this.releasedAt = null;
      return { kind: "not-legato" };
    }
    this.played++;
    this.releasedAt = null;
    if (this.played < example.notes.length) return { kind: "next-note" };
    this.done.add(this.at);
    this.at++;
    this.played = 0;
    this.misses = 0;
    this.letters = false;
    return { kind: "done", finished: this.finished };
  }
  up(pitch: number, time: number) {
    const example = this.page.examples[this.at];
    if (example && this.played > 0 && pitch === example.notes[this.played - 1])
      this.releasedAt = time;
  }
  private miss(pitch: number, want: number): HandsOutcome {
    this.misses++;
    const lettersShown = !this.letters && this.misses >= LETTER_MISSES;
    if (lettersShown) this.letters = true;
    if (letterName(pitch) === letterName(want) && !isBlack(pitch))
      return {
        kind: "octave",
        pitch,
        direction: pitch < want ? "higher" : "lower",
        lettersShown,
      };
    return { kind: "wrong", pitch, lettersShown };
  }
}

const HANDS = { left: "left", right: "right" };
/** What the child does with the example now. */
export function handsPrompt(game: HandsGame) {
  if (game.current === undefined) return undefined;
  if (!game.playing) return "Which hand plays it? LH is G5, RH is A5";
  return game.page.slur
    ? "Play the example legato: hold each key until the next goes down"
    : "Play the example on the keyboard";
}

/** The hint after `outcome`, or null to keep the one shown. */
export function handsFeedback(
  page: HandsPage,
  outcome: HandsOutcome,
  example: HandExample | undefined,
): string | null {
  const more =
    "lettersShown" in outcome && outcome.lettersShown
      ? " The letters are on the keys now."
      : "";
  switch (outcome.kind) {
    case "choose-first":
      return "First say which hand plays it: LH is G5, RH is A5.";
    case "hand-right":
      return `Yes! The ${HANDS[outcome.hand]} hand plays it. Now play it.`;
    case "hand-wrong":
      return example?.clef === "bass"
        ? "Look again: this one is in the bass clef, for the left hand."
        : "Look again: this one is in the treble clef, for the right hand.";
    case "ignored":
    case "next-note":
      return null;
    case "not-legato":
      return "Keep the notes joined: hold each key until the next one goes down. Start again.";
    case "octave":
      return `That is ${bookName(outcome.pitch)}. Go ${outcome.direction}.${more}`;
    case "wrong":
      return isBlack(outcome.pitch)
        ? `That is a black key. The notes are on white keys.${more}`
        : `That is ${letterName(outcome.pitch)}. Look at the next note.${more}`;
    case "done":
      return `Yes! Played with the ${example ? HANDS[example.hand] : ""} hand.${outcome.finished ? ` ${doneText(page)}` : ""}`;
    case "finished":
      return doneText(page);
  }
}
