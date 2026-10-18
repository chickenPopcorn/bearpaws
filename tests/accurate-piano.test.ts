import { describe, expect, it } from "vitest";
import manifest from "../public/audio/accurate-salamander/manifest.json";
import checksums from "../public/audio/accurate-salamander/source/sha256.json";
import archive from "../public/audio/accurate-salamander/source/archive-members.json";
import {
  PIANO_REGIONS,
  pianoLevel,
  pianoPlaybackRate,
  selectPianoRegion,
} from "../src/piano";

const pitches = Array.from({ length: 88 }, (_, i) => i + 21);
const sourceLayers = Array.from({ length: 16 }, (_, i) => i + 1);

describe("Accurate-Salamander instrument", () => {
  it("uses the lossless 24-bit instrument and its source regions", () => {
    expect(manifest).toMatchObject({
      name: "Accurate-Salamander Grand Piano",
      sampleRate: 48000,
      bitDepth: 24,
      format: "FLAC",
      license: "CC-BY-3.0",
      amplitudeVelocityTracking: 98.5,
      sourceLayers,
    });
    expect(PIANO_REGIONS).toEqual(manifest.regions);
    expect(PIANO_REGIONS).toHaveLength(1408);
    expect(new Set(PIANO_REGIONS.map((region) => region.file)).size).toBe(480);
  });

  it("covers all 88 piano keys with sixteen nonoverlapping velocity bands", () => {
    expect([...new Set(PIANO_REGIONS.map((region) => region.pitch))]).toEqual(
      pitches,
    );
    for (const pitch of pitches) {
      const regions = PIANO_REGIONS.filter((region) => region.pitch === pitch);
      expect(regions.map((region) => region.sourceLayer)).toEqual(sourceLayers);
      expect(regions[0].velocityMin).toBe(2);
      expect(regions.at(-1)!.velocityMax).toBe(127);
      for (let i = 0; i < regions.length; i++) {
        const region = regions[i];
        expect(region.velocityMin).toBeLessThanOrEqual(region.velocityMax);
        if (i > 0)
          expect(region.velocityMin).toBe(regions[i - 1].velocityMax + 1);
      }
    }
  });

  it("ships every mapped recording with matching metadata and provenance", () => {
    const assets = import.meta.glob(
      "../public/audio/accurate-salamander/*.flac",
      { eager: true, query: "?url", import: "default" },
    );
    const filenames = Object.keys(assets)
      .map((path) => path.split("/").at(-1)!)
      .sort();
    type Recorded = { file: string; offset: number; offsetFrames: number };
    const regions: Recorded[] = [
      ...manifest.regions,
      ...Object.values(manifest.optionalVoices).flatMap(
        (group): Recorded[] => group.regions,
      ),
    ];
    const expected = [...new Set(regions.map((region) => region.file))].sort();
    // The optional voices add 161 recordings; resonance reuses note ones.
    expect(expected).toHaveLength(480 + 161);
    expect(filenames).toEqual(expected);
    expect(Object.keys(manifest.files).sort()).toEqual(expected);
    expect(Object.keys(checksums).sort()).toEqual(expected);
    expect(Object.keys(archive.files).sort()).toEqual(expected);
    for (const file of expected) {
      const info = manifest.files[file as keyof typeof manifest.files];
      expect(info.channels).toBe(2);
      expect(info.bitDepth).toBe(24);
      expect(info.duration).toBeGreaterThan(0);
      expect(info.sampleRate).toBeGreaterThanOrEqual(40000);
      expect(info.sampleRate).toBeLessThanOrEqual(60000);
      expect(info.bytes).toBe(
        archive.files[file as keyof typeof archive.files].size,
      );
      expect(checksums[file as keyof typeof checksums]).toMatch(
        /^[a-f0-9]{64}$/,
      );
    }
    for (const region of regions) {
      const info = manifest.files[region.file as keyof typeof manifest.files];
      expect(region.offset).toBeLessThan(info.duration);
      expect(region.offset).toBeCloseTo(
        region.offsetFrames / info.sampleRate,
        12,
      );
    }
  });

  it("selects exactly one region for every audible MIDI velocity", () => {
    for (const pitch of pitches) {
      const regions = PIANO_REGIONS.filter((region) => region.pitch === pitch);
      for (let velocity = 2; velocity <= 127; velocity++) {
        const expected = regions.filter(
          (region) =>
            velocity >= region.velocityMin && velocity <= region.velocityMax,
        );
        expect(expected).toHaveLength(1);
        expect(selectPianoRegion(pitch, velocity / 127)).toEqual(expected[0]);
      }
    }
  });

  it("moves through all sixteen recordings as playing intensity increases", () => {
    for (const pitch of pitches) {
      const selected = Array.from({ length: 126 }, (_, i) =>
        selectPianoRegion(pitch, (i + 2) / 127)!,
      );
      expect([
        ...new Set(selected.map((region) => region.sourceLayer)),
      ]).toEqual(sourceLayers);
      for (let i = 1; i < selected.length; i++)
        expect(selected[i].sourceLayer).toBeGreaterThanOrEqual(
          selected[i - 1].sourceLayer,
        );
      expect(selected[0].file).not.toBe(selected.at(-1)!.file);
    }
  });

  it("keeps silent velocities silent and clamps playable input to the bank", () => {
    for (const velocity of [-1, 0, 0.5 / 127, 1 / 127])
      expect(selectPianoRegion(60, velocity)).toBeUndefined();
    expect(selectPianoRegion(60, 2)).toEqual(selectPianoRegion(60, 1));
    expect(selectPianoRegion(0, 0.6)).toEqual(selectPianoRegion(21, 0.6));
    expect(selectPianoRegion(127, 0.6)).toEqual(selectPianoRegion(108, 0.6));
  });

  it("retains the preset's per-key pitch correction and attack offsets", () => {
    const middleC = selectPianoRegion(60, 70 / 127)!;
    const cSharp = selectPianoRegion(61, 70 / 127)!;
    const lowF = selectPianoRegion(29, 70 / 127)!;
    expect(middleC).toMatchObject({ rootPitch: 60, tune: 0 });
    expect(pianoPlaybackRate(middleC, 60)).toBe(1);
    expect(cSharp).toMatchObject({ rootPitch: 60, tune: 2 });
    expect(pianoPlaybackRate(cSharp, 61)).toBeCloseTo(1.060687741368217, 12);
    expect(lowF).toMatchObject({ rootPitch: 30, tune: 0 });
    // The SFZ offset uses frames from each original file, including the
    // corrected sample rate in its FLAC header, rather than nominal 48 kHz.
    expect(manifest.files["060_C4v09.flac"].sampleRate).toBe(47917);
    expect(manifest.files["030_Fs1v09.flac"].sampleRate).toBe(40410);
    expect(middleC.offset).toBeCloseTo(768 / 47917, 12);
    expect(cSharp.offset).toBeCloseTo(768 / 47917, 12);
    expect(lowF.offset).toBeCloseTo(646 / 40410, 12);
    expect(pianoPlaybackRate(lowF, 29)).toBeCloseTo(0.9438743126816935, 12);
    for (const region of PIANO_REGIONS) {
      expect(region.file).toMatch(/^\d{3}_[A-Za-z]+\d+v\d{2}\.flac$/);
      expect(Number(region.file.slice(0, 3))).toBe(region.rootPitch);
      expect(Number.isFinite(region.tune)).toBe(true);
      expect(Number.isFinite(region.gainDb)).toBe(true);
      expect(region.offset).toBeGreaterThanOrEqual(0);
      expect(region.releaseSeconds).toBeGreaterThan(0);
    }
  });

  it("applies the source velocity curve and decibel gain correction", () => {
    const region = selectPianoRegion(60, 0.6)!;
    expect(region.gainDb).toBe(0);
    expect(pianoLevel(region, 0.6)).toBeCloseTo(0.25589158437009396, 12);
    expect(pianoLevel(region, 1)).toBeCloseTo(0.7, 12);
    expect(pianoLevel({ ...region, gainDb: 6 }, 0.6)).toBeCloseTo(
      0.510570835011328,
      12,
    );
    expect(pianoLevel(region, 0)).toBe(0);
    let previous = 0;
    for (let velocity = 2; velocity <= 127; velocity++) {
      const level = pianoLevel(region, velocity / 127);
      expect(level).toBeGreaterThan(previous);
      previous = level;
    }
  });
});
