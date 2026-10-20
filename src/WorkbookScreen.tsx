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
  PaintGame,
  WORKBOOK_TITLE,
  feedback,
  instruction,
  prompt,
  pageAfter,
  pageBefore,
  stampText,
  zoneOf,
  type ControlAction,
  type Crayon,
  type WorkbookPage,
} from "./workbook";
import { drawWorkbookKeyboard } from "./workbookKeyboard";
import { WorkbookPicture, WorkbookStaff } from "./WorkbookPicture";

const START_HINT = "Play it on your piano.";

/** The page's keyboard: control keys, play zone and answer keys. */
const WorkbookKeyboard = memo(function WorkbookKeyboard({
  painted,
  letters,
}: {
  painted: ReadonlyMap<number, Crayon>;
  letters: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef({ painted, letters });
  const repaint = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    scene.current = { painted, letters };
    repaint.current();
  }, [painted, letters]);
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
    <canvas
      ref={canvas}
      className="workbook-keyboard"
      role="img"
      aria-label="Your piano. Left: control keys C2 hint, D2 back, E2 next, F2 hold to start over. Middle: C3 to C5 for the page's notes. Right: answer keys G5 to C6."
    />
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
  const [game, setGame] = useState(() => new PaintGame(page));
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
        setGame(new PaintGame(page));
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
  const key = useEffectEvent((pitch: number, down: boolean) => {
    if (!down) {
      controls.current?.up(pitch);
      return;
    }
    if (controls.current?.down(pitch) || zoneOf(pitch) === "answer") return;
    const target = game.current;
    const outcome = game.play(pitch);
    setRevision((r) => r + 1);
    setHint(feedback(page, outcome, target));
    if (outcome.kind === "painted" && outcome.finished) {
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
    const stop = studio.onKey((pitch, down) => key(pitch, down));
    return () => {
      stop();
      keys.clear();
      controls.current = null;
    };
  }, []);
  const current = game.current;
  const painted = new Map(game.painted);
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
          <p>{GAME_NAMES[page.game]} · Play each note on your piano.</p>
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
        {page.steps.map((step, i) => (
          <li
            key={i}
            aria-current={i === game.step ? "step" : undefined}
            className={i < game.step ? "done" : undefined}
          >
            <span
              className="workbook-crayon"
              style={{ background: CRAYONS[step.crayon] }}
              aria-hidden="true"
            />
            {instruction(page, step)}
            {i < game.step && <span className="sr-only"> Done.</span>}
          </li>
        ))}
      </ol>
      {page.staff && (
        <section className="panel workbook-staff-panel" aria-label="Staff">
          <WorkbookStaff notes={page.staff} painted={painted} />
        </section>
      )}
      {page.areas && (
        <section className="panel workbook-picture-panel" aria-label="Picture">
          <WorkbookPicture
            areas={page.areas}
            painted={painted}
            {...page.picture}
          />
        </section>
      )}
      <div className="roll workbook-roll">
        <div className="roll-caption">
          <span className="workbook-prompt">
            {current && (
              <span
                className="workbook-crayon"
                style={{ background: CRAYONS[current.crayon] }}
                aria-hidden="true"
              />
            )}
            {current ? prompt(page, current) : `Page ${page.page} is done`}
          </span>
          <div className="roll-actions">
            <span>
              {current
                ? `Step ${game.step + 1} of ${page.steps.length}`
                : next
                  ? `Next: page ${next.page} (E2)`
                  : "Last page so far"}
            </span>
          </div>
        </div>
        <p className="workbook-hint" role="status">
          {hint}
        </p>
        <WorkbookKeyboard painted={painted} letters={game.letters} />
      </div>
      <p className="small workbook-keys-help">
        Piano control keys: C2 hint · D2 back (hold to leave) · E2 next · F2
        hold to start over.
      </p>
    </>
  );
});
