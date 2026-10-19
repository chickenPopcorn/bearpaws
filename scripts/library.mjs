// Edit the shared song library, which lives in the Supabase `library` bucket.
//
//   npm run library:pull   Download the bucket into ./library for editing.
//   npm run library:push   Check ./library and upload it to the bucket.
//
// ./library holds index.json and songs/<id>.json + songs/<id>.mid. To add a
// song, put its MIDI file at songs/<id>.mid and list it in index.json with an
// id, title and collection: push converts the MIDI into songs/<id>.json.
// The bucket names each file after its content hash (songs/<id>.<hash>.json),
// so browsers can keep it for a year: a changed song gets a new name. A file
// the index stops listing is removed 24 hours later (see retired.json).
// Uploading needs the project's secret key: SUPABASE_SECRET_KEY, or a Supabase
// account token in MUSIC_API_KEY to look it up. Neither ever reaches the app.
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer, loadEnv } from "vite";

const FOLDER = "library";
/** Hashed files never change, so browsers and the CDN may keep them this long. */
const FOREVER = "31536000";
/** The index changes on every push. */
const BRIEF = "60";
/**
 * A file stays this long after the index stops listing it: a browser may still
 * be loading it from an index fetched just before the push.
 */
const RETIRE_MS = 24 * 60 * 60 * 1000;
/** songs/<id>.<hash>.json -> songs/<id>.json */
const plainName = (path) => path.replace(/\.[0-9a-f]{16}(\.\w+)$/, "$1");
const command = process.argv[2];
if (command !== "pull" && command !== "push") {
  console.error("Usage: node scripts/library.mjs pull|push");
  process.exit(1);
}
const env = { ...loadEnv("", process.cwd(), "VITE_"), ...process.env };
const url = env.VITE_SUPABASE_URL;
if (!url) throw new Error("Set VITE_SUPABASE_URL in .env.local (see README).");
const ref = new URL(url).hostname.split(".")[0];

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});
try {
  const { LIBRARY_BUCKET, validateIndex, validateSong } =
    await server.ssrLoadModule("/src/library.ts");
  const publicUrl = (path) =>
    `${url}/storage/v1/object/public/${LIBRARY_BUCKET}/${path}`;
  if (command === "pull") await pull(publicUrl, validateIndex);
  else await push(LIBRARY_BUCKET, validateIndex, validateSong);
} finally {
  await server.close();
}

