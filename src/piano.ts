import data from "../public/audio/accurate-salamander/manifest.json";

export interface PianoRegion {
  pitch: number;
  velocityMin: number;
  velocityMax: number;
  sourceLayer: number;
  file: string;
  rootPitch: number;
  tune: number;
  offset: number;
  gainDb: number;
  releaseSeconds: number;
}
export const pianoInstrument = data as typeof data & {
  files?: Record<string, { duration: number; channels: number }>;
};
export const PIANO_REGIONS: PianoRegion[] = data.regions;
const keys = new Map<number, PianoRegion[]>();
for (const region of PIANO_REGIONS) {
  const regions = keys.get(region.pitch) ?? [];
  regions.push(region);
  keys.set(region.pitch, regions);
}

/** A velocity from 0 to 1, as MIDI's 0 to 127. */
export const midiVelocity = (velocity: number) =>
  Math.round(Math.max(0, Math.min(1, velocity)) * 127);
/** The key that plays `pitch`: beyond the piano, its nearest key. */
export const pianoKey = (pitch: number) =>
  Math.max(21, Math.min(108, Math.round(pitch)));

export function selectPianoRegion(pitch: number, velocity: number) {
  if (!Number.isFinite(pitch) || !Number.isFinite(velocity)) return;
  const value = midiVelocity(velocity);
  return keys
    .get(pianoKey(pitch))
    ?.find(
      (region) => value >= region.velocityMin && value <= region.velocityMax,
    );
}

/** A recording without a root pitch plays at its own pitch, whatever the key. */
export const pianoPlaybackRate = (
  region: { rootPitch: number | null; tune: number },
  pitch: number,
) =>
  2 **
  (((region.rootPitch === null ? 0 : pitch - region.rootPitch) +
    region.tune / 100) /
    12);

// The source WAVs are normalized; retain the preset's velocity response and
// per-key compensation rather than applying an unrelated second gain curve.
export const pianoLevel = (
  region: Pick<PianoRegion, "gainDb">,
  velocity: number,
) =>
  0.7 *
  Math.max(0, Math.min(1, velocity)) **
    ((2 * data.amplitudeVelocityTracking) / 100) *
  10 ** (region.gainDb / 20);
