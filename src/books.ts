import { georgeClassesOrder } from "./classPieces";
import { lessonBookOrder } from "./lessonPieces";
import type { Song } from "./song";

/** The whole library: George’s piano classes. */
export const CLASSES_TITLE = "George Bear’s Classes";

/** One section per class book, in this order, each with its songs in order. */
export const books = [
  {
    id: "recital-3",
    series: "Music for Little Mozarts",
    title: "Music Recital Book 3",
    icon: "🎹",
    songs: georgeClassesOrder,
  },
  {
    id: "lesson-3",
    series: "Music for Little Mozarts",
    title: "Music Lesson Book 3",
    icon: "📖",
    songs: lessonBookOrder,
  },
] as const satisfies readonly {
  id: string;
  series: string;
  title: string;
  icon: string;
  songs: readonly string[];
}[];
export type Book = (typeof books)[number];
export type BookId = Book["id"];

/** The book that lists a song; any other song counts as Recital Book 3. */
export function bookForSong(id: string): Book {
  return (
    books.find((book) => (book.songs as readonly string[]).includes(id)) ??
    books[0]
  );
}

export const songsInBook = (songs: readonly Song[], id: BookId) =>
  songs.filter((song) => bookForSong(song.id).id === id);
