import type { Group } from "./engine";
import { noteName, suggestedFinger, type Song } from "./song";

/**
 * The Wait-mode target as text, for screen readers: the canvas and score show
 * it only visually. One entry per hand and pitch, as on the keyboard.
 */
export function describeWaitTarget(
  song: Song,
  gate: Group | undefined,
  down: ReadonlySet<number>,
) {
  if (!gate) return "No more notes to play in this passage.";
  const hands = new Map(song.tracks.map((track) => [track.id, track.hand]));
  const notes = new Map(
    gate.notes.map((note) => [`${note.track}:${note.pitch}`, note]),
  );
  const parts = [...notes.values()].map((note) => {
    const hand = hands.get(note.track) ?? "off";
    const finger = suggestedFinger(note, hand);
    return [
      noteName(note.pitch),
      hand === "left" ? "left hand" : "right hand",
      finger && `finger ${finger}`,
      down.has(note.pitch) && "held",
    ]
      .filter(Boolean)
      .join(", ");
  });
  return `Next: ${parts.join("; ")}.`;
}
