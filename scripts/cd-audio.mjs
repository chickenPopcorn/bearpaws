// Upload the course CD's audio to the private Supabase bucket `cd-audio`.
//
//   npm run cd-audio:push -- <folder>             Upload the CD's MP3 files.
//   npm run cd-audio:push -- <folder> --dry-run   Check them; upload nothing.
//
// <folder> holds the 112 MP3 files of "Music for Little Mozarts: Lesson and
// Discovery, Level 3" (Alfred Music, 2015), named as ripped:
// "Disc 1 - 15 Finger 3 on E.mp3". The recordings are copyrighted, so they
// never go into this repository. Each goes to mflm-3/disc-<n>/<nn>.mp3, and
// mflm-3/manifest.json lists every track: its disc, number, title on the CD,
// kind, and for each piece of Lesson Book 3 the library song's id.
//
// Disc 1 follows Lesson Book 3: tracks 3, 5, ... 85 are its 42 pieces in book
// order (`song`), the order of the `lesson-3` songs in the library's
// index.json; the other tracks tell the story (`story`). Disc 2 is the
// Discovery book (`discovery`).
//
// Only signed-in users can read the bucket (see supabase/migrations). The
// recordings never change, so browsers may keep each for a year; a corrected
// track needs a new name. A track already in the bucket with the same size is
// skipped, so the upload can run again after a failure; one with another size
// stops it. Uploading needs the project's secret key (see
// scripts/supabase-admin.mjs).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { adminClient } from "./supabase-admin.mjs";

const BUCKET = "cd-audio";
const CD = "mflm-3";
const MANIFEST = `${CD}/manifest.json`;
/** The bucket's largest file (file_size_limit in its migration). */
const MAX_FILE = 20 * 1024 * 1024;
const FOREVER = "31536000";
/** The manifest may change, and lists the tracks under their names. */
const BRIEF = "60";
/** How many tracks each disc has. */
const TRACKS = { 1: 86, 2: 26 };
/** Disc 1's tracks that hold the pieces of Lesson Book 3. */
const isSong = (disc, track) =>
  disc === 1 && track % 2 === 1 && track >= 3 && track <= 85;
/** The book's title of a piece whose CD title has a typo, by track. */
const BOOK_TITLES = {
  57: "Beethoven Bear's Amazing Trick",
  81: "The Bowing Song",
};
/** Titles compared without case, spacing or punctuation. */
const plain = (title) =>
  title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const folder = args.find((arg) => !arg.startsWith("--"));
if (!folder) {
  console.error("Usage: npm run cd-audio:push -- <folder> [--dry-run]");
  process.exit(1);
}

// The folder's file names say which track each file is; anything else in it
// stops the upload rather than be guessed at.
const tracks = [];
for (const name of readdirSync(folder).sort()) {
  if (name.startsWith(".")) continue;
  const match = /^Disc ([12]) - (\d{1,2}) (.+)\.mp3$/.exec(
    name.normalize("NFC"),
  );
  if (!match) throw new Error(`Not a track of the CD: ${name}`);
  const [, disc, track, title] = match;
  tracks.push({ file: join(folder, name), disc: +disc, track: +track, title });
}
tracks.sort((a, b) => a.disc - b.disc || a.track - b.track);
for (const [disc, count] of Object.entries(TRACKS)) {
  const numbers = tracks.filter((t) => t.disc === +disc).map((t) => t.track);
  const expected = Array.from({ length: count }, (_, i) => i + 1);
  if (numbers.join() !== expected.join())
    throw new Error(
      `Disc ${disc} should have tracks 1 to ${count}, once each.`,
    );
}

const client = await adminClient();
// The pieces of Lesson Book 3, in book order, from the library.
const { data: indexFile, error: indexError } = await client.storage
  .from("library")
  .download("index.json", { cacheNonce: Date.now() });
if (indexError)
  throw new Error(`Library index.json: ${indexError.message}`, {
    cause: indexError,
  });
