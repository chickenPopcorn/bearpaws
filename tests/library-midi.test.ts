import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMidi } from "midi-file";
import { builtInSongs } from "../src/lessons";
import { classPieces } from "../src/classPieces";
import { buildScore } from "../src/notation";
import { parseSong, type Song } from "../src/song";

// The downloadable files use a complete silent bar rather than the app's
// one-beat lead-in, so standard MIDI readers retain the original bar grouping.
const exportedTick = (song: Song, seconds: number) =>
  Math.round(
    (seconds * song.lesson!.bpm * song.ppq) / 60 +
      (song.beatsPerBar! - (song.leadInBeats ?? 0)) * song.ppq,
  );

describe("downloadable beginner MIDI collection", () => {
  const songs = builtInSongs().filter((song) => song.lesson);

  it.each(songs.map((song) => [song.title, song] as const))(
    "exports %s with matching pitches, timing, hands and finger annotations",
    (_title, song) => {
      const file = readFileSync(`public/midi/${song.id}.mid`);
      const midi = parseMidi(new Uint8Array(file));
      expect(midi.header.format).toBe(1);
      expect(midi.header.ticksPerBeat).toBe(song.ppq);
      expect(midi.tracks).toHaveLength(2);
      midi.tracks.forEach((track, index) => {
        let tick = 0;
        const attacks: {
          pitch: number;
          tick: number;
          channel: number;
          velocity: number;
        }[] = [];
        const releases: { pitch: number; tick: number; channel: number }[] = [];
        const fingers: { tick: number; text: string }[] = [];
        for (const event of track) {
          tick += event.deltaTime;
          if (event.type === "noteOn" && event.velocity > 0)
            attacks.push({
              pitch: event.noteNumber,
              tick,
              channel: event.channel,
              velocity: event.velocity,
            });
          if (event.type === "noteOff")
            releases.push({
              pitch: event.noteNumber,
              tick,
              channel: event.channel,
            });
          if (event.type === "text") fingers.push({ tick, text: event.text });
        }
        const expected = song.notes.filter((note) => note.track === index);
        const sort = <T extends { pitch: number; tick: number }>(items: T[]) =>
          items.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
        expect(sort(attacks)).toEqual(
          sort(
            expected.map((note) => ({
              pitch: note.pitch,
              tick: exportedTick(song, note.start),
              channel: note.channel,
              velocity: Math.max(1, Math.round(note.velocity * 127)),
            })),
          ),
        );
        expect(sort(releases)).toEqual(
          sort(
            expected.map((note) => ({
              pitch: note.pitch,
              tick: exportedTick(song, note.end),
              channel: note.channel,
            })),
          ),
        );
        expect(fingers).toEqual(
          expected.map((note) => ({
            tick: exportedTick(song, note.start),
            text: `Paw Pal fingering: ${note.fingerHand} ${note.finger}; MIDI pitch ${note.pitch}`,
          })),
        );
        expect(track.filter((event) => event.type === "setTempo")).toEqual([
          {
            deltaTime: 0,
            type: "setTempo",
            meta: true,
            microsecondsPerBeat: Math.round(60_000_000 / song.lesson!.bpm),
          },
        ]);
        expect(track.filter((event) => event.type === "timeSignature")).toEqual(
          [
            {
              deltaTime: 0,
              type: "timeSignature",
              meta: true,
              numerator: song.beatsPerBar,
              denominator: 4,
              metronome: 24,
              thirtyseconds: 8,
            },
          ],
        );
        expect(track.at(-1)?.type).toBe("endOfTrack");
        expect(tick).toBe(exportedTick(song, song.duration));
      });
    },
  );

  it.each(songs.map((song) => [song.title, song] as const))(
    "preserves %s's musical bar grouping after its full-bar count-in",
    (_title, song) => {
      const imported = parseSong(
        new Uint8Array(readFileSync(`public/midi/${song.id}.mid`)),
        song.title,
        `download-${song.id}`,
      );
      expect(imported.warnings).toEqual([]);
      const original = buildScore(song);
      const downloaded = buildScore(imported);
      expect(downloaded.measures.has(0)).toBe(false);
      expect(downloaded.measureCount).toBe(original.measureCount + 1);
      for (const [measure, notes] of original.measures) {
        expect(
          downloaded.measures.get(measure + 1)?.map(({ note, offset }) => ({
            track: note.track,
            pitch: note.pitch,
            offset,
          })),
        ).toEqual(
          notes.map(({ note, offset }) => ({
            track: note.track,
            pitch: note.pitch,
            offset,
          })),
        );
      }
    },
  );

  it("keeps all downloadable catalog metadata and note annotations in sync with the source songs", () => {
    const catalog = JSON.parse(
      readFileSync("public/midi/catalog.json", "utf8"),
    );
    expect(catalog).toEqual(
      songs.map((song) => ({
        id: song.id,
        title: song.title,
        filename: `${song.id}.mid`,
        ...song.lesson,
        beatsPerBar: song.beatsPerBar,
        ticksPerBeat: song.ppq,
        countInBeats: song.beatsPerBar,
        notes: song.notes.map((note) => ({
          track: note.track,
          pitch: note.pitch,
          startTick: exportedTick(song, note.start),
          endTick: exportedTick(song, note.end),
          finger: note.finger,
          hand: note.fingerHand,
          beats: note.notatedBeats,
        })),
      })),
    );
  });

  it("downloads each George Bear’s Classes piece in its printed meter after one silent bar", () => {
    const catalog = JSON.parse(
      readFileSync("public/midi/catalog.json", "utf8"),
    ) as { id: string; beatsPerBar: number; countInBeats: number }[];
    for (const piece of classPieces) {
      const midi = parseMidi(
        new Uint8Array(readFileSync(`public/midi/${piece.id}.mid`)),
      );
      for (const track of midi.tracks)
        expect(
          track.find((event) => event.type === "timeSignature"),
        ).toMatchObject({ numerator: piece.beatsPerBar, denominator: 4 });
      expect(catalog.find((entry) => entry.id === piece.id)).toMatchObject({
        beatsPerBar: piece.beatsPerBar,
        countInBeats: piece.beatsPerBar,
      });
      // The first printed bar starts after the silent bar; The Wheels on the
      // Bus opens with a half rest before its first note.
      const firstAttack = Math.min(
        ...midi.tracks.map((track) => {
          let tick = 0;
          for (const event of track) {
            tick += event.deltaTime;
            if (event.type === "noteOn") return tick;
          }
          return Infinity;
        }),
      );
      const openingRest = piece.id === "pawpal-wheels-on-the-bus-v1" ? 2 : 0;
      expect(firstAttack).toBe(
        (piece.beatsPerBar + openingRest) * midi.header.ticksPerBeat!,
      );
    }
  });

  it("includes exactly the current MIDI files, catalog and readme in a valid ZIP", () => {
    // The generator also uses Python's standard library. Reading actual entries
    // catches stale compressed content, duplicate names, and damaged CRCs.
    const archive = JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          "import base64,json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n print(json.dumps({'badEntry':z.testzip(),'entries':[{'name':i.filename,'content':base64.b64encode(z.read(i)).decode('ascii')} for i in z.infolist()]}))",
          "public/midi/cadence-starter-library.zip",
        ],
        { encoding: "utf8" },
      ),
    ) as {
      badEntry: string | null;
      entries: { name: string; content: string }[];
    };
    expect(archive.badEntry).toBeNull();
    expect(archive.entries.map((entry) => entry.name).sort()).toEqual(
      [
        "README.txt",
        "catalog.json",
        ...songs.map((song) => `${song.id}.mid`),
      ].sort(),
    );
    for (const entry of archive.entries)
      expect(Buffer.from(entry.content, "base64")).toEqual(
        readFileSync(`public/midi/${entry.name}`),
      );
  });
});

describe("downloadable original piano MIDI", () => {
  it("preserves the full An Jing source bytes in its separate download", () => {
    const original = readFileSync("src/assets/an-jing.mid");
    const download = readFileSync("public/midi/bearpaws-an-jing-v1.mid");
    expect(download.equals(original)).toBe(true);
    expect(parseMidi(new Uint8Array(download)).tracks.length).toBeGreaterThan(
      0,
    );
  });
});
