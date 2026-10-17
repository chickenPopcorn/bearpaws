import type { Group } from "./engine";
import {
  noteName,
  suggestedFinger,
  type Hand,
  type Note,
  type Song,
} from "./song";

/**
 * The Wait-mode target as text, for screen readers: the canvas and score show
 * it only visually. One entry per hand and pitch, as one key plays both.
 */
export function describeWaitTarget(
  song: Song,
  gate: Group | undefined,
  down: ReadonlySet<number>,
  hit: ReadonlySet<string>,
) {
  if (!gate) return "No more notes to play in this passage.";
  const hands = new Map(song.tracks.map((track) => [track.id, track.hand]));
  const keys = new Map<string, { hand: Hand; notes: Note[] }>();
  for (const note of gate.notes) {
    const hand: Hand = hands.get(note.track) ?? "off";
    const key = `${hand}:${note.pitch}`;
    const entry = keys.get(key) ?? { hand, notes: [] };
    entry.notes.push(note);
    keys.set(key, entry);
  }
  const parts = [...keys.values()].map(({ hand, notes }) => {
    const [note] = notes;
    const finger = notes
      .map((note) => suggestedFinger(note, hand))
      .find(Boolean);
    // A key still down from an earlier chord does not count: Wait mode needs
    // a release and a fresh press for a repeated pitch.
    const held = down.has(note.pitch);
    const played = notes.every((note) => hit.has(note.id));
    return [
      noteName(note.pitch),
      hand === "left" ? "left hand" : "right hand",
      finger && `finger ${finger}`,
      held && (played ? "held" : "release and play again"),
    ]
      .filter(Boolean)
      .join(", ");
  });
  return `Next: ${parts.join("; ")}.`;
}