async function pull(publicUrl, validateIndex) {
  const download = async (path) => {
    const response = await fetch(`${publicUrl(path)}?t=${Date.now()}`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const index = validateIndex(
    JSON.parse(new TextDecoder().decode(await download("index.json"))),
  );
  const songsFolder = resolve(FOLDER, "songs");
  mkdirSync(songsFolder, { recursive: true });
  // The working copy uses plain names; push adds the hashes again.
  for (const entry of index.songs) {
    for (const key of ["song", "midi"]) {
      if (!entry[key]) continue;
      const original = entry[key];
      entry[key] = plainName(entry[key]);
      // validateIndex allows only songs/<id>.json and .mid; check again here,
      // since this writes into the repository.
      const target = resolve(FOLDER, entry[key]);
      if (dirname(target) !== songsFolder)
        throw new Error(
          `${entry.id}: ${entry[key]} is outside ${FOLDER}/songs`,
        );
      writeFileSync(target, await download(original));
    }
    delete entry.hash;
    delete entry.midiHash;
  }
  writeFileSync(`${FOLDER}/index.json`, JSON.stringify(index, null, 2) + "\n");
  console.log(`Pulled ${index.songs.length} songs into ./${FOLDER}`);
}

async function push(bucket, validateIndex, validateSong) {
  const { parseSong } = await server.ssrLoadModule("/src/song.ts");
  const index = validateIndex(
    JSON.parse(readFileSync(`${FOLDER}/index.json`, "utf8")),
  );
  const hash = (bytes) =>
    createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const hashed = (path, bytes) => path.replace(/(\.\w+)$/, `.${hash(bytes)}$1`);
  const files = [];
  /** The index as published: every path carries its file's hash. */
  const published = structuredClone(index);
  // The live index, to notice a MIDI file replaced without its song data.
  // Only a bucket with no index yet (the first push) goes without; any other
  // failure stops the push rather than skip the check.
  const liveResponse = await fetch(
    `${url}/storage/v1/object/public/${bucket}/index.json?t=${Date.now()}`,
  );
  const liveBody = await liveResponse.text();
  let live;
  if (liveResponse.ok) live = JSON.parse(liveBody);
  else if (
    liveResponse.status === 404 ||
    /"code"\s*:\s*"NoSuchKey"/.test(liveBody)
  )
    live = { songs: [] };
  else
    throw new Error(
      `Could not read the live index.json (HTTP ${liveResponse.status}); try again.`,
    );
  const hashOf = (path) => /\.([0-9a-f]{16})\.\w+$/.exec(path ?? "")?.[1];
  const before = new Map(
    (live.songs ?? []).map((song) => [
      song.id,
      { song: hashOf(song.song), midi: hashOf(song.midi) },
    ]),
  );
  // Check every song before uploading anything.
  for (const entry of index.songs) {
    const songPath = `${FOLDER}/${entry.song}`;
    const midiPath = entry.midi && `${FOLDER}/${entry.midi}`;
    if (midiPath && !existsSync(midiPath))
      throw new Error(`${entry.id}: missing ${midiPath}`);
    if (!existsSync(songPath)) {
      if (!midiPath) throw new Error(`${entry.id}: missing ${songPath}`);
      const song = parseSong(
        new Uint8Array(readFileSync(midiPath)),
        entry.title,
        entry.id,
      );
      writeFileSync(songPath, JSON.stringify(song, null, 1) + "\n");
      console.log(`Converted ${midiPath} into ${songPath}`);
    }
    const songBytes = readFileSync(songPath);
    validateSong(JSON.parse(songBytes.toString("utf8")), entry.id);
    const out = published.songs.find((song) => song.id === entry.id);
    delete out.hash;
    delete out.midiHash;
    out.song = hashed(entry.song, songBytes);
    files.push([out.song, songBytes, "application/json"]);
    if (midiPath) {
      const midiBytes = readFileSync(midiPath);
      out.midi = hashed(entry.midi, midiBytes);
      files.push([out.midi, midiBytes, "audio/midi"]);
      // The app plays the song data and offers the MIDI file for download,
      // so a new MIDI file with the old song data would make them disagree.
      const was = before.get(entry.id);
      if (
        was?.midi &&
        was.midi !== hash(midiBytes) &&
        was.song === hash(songBytes)
      )
        throw new Error(
          `${entry.id}: ${entry.midi} changed but ${entry.song} did not. ` +
            `Update ${entry.song} to match, or delete it to rebuild it from ` +
            `the MIDI file (that drops any lesson details and fingering).`,
        );
    }
  }

  const client = createClient(url, await secretKey(), {
    auth: { persistSession: false },
  });
  const storage = client.storage.from(bucket);
  const upload = async (path, bytes, contentType, cacheControl) => {
    const { error } = await storage.upload(path, bytes, {
      contentType,
      upsert: true,
      cacheControl,
    });
    if (error) throw new Error(`Upload ${path}: ${error.message}`);
  };
  for (const [path, bytes, type] of files)
    await upload(path, bytes, type, FOREVER);
  // The index goes last, so it never lists a file that is not there yet.
  await upload(
    "index.json",
    Buffer.from(JSON.stringify(published, null, 2) + "\n"),
    "application/json",
    BRIEF,
  );

  // retired.json records when each unlisted file left the index. Files are
  // removed only once they have been unlisted for RETIRE_MS, however many
  // pushes happen meanwhile.
  const now = Date.now();
  const listed = new Set(files.map(([path]) => path));
  const retired = await readRetired(storage);
  const keep = {};
  const stale = [];
  for (const path of await listAll(storage, "songs")) {
    if (listed.has(path)) continue;
    const since = retired[path] ?? now;
    if (now - since >= RETIRE_MS) stale.push(path);
    else keep[path] = since;
  }
  if (stale.length) {
    const { error: removal } = await storage.remove(stale);
    if (removal) throw new Error(`Remove old files: ${removal.message}`);
  }
  await upload(
    "retired.json",
    Buffer.from(JSON.stringify(keep, null, 2) + "\n"),
    "application/json",
    BRIEF,
  );
  console.log(
    `Pushed ${index.songs.length} songs to the ${bucket} bucket` +
      (stale.length ? `, removed ${stale.length} old files` : "") +
      (Object.keys(keep).length
        ? `, kept ${Object.keys(keep).length} unlisted files for now`
        : ""),
  );
}

/** Every file path in a bucket folder, a page at a time. */
async function listAll(storage, folder) {
  const paths = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.list(folder, { limit: 1000, offset });
    if (error) throw new Error(`List ${folder}/: ${error.message}`);
    paths.push(...data.map((file) => `${folder}/${file.name}`));
    if (data.length < 1000) return paths;
  }
}

/** When each unlisted file left the index. Read past the CDN, so it is current. */
async function readRetired(storage) {
  const { data, error } = await storage.download("retired.json");
  // Missing on the first push. A file with no record counts as leaving now,
  // so losing the record only keeps files longer.
  if (error) return {};
  try {
    return JSON.parse(await data.text());
  } catch {
    return {};
  }
}

async function secretKey() {
  if (env.SUPABASE_SECRET_KEY) return env.SUPABASE_SECRET_KEY;
  if (!env.MUSIC_API_KEY)
    throw new Error("Set SUPABASE_SECRET_KEY or MUSIC_API_KEY to upload.");
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${env.MUSIC_API_KEY}` } },
  );
  if (!response.ok)
    throw new Error(`Supabase account API: HTTP ${response.status}`);
  const key = (await response.json()).find((k) => k.type === "secret");
  if (!key) throw new Error("This project has no secret API key.");
  return key.api_key;
}
