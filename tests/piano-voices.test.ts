import { describe, expect, it } from "vitest";
import manifest from "../public/audio/accurate-salamander/manifest.json";
import { PIANO_REGIONS, pianoLevel, pianoPlaybackRate } from "../src/piano";
import {
  PIANO_VOICE_GROUPS,
  pedalNoiseRegion,
  pianoVoiceEvents,
  pianoVoiceFiles,
  pianoVoiceLevel,
  pianoVoiceRegions,
  type PianoVoiceEvent,
} from "../src/pianoVoices";
import { DEFAULT_PIANO_SOUND } from "../src/pianoSound";
import type { Note, PedalSpan } from "../src/song";

const keys = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const note = (
  id: string,
  pitch: number,
  start: number,
  end: number,
  soundEnd = end,
  channel = 0,
  velocity = 0.6,
): Note => ({
  id,
  pitch,
  start,
  end,
  soundEnd,
  velocity,
  track: channel,
  channel,
});
const summary = (events: PianoVoiceEvent[]) =>
  events.map((event) => [event.region.voice, event.time, event.ids]);

describe("optional Accurate-Salamander voices in the manifest", () => {
  it("records every voice the preset leaves off, with its controller", () => {
    expect(
      Object.entries(PIANO_VOICE_GROUPS).map(([voice, group]) => [
        voice,
        group.label,
        group.controller,
        group.regions.length,
      ]),
    ).toEqual([
      ["release", "Sampled Release", 20, 69],
      ["keyNoise", "Hammer Noise", 21, 88],
      ["pedalNoise", "Pedal Noise", 22, 4],
      ["resonance", "Pedal Resonance", 23, 135],
    ]);
    for (const group of Object.values(manifest.optionalVoices)) {
      // Off upstream; enabled, each controller lowers its voice by up to 12 dB.
      expect(group.defaultController).toBe(0);
      expect(group.controllerGainDb).toBe(-12);
    }
    // The note regions are unchanged by the optional voices.
    expect(PIANO_REGIONS).toHaveLength(1408);
  });

  it("maps sampled release to keys with dampers, by velocity, with the pedal up", () => {
    for (const pitch of keys(21, 88))
      for (let velocity = 2; velocity <= 127; velocity++) {
        const regions = pianoVoiceRegions("release", pitch, velocity / 127);
        expect(regions).toHaveLength(1);
        const [region] = regions;
        expect(region).toMatchObject({
          trigger: "release",
          pedal: "up",
          gainDb: -21,
          offset: 0,
        });
        // Each recording serves its own key and the keys either side.
        expect(Math.abs(pitch - region.rootPitch!)).toBeLessThanOrEqual(1);
        expect(region.file).toMatch(
          velocity >= 45 ? /^harmL/ : velocity >= 31 ? /^harmS/ : /^harmV3/,
        );
      }
    // Undamped treble strings have no damper to release.
    for (const pitch of keys(89, 108))
      expect(pianoVoiceRegions("release", pitch, 0.8)).toEqual([]);
    expect(pianoVoiceRegions("release", 60, 1 / 127)).toEqual([]);
    expect(
      [
        ...new Set(
          PIANO_VOICE_GROUPS.release.regions.map((r) => r.decayDbPerSecond),
        ),
      ].sort(),
    ).toEqual([2, 6, 7, 8, 9]);
  });

  it("maps one unpitched key release noise to every key", () => {
    for (const pitch of keys(21, 108)) {
      const regions = pianoVoiceRegions("keyNoise", pitch, 0.5);
      expect(regions).toEqual([
        expect.objectContaining({
          file: `rel${pitch - 20}.flac`,
          trigger: "release_key",
          pedal: null,
          rootPitch: null,
          gainDb: -37,
          decayDbPerSecond: 2,
        }),
      ]);
      expect(pianoPlaybackRate(regions[0], pitch)).toBe(1);
    }
  });

  it("splits pedal press and lift noise between two recordings each", () => {
    expect(pedalNoiseRegion(true, 0).file).toBe("pedalD1.flac");
    expect(pedalNoiseRegion(true, 0.5).file).toBe("pedalD2.flac");
    expect(pedalNoiseRegion(true, 0.999).file).toBe("pedalD2.flac");
    expect(pedalNoiseRegion(false, 0.2).file).toBe("pedalU1.flac");
    expect(pedalNoiseRegion(false, 0.7).file).toBe("pedalU2.flac");
    for (const region of PIANO_VOICE_GROUPS.pedalNoise.regions) {
      expect(region.gainDb).toBe(region.trigger === "pedalDown" ? -39 : -45);
      expect(region.cutSeconds).toBe(0.1);
      expect(region.rootPitch).toBeNull();
    }
  });

  it("builds pseudo resonance from neighbouring strings' softest notes, only with the pedal down", () => {
    const noteFiles = new Set(PIANO_REGIONS.map((region) => region.file));
    for (const region of PIANO_VOICE_GROUPS.resonance.regions) {
      expect(region).toMatchObject({
        trigger: "attack",
        pedal: "down",
        attackSeconds: 0.05,
        releaseSeconds: 0.5,
        offset: 0,
        pitchMin: region.pitchMax,
        velocityMin: 2,
        velocityMax: 127,
      });
      expect(noteFiles.has(region.file)).toBe(true);
      expect(region.file).toMatch(/v01\.flac$/);
      // Another string's recording, retuned to the key that was struck.
      const distance = Math.abs(region.rootPitch! - region.pitchMin);
      expect(distance).toBeGreaterThanOrEqual(2);
      expect(distance).toBeLessThanOrEqual(10);
      // group_volume -6 to -18 dB, plus the region's own trim.
      expect(region.gainDb).toBeLessThan(-5.5);
      expect(region.gainDb).toBeGreaterThan(-18.5);
    }
    for (const pitch of keys(21, 89)) {
      const count = pianoVoiceRegions("resonance", pitch, 0.5).length;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    }
    for (const pitch of keys(90, 108))
      expect(pianoVoiceRegions("resonance", pitch, 0.5)).toEqual([]);
  });
});

