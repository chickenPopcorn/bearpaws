// Edit the shared song library, which lives in the Supabase `library` bucket.
//
//   npm run library:pull   Download the bucket into ./library for editing.
//   npm run library:push   Check ./library and upload it to the bucket.
//
// ./library holds index.json and songs/<id>.json + songs/<id>.mid. To add a
// song, put its MIDI file at songs/<id>.mid and list it in index.json with an
// id, title and collection: push converts the MIDI into songs/<id>.json.
// The bucket names each file after its content hash (songs/<id>.<hash>.json),
// so browsers can keep it for a year: a changed song gets a new name.
// Uploading needs the project's secret key: SUPABASE_SECRET_KEY, or a Supabase
// account token in MUSIC_API_KEY to look it up. Neither ever reaches the app.
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, loadEnv } from "vite";

const FOLDER = "library";
/** Hashed files never change, so browsers and the CDN may keep them this long. */
const FOREVER = "31536000";
/** The index changes on every push. */
const BRIEF = "60";
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
  mkdirSync(`${FOLDER}/songs`, { recursive: true });
  // The working copy uses plain names; push adds the hashes again.
  for (const entry of index.songs) {
    for (const key of ["song", "midi"]) {
      if (!entry[key]) continue;
      const bytes = await download(entry[key]);
      entry[key] = plainName(entry[key]);
      writeFileSync(`${FOLDER}/${entry[key]}`, bytes);
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
  // A browser may hold the previous index for up to BRIEF seconds, so the
  // files it lists stay until the next push.
  const previous = await fetch(
    `${url}/storage/v1/object/public/${bucket}/index.json?t=${Date.now()}`,
  )
    .then((response) => (response.ok ? response.json() : { songs: [] }))
    .catch(() => ({ songs: [] }));
  for (const [path, bytes, type] of files)
    await upload(path, bytes, type, FOREVER);
  // The index goes last, so it never lists a file that is not there yet.
  await upload(
    "index.json",
    Buffer.from(JSON.stringify(published, null, 2) + "\n"),
    "application/json",
    BRIEF,
  );

  // Remove files that neither the new nor the previous index lists.
  const kept = new Set([
    ...files.map(([path]) => path),
    ...(previous.songs ?? []).flatMap((song) => [song.song, song.midi]),
  ]);
  const { data: listed, error } = await storage.list("songs", { limit: 1000 });
  if (error) throw new Error(`List songs/: ${error.message}`);
  const stale = listed
    .map((file) => `songs/${file.name}`)
    .filter((path) => !kept.has(path));
  if (stale.length) {
    const { error: removal } = await storage.remove(stale);
    if (removal) throw new Error(`Remove old files: ${removal.message}`);
  }
  console.log(
    `Pushed ${index.songs.length} songs to the ${bucket} bucket` +
      (stale.length ? `, removed ${stale.length} old files` : ""),
  );
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
