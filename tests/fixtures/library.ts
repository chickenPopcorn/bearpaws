import data from "./library-songs.json";
import type { Song } from "../../src/song";

type Entry = { collection: "classes" | "songs" | "pops"; song: Song };

/**
 * Three songs from the shared library (Ode to Joy, Dancing Raindrops and
 * Five O'Clock), as the app receives them from the library bucket. Each call
 * returns fresh copies.
 */
export function fixtureLibrary(): Song[] {
  return (structuredClone(data) as unknown as Entry[]).map(
    ({ collection, song }) => ({
      ...song,
      library: {
        collection,
        midi: `https://library.example/songs/${song.id}.mid?v=fixture`,
      },
    }),
  );
}
