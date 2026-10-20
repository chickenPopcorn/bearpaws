import { pitchPosition } from "./notation";
import {
  CRAYONS,
  bookName,
  type AreaShape,
  type Clef,
  type Crayon,
} from "./workbook";

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
}: {
  areas: readonly PictureArea[];
  /** The area to play now, by index. */
  current?: number;
  height?: number;
  scale?: number;
}) {
  const done = areas.filter((area) => area.crayon || area.ring).length;
  return (
    <svg
      className="workbook-picture"
      viewBox={`0 0 640 ${height}`}
      role="img"
      aria-label={`Picture with ${areas.length} areas, ${done} painted`}
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
            {area.ring ? `, circled ${area.ring}` : ""}
            {area.faded ? ", skipped" : ""}
          </title>
          <path
            d={SHAPES[area.shape]}
            style={{ fill: area.crayon ? CRAYONS[area.crayon] : undefined }}
          />
          <StaffNotes
            notes={area.notes}
            clef={area.clef}
            harmonic={area.harmonic}
            dots={area.dots}
          />
          {area.ring && (
            <ellipse
              className="workbook-ring"
              rx={86}
              ry={64}
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
