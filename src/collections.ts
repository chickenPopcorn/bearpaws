import { popsPieces } from "./popsPieces";
import { midiPieces } from "./midiPieces";
import type { Song } from "./song";

export const collections = [
  { id: "classes", title: "George Bear’s Classes" },
  { id: "songs", title: "Papa Bear’s Collections" },
  { id: "pops", title: "Mama Bear’s Pops" },
] as const;
export type CollectionId = (typeof collections)[number]["id"];
const popsIds = new Set(
  [...popsPieces, ...midiPieces].map((piece) => piece.id),
);

export function collectionForSong(id: string) {
  if (id === "cadence-dancing-raindrops-v1") return collections[0];
  if (popsIds.has(id)) return collections[2];
  return collections[1];
}

export const songsInCollection = (songs: readonly Song[], id: CollectionId) =>
  songs.filter((song) => collectionForSong(song.id).id === id);
