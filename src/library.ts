import type { Song } from "./song";

/** The public Supabase bucket that holds the shared song library. */
export const LIBRARY_BUCKET = "library";
export const COLLECTION_IDS = ["classes", "songs", "pops"] as const;
export type LibraryCollection = (typeof COLLECTION_IDS)[number];

/** One song in index.json. Paths are relative to the bucket. */
export interface LibraryEntry {
  id: string;
  title: string;
  collection: LibraryCollection;
  /** The song in the app's format, as JSON. */
  song: string;
  /** Its MIDI file, for downloads. */
  midi?: string;
  /** Content hashes, so browsers fetch a file again only when it changes. */
  hash?: string;
  midiHash?: string;
}
export interface LibraryIndex {
  version: 1;
  songs: LibraryEntry[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);
const whole = (value: unknown) => Number.isSafeInteger(value);
const text = (value: unknown) => typeof value === "string" && value !== "";

function fail(where: string, problem: string): never {
  throw new Error(`${where}: ${problem}`);
}

/** Check index.json and return it typed. Throws with the first problem found. */
export function validateIndex(value: unknown): LibraryIndex {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.songs))
    fail("index.json", "expected { version: 1, songs: [...] }");
  const ids = new Set<string>();
  value.songs.forEach((entry: unknown, i) => {
    const where = `index.json songs[${i}]`;
    if (!isRecord(entry)) fail(where, "not an object");
    if (!text(entry.id) || !/^[A-Za-z0-9._-]{1,128}$/.test(entry.id as string))
      fail(where, "id must use letters, digits, dot, dash or underscore");
    if (ids.has(entry.id as string)) fail(where, `duplicate id ${entry.id}`);
    ids.add(entry.id as string);
    if (!text(entry.title)) fail(where, "missing title");
    if (!COLLECTION_IDS.includes(entry.collection as LibraryCollection))
      fail(where, `collection must be one of ${COLLECTION_IDS.join(", ")}`);
    if (!text(entry.song)) fail(where, "missing song path");
    for (const key of ["midi", "hash", "midiHash"])
      if (entry[key] !== undefined && !text(entry[key]))
        fail(where, `${key} must be a non-empty string`);
  });
  if (!value.songs.length) fail("index.json", "the library has no songs");
  return value as unknown as LibraryIndex;
}

/** Check one song file against the app's Song format. */
export function validateSong(value: unknown, id: string): Song {
  const where = `song ${id}`;
  if (!isRecord(value)) fail(where, "not an object");
  if (value.id !== id) fail(where, `its id is ${String(value.id)}`);
  if (!text(value.title)) fail(where, "missing title");
  if (!finite(value.duration) || (value.duration as number) <= 0)
    fail(where, "duration must be a positive number");
  if (!whole(value.ppq) || (value.ppq as number) <= 0)
    fail(where, "ppq must be a positive whole number");
  if (!Array.isArray(value.warnings)) fail(where, "missing warnings list");
  if (!Array.isArray(value.tempos)) fail(where, "missing tempos list");
  if (!Array.isArray(value.tracks) || !value.tracks.length)
    fail(where, "missing tracks");
  const tracks = new Set<number>();
  for (const track of value.tracks as unknown[]) {
    if (
      !isRecord(track) ||
      !whole(track.id) ||
      typeof track.name !== "string" ||
      !["left", "right", "off"].includes(track.hand as string) ||
      !whole(track.count)
    )
      fail(where, "each track needs id, name, hand and count");
    if (tracks.has(track.id as number))
      fail(where, `duplicate track id ${track.id}`);
    tracks.add(track.id as number);
  }
  if (!Array.isArray(value.notes) || !value.notes.length)
    fail(where, "missing notes");
  // Scoring and rendering key on note ids, so each must be unique.
  const notes = new Set<string>();
  for (const note of value.notes as unknown[]) {
    if (
      !isRecord(note) ||
      !text(note.id) ||
      !whole(note.pitch) ||
      (note.pitch as number) < 0 ||
      (note.pitch as number) > 127 ||
      !finite(note.start) ||
      !finite(note.end) ||
      !finite(note.soundEnd) ||
      !finite(note.velocity) ||
      !whole(note.channel) ||
      !tracks.has(note.track as number)
    )
      fail(where, `bad note ${isRecord(note) ? String(note.id) : ""}`);
    if (notes.has(note.id as string))
      fail(where, `duplicate note id ${note.id}`);
    notes.add(note.id as string);
  }
  return value as unknown as Song;
}

/**
 * Load every library song. `url` turns a bucket path into its public URL.
 * The index is always revalidated; song files carry their hash, so a browser
 * reuses its cached copy until the song changes.
 */
export async function loadLibrary(
  url: (path: string) => string,
  fetcher: typeof fetch = fetch,
): Promise<Song[]> {
  const get = async (path: string, hash?: string) => {
    const response = await fetcher(
      hash ? `${url(path)}?v=${hash}` : url(path),
      hash ? undefined : { cache: "no-cache" },
    );
    if (!response.ok)
      throw new Error(`Library file ${path}: HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  };
  const index = validateIndex(await get("index.json"));
  return Promise.all(
    index.songs.map(async (entry) => {
      const song = validateSong(await get(entry.song, entry.hash), entry.id);
      return {
        ...song,
        title: entry.title,
        library: {
          collection: entry.collection,
          midi: entry.midi
            ? `${url(entry.midi)}${entry.midiHash ? `?v=${entry.midiHash}` : ""}`
            : undefined,
        },
      };
    }),
  );
}
