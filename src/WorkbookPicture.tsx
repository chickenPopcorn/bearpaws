import { pitchPosition } from "./notation";
import {
  CRAYONS,
  bookName,
  type AreaShape,
  type Clef,
  type Crayon,
  type HoldCard,
  type NoteValue,
  type RestValue,
  type SnapColumn,
  type HandExample,
  letterName,
} from "./workbook";
import { cardCounts } from "./workbookHold";

/** Half a staff space, in picture units: one step up the staff. */
const HALF = 3.75;
/** Treble clef notes are written from E4 (step 30), bass from G2 (step 18). */
const BOTTOM_LINE_STEP = { treble: 30, bass: 18 } as const;

/** Outward bumps around an ellipse, for a cloud. */
function cloudPath(rx: number, ry: number, bumps: number) {
  const points = Array.from({ length: bumps }, (_, i) => {
    const angle = (i / bumps) * Math.PI * 2;
    return [Math.cos(angle) * rx, Math.sin(angle) * ry];
  });
  const arcs = points.map(([x, y], i) => {
    const [px, py] = points[(i + bumps - 1) % bumps];
    const r = Math.hypot(x - px, y - py) * 0.62;
    return `A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const [x0, y0] = points[bumps - 1];
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} ${arcs.join(" ")} Z`;
}
function starPath(outer: number, inner: number) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5,
      r = i % 2 ? inner : outer;
    return `${(Math.cos(angle) * r).toFixed(1)} ${(Math.sin(angle) * r).toFixed(1)}`;
  });
  return `M ${points.join(" L ")} Z`;
}
const SHAPES: Record<AreaShape, string> = {
  star: starPath(68, 38),
  cloud: cloudPath(66, 44, 9),
  heart:
    "M 0 48 C -34 24 -66 4 -62 -22 C -58 -44 -26 -50 0 -26 C 26 -50 58 -44 62 -22 C 66 4 34 24 0 48 Z",
  blob: "M -60 -30 Q -60 -46 -44 -46 L 44 -46 Q 60 -46 60 -30 L 60 30 Q 60 46 44 46 L -44 46 Q -60 46 -60 30 Z",
  // A grand staff card, for hands together.
  tall: "M -70 -72 Q -70 -80 -62 -80 L 62 -80 Q 70 -80 70 -72 L 70 72 Q 70 80 62 80 L -62 80 Q -70 80 -70 72 Z",
  // An Interval Hop card, like the book's chalkboards.
  card: "M -70 -42 Q -70 -50 -62 -50 L 62 -50 Q 70 -50 70 -42 L 70 42 Q 70 50 62 50 L -62 50 Q -70 50 -70 42 Z",
};

/** Where a note's head starts on an area's staff, and its ledger lines. */
function placeNotes(notes: readonly number[], clef: Clef, harmonic: boolean) {
  const steps = notes.map(
    (pitch) => pitchPosition(pitch, clef === "treble" ? "right" : "left").step,
  );
  // One note sits where the book puts it; two one after the other side by
  // side; two together on one line, a 2nd's upper head beside the lower.
  const xs =
    notes.length === 1
      ? [19]
      : !harmonic
        ? [-4, 20]
        : Math.abs(steps[0] - steps[1]) === 1
          ? [2, 14.5]
          : [8, 8];
  return steps.map((step, i) => {
    const ledgers: number[] = [];
    for (let s = BOTTOM_LINE_STEP[clef] - 2; s >= step; s -= 2) ledgers.push(s);
    for (let s = BOTTOM_LINE_STEP[clef] + 10; s <= step; s += 2)
      ledgers.push(s);
    return {
      x: xs[steps[0] > steps[1] && harmonic ? 1 - i : i],
      step,
      ledgers,
    };
  });
}

