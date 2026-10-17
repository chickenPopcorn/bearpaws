export type PianoSoundProfile = "natural" | "original";

export interface PianoSoundSettings {
  profile: PianoSoundProfile;
  ambience: number;
}

export const DEFAULT_PIANO_SOUND: Readonly<PianoSoundSettings> = {
  profile: "natural",
  ambience: 0.22,
};

export function normalizePianoSound(value: unknown): PianoSoundSettings {
  const settings = (
    value && typeof value === "object" ? value : {}
  ) as Partial<PianoSoundSettings>;
  return {
    profile: settings.profile === "original" ? "original" : "natural",
    ambience:
      typeof settings.ambience === "number" &&
      Number.isFinite(settings.ambience)
        ? Math.max(0, Math.min(1, settings.ambience))
        : DEFAULT_PIANO_SOUND.ambience,
  };
}

export const ROOM_IMPULSE_SECONDS = 1.35;

/** A small synthetic stereo room, not recorded piano/pedal resonance. */
export function createRoomImpulse(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.ceil(rate * ROOM_IMPULSE_SECONDS);
  const impulse = context.createBuffer(2, length, rate);
  const reflections = [
    [
      [0.012, 0.42],
      [0.026, 0.27],
      [0.043, -0.19],
      [0.068, 0.13],
    ],
    [
      [0.017, 0.4],
      [0.031, -0.25],
      [0.049, 0.2],
      [0.073, 0.14],
    ],
  ];
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    let seed = 0x6d2b79f5 ^ (channel * 0x9e3779b9);
    let filtered = 0;
    let energy = 0;
    const filter = 1 - Math.exp((-2 * Math.PI * 3200) / rate);
    // The late field starts gently and is low-pass filtered so the room does
    // not add a bright, noisy halo to the piano's recorded attack.
    for (let frame = Math.ceil(rate * 0.028); frame < length; frame++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const noise = ((seed >>> 0) / 0x100000000) * 2 - 1;
      filtered += filter * (noise - filtered);
      const time = frame / rate;
      const attack = Math.min(1, (time - 0.028) / 0.04);
      const end = Math.min(1, (length - 1 - frame) / (rate * 0.03));
      const value = filtered * attack * Math.exp(-6.3 * time) * end;
      samples[frame] = value;
      energy += value * value;
    }
    // Fixed energy makes the wet level stable across sample rates. Browser
    // convolver auto-normalization is disabled so it cannot change this mix.
    const scale = Math.sqrt(0.22 / energy);
    for (let frame = 0; frame < length; frame++) samples[frame] *= scale;
    for (const [time, level] of reflections[channel])
      samples[Math.round(time * rate)] += level;
  }
  return impulse;
}

const SMOOTH_SECONDS = 0.04;
const PROFILE_FADE_SECONDS = 0.08;
const NATURAL_COMPRESSOR = {
  threshold: -14,
  knee: 18,
  ratio: 1.65,
  attack: 0.012,
  release: 0.32,
};
const ORIGINAL_COMPRESSOR = {
  threshold: -10,
  knee: 12,
  ratio: 4,
  attack: 0.003,
  release: 0.25,
};

export interface PianoSoundBus {
  input: AudioNode;
  setSound(settings: PianoSoundSettings): void;
  reset(): void;
  dispose(): void;
}

/** Shared processing; individual notes still allocate only a source and gain. */
export function createPianoSoundBus(
  context: AudioContext,
  initial: PianoSoundSettings,
): PianoSoundBus {
  const nodes: AudioNode[] = [];
  let convolver: ConvolverNode | null = null;
  const remember = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };
  const dispose = () => {
    for (const node of nodes) node.disconnect();
    convolver?.disconnect();
  };
  try {
    const compressor = remember(context.createDynamicsCompressor());
    const dry = remember(context.createGain());
    const wet = remember(context.createGain());
    const safety = remember(context.createDynamicsCompressor());
    const master = remember(context.createGain());
    const original = remember(context.createGain());
    const impulse = createRoomImpulse(context);
    const makeConvolver = () => {
      const node = context.createConvolver();
      try {
        node.normalize = false;
        node.buffer = impulse;
        node.connect(wet);
        return node;
      } catch (error) {
        node.disconnect();
        throw error;
      }
    };
    convolver = makeConvolver();
    compressor.connect(dry).connect(safety);
    compressor.connect(convolver);
    wet.connect(safety);
    safety.connect(master).connect(context.destination);
    // Web Audio compressors add 6ms of lookahead even at a 1:1 ratio. Original
    // keeps the previous single-compressor delay; only Natural adds the second.
    compressor.connect(original).connect(context.destination);
    safety.threshold.value = -3;
    safety.knee.value = 0;
    safety.ratio.value = 20;
    safety.attack.value = 0.001;
    safety.release.value = 0.08;

    const update = (settings: PianoSoundSettings, immediate: boolean) => {
      const sound = normalizePianoSound(settings);
      const natural = sound.profile === "natural";
      const target = natural ? NATURAL_COMPRESSOR : ORIGINAL_COMPRESSOR;
      const set = (param: AudioParam, value: number, fade = false) => {
        if (immediate) {
          param.value = value;
          return;
        }
        const now = context.currentTime;
        if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
        else {
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
        }
        if (fade)
          param.linearRampToValueAtTime(value, now + PROFILE_FADE_SECONDS);
        else param.setTargetAtTime(value, now, SMOOTH_SECONDS);
      };
      for (const key of Object.keys(target) as (keyof typeof target)[])
        set(compressor[key], target[key]);
      set(dry.gain, 1);
      set(wet.gain, natural ? sound.ambience * 0.7 : 0);
      // Natural keeps post-mix peak protection. Finite crossfades reach exact
      // zero so Original has no residual sound from the delayed safety path.
      set(master.gain, natural ? 0.92 : 0, true);
      set(original.gain, natural ? 0 : 1, true);
    };
    update(initial, true);
    return {
      input: compressor,
      setSound: (settings) => update(settings, false),
      reset: () => {
        // Reusing the impulse avoids regenerating it. A fresh processor flushes
        // the old room tail after a stop, seek or song change.
        if (convolver) {
          compressor.disconnect(convolver);
          convolver.disconnect();
          convolver = null;
        }
        convolver = makeConvolver();
        compressor.connect(convolver);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
