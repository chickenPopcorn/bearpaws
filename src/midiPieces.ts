import anJingMidi from "./assets/an-jing.mid?url&inline";
import { parseSong, type Song } from "./song";

/** Complete MIDI arrangements, kept separate from the fingered starter lessons. */
export const midiPieces = [
  {
    id: "bearpaws-an-jing-v1",
    title: "安静 · 周杰伦",
    composer: "周杰伦 · Jay Chou",
    description:
      "Full piano arrangement. Hands are suggested using a middle-C split; finger numbers are not provided.",
    url: "https://onlinesequencer.net/1677315",
    credit: "Shaivan on Online Sequencer",
    data: anJingMidi,
  },
] as const;

export function midiBytes(piece: (typeof midiPieces)[number]): Uint8Array {
  return Uint8Array.from(atob(piece.data.split(",")[1]), (char) =>
    char.charCodeAt(0),
  );
}

export function midiSongs(): Song[] {
  return midiPieces.map((piece) => {
    const song = parseSong(midiBytes(piece), piece.title, piece.id);
    // This source merges both hands into one piano track. Preserve all pitches,
    // timing, releases and velocities; only assign display/practice hands.
    for (const note of song.notes) {
      note.id = `${piece.id}-${note.id}`;
      note.track = note.pitch < 60 ? 0 : 1;
    }
    song.tracks = [
      { id: 0, name: "Left · below middle C", hand: "left", count: 0 },
      { id: 1, name: "Right · middle C and above", hand: "right", count: 0 },
    ];
    for (const note of song.notes) song.tracks[note.track].count++;
    song.source = {
      composer: piece.composer,
      description: piece.description,
      url: piece.url,
      credit: piece.credit,
    };
    return song;
  });
}