describe("optional voice triggers", () => {
  it("adds release harmonics at key-up only when the pedal is up, and key noise always", () => {
    const events = pianoVoiceEvents([
      note("up", 60, 0, 0.5),
      note("held", 64, 1, 1.5, 3),
    ]);
    expect(summary(events)).toEqual([
      ["keyNoise", 0.5, ["up~keyNoise~0"]],
      ["release", 0.5, ["up~release~0"]],
      ["keyNoise", 1.5, ["held~keyNoise~0"]],
    ]);
    expect(events[0]).toMatchObject({ songEnd: Infinity, held: 0.5 });
  });

  it("doubles notes struck with the pedal down with resonance that ends with the note", () => {
    const pedals: PedalSpan[] = [
      { channel: 0, start: 1, end: 3 },
      { channel: 1, start: 5, end: 6 },
    ];
    const events = pianoVoiceEvents(
      [
        note("before", 60, 0.5, 0.9),
        note("pressed", 60, 1, 1.5, 3),
        note("other channel", 62, 5.5, 5.8, 5.8, 0),
        note("lifted", 64, 3, 3.5),
      ],
      pedals,
    ).filter((event) => event.region.voice === "resonance");
    expect(events.map((event) => [event.time, event.songEnd])).toEqual(
      pianoVoiceRegions("resonance", 60, 0.6).map(() => [1, 3]),
    );
    expect(events.map((event) => event.ids)).toEqual([
      ["pressed~resonance~0"],
      ["pressed~resonance~1"],
    ]);
  });

  it("sounds pedal noise at each press and lift of the foot pedal, and the next change cuts it", () => {
    const pedals: PedalSpan[] = [
      { channel: 0, start: 1, end: 3 },
      // Two channels pressed together are one foot pedal.
      { channel: 1, start: 2, end: 4 },
      { channel: 0, start: 6, end: 7 },
      // A channel with no notes in the passage has no pedal noise.
      { channel: 9, start: 8, end: 9 },
    ];
    const events = pianoVoiceEvents(
      [note("a", 60, 0, 0.5, 0.5, 0), note("b", 48, 0, 0.5, 0.5, 1)],
      pedals,
    ).filter((event) => event.region.voice === "pedalNoise");
    expect(
      events.map((event) => [
        event.region.trigger,
        event.time,
        event.songEnd,
        event.ids,
      ]),
    ).toEqual([
      ["pedalDown", 1, 4, ["pedal~0~down"]],
      ["pedalUp", 4, 6, ["pedal~0~up"]],
      ["pedalDown", 6, 7, ["pedal~1~down"]],
      ["pedalUp", 7, Infinity, ["pedal~1~up"]],
    ]);
    // Both recordings of each kind take turns rather than one repeating.
    expect(new Set(events.map((event) => event.region.file)).size).toBe(4);
  });

  it("keeps a lift and press at one instant on one channel", () => {
    const events = pianoVoiceEvents(
      [note("a", 60, 0, 0.5, 3)],
      [
        { channel: 0, start: 1, end: 2 },
        { channel: 0, start: 2, end: 3 },
      ],
    ).filter((event) => event.region.voice === "pedalNoise");
    expect(
      events.map((event) => [event.region.trigger, event.time, event.songEnd]),
    ).toEqual([
      ["pedalDown", 1, 2],
      // The press at the same instant cuts the lift's noise at once.
      ["pedalUp", 2, 2],
      ["pedalDown", 2, 3],
      ["pedalUp", 3, Infinity],
    ]);
  });

  it("lets a press still down where the file ends ring out", () => {
    const [press, ...rest] = pianoVoiceEvents(
      [note("a", 60, 0, 0.5)],
      [{ channel: 0, start: 1, end: 1, open: true }],
    ).filter((event) => event.region.voice === "pedalNoise");
    expect(press).toMatchObject({ time: 1, songEnd: Infinity });
    expect(press.region.trigger).toBe("pedalDown");
    expect(rest).toEqual([]);
  });

  it("sounds a press and lift at one instant", () => {
    const events = pianoVoiceEvents(
      [note("a", 60, 0, 0.5)],
      [{ channel: 0, start: 1, end: 1 }],
    ).filter((event) => event.region.voice === "pedalNoise");
    expect(events.map((event) => [event.region.trigger, event.time])).toEqual([
      ["pedalDown", 1],
      ["pedalUp", 1],
    ]);
  });

  it("keeps one foot pedal down when another channel takes it over at a lift", () => {
    const events = pianoVoiceEvents(
      [note("a", 60, 0, 0.5, 3), note("b", 48, 0, 0.5, 3, 1)],
      [
        { channel: 0, start: 1, end: 2 },
        { channel: 1, start: 2, end: 3 },
      ],
    ).filter((event) => event.region.voice === "pedalNoise");
    expect(events.map((event) => [event.region.trigger, event.time])).toEqual([
      ["pedalDown", 1],
      ["pedalUp", 3],
    ]);
  });

  it("gives a pitch beyond the piano its nearest key's voices, as its note", () => {
    const [low, high] = pianoVoiceEvents([
      note("low", 15, 0, 0.5),
      note("high", 115, 1, 1.5),
    ]).filter((event) => event.region.voice === "keyNoise");
    expect([low.region.file, low.pitch]).toEqual(["rel1.flac", 15]);
    expect([high.region.file, high.pitch]).toEqual(["rel88.flac", 115]);
    expect(pianoVoiceRegions("release", 15, 0.6)).toEqual(
      pianoVoiceRegions("release", 21, 0.6),
    );
  });

  it("sounds no pedal lift where a file ends with the pedal down", () => {
    const lifts = (pedals: PedalSpan[]) =>
      pianoVoiceEvents(
        [note("a", 60, 0, 0.5, 4), note("b", 48, 0, 0.5, 4, 1)],
        pedals,
      )
        .filter((event) => event.region.trigger === "pedalUp")
        .map((event) => event.time);
    expect(lifts([{ channel: 0, start: 0.25, end: 4, open: true }])).toEqual(
      [],
    );
    // While any channel is still down at the end, the foot pedal never lifts.
    expect(
      lifts([
        { channel: 0, start: 0.25, end: 4, open: true },
        { channel: 1, start: 1, end: 4 },
      ]),
    ).toEqual([]);
    expect(
      lifts([
        { channel: 0, start: 0.25, end: 2 },
        { channel: 1, start: 1, end: 4, open: true },
      ]),
    ).toEqual([]);
  });

  it("sounds no release harmonics for a key that comes up as a file ends with the pedal down", () => {
    const events = pianoVoiceEvents(
      [note("last", 60, 0.5, 1)],
      [{ channel: 0, start: 0.2, end: 1, open: true }],
    );
    expect(
      summary(events.filter((event) => event.time === 1 && event.notes.length)),
    ).toEqual([["keyNoise", 1, ["last~keyNoise~0"]]]);
  });

  it("releases duplicate tracks struck together once, when the last key comes up", () => {
    const events = pianoVoiceEvents([
      note("short", 60, 0, 0.5, 0.5, 0),
      note("long", 60, 0, 1, 1, 1),
    ]);
    expect(summary(events)).toEqual([
      ["keyNoise", 1, ["short~keyNoise~0", "long~keyNoise~0"]],
      ["release", 1, ["short~release~0", "long~release~0"]],
    ]);
    expect(events[0].held).toBe(1);
    // The pedal holding either track at that key-up holds back harmonics.
    expect(
      summary(
        pianoVoiceEvents(
          [note("short", 60, 0, 0.5, 0.5, 0), note("long", 60, 0, 1, 2, 1)],
          [{ channel: 1, start: 0.8, end: 2 }],
        ).filter((event) => event.region.voice !== "pedalNoise"),
      ),
    ).toEqual([["keyNoise", 1, ["short~keyNoise~0", "long~keyNoise~0"]]]);
  });

  it("triggers one voice for duplicate tracks, from the louder note", () => {
    const events = pianoVoiceEvents(
      [
        note("soft", 60, 0, 0.5, 0.5, 0, 0.2),
        note("loud", 60, 0, 0.5, 0.5, 1, 0.9),
      ],
      [],
    );
    expect(summary(events)).toEqual([
      ["keyNoise", 0.5, ["soft~keyNoise~0", "loud~keyNoise~0"]],
      ["release", 0.5, ["soft~release~0", "loud~release~0"]],
    ]);
    expect(events[1]).toMatchObject({
      velocity: 0.9,
      region: pianoVoiceRegions("release", 60, 0.9)[0],
    });
  });

  it("plays each voice at its SFZ level, less rt_decay for the time the key was held", () => {
    const [keyNoise, release] = pianoVoiceEvents([note("n", 60, 0, 2)]);
    expect(pianoVoiceLevel(release, 0)).toBeCloseTo(
      pianoLevel({ gainDb: -21 }, 0.6),
      12,
    );
    const decay = release.region.decayDbPerSecond;
    expect(pianoVoiceLevel(release, 2)).toBeCloseTo(
      pianoLevel({ gainDb: -21 - 2 * decay }, 0.6),
      12,
    );
    expect(pianoVoiceLevel(keyNoise, 1)).toBeCloseTo(
      pianoLevel({ gainDb: -39 }, 0.6),
      12,
    );
    // Pedal noise has no key velocity.
    const [press] = pianoVoiceEvents(
      [note("n", 60, 0, 0.5, 2)],
      [{ channel: 0, start: 0.25, end: 2 }],
    ).filter((event) => event.region.voice === "pedalNoise");
    expect(pianoVoiceLevel(press, 0)).toBeCloseTo(
      pianoLevel({ gainDb: -39 }, 1),
      12,
    );
  });

  it("lists the recordings enabled voices need, smallest kinds first", () => {
    const events = pianoVoiceEvents(
      [note("a", 60, 0, 0.5, 2), note("b", 62, 3, 3.5)],
      [{ channel: 0, start: 0, end: 2 }],
    );
    const files = pianoVoiceFiles(events, DEFAULT_PIANO_SOUND.voices);
    expect(files.slice(0, 4)).toEqual([
      "rel40.flac",
      "rel42.flac",
      "pedalD1.flac",
      "pedalU1.flac",
    ]);
    expect(files.at(-1)).toMatch(/v01\.flac$/);
    expect(
      pianoVoiceFiles(events, {
        release: false,
        keyNoise: true,
        pedalNoise: false,
        resonance: false,
      }),
    ).toEqual(["rel40.flac", "rel42.flac"]);
  });
});
