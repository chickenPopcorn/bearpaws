import { useState } from "react";
import { fingerNames, type Song } from "./song";
import { handLineArt } from "./handIllustration";
import { BearPaw } from "./BearPaw";
import { read, write } from "./storage";

function HandDiagram({ hand }: { hand: "left" | "right" }) {
  const left = hand === "left";
  const tips = [
    { x: 231, y: 79, finger: 5 },
    { x: 198, y: 36, finger: 4 },
    { x: 152, y: 18, finger: 3 },
    { x: 104, y: 34, finger: 2 },
    { x: 49, y: 140, finger: 1 },
  ];
  return (
    <svg
      viewBox="24 -12 232 318"
      role="img"
      aria-label={`${hand} hand viewed from above: 1 thumb, 2 index, 3 middle, 4 ring, 5 little finger`}
    >
      <g transform={left ? "translate(280 0) scale(-1 1)" : undefined}>
        <path d={handLineArt} fill="currentColor" fillOpacity="0.82" />
      </g>
      {tips.map(({ x, y, finger }) => (
        <g key={finger}>
          <circle
            cx={left ? 280 - x : x}
            cy={y}
            r="13"
            fill="white"
            fillOpacity="0.94"
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeWidth="1"
          />
          <text
            x={left ? 280 - x : x}
            y={y + 7}
            textAnchor="middle"
            fill="currentColor"
            fontSize="22"
            fontWeight="700"
          >
            {finger}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function FingerGuide({
  song,
  left,
  right,
}: {
  song: Song;
  left: boolean;
  right: boolean;
}) {
  const [bear, setBear] = useState(
    () => read<unknown>("bear-paws", false) === true,
  );
  if (!song.lesson || !song.notes.some((n) => n.finger)) return null;
  const hands = new Map(song.tracks.map((t) => [t.id, t.hand]));
  return (
    <section className="finger-guide" aria-label="Finger positions">
      <div className="finger-guide-title">
        <button
          type="button"
          className="finger-guide-title-button"
          aria-label="Where your fingers go: bear paw mode"
          aria-pressed={bear}
          title={bear ? "Back to human hands" : "A little bear-shaped surprise"}
          onClick={() => {
            const next = !bear;
            setBear(next);
            write("bear-paws", next);
          }}
        >
          Where your fingers go
        </button>
        <p>
          Suggested starting positions. C4 is middle C; C3 is one octave lower.
        </p>
        <div className="finger-legend">
          {fingerNames.slice(1).map((name, i) => (
            <span key={name}>
              <b>{i + 1}</b> {name}
            </span>
          ))}
        </div>
      </div>
      {(["left", "right"] as const).map((hand) => {
        const enabled = hand === "left" ? left : right;
        const assigned = song.notes.some(
          (n) => n.fingerHand === hand && hands.get(n.track) === hand,
        );
        return (
          <div
            key={hand}
            className={`hand-position ${hand} ${enabled ? "" : "inactive"}`}
          >
            {bear ? <BearPaw hand={hand} /> : <HandDiagram hand={hand} />}
            <div>
              <strong>
                {hand === "left" ? "Left hand" : "Right hand"}
                {!enabled && " · off"}
              </strong>
              <p>
                {assigned
                  ? song.lesson!.handPositions[hand]
                  : "Restore this track’s original hand to use its fingering."}
              </p>
            </div>
          </div>
        );
      })}
    </section>
  );
}
