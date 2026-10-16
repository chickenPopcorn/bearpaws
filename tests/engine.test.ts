import { describe, expect, it } from "vitest";
import { writeMidi } from "midi-file";
import { chords, MidiState, Practice, Transport } from "../src/engine";
import { exampleSong, parseSong, tempoConverter, type Note } from "../src/song";

function midi(
  tracks: Parameters<typeof writeMidi>[0]["tracks"],
  format: 0 | 1 | 2 = 1,
) {
  return Uint8Array.from(
    writeMidi({
      header: { format, numTracks: tracks.length, ticksPerBeat: 480 },
      tracks,
    }),
  );
}

function note(
  id: string,
  pitch: number,
  start: number,
  duration = 0.5,
  track = 0,
): Note {
  return {
    id,
    pitch,
    start,
    end: start + duration,
    soundEnd: start + duration,
    velocity: 0.8,
    track,
    channel: track,
  };
}

describe("MIDI import and the musical timeline", () => {
  it("uses the MIDI default 120 BPM when there are no tempo events", () => {
    const seconds = tempoConverter(480, []);
    expect([seconds(0), seconds(240), seconds(480), seconds(960)]).toEqual([
      0, 0.25, 0.5, 1,
    ]);
  });

  it("keeps the default tempo until a nonzero first tempo-change tick", () => {
    const seconds = tempoConverter(480, [{ tick: 480, microseconds: 1000000 }]);
    expect([seconds(240), seconds(480), seconds(960)]).toEqual([
      0.25, 0.5, 1.5,
    ]);
  });

  it("integrates an unsorted tempo map without applying a later tempo retroactively", () => {
    const seconds = tempoConverter(480, [
      { tick: 960, microseconds: 250000 },
      { tick: 0, microseconds: 1000000 },
      { tick: 480, microseconds: 500000 },
    ]);
    expect([
      seconds(240),
      seconds(480),
      seconds(720),
      seconds(960),
      seconds(1440),
    ]).toEqual([0.5, 1, 1.25, 1.5, 1.75]);
  });

  it("uses conductor-track tempo changes for notes on every track and exposes explicit hand assignment", () => {
    const song = parseSong(
      midi([
        [
          { deltaTime: 0, type: "setTempo", microsecondsPerBeat: 1000000 },
          { deltaTime: 480, type: "setTempo", microsecondsPerBeat: 500000 },
          { deltaTime: 480, type: "endOfTrack" },
        ],
        [
          { deltaTime: 0, type: "trackName", text: "Melody" },
          {
            deltaTime: 240,
            type: "noteOn",
            channel: 0,
            noteNumber: 60,
            velocity: 64,
          },
          {
            deltaTime: 480,
            type: "noteOff",
            channel: 0,
            noteNumber: 60,
            velocity: 0,
          },
          { deltaTime: 0, type: "endOfTrack" },
        ],
        [
          { deltaTime: 0, type: "trackName", text: "Bass" },
          {
            deltaTime: 480,
            type: "noteOn",
            channel: 1,
            noteNumber: 48,
            velocity: 100,
          },
          {
            deltaTime: 480,
            type: "noteOff",
            channel: 1,
            noteNumber: 48,
            velocity: 0,
          },
          { deltaTime: 0, type: "endOfTrack" },
        ],
      ]),
      "Tempo exercise",
      "fixture",
    );
    expect(song.notes.map((n) => [n.pitch, n.start, n.end])).toEqual([
      [60, 0.5, 1.25],
      [48, 1, 1.5],
    ]);
    expect(song.notes[0].velocity).toBeCloseTo(64 / 127);
    expect(song.tracks.map((t) => [t.name, t.hand, t.count])).toEqual([
      ["Track 1", "off", 0],
      ["Melody", "off", 1],
      ["Bass", "off", 1],
    ]);
  });

  it("pairs overlapping same-pitch notes FIFO, including velocity-zero note-off", () => {
    const song = parseSong(
      midi(
        [
          [
            {
              deltaTime: 0,
              type: "noteOn",
              channel: 0,
              noteNumber: 60,
              velocity: 32,
            },
            {
              deltaTime: 120,
              type: "noteOn",
              channel: 0,
              noteNumber: 60,
              velocity: 96,
            },
            {
              deltaTime: 120,
              type: "noteOn",
              channel: 0,
              noteNumber: 60,
              velocity: 0,
            },
            {
              deltaTime: 240,
              type: "noteOff",
              channel: 0,
              noteNumber: 60,
              velocity: 0,
            },
            { deltaTime: 0, type: "endOfTrack" },
          ],
        ],
        0,
      ),
      "Repeated",
      "repeated",
    );
    expect(song.notes.map((n) => [n.start, n.end])).toEqual([
      [0, 0.25],
      [0.125, 0.5],
    ]);
    expect(song.notes.map((n) => n.velocity)).toEqual([32 / 127, 96 / 127]);
    expect(new Set(song.notes.map((n) => n.id)).size).toBe(2);
    expect(song.tracks[0].hand).toBe("right");
  });

  it("does not pair same-pitch note-offs across channels", () => {
    const song = parseSong(
      midi([
        [
          {
            deltaTime: 0,
            type: "noteOn",
            channel: 0,
            noteNumber: 60,
            velocity: 100,
          },
          {
            deltaTime: 0,
            type: "noteOn",
            channel: 1,
            noteNumber: 60,
            velocity: 100,
          },
          {
            deltaTime: 240,
            type: "noteOff",
            channel: 1,
            noteNumber: 60,
            velocity: 0,
          },
          {
            deltaTime: 240,
            type: "noteOff",
            channel: 0,
            noteNumber: 60,
            velocity: 0,
          },
          { deltaTime: 0, type: "endOfTrack" },
        ],
      ]),
      "Channels",
      "channels",
    );
    expect(song.notes.map((n) => [n.channel, n.end]).sort()).toEqual([
      [0, 0.5],
      [1, 0.25],
    ]);
  });

  it("keeps imported physical release separate from sustain sound duration", () => {
    const song = parseSong(
      midi([
        [
          {
            deltaTime: 0,
            type: "controller",
            channel: 0,
            controllerType: 64,
            value: 127,
          },
          {
            deltaTime: 0,
            type: "noteOn",
            channel: 0,
            noteNumber: 60,
            velocity: 100,
          },
          {
            deltaTime: 480,
            type: "noteOff",
            channel: 0,
            noteNumber: 60,
            velocity: 0,
          },
          {
            deltaTime: 480,
            type: "controller",
            channel: 0,
            controllerType: 64,
            value: 0,
          },
          { deltaTime: 0, type: "endOfTrack" },
        ],
      ]),
      "Pedal",
      "pedal",
    );
    expect(song.notes[0]).toMatchObject({ start: 0, end: 0.5, soundEnd: 1 });
    expect(song.duration).toBeGreaterThanOrEqual(1);
  });

  it("recovers unclosed notes at the track boundary and reports orphan releases", () => {
    const song = parseSong(
      midi([
        [
          {
            deltaTime: 0,
            type: "noteOff",
            channel: 0,
            noteNumber: 59,
            velocity: 0,
          },
          {
            deltaTime: 0,
            type: "noteOn",
            channel: 0,
            noteNumber: 60,
            velocity: 100,
          },
          { deltaTime: 480, type: "endOfTrack" },
        ],
      ]),
      "Incomplete notes",
      "incomplete",
    );
    expect(song.notes[0]).toMatchObject({ start: 0, end: 0.5 });
    expect(song.warnings).toEqual(
      expect.arrayContaining([
        "Unpaired note-off ignored.",
        "Unclosed note ended at track boundary.",
      ]),
    );
  });

  it("rejects non-MIDI, truncated, empty and independent-timeline files clearly", () => {
    expect(() => parseSong(new Uint8Array([1, 2, 3]), "Bad", "bad")).toThrow(
      /standard MIDI/,
    );
    expect(() =>
      parseSong(new TextEncoder().encode("MThd"), "Bad", "bad"),
    ).toThrow(/malformed|incomplete/);
    expect(() =>
      parseSong(
        midi([[{ deltaTime: 0, type: "endOfTrack" }]]),
        "Empty",
        "empty",
      ),
    ).toThrow(/No playable notes/);
    expect(() =>
      parseSong(
        midi([[{ deltaTime: 0, type: "endOfTrack" }]], 2),
        "Independent",
        "format2",
      ),
    ).toThrow(/format 2/);
  });

  it("groups simultaneous imported notes as a chord while keeping repeated notes distinct", () => {
    const song = parseSong(
      midi([
        [
          {
            deltaTime: 0,
            type: "noteOn",
            channel: 0,
            noteNumber: 67,
            velocity: 100,
          },
          {
            deltaTime: 0,
            type: "noteOn",
            channel: 0,
            noteNumber: 60,
            velocity: 100,
          },
          {
            deltaTime: 0,
            type: "noteOn",
            channel: 0,
            noteNumber: 64,
            velocity: 100,
          },
          {
            deltaTime: 240,
            type: "noteOff",
            channel: 0,
            noteNumber: 60,
            velocity: 0,
          },
          {
            deltaTime: 0,
            type: "noteOff",
            channel: 0,
            noteNumber: 64,
            velocity: 0,
          },
          {
            deltaTime: 0,
            type: "noteOff",
            channel: 0,
            noteNumber: 67,
            velocity: 0,
          },
          {
            deltaTime: 240,
            type: "noteOn",
            channel: 0,
            noteNumber: 60,
            velocity: 100,
          },
          {
            deltaTime: 240,
            type: "noteOff",
            channel: 0,
            noteNumber: 60,
            velocity: 0,
          },
          { deltaTime: 0, type: "endOfTrack" },
        ],
      ]),
      "Chords",
      "chords",
    );
    expect(
      chords(song.notes).map((g) => [g.start, g.notes.map((n) => n.pitch)]),
    ).toEqual([
      [0, [60, 64, 67]],
      [0.5, [60]],
    ]);
  });

  it("ships an original example with both assigned hands, chords and repeated pitches", () => {
    const song = exampleSong();
    expect(song.tracks.map((t) => t.hand)).toEqual(["left", "right"]);
    expect(
      song.notes.every(
        (n) => n.end > n.start && n.soundEnd >= n.end && n.velocity > 0,
      ),
    ).toBe(true);
    expect(chords(song.notes).some((g) => g.notes.length > 2)).toBe(true);
    const melody = song.notes.filter((n) => n.track === 1 && n.start >= 9);
    expect(melody[0].pitch).toBe(melody[1].pitch);
    expect(song.duration).toBeGreaterThanOrEqual(
      Math.max(...song.notes.map((n) => n.soundEnd)),
    );
  });
});

