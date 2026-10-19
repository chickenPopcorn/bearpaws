import data from "./library-songs.json";
import type { Song } from "../../src/song";

type Entry = { song: Song };

/**
 * Three songs from the shared library (Ode to Joy, Dancing Raindrops and
 * Five O'Clock), as the app receives songs from the library bucket, all in
 * Recital Book 3. Each call returns fresh copies.
 */
export function fixtureLibrary(): Song[] {
  return (structuredClone(data) as unknown as Entry[]).map(({ song }) => ({
    ...song,
    library: {
      book: "recital-3",
      midi: `https://library.example/songs/${song.id}.mid?v=fixture`,
    },
  }));
}
