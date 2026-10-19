import type { LibraryBook } from "./library";
import type { Song } from "./song";

/** The whole library: George’s piano classes. */
export const CLASSES_TITLE = "George Bear’s Classes";

/** One section per class book, in this order. */
export const books = [
  {
    id: "recital-3",
    series: "Music for Little Mozarts",
    title: "Music Recital Book 3",
    icon: "🎹",
  },
  {
    id: "lesson-3",
    series: "Music for Little Mozarts",
    title: "Music Lesson Book 3",
    icon: "📖",
  },
] as const satisfies readonly {
  id: LibraryBook;
  series: string;
  title: string;
  icon: string;
}[];
export type Book = (typeof books)[number];

export function bookForSong(song: Song | undefined): Book {
  return books.find((book) => book.id === song?.library?.book) ?? books[0];
}

export const songsInBook = (songs: readonly Song[], id: LibraryBook) =>
  songs.filter((song) => bookForSong(song).id === id);