describe("clock-driven transport", () => {
  it("gets the same position after sparse or frequent animation frames", () => {
    const sparse = new Transport(30),
      frequent = new Transport(30);
    sparse.play(100);
    frequent.play(100);
    for (let now = 100; now < 108; now += 0.017) frequent.update(now);
    expect(sparse.update(108)).toBe(8);
    expect(frequent.update(108)).toBe(8);
  });

  it("changes speed continuously and pauses without accumulating elapsed wall time", () => {
    const t = new Transport(30);
    t.play(100);
    t.setSpeed(0.5, 102);
    expect(t.at(106)).toBe(4);
    t.pause(106);
    expect(t.at(500)).toBe(4);
    t.play(500);
    expect(t.at(504)).toBe(6);
  });

  it("seeks and restarts deterministically while playing and while paused", () => {
    const t = new Transport(20);
    t.play(0);
    t.seek(8, 2);
    expect(t.at(3)).toBe(9);
    t.pause(3);
    t.seek(2, 10);
    expect(t.at(90)).toBe(2);
    t.seek(-10, 90);
    expect(t.at(90)).toBe(0);
    t.seek(200, 90);
    expect(t.at(90)).toBe(20);
    t.play(91);
    expect(t.at(92)).toBe(1);
  });

  it("retains loop overshoot and gives the same loop position after dropped frames", () => {
    const t = new Transport(30);
    t.loop = [2, 5];
    t.seek(2, 0);
    t.play(0);
    expect(t.update(10)).toBe(3);
    expect(t.cycle).toBeGreaterThan(1);
    t.pause(10.5);
    expect(t.at(100)).toBe(3.5);
    t.play(100);
    expect(t.update(102)).toBe(2.5);
  });

  it("stops at the song end and clamps supported playback speeds", () => {
    const t = new Transport(3);
    t.setSpeed(100, 0);
    expect(t.speed).toBe(1.5);
    t.setSpeed(0.01, 0);
    expect(t.speed).toBe(0.25);
    t.play(0);
    expect(t.update(20)).toBe(3);
    expect(t.playing).toBe(false);
  });

  it("holds a Wait gate across dropped frames without building up a catch-up jump", () => {
    const t = new Transport(30);
    t.play(0);
    expect(t.update(10, 1)).toBe(1);
    expect(t.update(20, 1)).toBe(1);
    expect(t.update(20.5, 2)).toBe(1.5);
  });

  it("cannot skip a pending Wait gate when a dropped frame also crosses the loop end", () => {
    const t = new Transport(20);
    t.loop = [0, 4];
    t.play(0);
    expect(t.update(4.2, 3)).toBe(3);
    expect(t.update(30, 3)).toBe(3);
  });

  it("maps delayed MIDI timestamps with the speed that was active when the event occurred", () => {
    const t = new Transport(30);
    t.play(100);
    t.setSpeed(0.5, 102);
    t.setSpeed(1.5, 106);
    expect(t.eventAt(101)).toEqual({ position: 1, speed: 1 });
    expect(t.eventAt(102)).toEqual({ position: 2, speed: 0.5 });
    expect(t.eventAt(104)).toEqual({ position: 3, speed: 0.5 });
    expect(t.eventAt(107)).toEqual({ position: 5.5, speed: 1.5 });
    // A later pause or seek must not rewrite earlier event positions.
    t.pause(108);
    t.seek(12, 110);
    expect(t.eventAt(104)).toEqual({ position: 3, speed: 0.5 });
    expect(t.eventAt(109)).toEqual({ position: 7, speed: 1.5 });
    expect(t.eventAt(111)).toEqual({ position: 12, speed: 1.5 });
    t.play(112);
    expect(t.eventAt(113)).toEqual({ position: 13.5, speed: 1.5 });
  });

  it("preserves timestamp positions on both sides of a loop wrap after the transport anchor moves", () => {
    const t = new Transport(20);
    t.loop = [0, 4];
    t.play(100);
    expect(t.update(104.25)).toBe(0.25);
    expect(t.eventAt(103.5)).toEqual({ position: 3.5, speed: 1 });
    expect(t.eventAt(104.125)).toEqual({ position: 0.125, speed: 1 });
    expect(t.eventAt(108.5)).toEqual({ position: 0.5, speed: 1 });
  });

  it("clamps historical event positions from the instant a dropped frame crossed a Wait gate", () => {
    const t = new Transport(30);
    t.play(100);
    expect(t.update(110, 1)).toBe(1);
    expect(t.eventAt(100.5)).toEqual({ position: 0.5, speed: 1 });
    expect(t.eventAt(101)).toEqual({ position: 1, speed: 1 });
    expect(t.eventAt(105)).toEqual({ position: 1, speed: 1 });
    t.update(120, 1);
    expect(t.eventAt(115)).toEqual({ position: 1, speed: 1 });
    t.seek(1, 120); // The chord has been played; continue from this instant.
    expect(t.eventAt(120.5)).toEqual({ position: 1.5, speed: 1 });
  });

  it("clamps event history when playback starts exactly on a pending Wait gate", () => {
    const t = new Transport(30);
    t.seek(1, 100);
    t.play(100);
    expect(t.update(105, 1)).toBe(1);
    expect(t.eventAt(102)).toEqual({ position: 1, speed: 1 });
    expect(t.eventAt(105)).toEqual({ position: 1, speed: 1 });
  });
});

