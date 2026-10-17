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

export function selectPianoRegion(pitch: number, velocity: number) {
  if (!Number.isFinite(pitch) || !Number.isFinite(velocity)) return;
  const midiVelocity = Math.round(Math.max(0, Math.min(1, velocity)) * 127);
  return keys
    .get(Math.max(21, Math.min(108, Math.round(pitch))))
    ?.find(
      (region) =>
        midiVelocity >= region.velocityMin &&
        midiVelocity <= region.velocityMax,
    );
}

export const pianoPlaybackRate = (region: PianoRegion, pitch: number) =>
  2 ** ((pitch - region.rootPitch + region.tune / 100) / 12);

// The source WAVs are normalized; retain the preset's velocity response and
// per-key compensation rather than applying an unrelated second gain curve.
export const pianoLevel = (region: PianoRegion, velocity: number) =>
  0.7 *
  Math.max(0, Math.min(1, velocity)) **
    ((2 * data.amplitudeVelocityTracking) / 100) *
  10 ** (region.gainDb / 20);
