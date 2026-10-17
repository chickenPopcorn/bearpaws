export interface PianoSoundSettings {
  ambience: number;
}

export const DEFAULT_PIANO_SOUND: Readonly<PianoSoundSettings> = {
  ambience: 0.22,
};

export function normalizePianoSound(value: unknown): PianoSoundSettings {
  const settings = (
    value && typeof value === "object" ? value : {}
  ) as Partial<PianoSoundSettings>;
  return {
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
const NATURAL_COMPRESSOR = {
  threshold: -14,
  knee: 18,
  ratio: 1.65,
  attack: 0.012,
  release: 0.32,
};
/** A fast limiter after the room mix, so the summed output cannot clip. */
const SAFETY_LIMITER: typeof NATURAL_COMPRESSOR = {
  threshold: -3,
  knee: 0,
  ratio: 20,
  attack: 0.001,
  release: 0.08,
};
function configure(
  node: DynamicsCompressorNode,
  settings: typeof NATURAL_COMPRESSOR,
) {
  for (const key of Object.keys(settings) as (keyof typeof settings)[])
    node[key].value = settings[key];
}
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
    const impulse = createRoomImpulse(context);
    const makeConvolver = () => {
      const node = context.createConvolver();
      node.normalize = false;
      node.buffer = impulse;
      node.connect(wet);
      return node;
    };
    convolver = makeConvolver();
    compressor.connect(dry).connect(safety);
    compressor.connect(convolver);
    wet.connect(safety);
    safety.connect(master).connect(context.destination);
    configure(compressor, NATURAL_COMPRESSOR);
    configure(safety, SAFETY_LIMITER);
    dry.gain.value = 1;
    master.gain.value = 0.92;

    const update = (settings: PianoSoundSettings, immediate: boolean) => {
      const sound = normalizePianoSound(settings);
      const target = sound.ambience * 0.7;
      if (immediate) wet.gain.value = target;
      else {
        const now = context.currentTime;
        if (wet.gain.cancelAndHoldAtTime) wet.gain.cancelAndHoldAtTime(now);
        else {
          wet.gain.cancelScheduledValues(now);
          wet.gain.setValueAtTime(wet.gain.value, now);
        }
        wet.gain.setTargetAtTime(target, now, SMOOTH_SECONDS);
      }
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