/** A small staff with one or two whole notes, centred on (0, 0). */
function StaffNotes({
  notes,
  clef,
  harmonic = false,
  dots,
}: {
  notes: readonly number[];
  clef: Clef;
  harmonic?: boolean;
  /** A crayon over each note head that has one, as a child colors it. */
  dots?: readonly (Crayon | undefined)[];
}) {
  const bottom = 4 * HALF,
    left = -40,
    right = 40,
    y = (step: number) => bottom - (step - BOTTOM_LINE_STEP[clef]) * HALF;
  const placed = placeNotes(notes, clef, harmonic);
  return (
    <g>
      <g className="sheet-staff-line">
        {[0, 1, 2, 3, 4].map((line) => (
          <line
            key={line}
            x1={left}
            x2={right}
            y1={bottom - line * 2 * HALF}
            y2={bottom - line * 2 * HALF}
          />
        ))}
        {placed.flatMap(({ x, ledgers }) =>
          ledgers.map((ledger) => (
            <line
              key={`${x}:${ledger}`}
              x1={x - 5}
              x2={x + 18}
              y1={y(ledger)}
              y2={y(ledger)}
            />
          )),
        )}
      </g>
      <text
        className="sheet-clef"
        x={left + 1}
        y={clef === "treble" ? bottom - 2 * HALF : bottom - 6 * HALF}
        fontSize={8 * HALF}
      >
        {clef === "treble" ? "\uE050" : "\uE062"}
      </text>
      {placed.map(({ x, step }, i) => {
        const dot = dots?.[i];
        return (
          <g key={i}>
            {dot && (
              <ellipse
                className="workbook-staff-paint"
                // A whole note's head is 1.69 staff spaces wide.
                cx={x + 1.69 * HALF}
                cy={y(step)}
                rx={2.8 * HALF}
                ry={2.2 * HALF}
                style={{ fill: CRAYONS[dot] }}
              />
            )}
            <text
              className="workbook-note"
              x={x}
              y={y(step)}
              fontSize={8 * HALF}
            >
              {"\uE0A2"}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * A grand staff on a card: the treble note above, the bass note or a
 * quarter rest below, joined by a brace.
 */
function GrandNotes({ treble, bass }: { treble: number; bass?: number }) {
  return (
    <g>
      <path
        className="workbook-brace"
        d="M -44 -50 Q -52 -30 -46 -4 Q -48 2 -54 4 Q -48 6 -46 12 Q -52 38 -44 58"
      />
      <g transform="translate(0 -30)">
        <StaffNotes notes={[treble]} clef="treble" />
      </g>
      <g transform="translate(0 40)">
        {bass === undefined ? (
          <g>
            <StaffNotes notes={[]} clef="bass" />
            <text className="workbook-note" x={16} y={0} fontSize={8 * HALF}>
              {"\uE4E5"}
            </text>
          </g>
        ) : (
          <StaffNotes notes={[bass]} clef="bass" />
        )}
      </g>
    </g>
  );
}

/** One area of a picture, as drawn. */
export interface PictureArea {
  shape: AreaShape;
  x: number;
  y: number;
  clef: Clef;
  /** One note, or an interval's two. */
  notes: readonly number[];
  /** Two notes written one above the other. */
  harmonic?: boolean;
  /** Its paint, once painted. */
  crayon?: Crayon;
  /** The crayon circling it, once circled. */
  ring?: Crayon;
  /** Each note head's crayon, once colored. */
  dots?: readonly (Crayon | undefined)[];
  /** Passed over: a Find page's card without its interval. */
  faded?: boolean;
  /** A grand staff card: a treble note, and a bass note or a rest. */
  grand?: { treble: number; bass?: number };
  /** How far pages: the answers printed under the staff, 2, 3 and 4. */
  choices?: readonly (number | string)[];
  /** How far pages: the answer given, circled in `ring`. */
  chosen?: number | string;
}
/** An area's clef: treble when all its notes are middle C or up. */
export const areaClef = (notes: readonly number[], clef?: Clef): Clef =>
  clef ?? (Math.min(...notes) >= 60 ? "treble" : "bass");

/**
 * A Color by Note picture: simple shapes, each holding one note, or an
 * interval's two, on a small staff. Painted areas take their step's crayon,
 * and on interval pages the area to play now is outlined. The picture is
 * 640 wide and `height` high; a page with many areas draws them at a smaller
 * `scale`.
 */
export function WorkbookPicture({
  areas,
  current,
  height = 300,
  scale = 1,
  summary,
}: {
  areas: readonly PictureArea[];
  /** The area to play now, by index. */
  current?: number;
  height?: number;
  scale?: number;
  /** What the picture holds and how far along it is, if not areas painted. */
  summary?: string;
}) {
  const done = areas.filter((area) => area.crayon || area.ring).length;
  return (
    <svg
      className="workbook-picture"
      viewBox={`0 0 640 ${height}`}
      role="img"
      aria-label={
        summary ?? `Picture with ${areas.length} areas, ${done} painted`
      }
    >
      {areas.map((area, i) => (
        <g
          key={i}
          className={`workbook-area${i === current ? " is-current" : ""}${area.faded ? " is-skipped" : ""}`}
          transform={`translate(${area.x} ${area.y}) scale(${scale})`}
        >
          <title>
            {area.notes.map(bookName).join(area.harmonic ? " with " : " then ")}
            {area.crayon ? `, ${area.crayon}` : ""}
            {area.ring
              ? area.chosen
                ? `, ${area.chosen} circled ${area.ring}`
                : `, circled ${area.ring}`
              : ""}
            {area.faded ? ", skipped" : ""}
          </title>
          <path
            className="workbook-shape"
            d={SHAPES[area.shape]}
            style={{ fill: area.crayon ? CRAYONS[area.crayon] : undefined }}
          />
          {area.grand ? (
            <GrandNotes {...area.grand} />
          ) : (
            <g transform={area.choices ? "translate(0 -10)" : undefined}>
              <StaffNotes
                notes={area.notes}
                clef={area.clef}
                harmonic={area.harmonic}
                dots={area.dots}
              />
            </g>
          )}
          {area.choices?.map((choice, n) => {
            // Words ("Same", "Different") take more room than numbers.
            const word = typeof choice === "string",
              x = (n - (area.choices!.length - 1) / 2) * (word ? 62 : 40);
            return (
              <g key={choice} transform={`translate(${x} 34)`}>
                <text
                  className={`workbook-choice${word ? " is-word" : ""}`}
                  textAnchor="middle"
                  y={word ? 5 : 6}
                >
                  {choice}
                </text>
                {area.ring && area.chosen === choice && (
                  <ellipse
                    className="workbook-ring"
                    rx={word ? 34 : 13}
                    ry={12}
                    pathLength={1}
                    style={{ stroke: CRAYONS[area.ring] }}
                  />
                )}
              </g>
            );
          })}
          {area.ring && !area.choices && (
            <ellipse
              className="workbook-ring"
              rx={86}
              ry={area.grand ? 96 : 64}
              pathLength={1}
              style={{ stroke: CRAYONS[area.ring] }}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

/** A Crayon Keys page's staff: one staff, or a grand staff with a brace. */
export function WorkbookStaff({
  notes,
  painted,
}: {
  notes: readonly { pitch: number; clef: Clef }[];
  painted: ReadonlyMap<number, Crayon>;
}) {
  // The studio score's spacing: a staff space of 10.
  const half = 5,
    grand = new Set(notes.map((n) => n.clef)).size > 1,
    bottoms = { treble: 70, bass: grand ? 170 : 70 },
    left = 34,
    spacing = 80,
    width = left + 70 + notes.length * spacing,
    clefs: Clef[] = grand ? ["treble", "bass"] : [notes[0].clef];
  const yOf = (pitch: number, clef: Clef) =>
    bottoms[clef] -
    (pitchPosition(pitch, clef === "treble" ? "right" : "left").step -
      BOTTOM_LINE_STEP[clef]) *
      half;
  return (
    <svg
      className="workbook-staff"
      viewBox={`0 0 ${width} ${grand ? 210 : 110}`}
      role="img"
      aria-label={`Staff: ${notes.map((n) => `${bookName(n.pitch)}${painted.has(n.pitch) ? ` (${painted.get(n.pitch)})` : ""}`).join(", ")}`}
    >
      <g className="sheet-staff-line" fill="none">
        {clefs.flatMap((clef) =>
          [0, 1, 2, 3, 4].map((line) => (
            <line
              key={`${clef}${line}`}
              x1={left}
              x2={width - 10}
              y1={bottoms[clef] - line * 2 * half}
              y2={bottoms[clef] - line * 2 * half}
            />
          )),
        )}
        {grand && (
          <>
            <line x1={left} x2={left} y1={30} y2={170} />
            <path d="M 27 30 Q 17 40 23 72 Q 27 94 18 100 Q 27 106 23 128 Q 17 160 27 170" />
          </>
        )}
      </g>
      {clefs.map((clef) => (
        <text
          key={clef}
          className="sheet-clef"
          x={left + 6}
          y={clef === "treble" ? bottoms.treble - 10 : bottoms.bass - 30}
          fontSize={40}
        >
          {clef === "treble" ? "" : ""}
        </text>
      ))}
      {notes.map(({ pitch, clef }, i) => {
        const x = left + 70 + i * spacing,
          y = yOf(pitch, clef),
          crayon = painted.get(pitch),
          { step } = pitchPosition(pitch, clef === "treble" ? "right" : "left");
        const ledgers: number[] = [];
        for (let s = BOTTOM_LINE_STEP[clef] - 2; s >= step; s -= 2)
          ledgers.push(bottoms[clef] - (s - BOTTOM_LINE_STEP[clef]) * half);
        for (let s = BOTTOM_LINE_STEP[clef] + 10; s <= step; s += 2)
          ledgers.push(bottoms[clef] - (s - BOTTOM_LINE_STEP[clef]) * half);
        return (
          <g key={i}>
            {crayon && (
              // The crayon over the note, as a child colors it in the book.
              <ellipse
                className="workbook-staff-paint"
                cx={x + 7}
                cy={y}
                rx={15}
                ry={12}
                style={{ fill: CRAYONS[crayon] }}
              />
            )}
            <g className="sheet-staff-line">
              {ledgers.map((ledger) => (
                <line
                  key={ledger}
                  x1={x - 6}
                  x2={x + 20}
                  y1={ledger}
                  y2={ledger}
                />
              ))}
            </g>
            <text className="workbook-note" x={x} y={y} fontSize={40}>
              {""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Bravura glyphs for Hold It! cards. */
const NOTE_GLYPHS: Record<NoteValue, string> = {
  quarter: "",
  half: "",
  "dotted-half": "",
  whole: "",
};
const REST_GLYPHS: Record<RestValue, string> = {
  quarter: "",
  half: "",
  whole: "",
};

/**
 * A Hold It! page's cards in a row (two rows for more than four): each
 * note or rest as printed. The card to play is outlined; a done note or
 * rest shows its counts, a done staccato note is circled in the page's
 * crayon, and a done plain note fades.
 */
export function HoldCards({
  cards,
  current,
  done,
  crayon,
}: {
  cards: readonly HoldCard[];
  current?: number;
  done: ReadonlySet<number>;
  crayon: Crayon;
}) {
  const perRow = cards.length > 4 ? 4 : cards.length,
    rows = Math.ceil(cards.length / perRow),
    height = rows * 140 + 20;
  return (
    <svg
      className="workbook-picture"
      viewBox={`0 0 640 ${height}`}
      role="img"
      aria-label={`${cards.length} cards, ${done.size} done`}
    >
      {cards.map((card, i) => {
        const x = 320 + ((i % perRow) - (perRow - 1) / 2) * 150,
          y = 80 + Math.floor(i / perRow) * 140,
          finished = done.has(i);
        const label =
          card.kind === "tap"
            ? card.staccato
              ? "quarter note with a staccato dot"
              : "quarter note"
            : `${card.value.replace("-", " ")} ${card.kind}`;
        return (
          <g
            key={i}
            className={`workbook-area${i === current ? " is-current" : ""}${
              finished && card.kind === "tap" && !card.staccato
                ? " is-skipped"
                : ""
            }`}
            transform={`translate(${x} ${y})`}
          >
            <title>
              {label}
              {finished
                ? card.kind === "tap"
                  ? card.staccato
                    ? `, circled ${crayon}`
                    : ", done"
                  : `, ${cardCounts(card)} count${cardCounts(card) === 1 ? "" : "s"}`
                : ""}
            </title>
            <path className="workbook-shape" d={SHAPES.card} />
            {card.kind === "rest" && card.value !== "quarter" && (
              <line
                className="workbook-rest-line"
                x1={-30}
                x2={30}
                y1={0}
                y2={0}
              />
            )}
            <text
              className={`workbook-glyph${card.kind === "rest" ? " is-rest" : ""}`}
              textAnchor="middle"
              x={card.kind === "rest" ? 0 : -6}
              // A note's head sits low, its stem up; a whole note centres.
              y={
                card.kind === "rest"
                  ? card.value === "quarter"
                    ? 14
                    : 0
                  : card.kind === "note" && card.value === "whole"
                    ? 6
                    : 16
              }
            >
              {card.kind === "rest"
                ? REST_GLYPHS[card.value]
                : NOTE_GLYPHS[card.kind === "note" ? card.value : "quarter"]}
            </text>
            {card.kind === "note" && card.value === "dotted-half" && (
              <text className="workbook-glyph" x={8} y={16}>
                {""}
              </text>
            )}
            {card.kind === "tap" && card.staccato && (
              <text className="workbook-glyph" x={-12} y={28}>
                {""}
              </text>
            )}
            {finished && card.kind !== "tap" && (
              <text className="workbook-choice" textAnchor="middle" y={44}>
                {`= ${cardCounts(card)}`}
              </text>
            )}
            {finished && card.kind === "tap" && card.staccato && (
              <ellipse
                className="workbook-ring"
                rx={86}
                ry={64}
                pathLength={1}
                style={{ stroke: CRAYONS[crayon] }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A Note Snap page: each column pair's letter cards and staff cards, with
 * a dot on each, as printed. The staff card to play is outlined; once its
 * note is played, a line joins its dot to its letter's.
 */
export function SnapBoard({
  columns,
  joined,
}: {
  columns: readonly SnapColumn[];
  /** How many staff cards are joined, in order: the next one is outlined. */
  joined: number;
}) {
  const rows = Math.max(...columns.map((c) => c.notes.length)),
    height = rows * 76 + 24,
    letterX = (c: number) => 55 + c * 320,
    staffX = (c: number) => 225 + c * 320,
    rowY = (r: number) => 50 + r * 76;
  // Each column's first card's place in the playing order.
  const first = columns.map((_, c) =>
    columns.slice(0, c).reduce((sum, column) => sum + column.notes.length, 0),
  );
  return (
    <svg
      className="workbook-picture"
      viewBox={`0 0 640 ${height}`}
      role="img"
      aria-label={`Letters and notes to join, ${joined} joined`}
    >
      <line
        className="workbook-snap-divider"
        x1={320}
        x2={320}
        y1={14}
        y2={height - 10}
      />
      {columns.map((column, c) => (
        <g key={c}>
          {column.notes.map(({ pitch }, r) => {
            if (first[c] + r >= joined) return null;
            const to = column.letters.indexOf(letterName(pitch));
            return (
              <line
                key={`line${r}`}
                className="workbook-snap-line"
                x1={letterX(c) + 34}
                y1={rowY(to)}
                x2={staffX(c) - 47}
                y2={rowY(r)}
                pathLength={1}
              />
            );
          })}
          {column.letters.map((letter, r) => (
            <g key={letter} transform={`translate(${letterX(c)} ${rowY(r)})`}>
              <rect
                className="workbook-snap-card"
                x={-30}
                y={-24}
                width={60}
                height={48}
                rx={6}
              />
              <text className="workbook-snap-letter" textAnchor="middle" y={9}>
                {letter}
              </text>
              <circle className="workbook-snap-dot" cx={34} r={4} />
            </g>
          ))}
          {column.notes.map(({ pitch, clef }, r) => (
            <g
              key={`note${r}`}
              className={`workbook-area${first[c] + r === joined ? " is-current" : ""}`}
              transform={`translate(${staffX(c)} ${rowY(r)})`}
            >
              <title>
                {bookName(pitch)}
                {first[c] + r < joined
                  ? `, joined to ${letterName(pitch)}`
                  : ""}
              </title>
              <g transform="scale(0.62)">
                <path className="workbook-shape" d={SHAPES.card} />
                <StaffNotes notes={[pitch]} clef={clef} />
              </g>
              <circle className="workbook-snap-dot" cx={-47} r={4} />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

/**
 * A Left Hand and Right Hand page's examples, two by two: each a staff of
 * its notes, the finger marked on the first, the slur if the page has one,
 * and the two hands to choose from below. The example to play is outlined;
 * its hand is colored in the page's crayon once chosen, and a done
 * example's slur is traced solid.
 */
export function HandsCards({
  examples,
  current,
  chosen,
  done,
  slur,
  crayon,
}: {
  examples: readonly HandExample[];
  current?: number;
  chosen: ReadonlyMap<number, "left" | "right">;
  done: ReadonlySet<number>;
  slur: boolean;
  crayon: Crayon;
}) {
  const half = 4.5,
    staffBottom = -4;
  return (
    <svg
      className="workbook-picture"
      viewBox="0 0 640 360"
      role="img"
      aria-label={`${examples.length} examples, ${done.size} played`}
    >
      {examples.map((example, i) => {
        const x = 165 + (i % 2) * 310,
          y = 95 + Math.floor(i / 2) * 175,
          y0 = (step: number) =>
            staffBottom - (step - BOTTOM_LINE_STEP[example.clef]) * half,
          heads = example.notes.map((pitch, n) => ({
            x: -48 + n * 42,
            y: y0(
              pitchPosition(pitch, example.clef === "treble" ? "right" : "left")
                .step,
            ),
            step: pitchPosition(
              pitch,
              example.clef === "treble" ? "right" : "left",
            ).step,
          })),
          hand = chosen.get(i);
        return (
          <g
            key={i}
            className={`workbook-area${i === current ? " is-current" : ""}`}
            transform={`translate(${x} ${y})`}
          >
            <title>
              {`${example.notes.map(bookName).join(", ")}${hand ? `, ${hand} hand` : ""}${done.has(i) ? ", played" : ""}`}
            </title>
            <path
              className="workbook-shape"
              d="M -140 -67 Q -140 -75 -132 -75 L 132 -75 Q 140 -75 140 -67 L 140 67 Q 140 75 132 75 L -132 75 Q -140 75 -140 67 Z"
            />
            <g className="sheet-staff-line">
              {[0, 1, 2, 3, 4].map((line) => (
                <line
                  key={line}
                  x1={-120}
                  x2={120}
                  y1={staffBottom - line * 2 * half}
                  y2={staffBottom - line * 2 * half}
                />
              ))}
              {heads.flatMap(({ x: hx, step }) => {
                const ledgers: number[] = [];
                for (
                  let s = BOTTOM_LINE_STEP[example.clef] - 2;
                  s >= step;
                  s -= 2
                )
                  ledgers.push(s);
                for (
                  let s = BOTTOM_LINE_STEP[example.clef] + 10;
                  s <= step;
                  s += 2
                )
                  ledgers.push(s);
                return ledgers.map((s) => (
                  <line
                    key={`${hx}:${s}`}
                    x1={hx - 6}
                    x2={hx + 18}
                    y1={y0(s)}
                    y2={y0(s)}
                  />
                ));
              })}
            </g>
            <text
              className="sheet-clef"
              x={-118}
              y={
                example.clef === "treble"
                  ? staffBottom - 2 * half
                  : staffBottom - 6 * half
              }
              fontSize={8 * half}
            >
              {example.clef === "treble" ? "" : ""}
            </text>
            {heads.map(({ x: hx, y: hy }, n) => (
              <text
                key={n}
                className="workbook-note"
                x={hx}
                y={hy}
                fontSize={8 * half}
              >
                {""}
              </text>
            ))}
            <text
              className="workbook-note"
              x={84}
              y={staffBottom - 4 * half}
              fontSize={8 * half}
            >
              {""}
            </text>
            <text
              className="workbook-finger"
              textAnchor="middle"
              x={heads[0].x + 6}
              y={
                example.clef === "treble"
                  ? staffBottom - 10 * half - 4
                  : staffBottom + 16
              }
            >
              {example.finger}
            </text>
            {slur && (
              // Below the notes on a treble staff, above them on a bass one,
              // as the book draws it.
              <g>
                <path
                  className={`workbook-slur${done.has(i) ? " is-traced" : ""}`}
                  d={
                    example.clef === "treble"
                      ? `M ${heads[0].x + 4} ${staffBottom + 8} Q ${(heads[0].x + heads.at(-1)!.x) / 2 + 6} ${staffBottom + 26} ${heads.at(-1)!.x + 10} ${staffBottom + 8}`
                      : `M ${heads[0].x + 4} ${staffBottom - 10 * half - 4} Q ${(heads[0].x + heads.at(-1)!.x) / 2 + 6} ${staffBottom - 10 * half - 22} ${heads.at(-1)!.x + 10} ${staffBottom - 10 * half - 4}`
                  }
                />
              </g>
            )}
            {(["left", "right"] as const).map((h, n) => (
              <g key={h} transform={`translate(${-48 + n * 96} 48)`}>
                <rect
                  className="workbook-hand"
                  x={-30}
                  y={-15}
                  width={60}
                  height={30}
                  rx={15}
                  style={{ fill: hand === h ? CRAYONS[crayon] : undefined }}
                />
                <text className="workbook-hand-label" textAnchor="middle" y={5}>
                  {h === "left" ? "LH" : "RH"}
                </text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