describe("Rhythm matching and feedback", () => {
  it("scores correct, early, late and wrong pitches using the configurable tolerance", () => {
    const p = new Practice([
      note("a", 60, 1),
      note("b", 62, 2),
      note("c", 64, 3),
    ]);
    p.input(60, 1.01, "rhythm", 0.2, 1, new Set([60]));
    p.input(62, 1.88, "rhythm", 0.2, 1, new Set([62]));
    p.input(64, 3.12, "rhythm", 0.2, 1, new Set([64]));
    p.input(70, 3.12, "rhythm", 0.2, 1, new Set([70]));
    expect(p.hit).toEqual(new Set(["a", "b", "c"]));
    expect(p.feedback.map((f) => f.kind)).toEqual([
      "hit",
      "early",
      "late",
      "wrong",
    ]);
    expect(p.feedback[1].offset).toBeCloseTo(-0.12);
    expect(p.feedback[2].offset).toBeCloseTo(0.12);
    const strict = new Practice([note("a", 60, 1)]);
    strict.input(60, 1.12, "rhythm", 0.08, 1, new Set([60]));
    expect(strict.hit.size).toBe(0);
    expect(strict.feedback[0].kind).toBe("wrong");
  });

  it("measures tolerance in real seconds at slower playback speeds", () => {
    const p = new Practice([note("a", 60, 1), note("b", 62, 2)]);
    p.input(60, 1.075, "rhythm", 0.2, 0.5, new Set([60]));
    p.input(62, 2.125, "rhythm", 0.2, 0.5, new Set([62]));
    expect(p.hit).toEqual(new Set(["a"]));
    expect(p.feedback[0].offset).toBeCloseTo(0.15);
    expect(p.feedback[1].kind).toBe("wrong");
    p.expire(2.11, 0.2, 0.5);
    expect(p.missed).toEqual(new Set(["b"]));
  });

  it("matches each repeated note once and counts misses once", () => {
    const p = new Practice([
      note("first", 60, 1),
      note("second", 60, 2),
      note("third", 62, 3),
    ]);
    p.input(60, 1, "rhythm", 0.2, 1, new Set([60]));
    p.input(60, 1.02, "rhythm", 0.2, 1, new Set([60]));
    p.input(60, 2.03, "rhythm", 0.2, 1, new Set([60]));
    p.expire(4, 0.2, 1);
    p.expire(8, 0.2, 1);
    expect(p.hit).toEqual(new Set(["first", "second"]));
    expect(p.feedback.filter((f) => f.kind === "wrong")).toHaveLength(1);
    expect(p.feedback.filter((f) => f.kind === "miss")).toEqual([
      { kind: "miss", pitch: 62, at: 3 },
    ]);
  });

  it("does not score Listen input and can practice an explicitly selected hand", () => {
    const all = [note("left", 48, 1, 0.5, 0), note("right", 60, 1, 0.5, 1)];
    const p = new Practice(all.filter((n) => n.track === 1));
    p.input(60, 1, "listen", 0.2, 1, new Set([60]));
    expect(p.feedback).toEqual([]);
    expect(p.hit.size).toBe(0);
    p.input(60, 1, "rhythm", 0.2, 1, new Set([60]));
    p.expire(4, 0.2, 1);
    expect(p.hit).toEqual(new Set(["right"]));
    expect(p.missed.size).toBe(0);
  });

  it("resets to a passage without treating deliberately skipped notes as misses", () => {
    const p = new Practice([note("skipped", 60, 1), note("passage", 62, 5)]);
    p.reset(5);
    expect(p.gate?.start).toBe(5);
    p.expire(5, 0.2, 1);
    expect(p.missed.size).toBe(0);
    p.expire(5.3, 0.2, 1);
    expect(p.missed).toEqual(new Set(["passage"]));
  });

  it("reconciles a delayed MIDI timestamp that arrived after the rendering clock declared a miss", () => {
    const t = new Transport(10);
    const p = new Practice([
      note("delayed", 60, 1),
      note("unplayed", 62, 1),
      note("repeat", 60, 2),
    ]);
    t.play(100);
    p.expire(t.at(101.4), 0.2, 1);
    expect(p.missed).toEqual(new Set(["delayed", "unplayed"]));
    // The handler runs at 101.4, but the MIDI event happened at 101.05.
    p.input(60, t.at(101.05), "rhythm", 0.2, 1, new Set([60]));
    expect(p.hit).toEqual(new Set(["delayed"]));
    expect(p.missed).toEqual(new Set(["unplayed"]));
    expect(p.feedback.filter((f) => f.kind === "miss")).toEqual([
      { kind: "miss", pitch: 62, at: 1 },
    ]);
    expect(p.feedback.at(-1)?.offset).toBeCloseTo(0.05);
    p.expire(3, 0.2, 1);
    p.input(60, 1.04, "rhythm", 0.2, 1, new Set([60]));
    expect(p.missed).toEqual(new Set(["unplayed", "repeat"]));
    expect(p.feedback.at(-1)?.kind).toBe("wrong");
  });

  it("uses the original timestamp tolerance when reconciling a delayed event at half speed", () => {
    const p = new Practice([note("within", 60, 1), note("outside", 62, 1)]);
    p.expire(2, 0.2, 0.5);
    p.input(60, 1.075, "rhythm", 0.2, 0.5, new Set([60]));
    p.input(62, 1.125, "rhythm", 0.2, 0.5, new Set([62]));
    expect(p.hit).toEqual(new Set(["within"]));
    expect(p.missed).toEqual(new Set(["outside"]));
    expect(p.feedback.find((f) => f.pitch === 60)?.offset).toBeCloseTo(0.15);
    expect(p.feedback.at(-1)?.kind).toBe("wrong");
  });
});

