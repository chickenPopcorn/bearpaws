import {
  memo,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { watchCanvasRedraws } from "./canvasRedraw";
import { studio } from "./session";
import { SongTitle } from "./SongTitle";
import {
  CRAYONS,
  ControlKeys,
  gameName,
  HopGame,
  IntervalGame,
  PaintGame,
  WORKBOOK_TITLE,
  ANSWER_KEYS,
  feedback,
  findPrompt,
  intervalName,
  namePrompt,
  hopFeedback,
  instruction,
  intervalSize,
  intervalFeedback,
  intervalInstruction,
  intervalPrompt,
  prompt,
  SNAP_WORDS,
  pageAfter,
  pageBefore,
  SKIP_KEY,
  stampText,
  zoneOf,
  type ControlAction,
  type Crayon,
  type WorkbookPage,
} from "./workbook";
import {
  drawWorkbookKeyboard,
  workbookKeys,
  type KeyLabel,
} from "./workbookKeyboard";
import { HoldGame, cardCounts, holdFeedback, holdPrompt } from "./workbookHold";
import { HandsGame, handsFeedback, handsPrompt } from "./workbookHands";
import {
  CLAP_BEAT,
  EarGame,
  NOTE_BEAT,
  earFeedback,
  earPrompt,
  sounds,
} from "./workbookEar";
import {
  EarCards,
  HandsCards,
  HoldCards,
  SnapBoard,
  WorkbookPicture,
  WorkbookStaff,
  areaClef,
  type PictureArea,
} from "./WorkbookPicture";

const START_HINT = "Play it on your piano.";
const NO_KEYS = new Map<number, Crayon>();
/** The game a page plays: by single notes, intervals or cards. */
const newGame = (page: WorkbookPage) =>
  page.game === "color-by-interval" ||
  page.game === "interval-find" ||
  page.game === "interval-name" ||
  page.game === "interval-twins"
    ? new IntervalGame(page)
    : page.game === "interval-hop"
      ? new HopGame(page)
      : page.game === "hold"
        ? new HoldGame(page)
        : page.game === "hands"
          ? new HandsGame(page)
          : page.game === "ear"
            ? new EarGame(page)
            : new PaintGame(page);
type Hop = { from: number; to: number; count: number };
const NO_HOP: Hop = { from: 60, to: 60, count: 0 };
/** A Find page's one sticker, on its answer key. */
const SKIP_STICKERS: ReadonlyMap<number, KeyLabel> = new Map([
  [SKIP_KEY, { mark: "»", word: "Skip" }],
]);
/** A How far page's answers, one on each answer key from G5 up. */
const answerStickers = (choices: readonly number[]) =>
  new Map<number, KeyLabel>(
    choices.map((choice, i) => [
      ANSWER_KEYS[i],
      { mark: String(choice), word: intervalName(choice) },
    ]),
  );
/** A Left Hand and Right Hand page's answers, on G5 and A5. */
const HAND_STICKERS: ReadonlyMap<number, KeyLabel> = new Map([
  [ANSWER_KEYS[0], { mark: "L", word: "LH" }],
  [ANSWER_KEYS[1], { mark: "R", word: "RH" }],
]);
/** A Same and Different page's answers, on G5 and A5. */
const TWIN_STICKERS: ReadonlyMap<number, KeyLabel> = new Map([
  [ANSWER_KEYS[0], { mark: "=", word: "Same" }],
  [ANSWER_KEYS[1], { mark: "≠", word: "Different" }],
]);
const KEYS = workbookKeys();
/** A key's centre, as a percentage of the keyboard's width. */
const keyCentre = (pitch: number) => {
  const key = KEYS.find((k) => k.pitch === pitch)!;
  return (key.x + key.width / 2) * 100;
};

/**
 * The Interval Hop paw over the keyboard: it hops from a card's first key to
 * its second, a little for a step and further for wider intervals, and
 * bounces in place for a repeat.
 */
function Hopper({ hop }: { hop: Hop }) {
  const paw = useRef<HTMLImageElement>(null);
  const from = keyCentre(hop.from),
    to = keyCentre(hop.to);
  useLayoutEffect(() => {
    const element = paw.current;
    if (
      !element ||
      !hop.count ||
      typeof element.animate !== "function" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const height = 8 + intervalSize([hop.from, hop.to]) * 7;
    element.animate(
      [
        { left: `${from}%`, transform: "translate(-50%, 0)" },
        {
          left: `${(from + to) / 2}%`,
          transform: `translate(-50%, -${height}px)`,
        },
        { left: `${to}%`, transform: "translate(-50%, 0)" },
      ],
      { duration: 600, easing: "ease-in-out" },
    );
    // Each new hop, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hop.count]);
  return (
    <img
      ref={paw}
      className="workbook-hopper"
      src={`${import.meta.env.BASE_URL}bearpaws.svg?v=3`}
      alt=""
      style={{ left: `${to}%` }}
    />
  );
}

/** The page's keyboard: control keys, play zone and answer keys. */
const WorkbookKeyboard = memo(function WorkbookKeyboard({
  painted,
  letters,
  hop,
  stickers,
}: {
  painted: ReadonlyMap<number, Crayon>;
  letters: boolean;
  /** Interval Hop pages: where the paw is, and its last hop. */
  hop?: Hop;
  /** The answer keys in use, with their stickers. */
  stickers?: ReadonlyMap<number, KeyLabel>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef({ painted, letters, stickers });
  const repaint = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    scene.current = { painted, letters, stickers };
    repaint.current();
  }, [painted, letters, stickers]);
  useLayoutEffect(() => {
    const element = canvas.current!;
    const subscribe = (listener: () => void) => {
      repaint.current = listener;
      const stop = studio.subscribe(listener);
      return () => {
        repaint.current = () => {};
        stop();
      };
    };
    return watchCanvasRedraws(element, subscribe, () =>
      drawWorkbookKeyboard(element, {
        down: studio.input.down,
        ...scene.current,
      }),
    );
  }, []);
  return (
    <div className={`workbook-keyboard-wrap${hop ? " has-hopper" : ""}`}>
      {hop && <Hopper hop={hop} />}
      <canvas
        ref={canvas}
        className="workbook-keyboard"
        role="img"
        aria-label="Your piano. Left: control keys C2 hint, D2 back, E2 next, F2 hold to start over. Middle: C3 to C5 for the page's notes. Right: answer keys G5 to C6."
      />
    </div>
  );
});

/**
 * Hold It!'s counting: a block per count that fills as the counts pass,
 * while a note's key is held or a rest is counted, and a metronome click
 * on the laptop for each count.
 */
function BeatBar({ game }: { game: HoldGame }) {
  // The counts begun so far, while counting; it changes once a count.
  const [beats, setBeats] = useState<number | null>(null);
  const index = game.current;
  const card = index === undefined ? undefined : game.page.cards[index];
  const active = game.beats(performance.now()) !== null;
  useEffect(() => {
    if (!active || !card) return;
    let frame = 0,
      clicked = -1,
      shown: number | null = null;
    const limit = cardCounts(card) + 1;
    const tick = () => {
      const now = game.beats(performance.now()),
        count = now === null ? null : Math.floor(now);
      // A click on each count, the first one accented, and none after the
      // card's last count.
      if (count !== null && count > clicked && count < limit) {
        clicked = count;
        studio.beat(count === 0);
      }
      if (count !== shown) {
        shown = count;
        setBeats(count);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [game, card, active]);
  if (!card || card.kind === "tap") return null;
  const total = cardCounts(card),
    shown = active ? beats : null;
  return (
    <div className="workbook-beats" role="img" aria-label={`${total} counts`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={
            shown !== null && shown >= i
              ? "workbook-beat is-on"
              : "workbook-beat"
          }
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
}

/** The stamp a finished page gets, like the teacher's date stamp. */
function PageStamp({ day, fresh }: { day?: string; fresh: boolean }) {
  return (
    <div className="workbook-stamp-wrap">
      <span
        className={`practice-stamp workbook-stamp${day ? " earned" : ""}${fresh ? " celebrate" : ""}`}
        role="img"
        aria-label={day ? `Done on ${stampText(day)}` : "Not done yet"}
      >
        <img
          className="practice-stamp-mark"
          src={`${import.meta.env.BASE_URL}bearpaws.svg?v=3`}
          alt=""
        />
      </span>
      {day && <span className="workbook-stamp-date">{stampText(day)}</span>}
    </div>
  );
}

/**
 * One workbook page as a game on the piano. The page's notes paint, and the
 * control keys move between pages: nothing here needs the mouse.
 */
export const Workbook = memo(function Workbook({
  page,
  stamp,
  onFinish,
  onPage,
  onLeave,
  notice,
  syncError,
}: {
  page: WorkbookPage;
  /** The day the page was finished, if it has been. */
  stamp?: string;
  onFinish(page: number): void;
  onPage(page: number): void;
  onLeave(): void;
  /** Browser storage trouble, such as a stamp kept for this session only. */
  notice?: string;
  /** Account sync trouble. */
  syncError?: string;
}) {
  const [game, setGame] = useState(() => newGame(page));
  // The game changes in place; a new revision redraws it.
  const [, setRevision] = useState(0);
  const [hint, setHint] = useState(START_HINT);
  const [fresh, setFresh] = useState(false);
  const controls = useRef<ControlKeys | null>(null);
  const previous = pageBefore(page),
    next = pageAfter(page);
  const control = useEffectEvent((action: ControlAction) => {
    switch (action) {
      case "hint":
        if (game.finished) return;
        // On Ear Detective pages C2 plays the example.
        if (game instanceof EarGame) {
          void listen(game);
          return;
        }
        game.hint();
        setRevision((r) => r + 1);
        setHint("Hint: the letters are on the keys.");
        return;
      case "next":
        if (next) onPage(next.page);
        else setHint("This is the last page so far.");
        return;
      case "back":
        if (previous) onPage(previous.page);
        else setHint("This is the first page so far.");
        return;
      case "leave":
        onLeave();
        return;
      case "restart":
        setGame(newGame(page));
        setFresh(false);
        setHint("Started over. " + START_HINT);
        return;
      case "restart-short":
        setHint("Hold F2 for 2 seconds to start over.");
        return;
      case "holding-leave":
        setHint("Keep holding D2 to leave the workbook. Let go to go back.");
        return;
      case "holding-restart":
        setHint("Keep holding F2 to start this page over.");
        return;
    }
  });
  const key = useEffectEvent((pitch: number, down: boolean, time: number) => {
    if (!down) {
      if (controls.current?.up(pitch)) return;
      // Hold It! times how long each key is held; a slur joins the keys.
      if (game instanceof HoldGame && zoneOf(pitch) === "play")
        play(pitch, time, false);
      if (game instanceof HandsGame && zoneOf(pitch) === "play")
        game.up(pitch, time);
      if (game instanceof EarGame && zoneOf(pitch) === "play") {
        game.up(pitch, time);
        watchEcho(game);
      }
      return;
    }
    if (controls.current?.down(pitch)) return;
    if (game instanceof EarGame) {
      if (zoneOf(pitch) === "answer") {
        const option =
          pitch === ANSWER_KEYS[0] ? 0 : pitch === ANSWER_KEYS[1] ? 1 : null;
        if (option === null || !game.asking) return;
        earOutcome(game, () => game.answer(option), option);
        return;
      }
      const outcome = game.down(pitch, time);
      const text = earFeedback(game.page, outcome, undefined);
      if (text !== null) setHint(text);
      if (outcome.kind === "echoing") watchEcho(game);
      setRevision((r) => r + 1);
      return;
    }
    if (game instanceof HandsGame) {
      const hand =
        pitch === ANSWER_KEYS[0]
          ? "left"
          : pitch === ANSWER_KEYS[1]
            ? "right"
            : undefined;
      if (zoneOf(pitch) === "answer" && !hand) return;
      const index = game.current;
      const wasFinished = game.finished;
      const outcome = hand ? game.answer(hand) : game.down(pitch, time);
      const text = handsFeedback(
        game.page,
        outcome,
        index === undefined ? undefined : game.page.examples[index],
      );
      if (text !== null) setHint(text);
      setRevision((r) => r + 1);
      if (!wasFinished && game.finished) {
        setFresh(true);
        onFinish(page.page);
      }
      return;
    }
    if (game instanceof HoldGame) {
      if (zoneOf(pitch) === "play") play(pitch, time, true);
      return;
    }
    const skip =
      pitch === SKIP_KEY &&
      game instanceof IntervalGame &&
      game.page.game === "interval-find";
    const answer =
      game instanceof IntervalGame &&
      (game.page.game === "interval-name" ||
        game.page.game === "interval-twins")
        ? game.page.choices[ANSWER_KEYS.indexOf(pitch)]
        : undefined;
    if (zoneOf(pitch) === "answer" && !skip && answer === undefined) return;
    const wasFinished = game.finished;
    if (game instanceof HopGame) {
      const text = hopFeedback(game, game.play(pitch, time, studio.input.down));
      if (text !== null) setHint(text);
    } else if (game instanceof IntervalGame) {
      const index = game.current;
      const outcome = skip
        ? game.skip()
        : answer !== undefined
          ? game.answer(answer)
          : game.play(pitch, time, studio.input.down);
      const text = intervalFeedback(
        game.page,
        outcome,
        index === undefined ? undefined : game.page.areas[index],
      );
      if (text !== null) setHint(text);
    } else {
      const target = game.current;
      setHint(feedback(game.page, game.play(pitch), target));
    }
    setRevision((r) => r + 1);
    if (!wasFinished && game.finished) {
      setFresh(true);
      onFinish(page.page);
    }
  });
  /**
   * An Ear Detective answer, from the echo or the answer keys: `answer`
   * gives the outcome, judged while example `index` was current.
   */
  const earOutcome = (
    ear: EarGame,
    answer: () => ReturnType<EarGame["judge"]>,
    option: 0 | 1 | undefined,
  ) => {
    const index = ear.current;
    const wasFinished = ear.finished;
    const outcome = answer();
    const circled =
      outcome.kind === "right" && index !== undefined
        ? ear.circled.get(index)
        : option;
    const text = earFeedback(ear.page, outcome, circled);
    if (text !== null) setHint(text);
    setRevision((r) => r + 1);
    if (!wasFinished && ear.finished) {
      setFresh(true);
      onFinish(page.page);
    }
  };
  /** Play the Ear Detective example, then wait for its echo. */
  const listen = async (ear: EarGame) => {
    const option = ear.listen();
    if (!option) return;
    const rhythm = ear.page.kind === "rhythm";
    const example = ear.page.examples[ear.current!];
    setHint(rhythm ? "Listen to the clapping…" : "Listen…");
    const until = await studio.playExample(
      sounds(ear.page, option),
      // A bar of clicks before a rhythm, as a teacher counts in.
      rhythm ? example.meter : 0,
      rhythm ? CLAP_BEAT : NOTE_BEAT,
    );
    if (until === null) {
      setHint("The sound could not start. Press C2 to try again.");
      return;
    }
    ear.playing(until);
    setRevision((r) => r + 1);
    echoTimer.current = setTimeout(
      () =>
        setHint(
          rhythm ? "Your turn: tap it back." : "Your turn: play it back.",
        ),
      Math.max(0, until - performance.now()),
    );
  };
  const echoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /** Judge the echo once it is complete, or once it has gone quiet. */
  const watchEcho = (ear: EarGame) => {
    clearTimeout(echoTimer.current);
    if (ear.echoComplete) {
      // A moment for the last key's release to arrive.
      echoTimer.current = setTimeout(() => judge(ear), 250);
      return;
    }
    const ends = ear.echoEnds;
    if (ends !== null)
      echoTimer.current = setTimeout(
        () => judge(ear),
        Math.max(0, ends - performance.now()),
      );
  };
  const judge = useEffectEvent((ear: EarGame) => {
    if (ear !== game) return;
    earOutcome(ear, () => ear.judge(), undefined);
  });
  /** A Hold It! key going down or coming up. */
  const play = (pitch: number, time: number, down: boolean) => {
    if (!(game instanceof HoldGame)) return;
    const index = game.current;
    const wasFinished = game.finished;
    const outcome = down ? game.down(pitch, time) : game.up(pitch, time);
    const text = holdFeedback(
      game.page,
      outcome,
      index === undefined ? undefined : game.page.cards[index],
    );
    if (text !== null) setHint(text);
    setRevision((r) => r + 1);
    if (!wasFinished && game.finished) {
      setFresh(true);
      onFinish(page.page);
    }
  };
  useEffect(() => {
    const keys = new ControlKeys(
      (action) => control(action),
      (pitch) => studio.input.down.has(pitch),
    );
    controls.current = keys;
    const stop = studio.onKey((pitch, down, time) => key(pitch, down, time));
    return () => {
      stop();
      keys.clear();
      controls.current = null;
      clearTimeout(echoTimer.current);
      studio.stopExample();
    };
  }, []);
  // The page's steps, its prompt now, and what its keys and picture show.
  let lines: { crayon: Crayon; text: string }[],
    now: string | undefined,
    keys: ReadonlyMap<number, Crayon>,
    areas: PictureArea[] | undefined,
    current: number | undefined,
    hop: Hop | undefined,
    stickers: ReadonlyMap<number, KeyLabel> | undefined,
    summary: string | undefined,
    shownStep = game.step;
  if (game instanceof HoldGame) {
    lines = game.page.steps.map((step) => ({
      crayon: step.crayon,
      text: step.words,
    }));
    now = holdPrompt(game);
    keys = NO_KEYS;
  } else if (game instanceof EarGame) {
    lines = game.page.steps.map((step) => ({
      crayon: step.crayon,
      text: step.words,
    }));
    now = earPrompt(game);
    keys = NO_KEYS;
    if (game.asking)
      stickers = new Map([
        [
          ANSWER_KEYS[0],
          { mark: "↑", word: game.page.labels ? "Mouse" : "Top" },
        ],
        [
          ANSWER_KEYS[1],
          { mark: "↓", word: game.page.labels ? "Hippo" : "Bottom" },
        ],
      ]);
  } else if (game instanceof HandsGame) {
    lines = game.page.steps.map((step) => ({
      crayon: step.crayon,
      text: step.words,
    }));
    now = handsPrompt(game);
    keys = NO_KEYS;
    stickers = HAND_STICKERS;
  } else if (game instanceof HopGame) {
    const { page } = game;
    lines = [
      ...page.colors.map(({ crayon, letter }) => ({
        crayon,
        text: `Color each ${letter} ${crayon}.`,
      })),
      ...page.steps.map((step) => ({
        crayon: step.crayon,
        text: intervalInstruction(step),
      })),
    ];
    current = game.current;
    now = game.coloring
      ? game.colors.current && prompt(game.colors.page, game.colors.current)
      : current === undefined
        ? undefined
        : intervalPrompt(page.areas[current]);
    keys = new Map(game.colors.painted);
    areas = page.areas.map((area, i) => ({
      ...area,
      clef: areaClef(area.notes, area.clef),
      ring: game.cards.painted.get(i),
      dots: area.notes.map((pitch) => game.colors.painted.get(pitch)),
    }));
    hop = game.lastHop ?? NO_HOP;
  } else if (game instanceof IntervalGame) {
    const { page } = game;
    lines = page.steps.map((step) => ({
      crayon: step.crayon,
      text: intervalInstruction(step),
    }));
    current = game.current;
    keys = NO_KEYS;
    if (page.game === "interval-find") {
      // The cards are circled, as the book asks, and skipped cards fade.
      now = current === undefined ? undefined : findPrompt(page);
      areas = page.areas.map((area, i) => ({
        ...area,
        clef: areaClef(area.notes, area.clef),
        ring: game.painted.get(i),
        faded: game.skipped.has(i),
      }));
      hop = game.lastHop ?? NO_HOP;
      stickers = SKIP_STICKERS;
    } else if (
      page.game === "interval-name" ||
      page.game === "interval-twins"
    ) {
      // The answer is circled under the card (on a Same and Different page,
      // under its box's bottom card), as the book asks.
      const twins = page.game === "interval-twins";
      now =
        current === undefined
          ? undefined
          : namePrompt(game, page.areas[current]);
      areas = page.areas.map((area, i) => ({
        ...area,
        clef: areaClef(area.notes, area.clef),
        choices: twins && i % 2 === 0 ? undefined : page.choices,
        chosen: game.answers.get(i),
        ring: game.painted.get(i),
      }));
      hop = game.lastHop ?? NO_HOP;
      stickers = twins ? TWIN_STICKERS : answerStickers(page.choices);
      // A box is one answer, under its bottom card.
      if (twins)
        summary = `Picture with ${page.areas.length / 2} boxes, ${game.answers.size} answered`;
    } else {
      now =
        current === undefined ? undefined : intervalPrompt(page.areas[current]);
      areas = page.areas.map((area, i) => ({
        ...area,
        clef: areaClef(area.notes, area.clef),
        crayon: game.painted.get(i),
      }));
    }
  } else if (game.page.game === "note-snap") {
    // One line, the book's; the cards light one at a time.
    lines = [{ crayon: "blue", text: SNAP_WORDS }];
    shownStep = game.finished ? 1 : 0;
    now = game.current && prompt(game.page, game.current);
    keys = new Map(game.painted);
  } else {
    const { page } = game;
    lines = page.steps.map((step) => ({
      crayon: step.crayon,
      text: instruction(page, step),
    }));
    now = game.current && prompt(page, game.current);
    keys = new Map(game.painted);
    areas = page.areas?.map((area) => ({
      ...area,
      notes: [area.pitch],
      clef: areaClef([area.pitch], area.clef),
      crayon: game.painted.get(area.pitch),
    }));
  }
  const crayonNow = game.finished ? undefined : lines[shownStep]?.crayon;
  return (
    <>
      <div className="song-head">
        <div>
          <div className="kicker">
            {WORKBOOK_TITLE} · Page {page.page}
          </div>
          <h1>
            <SongTitle title={page.title} />
          </h1>
          <p>
            {gameName(page)} ·{" "}
            {page.game === "color-by-interval"
              ? "Play each pair of notes on your piano."
              : page.game === "interval-hop"
                ? "Play each card's two notes on your piano."
                : page.game === "interval-find"
                  ? "Play the cards it asks for; skip the others on G5."
                  : page.game === "interval-name"
                    ? "Play each card, then press how far apart: 2, 3 or 4."
                    : page.game === "interval-twins"
                      ? "Play both cards, then press Same or Different."
                      : page.game === "hands"
                        ? "Say which hand plays each example, then play it."
                        : page.game === "ear"
                          ? "Press C2 to listen, then play it back."
                          : "Play each note on your piano."}
          </p>
        </div>
        <div className="song-tools">
          <span className="chip">Use with page {page.useWith}</span>
          <PageStamp day={stamp} fresh={fresh} />
        </div>
      </div>
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      {syncError && (
        <p className="alert" role="status">
          {syncError}
        </p>
      )}
      <ol className="workbook-steps" aria-label="Steps">
        {lines.map((line, i) => (
          <li
            key={i}
            aria-current={i === shownStep ? "step" : undefined}
            className={i < shownStep ? "done" : undefined}
          >
            <span
              className="workbook-crayon"
              style={{ background: CRAYONS[line.crayon] }}
              aria-hidden="true"
            />
            {line.text}
            {i < shownStep && <span className="sr-only"> Done.</span>}
          </li>
        ))}
      </ol>
      {(page.game === "crayon-keys" || page.game === "color-by-note") &&
        page.staff && (
          <section className="panel workbook-staff-panel" aria-label="Staff">
            <WorkbookStaff notes={page.staff} painted={keys} />
          </section>
        )}
      {areas && (
        <section className="panel workbook-picture-panel" aria-label="Picture">
          <WorkbookPicture
            areas={areas}
            current={current}
            summary={summary}
            {...page.picture}
          />
        </section>
      )}
      {game instanceof PaintGame && game.page.snap && (
        <section className="panel workbook-picture-panel" aria-label="Cards">
          <SnapBoard columns={game.page.snap} joined={game.step} />
        </section>
      )}
      {game instanceof EarGame && (
        <section className="panel workbook-picture-panel" aria-label="Examples">
          <EarCards
            page={game.page}
            current={game.current}
            circled={game.circled}
            crayon={game.page.steps[0].crayon}
          />
        </section>
      )}
      {game instanceof HandsGame && (
        <section className="panel workbook-picture-panel" aria-label="Examples">
          <HandsCards
            examples={game.page.examples}
            current={game.current}
            chosen={game.chosen}
            done={game.done}
            slur={game.page.slur}
            crayon={game.page.steps[0].crayon}
          />
        </section>
      )}
      {game instanceof HoldGame && (
        <section className="panel workbook-picture-panel" aria-label="Cards">
          <HoldCards
            cards={game.page.cards}
            current={game.current}
            done={game.done}
            crayon={game.page.steps[0].crayon}
          />
        </section>
      )}
      <div className="roll workbook-roll">
        <div className="roll-caption">
          <span className="workbook-prompt">
            {crayonNow && (
              <span
                className="workbook-crayon"
                style={{ background: CRAYONS[crayonNow] }}
                aria-hidden="true"
              />
            )}
            {now ?? `Page ${page.page} is done`}
          </span>
          <div className="roll-actions">
            <span>
              {!game.finished
                ? `Step ${shownStep + 1} of ${lines.length}`
                : next
                  ? `Next: page ${next.page} (E2)`
                  : "Last page so far"}
            </span>
          </div>
        </div>
        <p className="workbook-hint" role="status">
          {hint}
        </p>
        {game instanceof HoldGame && <BeatBar game={game} />}
        <WorkbookKeyboard
          painted={keys}
          letters={game.letters}
          hop={hop}
          stickers={stickers}
        />
      </div>
      <p className="small workbook-keys-help">
        Piano control keys: C2 hint · D2 back (hold to leave) · E2 next · F2
        hold to start over.
        {page.game === "interval-find" &&
          " Skip: G5, or L on the computer keyboard."}
        {page.game === "interval-name" &&
          " Answers: G5 is 2, A5 is 3, B5 is 4 (on the computer keyboard L, ; and ')."}
        {page.game === "ear" &&
          " Listen: C2. Answers when asked: G5 top, A5 bottom (on the computer keyboard 1 listens; L and ; answer)."}
        {page.game === "hands" &&
          " Hands: G5 is LH, A5 is RH (on the computer keyboard L and ;)."}
        {page.game === "interval-twins" &&
          " Answers: G5 is Same, A5 is Different (on the computer keyboard L and ;)."}
      </p>
    </>
  );
});
