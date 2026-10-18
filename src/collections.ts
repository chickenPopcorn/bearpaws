import type { Song } from "./song";

export const collections = [
  { id: "classes", title: "George Bear’s Classes", icon: "🎒" },
  { id: "songs", title: "Papa Bear’s Collections", icon: "🎼" },
  { id: "pops", title: "Mama Bear’s Pops", icon: "🎤" },
] as const;
export type CollectionId = (typeof collections)[number]["id"];

/** Library songs carry their collection; imported songs join Papa Bear’s. */
export function collectionForSong(song: Song | undefined) {
  const id = song?.library?.collection ?? "songs";
  return collections.find((group) => group.id === id) ?? collections[1];
}

export const songsInCollection = (songs: readonly Song[], id: CollectionId) =>
  songs.filter((song) => collectionForSong(song).id === id);