describe("Wait for me chord and repeated-note gating", () => {
  it("requires every chord pitch physically held, not merely previously played or sustained", () => {
    const p = new Practice([
      note("c", 60, 1),
      note("e", 64, 1),
      note("g", 67, 1),
      note("next", 62, 2),
    ]);
    expect(p.input(60, 1, "wait", 0.2, 1, new Set([60]))).toBeUndefined();
    expect(p.input(64, 1, "wait", 0.2, 1, new Set([64]))).toBeUndefined();
    expect(p.input(67, 1, "wait", 0.2, 1, new Set([64, 67]))).toBeUndefined();
    expect(p.gate?.start).toBe(1);
    expect(p.input(60, 1, "wait", 0.2, 1, new Set([60, 64, 67]))).toBe(true);
    expect(p.gate?.start).toBe(2);
  });

  it("does not accept anticipatory notes or release a gate for a wrong pitch", () => {
    const p = new Practice([note("c", 60, 1)]);
    p.input(60, 0.8, "wait", 0.2, 1, new Set([60]));
    expect(p.hit.size).toBe(0);
    p.input(61, 1, "wait", 0.2, 1, new Set([61]));
    expect(p.feedback[0].kind).toBe("wrong");
    expect(p.gateIndex).toBe(0);
    expect(p.input(60, 1, "wait", 0.2, 1, new Set([60]))).toBe(true);
    expect(p.gate).toBeUndefined();
  });

  it("requires a fresh physical press for a repeated pitch even while the pedal sustains it", () => {
    const p = new Practice([note("first", 60, 1), note("second", 60, 2)]);
    const state = new MidiState();
    function deliver(data: number[], position: number) {
      const event = state.message(data);
      return (
        event && p.input(event.pitch, position, "wait", 0.2, 1, state.down)
      );
    }
    expect(deliver([0x90, 60, 100], 1)).toBe(true);
    expect(deliver([0x90, 60, 100], 2)).toBeUndefined();
    expect(p.gate?.start).toBe(2);
    deliver([0xb0, 64, 127], 2);
    deliver([0x90, 60, 0], 2);
    expect(state.down.has(60)).toBe(false);
    expect(state.sounding.has(60)).toBe(true);
    expect(deliver([0x90, 60, 80], 2)).toBe(true);
    expect(p.hit.size).toBe(2);
  });

  it("does not borrow a held pitch from the preceding chord to satisfy the next chord", () => {
    const p = new Practice([
      note("first", 60, 1),
      note("repeat", 60, 2),
      note("e", 64, 2),
    ]);
    expect(p.input(60, 1, "wait", 0.2, 1, new Set([60]))).toBe(true);
    expect(p.input(64, 2, "wait", 0.2, 1, new Set([60, 64]))).toBeUndefined();
    expect(p.gate?.start).toBe(2);
    expect(p.input(60, 2, "wait", 0.2, 1, new Set([60, 64]))).toBe(true);
    p.reset(1);
    expect(p.hit.size).toBe(0);
    expect(p.feedback).toEqual([]);
    expect(p.gate?.start).toBe(1);
  });

  it("resumes an incomplete chord after pause, then resets chord presses on seek and loop replay", () => {
    const p = new Practice([
      note("first-c", 60, 1),
      note("first-e", 64, 1),
      note("second-c", 60, 2),
      note("second-e", 64, 2),
    ]);
    const t = new Transport(4),
      state = new MidiState();
    t.loop = [1, 3];
    t.seek(1, 0);
    p.reset(1);
    t.play(0);
    function press(pitch: number) {
      const edge = state.message([0x90, pitch, 100]);
      return edge && p.input(pitch, t.position, "wait", 0.2, 1, state.down);
    }
    t.update(1, p.gate?.start);
    expect(press(60)).toBeUndefined();
    t.pause(1);
    expect(t.at(100)).toBe(1);
    t.play(100);
    expect(t.update(105, p.gate?.start)).toBe(1);
    expect(press(64)).toBe(true);
    expect(p.gate?.start).toBe(2);

    // Seek/restart clears both previous chord credit and held MIDI state.
    t.seek(2, 106);
    p.reset(2);
    state.clear();
    expect(press(64)).toBeUndefined();
    expect(p.gate?.start).toBe(2);
    expect(press(60)).toBe(true);
    expect(p.gate).toBeUndefined();

    const previousCycle = t.cycle;
    t.update(108);
    expect(t.cycle).toBeGreaterThan(previousCycle);
    p.reset(1);
    state.clear();
    expect(t.update(108, p.gate?.start)).toBe(1);
    expect(p.hit.size).toBe(0);
    expect(press(60)).toBeUndefined();
    expect(p.gate?.start).toBe(1);
    expect(press(64)).toBe(true);
    expect(p.gate?.start).toBe(2);
  });
});

