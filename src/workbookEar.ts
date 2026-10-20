import {
  doneText,
  type EarExample,
  type EarNote,
  type EarOption,
  type EarPage,
} from "./workbook";

/**
 * Ear Detective: for each example the app plays one of its two options, a
 * clapped rhythm on the laptop or a melody in the piano's sound, and the
 * child plays it back. The echo is matched against both options; when it
 * matches neither, the answer keys G5 (top) and A5 (bottom) take the answer
 * instead. Times are in milliseconds, on the key events' clock.
 */

/** A clapped beat and a played beat, in seconds. */
export const CLAP_BEAT = 0.75;
export const NOTE_BEAT = 0.6;
/** An echo is over this long after its last key goes down or comes up. */
export const ECHO_IDLE_MS = 1800;
/** A staccato note sounds this much of its beat. */
export const STACCATO_FRACTION = 0.35;

/** One sound the app plays: a note, or a clap with no pitch. */
export interface Sound {
  pitch?: number;
  /** Seconds after the start. */
  start: number;
  duration: number;
}

/** What the app plays for `option`, after `countIn` beats of clicks. */
export function sounds(page: EarPage, option: EarOption): Sound[] {
  const beat = page.kind === "rhythm" ? CLAP_BEAT : NOTE_BEAT;
  const out: Sound[] = [];
  let at = 0;
  for (const note of option.notes) {
    if (!note.rest)
      out.push({
        ...(note.pitch !== undefined && { pitch: note.pitch }),
        start: at * beat,
        duration:
          note.pitch === undefined
            ? 0.1
            : note.staccato
              ? STACCATO_FRACTION * beat
              : // Legato notes run into the next one.
                note.beats * beat * (option.slur ? 1.02 : 0.9),
      });
    at += note.beats;
  }
  return out;
}

/** One key of the child's echo. */
interface Key {
  pitch: number;
  down: number;
  up?: number;
}

const played = (option: EarOption) =>
  option.notes.filter((n): n is EarNote & { pitch: number } => !n.rest);
/** Each sounding note's start, in beats. */
const onsets = (option: EarOption) => {
  const out: number[] = [];
  let at = 0;
  for (const note of option.notes) {
    if (!note.rest) out.push(at);
    at += note.beats;
  }
  return out;
};

/**
 * Whether `keys` echo `option`'s rhythm: as many notes, spaced in the same
 * proportions (each gap within a third of a beat, scaled to the echo's
 * tempo).
 */
function sameRhythm(keys: readonly Key[], option: EarOption) {
  const beats = onsets(option);
  if (keys.length !== beats.length) return false;
  if (beats.length < 2) return true;
  const span = beats.at(-1)! - beats[0],
    echo = keys.at(-1)!.down - keys[0].down;
  if (echo <= 0) return false;
  return beats.every(
    (beat, i) =>
      Math.abs(
        ((keys[i].down - keys[0].down) / echo) * span - (beat - beats[0]),
      ) <= 0.34,
  );
}
/** Whether `keys` play `option`'s notes. */
const samePitches = (keys: readonly Key[], option: EarOption) => {
  const notes = played(option);
  return (
    keys.length === notes.length &&
    notes.every((note, i) => keys[i].pitch === note.pitch)
  );
};
/**
 * Whether the echo was played staccato: most keys let go before half the
 * gap to the next one. The last key has no gap, and is left out.
 */
function playedStaccato(keys: readonly Key[]) {
  let short = 0,
    counted = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    const gap = keys[i + 1].down - keys[i].down,
      held = (keys[i].up ?? keys[i + 1].down) - keys[i].down;
    if (gap <= 0) continue;
    counted++;
    if (held < gap * 0.6) short++;
  }
  return counted > 0 && short * 2 > counted;
}
const staccatoOption = (option: EarOption) =>
  played(option).some((n) => n.staccato);

/** Which of `example`'s options `keys` echo: 0, 1, or none. */
export function matchEcho(
  page: EarPage,
  example: EarExample,
  keys: readonly Key[],
): 0 | 1 | null {
  const [top, bottom] = example.options;
  const fits = (option: EarOption) => {
    if (page.kind === "rhythm") return sameRhythm(keys, option);
    if (!samePitches(keys, option)) return false;
    // Where the two differ in how they are played, so must the echo.
    if (staccatoOption(top) !== staccatoOption(bottom))
      return playedStaccato(keys) === staccatoOption(option);
    return true;
  };
  const a = fits(top),
    b = fits(bottom);
  return a && !b ? 0 : b && !a ? 1 : null;
}

export type EarOutcome =
  /** Keys before the example was heard. */
  | { kind: "listen-first" }
  /** The example is playing; keys wait for it to end. */
  | { kind: "playing" }
  /** A key of the echo. */
  | { kind: "echoing" }
  | { kind: "right"; finished: boolean; echoed: boolean }
  /** The echo or the answer was the other option. */
  | { kind: "other" }
  /** The echo matched neither option: the answer keys now. */
  | { kind: "unclear" }
  | { kind: "finished" };

/**
 * One Ear Detective page being played. `pick` chooses which option the app
 * plays for each example (0 top, 1 bottom); tests pass a fixed one.
 */
