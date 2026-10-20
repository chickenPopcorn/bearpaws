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
  GAME_NAMES,
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
import {
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
      controls.current?.up(pitch);
      return;
    }
    if (controls.current?.down(pitch)) return;
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
    };
  }, []);
  // The page's steps, its prompt now, and what its keys and picture show.
  let lines: { crayon: Crayon; text: string }[],
    now: string | undefined,
    keys: ReadonlyMap<number, Crayon>,
    areas: PictureArea[] | undefined,
    current: number | undefined,
    hop: Hop | undefined,
    stickers: ReadonlyMap<number, KeyLabel> | undefined;
  if (game instanceof HopGame) {
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
    } else {
      now =
        current === undefined ? undefined : intervalPrompt(page.areas[current]);
      areas = page.areas.map((area, i) => ({
        ...area,
        clef: areaClef(area.notes, area.clef),
        crayon: game.painted.get(i),
      }));
    }
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
  const crayonNow = game.finished ? undefined : lines[game.step]?.crayon;
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
            {GAME_NAMES[page.game]} ·{" "}
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
            aria-current={i === game.step ? "step" : undefined}
            className={i < game.step ? "done" : undefined}
          >
            <span
              className="workbook-crayon"
              style={{ background: CRAYONS[line.crayon] }}
              aria-hidden="true"
            />
            {line.text}
            {i < game.step && <span className="sr-only"> Done.</span>}
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
          <WorkbookPicture areas={areas} current={current} {...page.picture} />
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
                ? `Step ${game.step + 1} of ${lines.length}`
                : next
                  ? `Next: page ${next.page} (E2)`
                  : "Last page so far"}
            </span>
          </div>
        </div>
        <p className="workbook-hint" role="status">
          {hint}
        </p>
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
        {page.game === "interval-twins" &&
          " Answers: G5 is Same, A5 is Different (on the computer keyboard L and ;)."}
      </p>
    </>
  );
});