describe("live MIDI physical keys, sustain and cleanup", () => {
  it("returns note-on edges and velocity, treating both release encodings as key-up", () => {
    const s = new MidiState();
    expect(s.message([0x90, 60, 96])).toEqual({ pitch: 60, velocity: 96 });
    expect(s.velocities.get(60)).toBe(96);
    expect(s.message([0x90, 60, 64])).toBeUndefined();
    expect(s.down).toEqual(new Set([60]));
    s.message([0x90, 60, 0]);
    expect(s.down.size).toBe(0);
    expect(s.sounding.size).toBe(0);
    expect(s.message([0x90, 60, 32])).toEqual({ pitch: 60, velocity: 32 });
    s.message([0x80, 60, 40]);
    expect(s.down.size).toBe(0);
    expect(s.sounding.size).toBe(0);
  });

  it("sustains released sound while retaining a separate physical-key state", () => {
    const s = new MidiState();
    s.message([0x90, 60, 100]);
    s.message([0xb0, 64, 64]);
    s.message([0x80, 60, 0]);
    expect(s.sustain).toBe(true);
    expect(s.down.has(60)).toBe(false);
    expect(s.sounding.has(60)).toBe(true);
    s.message([0x90, 64, 100]);
    s.message([0xb0, 64, 63]);
    expect(s.sustain).toBe(false);
    expect(s.sounding).toEqual(new Set([64]));
    expect(s.down).toEqual(new Set([64]));
  });

  it("isolates pedal, physical note releases and channel panic messages", () => {
    const s = new MidiState();
    s.message([0x90, 60, 100]);
    s.message([0x91, 60, 90]);
    s.message([0xb0, 64, 127]);
    s.message([0x80, 60, 0]);
    expect(s.down).toEqual(new Set([60]));
    s.message([0x81, 60, 0]);
    expect(s.down.size).toBe(0);
    expect(s.sounding).toEqual(new Set([60]));
    s.message([0xb1, 64, 0]);
    expect(s.sounding).toEqual(new Set([60]));
    s.message([0xb0, 64, 0]);
    expect(s.sounding.size).toBe(0);
    s.message([0x90, 60, 100]);
    s.message([0x91, 64, 100]);
    s.message([0xb0, 123, 0]);
    expect(s.down).toEqual(new Set([64]));
    s.message([0xb1, 120, 0]);
    expect(s.down.size).toBe(0);
    expect(s.sounding.size).toBe(0);
  });

  it("ignores unrelated MIDI messages without creating keys", () => {
    const s = new MidiState();
    s.message([0xb0, 1, 127]);
    s.message([0xe0, 0, 64]);
    s.message([0xf8]);
    expect(s.down.size).toBe(0);
    expect(s.sounding.size).toBe(0);
    expect(s.sustain).toBe(false);
  });

  it("does not create phantom sustained notes from orphan or duplicate key releases", () => {
    const s = new MidiState();
    s.message([0xb0, 64, 127]);
    s.message([0x80, 60, 0]);
    s.message([0x90, 64, 0]);
    expect(s.down.size).toBe(0);
    expect(s.sounding.size).toBe(0);
    s.message([0x90, 67, 100]);
    s.message([0x80, 67, 0]);
    s.message([0x80, 67, 0]);
    expect(s.sounding).toEqual(new Set([67]));
  });

  it("clears every transient state on disconnect/restart and accepts the first reconnect press", () => {
    const s = new MidiState();
    s.message([0x90, 60, 100]);
    s.message([0xb0, 64, 127]);
    s.message([0x80, 60, 0]);
    s.message([0x91, 64, 90]);
    s.clear();
    expect(s.down.size).toBe(0);
    expect(s.sounding.size).toBe(0);
    expect(s.velocities.size).toBe(0);
    expect(s.pedals.size).toBe(0);
    expect(s.sustain).toBe(false);
    expect(s.message([0x91, 64, 90])).toEqual({ pitch: 64, velocity: 90 });
    s.message([0x81, 64, 0]);
    expect(s.sounding.size).toBe(0);
  });
});
