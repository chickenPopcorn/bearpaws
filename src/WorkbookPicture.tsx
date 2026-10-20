import { pitchPosition } from "./notation";
import {
  CRAYONS,
  bookName,
  type Area,
  type AreaShape,
  type Crayon,
} from "./workbook";

/** Half a staff space, in picture units: one step up the staff. */
const HALF = 3;
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
};

/** A small staff with one whole note, centred on (0, 0). */
function StaffNote({ pitch }: { pitch: number }) {
  const clef = pitch >= 60 ? "treble" : "bass";
  const { step } = pitchPosition(pitch, clef === "treble" ? "right" : "left");
  const bottom = 12,
    left = -32,
    right = 32,
    y = bottom - (step - BOTTOM_LINE_STEP[clef]) * HALF;
  // Ledger lines for a note below or above the staff.
  const ledgers: number[] = [];
  for (let s = BOTTOM_LINE_STEP[clef] - 2; s >= step; s -= 2)
    ledgers.push(bottom - (s - BOTTOM_LINE_STEP[clef]) * HALF);
  for (let s = BOTTOM_LINE_STEP[clef] + 10; s <= step; s += 2)
    ledgers.push(bottom - (s - BOTTOM_LINE_STEP[clef]) * HALF);
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
        {ledgers.map((ledger) => (
          <line key={ledger} x1={12} x2={30} y1={ledger} y2={ledger} />
        ))}
      </g>
      <text
        className="sheet-clef"
        x={left + 1}
        y={clef === "treble" ? bottom - 2 * HALF : bottom - 6 * HALF}
        fontSize={8 * HALF}
      >
        {clef === "treble" ? "" : ""}
      </text>
      <text className="workbook-note" x={16} y={y} fontSize={8 * HALF}>
        {""}
      </text>
    </g>
  );
}

/**
 * A Color by Note picture: simple shapes, each holding one note on a small
 * staff. Painted areas take their step's crayon.
 */
export function WorkbookPicture({
  areas,
  painted,
}: {
  areas: readonly Area[];
  painted: ReadonlyMap<number, Crayon>;
}) {
  const done = areas.filter((area) => painted.has(area.pitch)).length;
  return (
    <svg
      className="workbook-picture"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Picture with ${areas.length} areas, ${done} painted`}
    >
      {areas.map((area, i) => {
        const crayon = painted.get(area.pitch);
        return (
          <g
            key={i}
            className="workbook-area"
            transform={`translate(${area.x} ${area.y})`}
          >
            <title>
              {bookName(area.pitch)}
              {crayon ? `, ${crayon}` : ""}
            </title>
            <path
              d={SHAPES[area.shape]}
              style={{ fill: crayon ? CRAYONS[crayon] : undefined }}
            />
            <StaffNote pitch={area.pitch} />
          </g>
        );
      })}
    </svg>
  );
}
