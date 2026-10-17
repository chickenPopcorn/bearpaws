import { memo } from "react";
import { fingerNames, type Song } from "./song";
import { BearPaw } from "./BearPaw";

export const FingerGuide = memo(function FingerGuide({
  song,
  left,
  right,
}: {
  song: Song;
  left: boolean;
  right: boolean;
}) {
  if (!song.lesson || !song.notes.some((n) => n.finger)) return null;
  const hands = new Map(song.tracks.map((t) => [t.id, t.hand]));
  return (
    <section className="finger-guide" aria-label="Finger positions">
      <div className="finger-guide-title">
        <h2 className="finger-guide-heading">Where your fingers go</h2>
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
            <BearPaw hand={hand} />
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
});