const lessons = JSON.parse(await indexFile.text()).songs.filter(
  (song) => song.collection === "classes" && song.book === "lesson-3",
);
const songTracks = tracks.filter((t) => isSong(t.disc, t.track));
if (lessons.length !== songTracks.length)
  throw new Error(
    `The library has ${lessons.length} pieces in Lesson Book 3; the CD has ${songTracks.length}.`,
  );
songTracks.forEach((track, i) => {
  const song = lessons[i];
  if (plain(BOOK_TITLES[track.track] ?? track.title) !== plain(song.title))
    throw new Error(
      `Disc 1 track ${track.track} is "${track.title}", but piece ${i + 1} of Lesson Book 3 is "${song.title}".`,
    );
  track.songId = song.id;
});

const manifest = {
  version: 1,
  title: "Music for Little Mozarts: Lesson and Discovery, Level 3",
  publisher: "Alfred Music",
  year: 2015,
  tracks: tracks.map((track) => {
    const bytes = readFileSync(track.file);
    // An MP3 file starts with an ID3 tag or an MPEG audio frame.
    if (
      bytes.subarray(0, 3).toString("latin1") !== "ID3" &&
      !(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    )
      throw new Error(`${track.file} is not an MP3 file.`);
    if (bytes.length > MAX_FILE)
      throw new Error(
        `${track.file} is larger than the bucket's 20 MiB limit.`,
      );
    track.audio = `${CD}/disc-${track.disc}/${String(track.track).padStart(2, "0")}.mp3`;
    return {
      disc: track.disc,
      track: track.track,
      title: track.title,
      kind: isSong(track.disc, track.track)
        ? "song"
        : track.disc === 1
          ? "story"
          : "discovery",
      ...(track.songId && { songId: track.songId }),
      audio: track.audio,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }),
};
const count = (kind) => manifest.tracks.filter((t) => t.kind === kind).length;
console.log(
  `${tracks.length} tracks: ${count("song")} pieces of Lesson Book 3, ` +
    `${count("story")} story, ${count("discovery")} Discovery.`,
);
if (dryRun) {
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

const storage = client.storage.from(BUCKET);
/** Sizes of the tracks already in the bucket, by path. */
const existing = new Map();
for (const disc of Object.keys(TRACKS)) {
  const folderPath = `${CD}/disc-${disc}`;
  const { data, error } = await storage.list(folderPath, { limit: 1000 });
  if (error) throw new Error(`List ${folderPath}/: ${error.message}`);
  for (const file of data)
    existing.set(`${folderPath}/${file.name}`, file.metadata?.size);
}
let uploaded = 0;
let skipped = 0;
const queue = [...tracks];
const worker = async () => {
  for (let track; (track = queue.shift());) {
    const size = statSync(track.file).size;
    if (existing.has(track.audio)) {
      if (existing.get(track.audio) !== size)
        throw new Error(
          `${track.audio} is already in the bucket with a different size. ` +
            `Browsers keep each track for a year, so give a changed track a new name.`,
        );
      skipped++;
      continue;
    }
    const { error } = await storage.upload(
      track.audio,
      readFileSync(track.file),
      { contentType: "audio/mpeg", cacheControl: FOREVER, upsert: false },
    );
    if (error) throw new Error(`Upload ${track.audio}: ${error.message}`);
    uploaded++;
  }
};
await Promise.all(Array.from({ length: 4 }, worker));
// The manifest goes last, so it never lists a track that is not there yet.
const { error } = await storage.upload(
  MANIFEST,
  Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
  { contentType: "application/json", cacheControl: BRIEF, upsert: true },
);
if (error) throw new Error(`Upload ${MANIFEST}: ${error.message}`);
console.log(
  `Uploaded ${uploaded} tracks to the ${BUCKET} bucket` +
    (skipped ? `, skipped ${skipped} already there` : "") +
    `, and ${MANIFEST}.`,
);