export class EarGame {
  private at = 0;
  /** Each example's option, once it is chosen to play. */
  readonly chosen = new Map<number, 0 | 1>();
  /** Each example circled, by index, and the option circled. */
  readonly circled = new Map<number, 0 | 1>();
  /** The example has been heard; the echo may begin. */
  heard = false;
  /** The answer keys are offered, after an echo that matched neither. */
  asking = false;
  /** Letter names never help here. */
  letters = false;
  /** Key times before this end the playing; their keys are not the echo. */
  private quietUntil = 0;
  private keys: Key[] = [];
  constructor(
    readonly page: EarPage,
    private pick: (example: number) => 0 | 1 = () =>
      Math.random() < 0.5 ? 0 : 1,
  ) {}
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
  hint() {}
  /** The option to play now: chosen once per example. */
  listen(): EarOption | undefined {
    const example = this.page.examples[this.at];
    if (!example) return undefined;
    if (!this.chosen.has(this.at)) this.chosen.set(this.at, this.pick(this.at));
    this.keys = [];
    return example.options[this.chosen.get(this.at)!];
  }
  /** The example sounds until `until`; the echo begins after it. */
  playing(until: number) {
    this.heard = true;
    this.quietUntil = until;
    this.keys = [];
  }
  /** Whether keys at `time` are part of the playing, not the echo. */
  quiet(time: number) {
    return time < this.quietUntil;
  }
  down(pitch: number, time: number): EarOutcome {
    if (this.finished) return { kind: "finished" };
    if (!this.heard) return { kind: "listen-first" };
    if (this.quiet(time)) return { kind: "playing" };
    this.keys.push({ pitch, down: time });
    return { kind: "echoing" };
  }
  up(pitch: number, time: number) {
    const key = [...this.keys]
      .reverse()
      .find((k) => k.pitch === pitch && k.up === undefined);
    if (key) key.up = time;
  }
  /** The time the echo is over, if it is waiting: idle since its last key. */
  get echoEnds(): number | null {
    if (!this.keys.length) return null;
    const last = Math.max(
      ...this.keys.map((k) => k.up ?? k.down),
      this.keys.at(-1)!.down,
    );
    return last + ECHO_IDLE_MS;
  }
  /** How many keys the echo has. */
  get echoed() {
    return this.keys.length;
  }
  /**
   * Whether the echo is complete: as many keys as the example has notes,
   * and, where how they are held matters, all let go.
   */
  get echoComplete() {
    const option =
      this.page.examples[this.at]?.options[this.chosen.get(this.at) ?? 0];
    if (!option || this.keys.length < played(option).length) return false;
    return (
      this.page.kind !== "articulation" ||
      this.keys.every((k) => k.up !== undefined)
    );
  }
  /** The echo is over: match it. */
  judge(): EarOutcome {
    const example = this.page.examples[this.at];
    if (!example) return { kind: "finished" };
    const keys = this.keys;
    this.keys = [];
    if (!keys.length) return { kind: "echoing" };
    const match = matchEcho(this.page, example, keys);
    if (match === null) {
      this.asking = true;
      return { kind: "unclear" };
    }
    return this.decide(match, true);
  }
  /** An answer key: 0 is the top option (G5), 1 the bottom (A5). */
  answer(option: 0 | 1): EarOutcome {
    if (this.finished) return { kind: "finished" };
    if (!this.heard) return { kind: "listen-first" };
    return this.decide(option, false);
  }
  private decide(option: 0 | 1, echoed: boolean): EarOutcome {
    if (option !== this.chosen.get(this.at)) return { kind: "other" };
    this.circled.set(this.at, option);
    this.at++;
    this.heard = false;
    this.asking = false;
    this.keys = [];
    return { kind: "right", finished: this.finished, echoed };
  }
}

/** The option's name, for hints: top or bottom, or the page's character. */
const optionName = (page: EarPage, option: 0 | 1) =>
  page.labels?.[option] ?? (option ? "the bottom one" : "the top one");

/** What the child does with the example now. */
export function earPrompt(game: EarGame) {
  if (game.current === undefined) return undefined;
  if (!game.heard) return "Listen: press C2";
  if (game.asking)
    return game.page.labels
      ? `Which one? G5 is ${game.page.labels[0]}, A5 is ${game.page.labels[1]}`
      : "Which one? G5 is the top, A5 the bottom";
  return game.page.kind === "rhythm"
    ? "Tap it back on any key"
    : "Play it back on the piano";
}

/** The hint after `outcome`, or null to keep the one shown. */
export function earFeedback(
  page: EarPage,
  outcome: EarOutcome,
  option: 0 | 1 | undefined,
): string | null {
  switch (outcome.kind) {
    case "listen-first":
      return "Listen first: press C2.";
    case "playing":
    case "echoing":
      return null;
    case "right": {
      const name = option === undefined ? "" : optionName(page, option);
      const praise = outcome.echoed
        ? `You played it back: it was ${name}!`
        : `Yes! It was ${name}.`;
      return outcome.finished ? `${praise} ${doneText(page)}` : praise;
    }
    case "other":
      return "Not that one. Listen again (C2) and try once more.";
    case "unclear":
      return page.labels
        ? `Which one did you hear? G5 is ${page.labels[0]}, A5 is ${page.labels[1]}.`
        : "Which one did you hear? G5 is the top, A5 the bottom.";
    case "finished":
      return doneText(page);
  }
}
