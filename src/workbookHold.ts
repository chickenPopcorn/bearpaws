import { doneText, type HoldCard, type HoldPage } from "./workbook";

/**
 * Hold It!: Music Workbook 3's note values, staccato and rests, played on
 * any key of the piano while the laptop's metronome counts. Times are in
 * milliseconds, on the key events' clock.
 */

/** One count, at 60 beats a minute: slow enough to count aloud. */
export const BEAT_MS = 1000;
/** A note or rest is held this many counts early or late at most. */
const NOTE_SLACK = 0.5;
/** The next note may come this much early after a rest, or this much late. */
const REST_EARLY = 0.4;
const REST_LATE = 0.6;
/** A staccato note is let go within this; a plain one is held this long. */
export const STACCATO_MS = 300;
export const FULL_MS = 600;

export const COUNTS: Record<
  "quarter" | "half" | "dotted-half" | "whole",
  number
> = { quarter: 1, half: 2, "dotted-half": 3, whole: 4 };
const NAMES = {
  quarter: "quarter",
  half: "half",
  "dotted-half": "dotted half",
  whole: "whole",
};
const counts = (n: number) => `${n} count${n === 1 ? "" : "s"}`;
/** A note or rest card's counts; a tap is one count. */
export const cardCounts = (card: HoldCard) =>
  card.kind === "tap" ? 1 : COUNTS[card.value];

export type HoldOutcome =
  /** A key went down for a note: hold it. */
  | { kind: "holding" }
  /** The note before a rest was let go: the rest has begun. */
  | { kind: "resting" }
  | { kind: "done"; finished: boolean }
  /** A note let go too soon, or a plain tap played too short. */
  | { kind: "short" }
  /** A note held too long, or a staccato tap held. */
  | { kind: "long" }
  /** The note after a rest, played before the rest was over. */
  | { kind: "too-soon" }
  /** The note after a rest, played long after it ended. */
  | { kind: "too-late" }
  /** A second key, or a key let go that this page was not following. */
  | { kind: "ignored" }
  | { kind: "finished" };

/**
 * One Hold It! page being played, a card at a time. A note card is held
 * for its counts; a rest card is a note, let go, then the rest's counts,
 * then the next note; a tap is played short if it has a staccato dot, or
 * for a full count if not. Nothing is scored; a try that is off says why
 * and the card waits for another.
 */
export class HoldGame {
  private at = 0;
  /** Letter names never help here, but the hint key may ask. */
  letters = false;
  /** The cards done, by index. */
  readonly done = new Set<number>();
  /** The key being followed, and when it went down (null: its release does nothing). */
  private key: number | null = null;
  private downAt: number | null = null;
  /** When the rest of a rest card began. */
  private restFrom: number | null = null;
  constructor(readonly page: HoldPage) {}
  get finished() {
    return this.at >= this.page.cards.length;
  }
  /** The card to play now, by index. */
  get current(): number | undefined {
    return this.finished ? undefined : this.at;
  }
  /** The page has one step. */
  get step() {
    return this.finished ? 1 : 0;
  }
  /** Whether a rest is being counted now. */
  get resting() {
    return this.restFrom !== null;
  }
  hint() {}
  /**
   * The counts gone by now, for the bar that fills as they pass: while a
   * note card's key is held, or while a rest is counted. Null otherwise.
   */
  beats(now: number): number | null {
    const card = this.page.cards[this.at];
    if (card?.kind === "note" && this.downAt !== null)
      return (now - this.downAt) / BEAT_MS;
    if (this.restFrom !== null) return (now - this.restFrom) / BEAT_MS;
    return null;
  }
  down(pitch: number, time: number): HoldOutcome {
    const card = this.page.cards[this.at];
    if (!card) return { kind: "finished" };
    if (this.key !== null) return { kind: "ignored" };
    if (card.kind === "rest" && this.restFrom !== null) {
      const rested = (time - this.restFrom) / BEAT_MS,
        count = COUNTS[card.value];
      this.restFrom = null;
      // Off: this key is the note before a new try at the rest.
      if (rested < count - REST_EARLY || rested > count + REST_LATE) {
        this.key = pitch;
        this.downAt = time;
        return { kind: rested < count ? "too-soon" : "too-late" };
      }
      // The note after the rest: letting it go does nothing more.
      this.key = pitch;
      this.downAt = null;
      return this.complete();
    }
    this.key = pitch;
    this.downAt = time;
    return { kind: "holding" };
  }
  up(pitch: number, time: number): HoldOutcome {
    if (pitch !== this.key) return { kind: "ignored" };
    this.key = null;
    const from = this.downAt;
    this.downAt = null;
    const card = this.page.cards[this.at];
    if (from === null || !card) return { kind: "ignored" };
    const ms = time - from;
    switch (card.kind) {
      case "note": {
        const held = ms / BEAT_MS,
          count = COUNTS[card.value];
        if (held < count - NOTE_SLACK) return { kind: "short" };
        if (held > count + NOTE_SLACK) return { kind: "long" };
        return this.complete();
      }
      case "rest":
        this.restFrom = time;
        return { kind: "resting" };
      case "tap":
        if (card.staccato)
          return ms <= STACCATO_MS ? this.complete() : { kind: "long" };
        return ms >= FULL_MS ? this.complete() : { kind: "short" };
    }
  }
  private complete(): HoldOutcome {
    this.done.add(this.at);
    this.at++;
    return { kind: "done", finished: this.finished };
  }
}

/** What the child does with the card now. */
export function holdPrompt(game: HoldGame) {
  const index = game.current;
  if (index === undefined) return undefined;
  const card = game.page.cards[index];
  switch (card.kind) {
    case "note":
      return `Hold a key for the ${NAMES[card.value]} note's counts, then let go`;
    case "rest":
      return game.resting
        ? "Rest… then play when the bar is full"
        : "Play a note and let go: then rest";
    case "tap":
      return "Play this note as written";
  }
}

/**
 * The hint after `outcome` on `card`, or null to keep the one shown (a key
 * going down for a note is the start of a try, not news).
 */
export function holdFeedback(
  page: HoldPage,
  outcome: HoldOutcome,
  card: HoldCard | undefined,
): string | null {
  const name = card && card.kind !== "tap" ? NAMES[card.value] : "",
    count = card ? cardCounts(card) : 1;
  switch (outcome.kind) {
    case "holding":
    case "ignored":
      return null;
    case "resting":
      return `Shh… rest for ${counts(count)}, then play when the bar is full.`;
    case "done":
      if (outcome.finished) return doneText(page);
      if (card?.kind === "note")
        return `Yes! A ${name} note gets ${counts(count)}.`;
      if (card?.kind === "rest")
        return `Yes! A ${name} rest gets ${counts(count)}.`;
      return card?.staccato
        ? "Yes! Short and bouncy: that is staccato."
        : "Yes! A full count: that one is not staccato.";
    case "short":
      return card?.kind === "tap"
        ? "No dot on this one: hold it for a whole count."
        : `Hold longer: a ${name} note gets ${counts(count)}.`;
    case "long":
      return card?.kind === "tap"
        ? "That note has a dot: play it short and bounce off the key."
        : `Let go sooner: a ${name} note gets ${counts(count)}.`;
    case "too-soon":
      return `Shh! Too soon: a ${name} rest gets ${counts(count)}. Let go and rest again.`;
    case "too-late":
      return "Play right when the rest ends. Let go and rest again.";
    case "finished":
      return doneText(page);
  }
}
