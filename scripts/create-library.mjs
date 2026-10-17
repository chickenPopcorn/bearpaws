import { createServer } from "vite";
import { writeMidi } from "midi-file";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Load the same typed arrangements used by the app, without starting a server.
const server = await createServer({
  configFile: false,
  cacheDir: "node_modules/.vite-midi-export",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null },
  appType: "custom",
});
try {
  const { builtInSongs } = await server.ssrLoadModule("/src/lessons.ts");
  const { midiPieces, midiBytes } =
    await server.ssrLoadModule("/src/midiPieces.ts");
  const songs = builtInSongs().filter((song) => song.lesson);
  const directory = resolve("public/midi");
  mkdirSync(directory, { recursive: true });
  // Full arrangements retain the original MIDI bytes and are downloaded
  // individually, outside the starter pack with its authored fingerings.
  for (const piece of midiPieces)
    writeFileSync(resolve(directory, `${piece.id}.mid`), midiBytes(piece));
  const manifest = [];
  for (const song of songs) {
    const bpm = song.lesson.bpm;
    // SMF bars begin at tick zero. Extend the app's short lead-in to a full
    // silent bar so the first musical downbeat remains a barline in any player.
    const countInBeats = song.beatsPerBar;
    const leadInOffset = (countInBeats - (song.leadInBeats ?? 0)) * song.ppq;
    const tick = (seconds) =>
      Math.round((seconds * bpm * song.ppq) / 60) + leadInOffset;
    const tracks = song.tracks.map((track) => {
      const events = [];
      for (const note of song.notes.filter((note) => note.track === track.id)) {
        const start = tick(note.start);
        events.push(
          {
            at: start,
            order: 1,
            type: "text",
            text: `BearPaws fingering: ${note.fingerHand} ${note.finger}; MIDI pitch ${note.pitch}`,
          },
          {
            at: start,
            order: 2,
            type: "noteOn",
            channel: note.channel,
            noteNumber: note.pitch,
            velocity: Math.max(1, Math.round(note.velocity * 127)),
          },
          {
            at: tick(note.end),
            order: 0,
            type: "noteOff",
            channel: note.channel,
            noteNumber: note.pitch,
            velocity: 0,
          },
        );
      }
      let last = 0;
      return [
        {
          deltaTime: 0,
          type: "trackName",
          // This MIDI writer uses single-byte text; keep non-Latin titles in
          // the UTF-8 catalog and use portable English part names in the MIDI.
          text: /[^\u0000-\u00ff]/.test(song.title)
            ? `${track.hand}: piano`
            : `${track.hand}: ${song.title}`,
        },
        {
          deltaTime: 0,
          type: "setTempo",
          microsecondsPerBeat: Math.round(60_000_000 / bpm),
        },
        {
          deltaTime: 0,
          type: "timeSignature",
          numerator: song.beatsPerBar,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
        ...events
          .sort((a, b) => a.at - b.at || a.order - b.order)
          .map(({ at, order, ...event }) => {
            const deltaTime = at - last;
            last = at;
            return { ...event, deltaTime };
          }),
        {
          deltaTime: Math.max(0, tick(song.duration) - last),
          type: "endOfTrack",
        },
      ];
    });
    const filename = `${song.id}.mid`;
    writeFileSync(
      resolve(directory, filename),
      new Uint8Array(
        writeMidi({
          header: {
            format: 1,
            numTracks: tracks.length,
            ticksPerBeat: song.ppq,
          },
          tracks,
        }),
      ),
    );
    manifest.push({
      id: song.id,
      title: song.title,
      filename,
      ...song.lesson,
      beatsPerBar: song.beatsPerBar,
      ticksPerBeat: song.ppq,
      countInBeats,
      notes: song.notes.map((note) => ({
        track: note.track,
        pitch: note.pitch,
        startTick: tick(note.start),
        endTick: tick(note.end),
        finger: note.finger,
        hand: note.fingerHand,
        beats: note.notatedBeats,
      })),
    });
  }
  writeFileSync(
    resolve(directory, "catalog.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  writeFileSync(
    resolve(directory, "README.txt"),
    "BearPaws beginner practice collection\n\n" +
      "These short arrangements match the BearPaws practice library.\n" +
      "Each MIDI has separate left- and right-hand tracks, tempo, and one full\n" +
      "silent count-in bar, keeping the musical downbeats on barlines.\n" +
      "Finger numbers are stored as MIDI text events and in catalog.json;\n" +
      "BearPaws displays the complete fingering in its built-in arrangements.\n" +
      "Other MIDI players may ignore text events. Reimporting a MIDI into\n" +
      "BearPaws treats it as a general MIDI file, without the lesson metadata.\n\n" +
      "The catalog records countInBeats as the leading silent quarter-note beats.\n" +
      "Melody credits, starting positions, and per-note fingering are in catalog.json.\n" +
      "Dancing Raindrops is the personal-practice transcription supplied by the user.\n",
  );
  // Python's standard library packages fixed entry metadata for reproducible ZIPs.
  execFileSync("python3", ["scripts/create-library-zip.py", directory]);
  console.log(
    `Exported ${songs.length} starter MIDI files, ${midiPieces.length} full arrangements and cadence-starter-library.zip`,
  );
} finally {
  await server.close();
}
