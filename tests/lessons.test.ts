import { describe, expect, it } from "vitest";
import { builtInSongs, isBuiltInSong } from "../src/lessons";
import { starterPieces } from "../src/starterPieces";
import { popsPieces } from "../src/popsPieces";
import { collectionForSong } from "../src/collections";
import { tempoConverter } from "../src/song";

describe("bundled beginner music", () => {
  it("keeps the original lessons and adds recognizable beginner arrangements", () => {
    const songs = builtInSongs();
    expect(songs.slice(0, 2).map((song) => [song.id, song.title])).toEqual([
      ["cadence-ode-to-joy-v1", "Ode to Joy"],
      ["cadence-dancing-raindrops-v1", "Dancing Raindrops"],
    ]);
    expect(songs).toHaveLength(15);
    expect(new Set(songs.map((song) => song.id)).size).toBe(songs.length);
    for (const title of [
      "Hot Cross Buns",
      "Mary Had a Little Lamb",
      "Twinkle, Twinkle, Little Star",
      "London Bridge",
      "好一朵茉莉花 · chorus",
    ])
      expect(songs.some((song) => song.title === title)).toBe(true);
    for (const song of songs) {
      expect(isBuiltInSong(song.id)).toBe(true);
      expect(isBuiltInSong(`${song.id}-imported`)).toBe(false);
    }
    for (const removedId of [
      "cadence-first-steps-v1",
      "cadence-saints-v1",
      "cadence-morning-waltz-v1",
      "cadence-imported-song",
      "",
    ])
      expect(isBuiltInSong(removedId)).toBe(false);
  });

  it("returns independent notes, track assignments and lesson metadata for every song", () => {
    const original = builtInSongs();
    const songs = builtInSongs();
    for (const song of songs) {
      song.notes[0].pitch = 0;
      song.tracks[0].hand = "off";
      song.lesson!.handPositions.left = "changed";
    }
    expect(builtInSongs()).toEqual(original);
  });

  it("preserves the complete beginner Ode to Joy arrangement", () => {
    const song = builtInSongs()[0];
    expect(song.notes).toHaveLength(38);
    expect(song.lesson!.bpm).toBe(80);
    const melody = song.notes.filter((note) => note.track === 1);
    expect(melody.slice(0, 8).map((note) => note.pitch)).toEqual([
      64, 64, 65, 67, 67, 65, 64, 62,
    ]);
    expect(melody.at(-1)!.pitch).toBe(60);
    expect(song.lesson!.composer).toContain("Beethoven");
    expect(song.lesson!.description.length).toBeGreaterThan(0);
  });

  it("keeps five-finger lessons in their stated positions and provides valid fingering for every note", () => {
    const right = new Map([
      [60, 1],
      [62, 2],
      [64, 3],
      [65, 4],
      [67, 5],
    ]);
    const left = new Map([
      [48, 5],
      [50, 4],
      [52, 3],
      [53, 2],
      [55, 1],
    ]);
    for (const song of builtInSongs()) {
      expect(song.lesson!.handPositions.left).toContain("C3 (5) to G3 (1)");
      expect(song.lesson!.handPositions.right.length).toBeGreaterThan(10);
      const fixedC =
        song.lesson!.handPositions.right === "C position · C4 (1) to G4 (5)";
      for (const note of song.notes) {
        const hand = song.tracks.find((track) => track.id === note.track)!.hand;
        expect(hand).toBe(note.track === 0 ? "left" : "right");
        expect(note.fingerHand).toBe(hand);
        expect([1, 2, 3, 4, 5]).toContain(note.finger);
        const fingers = hand === "right" ? right : left;
        if (hand === "left" || fixedC) {
          expect(fingers.has(note.pitch)).toBe(true);
          expect(note.finger).toBe(fingers.get(note.pitch));
        }
      }
    }
  });

  it("fills each arranged bar and states hand changes for melodies beyond C position", () => {
    for (const piece of [...starterPieces, ...popsPieces]) {
      expect(piece.bass).toHaveLength(piece.melody.length);
      expect(piece.melody.length).toBeGreaterThanOrEqual(4);
      for (const bar of piece.melody)
        expect(bar.reduce((beats, step) => beats + step[1], 0)).toBeCloseTo(
          piece.beatsPerBar,
        );
      const extended = piece.melody.some((bar) =>
        bar.some(
          ([pitch]) => pitch !== null && ![60, 62, 64, 65, 67].includes(pitch),
        ),
      );
      if (extended) expect(piece.rightPosition).toBeTruthy();
    }
  });

  it("adds the eight-bar Jasmine Flower chorus to Mama Bear’s Pops", () => {
    const songs = builtInSongs();
    const jasmine = songs.find(
      (song) => song.id === "bearpaws-jasmine-flower-v1",
    )!;
    expect(collectionForSong(jasmine.id).id).toBe("pops");
    expect(
      songs
        .filter((song) => collectionForSong(song.id).id === "classes")
        .map((song) => song.title),
    ).toEqual(["Dancing Raindrops"]);
    expect(
      songs.filter((song) => collectionForSong(song.id).id === "songs"),
    ).toHaveLength(13);
    expect(jasmine.notes.filter((note) => note.track === 0)).toHaveLength(8);
    const melody = jasmine.notes.filter((note) => note.track === 1);
    expect(melody).toHaveLength(40);
    expect(melody.slice(0, 7).map((note) => note.pitch)).toEqual([
      64, 64, 67, 69, 72, 72, 69,
    ]);
    expect(melody.slice(-4).map((note) => note.pitch)).toEqual([
      60, 60, 62, 60,
    ]);
    expect(jasmine.lesson!.description).toContain("chorus");
  });

  it("schedules valid, nonoverlapping notes on the stated tempo and counts every track", () => {
    const songs = builtInSongs();
    expect(
      new Set(songs.flatMap((song) => song.notes.map((note) => note.id))).size,
    ).toBe(songs.reduce((sum, song) => sum + song.notes.length, 0));
    for (const song of songs) {
      const beat = tempoConverter(song.ppq, song.tempos)(song.ppq);
      expect(beat).toBeCloseTo(60 / song.lesson!.bpm, 9);
      expect(song.notes[0].start).toBeCloseTo(beat, 9);
      for (const [index, note] of song.notes.entries()) {
        expect(Number.isFinite(note.start)).toBe(true);
        expect(note.start).toBeGreaterThanOrEqual(0);
        expect(note.end).toBeGreaterThan(note.start);
        expect(note.soundEnd).toBe(note.end);
        expect(note.soundEnd).toBeLessThan(song.duration);
        expect(note.velocity).toBeGreaterThan(0);
        expect(note.velocity).toBeLessThanOrEqual(1);
        expect(note.channel).toBe(note.track);
        expect((note.start / beat) * 2).toBeCloseTo(
          Math.round((note.start / beat) * 2),
          9,
        );
        if (index > 0)
          expect(note.start).toBeGreaterThanOrEqual(
            song.notes[index - 1].start,
          );
      }
      for (const track of song.tracks) {
        const notes = song.notes.filter((note) => note.track === track.id);
        expect(track.count).toBe(notes.length);
        const previousEnds = new Map<number, number>();
        for (const note of notes) {
          const previousEnd = previousEnds.get(note.pitch);
          if (previousEnd !== undefined)
            expect(note.start).toBeGreaterThanOrEqual(previousEnd);
          previousEnds.set(note.pitch, note.end);
        }
      }
    }
  });

  it("keeps Ode to Joy's one bass note per four-beat bar and one-beat lead-in", () => {
    const song = builtInSongs()[0];
    expect(song.beatsPerBar).toBe(4);
    expect(song.leadInBeats).toBe(1);
    const beat = 60 / song.lesson!.bpm;
    const bass = song.notes.filter((note) => note.track === 0);
    expect(bass.map((note) => note.pitch)).toEqual([
      48, 55, 48, 55, 48, 55, 55, 48,
    ]);
    for (let index = 1; index < bass.length; index++) {
      expect(bass[index].start - bass[index - 1].start).toBeCloseTo(
        4 * beat,
        9,
      );
    }
    expect(song.duration).toBeCloseTo((8 * 4 + 1) * beat + 0.5, 9);
  });

  it("transcribes all eight bars of Dancing Raindrops, including each hand's rests and chords", () => {
    const song = builtInSongs().find(
      (candidate) => candidate.id === "cadence-dancing-raindrops-v1",
    )!;
    expect(song).toBeDefined();
    expect(song.title).toBe("Dancing Raindrops");
    expect(song.lesson!.bpm).toBe(80);
    expect(song.beatsPerBar).toBe(4);
    expect(song.leadInBeats).toBe(1);
    expect(song.notes).toHaveLength(39);
    expect(song.tracks.map((track) => [track.hand, track.count])).toEqual([
      ["left", 22],
      ["right", 17],
    ]);

    // Each cell is one quarter-note beat; an empty cell is a quarter rest.
    const bars = [
      { track: 0, beats: [[55], [55], [52], [48]] },
      { track: 0, beats: [[52, 55], [52, 55], [52, 55], []] },
      { track: 0, beats: [[53, 55], [53, 55], [53, 55], []] },
      { track: 0, beats: [[52, 55], [52, 55], [52, 55], []] },
      { track: 1, beats: [[60], [60], [64], [67]] },
      { track: 1, beats: [[60, 64], [60, 64], [60, 64], []] },
      { track: 1, beats: [[67], [65], [64], [62]] },
      { track: 1, beats: [[60], [60], [60], []] },
    ];
    const beat = 60 / song.lesson!.bpm;
    const expected = bars.flatMap((bar, barIndex) =>
      bar.beats.flatMap((pitches, beatIndex) =>
        pitches.map((pitch) => ({
          beat: barIndex * 4 + beatIndex,
          track: bar.track,
          pitch,
        })),
      ),
    );
    expect(
      song.notes.map((note) => ({
        beat: Math.round(note.start / beat - 1),
        track: note.track,
        pitch: note.pitch,
      })),
    ).toEqual(expected);
  });

  it("plays the Raindrops staccato dots briefly and connects the descending slur", () => {
    const song = builtInSongs().find(
      (candidate) => candidate.id === "cadence-dancing-raindrops-v1",
    )!;
    const beat = 60 / song.lesson!.bpm;
    for (const note of song.notes) {
      const scoreBeat = Math.round(note.start / beat - 1);
      const inSlur = scoreBeat >= 24 && scoreBeat < 28;
      expect((note.end - note.start) / beat).toBeCloseTo(inSlur ? 1 : 0.45, 9);
    }
    const phrase = song.notes.filter(
      (note) => note.track === 1 && note.start >= 25 * beat,
    );
    for (let index = 0; index < 4; index++) {
      expect(phrase[index].end).toBeCloseTo(phrase[index + 1].start, 9);
    }
  });
});
