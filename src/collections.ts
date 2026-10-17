import { popsPieces } from "./popsPieces";

export const collections = [
  { id: "classes", title: "George Bear’s Classes" },
  { id: "songs", title: "Papa Bear’s Collections" },
  { id: "pops", title: "Mama Bear’s Pops" },
] as const;

export function collectionForSong(id: string) {
  if (id === "cadence-dancing-raindrops-v1") return collections[0];
  if (popsPieces.some((piece) => piece.id === id)) return collections[2];
  return collections[1];
}
