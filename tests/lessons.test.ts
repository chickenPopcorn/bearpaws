import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { builtInSongs, classSongs } from "../src/lessons";
import { starterPieces } from "../src/starterPieces";
import { popsPieces } from "../src/popsPieces";
import {
  classPieces,
  classPositions,
  georgeClassesOrder,
} from "../src/classPieces";
import { books, bookForSong, songsInBook } from "../src/books";
import { parseSong, tempoConverter, type Song } from "../src/song";
import { buildScore, scoreTimeAtX, scoreViewport } from "../src/notation";

describe("bundled beginner music", () => {
  it("keeps the original lessons and adds recognizable beginner arrangements", () => {
    const songs = builtInSongs();
    expect(songs.slice(0, 2).map((song) => [song.id, song.title])).toEqual([
      ["cadence-ode-to-joy-v1", "Ode to Joy"],
      ["cadence-dancing-raindrops-v1", "Dancing Raindrops"],
    ]);
    expect(songs).toHaveLength(27);
    expect(songs.filter((song) => song.lesson)).toHaveLength(26);
    expect(new Set(songs.map((song) => song.id)).size).toBe(songs.length);
    for (const title of [
      "Hot Cross Buns",
      "Mary Had a Little Lamb",
      "Twinkle, Twinkle, Little Star",
      "London Bridge",
      "好一朵茉莉花 · chorus",
      "安静 · 周杰伦",
    ])
      expect(songs.some((song) => song.title === title)).toBe(true);
  });

  it("returns independent notes, track assignments and lesson metadata for every song", () => {
    const original = builtInSongs();
    const songs = builtInSongs();
    for (const song of songs) {
      song.notes[0].pitch = 0;
      song.tracks[0].hand = "off";
      if (song.lesson) song.lesson.handPositions.left = "changed";
      if (song.source) song.source.description = "changed";
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
    // C position, and Middle C position with both thumbs sharing middle C.
    const leftPositions = new Map([
      [
        "C3 (5) to G3 (1)",
        new Map([
          [48, 5],
          [50, 4],
          [52, 3],
          [53, 2],
          [55, 1],
        ]),
      ],
      [
        "F3 (5) to C4 (1)",
        new Map([
          [53, 5],
          [55, 4],
          [57, 3],
          [59, 2],
          [60, 1],
        ]),
      ],
    ]);
    for (const song of builtInSongs().filter((song) => song.lesson)) {
      const range = [...leftPositions.keys()].find((range) =>
        song.lesson!.handPositions.left.endsWith(range),
      );
      expect(range).toBeDefined();
      const left = leftPositions.get(range!)!;
      expect(song.lesson!.handPositions.right.length).toBeGreaterThan(10);
      const fixedC = [
        "C position · C4 (1) to G4 (5)",
        "Middle C position · C4 (1) to G4 (5)",
      ].includes(song.lesson!.handPositions.right);
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

  it("builds the eight-bar Jasmine Flower chorus", () => {
    const songs = builtInSongs();
    const jasmine = songs.find(
      (song) => song.id === "bearpaws-jasmine-flower-v1",
    )!;
    expect(classSongs().map((song) => song.title)).toEqual([
      "Dancing Raindrops",
      "Five O'Clock",
      "Tell Us, Please!",
      "Sleep Tight, Mozart Mouse",
      "Something for You",
      "Bridal Chorus",
      "Mozart Mouse's Special Music",
      "Camptown Races",
      "Hush, Little Baby",
      "The Wheels on the Bus",
      "Old MacDonald Had a Farm",
      "Aura Lee",
    ]);
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

  it("builds the full An Jing piano MIDI without invented fingerings", () => {
    const song = builtInSongs().find(
      (candidate) => candidate.id === "bearpaws-an-jing-v1",
    )!;
    const original = parseSong(
      new Uint8Array(readFileSync("src/assets/an-jing.mid")),
      "source",
      "source",
    );
    expect(song).toBeDefined();
    expect(song.title).toBe("安静 · 周杰伦");
    expect(song.lesson).toBeUndefined();
    expect(song.source!.composer).toMatch(/周杰伦|Jay Chou/);
    expect(song.source!.description.length).toBeGreaterThan(0);
    expect(song.source!.url).toMatch(/^https:\/\//);
    expect(song.source!.credit.length).toBeGreaterThan(0);
    expect(song.notes).toHaveLength(1369);
    expect(song.duration).toBeGreaterThan(330);
    expect(song.ppq).toBe(original.ppq);
    expect(song.tempos).toEqual(original.tempos);
    expect(song.timeSignatures).toEqual(original.timeSignatures);
    expect(song.duration).toBe(original.duration);
    const performance = (notes: typeof song.notes) =>
      notes
        .map(({ pitch, start, end, soundEnd, velocity, channel }) => ({
          pitch,
          start,
          end,
          soundEnd,
          velocity,
          channel,
        }))
        .sort(
          (a, b) =>
            a.start - b.start ||
            a.pitch - b.pitch ||
            a.end - b.end ||
            a.soundEnd - b.soundEnd ||
            a.velocity - b.velocity ||
            a.channel - b.channel,
        );
    expect(performance(song.notes)).toEqual(performance(original.notes));
    expect(song.tracks.map((track) => [track.id, track.hand])).toEqual([
      [0, "left"],
      [1, "right"],
    ]);
    for (const note of song.notes) {
      expect(note.track).toBe(note.pitch < 60 ? 0 : 1);
      expect(note.finger).toBeUndefined();
      expect(note.fingerHand).toBeUndefined();
      expect(note.id.startsWith(`${song.id}-`)).toBe(true);
    }
    for (const track of song.tracks)
      expect(track.count).toBe(
        song.notes.filter((note) => note.track === track.id).length,
      );
  });

  it("keeps the complete An Jing score seekable from its opening through its final measure", () => {
    const song = builtInSongs().find(
      (candidate) => candidate.id === "bearpaws-an-jing-v1",
    )!;
    const score = buildScore(song);
    const scoredNotes = [...score.measures.values()].flat();
    expect(scoredNotes).toHaveLength(1369);
    expect(new Set(scoredNotes.map((item) => item.note.id))).toEqual(
      new Set(song.notes.map((note) => note.id)),
    );
    expect(score.measureCount).toBeGreaterThan(90);

    for (const position of [
      song.notes[0].start,
      song.notes[Math.floor(song.notes.length / 2)].start,
      song.notes.at(-1)!.start,
    ]) {
      const beat = score.clock.at(position);
      const coordinate = score.meter.coordinate(beat);
      const measure = score.meter.at(beat);
      expect(score.meter.beatAt(coordinate)).toBeCloseTo(beat, 8);
      expect(score.clock.time(measure.start + measure.offset)).toBeCloseTo(
        position,
        8,
      );

      const viewport = scoreViewport(beat, score.measureCount, score.meter);
      expect(viewport.last - viewport.first).toBeLessThanOrEqual(4);
      const x =
        88 +
        24 +
        (coordinate - viewport.first) * viewport.measureWidth -
        viewport.offset;
      expect(
        scoreTimeAtX(
          x,
          { ...viewport, meter: score.meter },
          score.clock,
          score.leadInBeats,
          song.duration,
        ),
      ).toBeCloseTo(position, 8);
    }
  });

  it("schedules valid, nonoverlapping notes on the stated tempo and counts every track", () => {
    const songs = builtInSongs();
    expect(
      new Set(songs.flatMap((song) => song.notes.map((note) => note.id))).size,
    ).toBe(songs.reduce((sum, song) => sum + song.notes.length, 0));
    for (const song of songs.filter((candidate) => candidate.lesson)) {
      const beat = tempoConverter(song.ppq, song.tempos)(song.ppq);
      expect(beat).toBeCloseTo(60 / song.lesson!.bpm, 9);
      // The Wheels on the Bus opens with a printed half rest after the lead-in.
      const openingRest = song.id === "pawpal-wheels-on-the-bus-v1" ? 2 : 0;
      expect(song.notes[0].start).toBeCloseTo((1 + openingRest) * beat, 9);
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

const pitchNames = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const pitchName = (pitch: number) =>
  `${pitchNames[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

/**
 * One hand's printed bars, such as "r2 C4 C4 | C4:4": rN is an N-beat rest,
 * ":N" a note of N beats (quarter notes have no suffix), "+" a chord and
 * "." a staccato dot.
 */
function printedBars(song: Song, hand: "left" | "right") {
  const beat = 60 / song.lesson!.bpm;
  const barLength = song.beatsPerBar!;
  const chords = new Map<number, Song["notes"]>();
  for (const note of song.notes.filter((note) => note.fingerHand === hand)) {
    const at = Math.round(note.start / beat - 1);
    chords.set(at, [...(chords.get(at) ?? []), note]);
  }
  const barCount = Math.round(song.notes.at(-1)!.start / beat) / barLength;
  return Array.from({ length: Math.ceil(barCount) }, (_, bar) => {
    const tokens: string[] = [];
    let cursor = bar * barLength;
    for (const [at, notes] of [...chords].sort((a, b) => a[0] - b[0])) {
      if (at < cursor || at >= (bar + 1) * barLength) continue;
      if (at > cursor) tokens.push(`r${at - cursor}`);
      const beats = notes[0].notatedBeats!;
      tokens.push(
        notes.map((note) => pitchName(note.pitch)).join("+") +
          (beats === 1 ? "" : `:${beats}`) +
          (notes[0].staccato ? "." : ""),
      );
      cursor = at + beats;
    }
    if (cursor < (bar + 1) * barLength)
      tokens.push(`r${(bar + 1) * barLength - cursor}`);
    return tokens.join(" ");
  }).join(" | ");
}

describe("George Bear’s Classes book pieces", () => {
  it("lists the pieces in Recital Book 3 order, after Dancing Raindrops", () => {
    // Pages 21–31 are printed in the photos; the five story pieces before
    // page 21 follow their facing pages and the story.
    const bookOrder = [
      "pawpal-five-oclock-v1",
      "pawpal-tell-us-please-v1",
      "pawpal-sleep-tight-mozart-mouse-v1",
      "pawpal-something-for-you-v1",
      "pawpal-bridal-chorus-v1",
      "pawpal-mozart-mouses-special-music-v1", // page 21
      "pawpal-camptown-races-v1", // page 23
      "pawpal-hush-little-baby-v1", // page 25
      "pawpal-wheels-on-the-bus-v1", // page 27
      "pawpal-old-macdonald-v1", // page 29
      "pawpal-aura-lee-v1", // page 31
    ];
    expect(georgeClassesOrder).toEqual([
      "cadence-dancing-raindrops-v1",
      ...bookOrder,
    ]);
    const songs = builtInSongs();
    expect(songs.map((song) => song.id).slice(1, 13)).toEqual(
      georgeClassesOrder,
    );
    expect(classSongs().map((song) => song.id)).toEqual(georgeClassesOrder);
  });

  it("puts every class song in Recital Book 3 and none yet in Lesson Book 3", () => {
    expect(books.map((book) => book.title)).toEqual([
      "Music Recital Book 3",
      "Music Lesson Book 3",
    ]);
    const songs = classSongs();
    expect(songsInBook(songs, "recital-3")).toEqual(songs);
    expect(songsInBook(songs, "lesson-3")).toEqual([]);
    expect(bookForSong("not-in-a-book").id).toBe("recital-3");
  });

  it("registers each piece once, with full bars and its printed hand position", () => {
    expect(new Set(classPieces.map((piece) => piece.id)).size).toBe(11);
    const songs = classSongs();
    expect(songs.map((song) => song.id)).toEqual([
      "cadence-dancing-raindrops-v1",
      ...classPieces.map((piece) => piece.id),
    ]);
    for (const piece of classPieces) {
      expect(piece.id).toMatch(/^pawpal-[a-z-]+-v1$/);
      for (const bar of piece.bars)
        for (const steps of [bar.left, bar.right])
          if (steps)
            expect(steps.reduce((beats, step) => beats + step[1], 0)).toBe(
              piece.beatsPerBar,
            );
      const song = songs.find((song) => song.id === piece.id)!;
      const position = classPositions[piece.position];
      expect(song.title).toBe(piece.title);
      expect(song.beatsPerBar).toBe(piece.beatsPerBar);
      expect(song.leadInBeats).toBe(1);
      expect(song.lesson).toEqual({
        composer: piece.composer,
        description: piece.description,
        level: position.level,
        bpm: piece.bpm,
        handPositions: position.handPositions,
      });
      expect(song.lesson!.composer).toContain("piano book");
      const score = buildScore(song);
      expect(score.measureCount).toBe(piece.bars.length);
      expect(score.meter.measureAt(0).numerator).toBe(piece.beatsPerBar);
      for (const note of song.notes) {
        expect(note.finger).toBe(
          position.fingers[note.fingerHand!][note.pitch],
        );
        expect(note.track).toBe(note.fingerHand === "left" ? 0 : 1);
      }
    }
  });

  it("transcribes every bar of each student part, with rests, chords and staccato", () => {
    const sleepVerse = {
      right: "r3 | C4:3 | r1 C4 D4 | E4:3 | r3 | D4:3 | r1 E4 D4 | C4:3",
      left: "G3:3 | r3 | G3 r2 | r3 | G3:3 | r3 | G3 r2 | r3",
    };
    const fanfare = {
      right: "C4+G4 C4+G4 C4+G4 C4+G4 | C4+G4:2 C4+G4:2 | r4 | r4",
      left: "r4 | r4 | C3+G3 C3+G3 C3+G3 C3+G3 | C3+G3:2 C3+G3:2",
    };
    const farm = {
      right: "G4 G4 G4 D4 | E4 E4 D4:2 | r4",
      left: "r4 | r4 | B3 B3 A3 A3",
    };
    const blackbird = "G3 C4 B3 C4 | r1 A3 r2 | C4 B3 A3 B3 | C4:4";
    const expected: Record<string, { right: string; left: string }> = {
      "pawpal-five-oclock-v1": {
        right: "D4:3 | r3 | D4:3 | r3 | D4:3 | D4:3 | D4:3 | r3",
        left: "B3:3 | G3:3 | B3:3 | G3:3 | B3 A3 G3 | B3 A3 G3 | B3 A3 B3 | C4:3",
      },
      "pawpal-tell-us-please-v1": {
        right:
          "C4:2 F4:2 | C4. C4. F4:2 | D4:2 G4:2 | D4. D4. G4:2 | r4 | r4 | r4 | r4",
        left: "r4 | r4 | r4 | r4 | G3:2 D3:2 | G3. G3. D3:2 | G3. F3. E3. D3. | C3:4",
      },
      "pawpal-sleep-tight-mozart-mouse-v1": {
        right: [sleepVerse.right, sleepVerse.right, "r3 | r3 | r3 | r3"].join(
          " | ",
        ),
        left: [
          sleepVerse.left,
          sleepVerse.left,
          "G3+C4:3 | G3+C4:3 | G3+C4:2 G3+C4 | G3+C4:3",
        ].join(" | "),
      },
      "pawpal-something-for-you-v1": {
        right:
          "r4 | r4 | G4 G4 C4 C4 | F4 F4 F4:2 | r4 | r4 | G4 C4 D4 E4 | F4 F4 F4:2",
        left: "F3 F3 C4 C4 | A3 A3 C4:2 | r4 | r4 | F3 F3 C4 C4 | A3 A3 C4:2 | r4 | r4",
      },
      "pawpal-bridal-chorus-v1": {
        right:
          "r2 C4 C4 | C4:4 | r2 D4 r1 | r4 | r2 C4 F4 | F4:2 E4 D4 | C4:2 r2 | D4:4 | " +
          "r2 C4 C4 | C4:4 | r2 D4 r1 | r4 | r2 C4 E4 | G4:2 E4 C4 | r2 D4 E4 | C4:4",
        left:
          "G3:2 r2 | r4 | G3:2 r1 B3 | C4:4 | G3:2 r2 | r4 | r2 B3 C4 | r4 | " +
          "G3:2 r2 | r4 | G3:2 r1 B3 | C4:4 | G3:2 r2 | r4 | A3:2 r2 | r4",
      },
      "pawpal-mozart-mouses-special-music-v1": {
        right: [
          fanfare.right,
          "D4 D4 D4 F4 | G4:2 F4:2 | G4 G4 F4 D4 | G4 G4 G4:2",
          fanfare.right,
          "D4 F4 G4:2 | D4 F4 G4:2 | G4 G4 F4 D4 | C4+G4 C4+G4 C4+G4:2",
        ].join(" | "),
        left: [
          fanfare.left,
          "G3:4 | G3:4 | G3:4 | G3:4",
          fanfare.left,
          "G3:4 | G3:4 | G3:4 | C3+G3 C3+G3 C3+G3:2",
        ].join(" | "),
      },
      "pawpal-camptown-races-v1": {
        right:
          "C4 C4 r1 C4 | D4 C4 r2 | r4 | r4 | C4 C4 r1 C4 | D4 C4 r2 | r4 | r4",
        left: "r2 A3 r1 | r2 A3:2 | A3 G3:3 | A3 G3:3 | r2 A3 r1 | r2 A3:2 | G3:2 A3 G3 | F3:4",
      },
      "pawpal-hush-little-baby-v1": {
        right:
          "r2 E4 E4 | E4:2 F4:2 | E4:2 D4 D4 | D4:4 | r2 D4 D4 | D4:2 D4 E4 | D4:2 C4:2 | C4:4 | " +
          "r2 E4:2 | E4:2 F4:2 | E4:2 D4:2 | D4:4 | r2 D4 D4 | D4:2 D4 E4 | D4:2 C4:2 | C4:4",
        left:
          "G3:2 r2 | r4 | r4 | r4 | G3 G3 r2 | r4 | r4 | r4 | " +
          "G3:2 r2 | r4 | r4 | r4 | G3 G3 r2 | r4 | r4 | r4",
      },
      "pawpal-wheels-on-the-bus-v1": {
        right:
          "r4 | C4:2 C4 C4 | C4:2 E4:2 | G4:2 E4:2 | C4:4 | D4:2 D4:2 | D4:4 | G4:2 E4:2 | C4:2 r2 | " +
          "r4 | r4 | r4 | r4 | D4:2 F4:2 | E4:2 D4:2 | C4:4 | r4",
        left:
          "r2 G3:2 | r4 | r4 | r4 | r4 | r4 | r4 | r4 | r2 G3:2 | " +
          "C3:2 C3 C3 | C3:2 E3:2 | G3:2 E3:2 | C3:4 | r4 | r4 | r4 | C3:2 C3:2",
      },
      "pawpal-old-macdonald-v1": {
        right: [
          farm.right,
          "r3 D4",
          farm.right,
          "r3 D4",
          "G4 G4 G4 D4 | G4 G4 G4:2 | G4 G4 r2 | G4 G4 r2",
          farm.right,
          "r4",
        ].join(" | "),
        left: [
          farm.left,
          "G3:3 r1",
          farm.left,
          "G3:3 r1",
          "r4 | r4 | r2 G3 G3 | r2 G3 G3",
          farm.left,
          "G3:4",
        ].join(" | "),
      },
      "pawpal-aura-lee-v1": {
        right:
          "r4 | D4 r1 D4:2 | r4 | r4 | r4 | D4 r1 D4:2 | r4 | r4 | " +
          "E4 E4 E4:2 | E4 E4 E4:2 | E4 D4 C4 D4 | E4:4 | E4 E4 F4 E4 | D4 r1 D4 D4 | r4 | r4",
        left: [
          blackbird,
          blackbird,
          "r4 | r4 | r4 | r4 | r4 | r1 A3 r2 | C4 B3 A3 B3 | C4:4",
        ].join(" | "),
      },
    };
    const songs = classSongs().slice(1);
    expect(songs.map((song) => song.id)).toEqual(Object.keys(expected));
    for (const song of songs) {
      expect(printedBars(song, "right")).toBe(expected[song.id].right);
      expect(printedBars(song, "left")).toBe(expected[song.id].left);
    }
  });

  it("follows the printed meters, dynamics, repeat and articulation", () => {
    const songs = new Map(classSongs().map((song) => [song.id, song]));
    for (const id of [
      "pawpal-five-oclock-v1",
      "pawpal-sleep-tight-mozart-mouse-v1",
    ])
      expect(songs.get(id)!.beatsPerBar).toBe(3);

    // The repeated lullaby verse is loud the first time and soft the second.
    const sleep = songs.get("pawpal-sleep-tight-mozart-mouse-v1")!;
    const sleepBeat = 60 / sleep.lesson!.bpm;
    const verse = (from: number, to: number) =>
      new Set(
        sleep.notes
          .filter(
            (note) =>
              note.start >= (1 + from) * sleepBeat - 1e-9 &&
              note.start < (1 + to) * sleepBeat - 1e-9,
          )
          .map((note) => note.velocity),
      );
    expect(verse(0, 24)).toEqual(new Set([0.75]));
    expect(verse(24, 60)).toEqual(new Set([0.45]));

    // Mozart Mouse's fanfare returns louder at bar 9.
    const mozart = songs.get("pawpal-mozart-mouses-special-music-v1")!;
    const mozartBeat = 60 / mozart.lesson!.bpm;
    for (const note of mozart.notes)
      expect(note.velocity).toBe(
        note.start < (1 + 32) * mozartBeat - 1e-9 ? 0.6 : 0.75,
      );

    // Only Tell Us, Please! has staccato dots, on every quarter note; they
    // sound for under half a beat, and other notes keep a short release gap.
    for (const song of songs.values()) {
      if (song.id === "cadence-dancing-raindrops-v1") continue;
      const beat = 60 / song.lesson!.bpm;
      for (const note of song.notes) {
        expect(note.staccato ?? false).toBe(
          song.id === "pawpal-tell-us-please-v1" && note.notatedBeats === 1,
        );
        expect(note.end - note.start).toBeCloseTo(
          note.staccato ? 0.45 * beat : note.notatedBeats! * beat - 0.055,
          9,
        );
      }
    }
  });
});
