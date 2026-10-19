import data from "../public/audio/accurate-salamander/manifest.json";
import { midiVelocity, pianoKey, pianoLevel } from "./piano";
import type { PianoVoice, PianoVoices } from "./pianoSound";
import type { Note, PedalSpan } from "./song";
import { lastIndexAtOrBefore } from "./timeline";

/** One region of a voice the preset leaves off, as the import script records it. */
export interface PianoVoiceRegion {
  voice: PianoVoice;
  /** The SFZ group number. */
  group: number;
  /** "release" needs the pedal up at key-up; "release_key" sounds at every key-up. */
  trigger: "attack" | "release" | "release_key" | "pedalDown" | "pedalUp";
  /** The pedal a key-triggered region needs when it triggers, if any. */
  pedal: "down" | "up" | null;
  pitchMin: number;
  pitchMax: number;
  velocityMin: number;
  velocityMax: number;
  /** The share of random draws that pick this region (lorand/hirand). */
  randomMin: number;
  randomMax: number;
  file: string;
  /** The key the recording sounds at; null plays it at its own pitch. */
  rootPitch: number | null;
  tune: number;
  offset: number;
  gainDb: number;
  attackSeconds: number;
  releaseSeconds: number;
  /** How fast the next pedal change silences pedal noise (off_time). */
  cutSeconds: number;
  /** rt_decay: decibels lost per second the key was held. */
  decayDbPerSecond: number;
}
interface PianoVoiceGroup {
  label: string;
  controller: number;
  /**
   * The level the controller removes at its lowest enabled value. The app
   * plays each enabled voice at 127, where upstream removes nothing.
   */
  controllerGainDb: number;
  regions: PianoVoiceRegion[];
}
export const PIANO_VOICE_GROUPS = data.optionalVoices as unknown as Record<
  PianoVoice,
  PianoVoiceGroup
>;
/** Quieter voices are not worth a voice (-80 dB). */
export const MIN_PIANO_VOICE_LEVEL = 1e-4;

export interface PianoVoiceEvent {
  /** Pass ids: one for each note, or pedal change, this voice sounds for. */
  ids: string[];
  /** The ids of the notes it sounds for. */
  notes: string[];
  region: PianoVoiceRegion;
  pitch: number;
  velocity: number;
  /** Song time of the trigger. */
  time: number;
  /**
   * Song time at which a resonance or pedal-noise voice is damped. Release
   * and key noise play their recording to its end: Infinity.
   */
  songEnd: number;
  /** How long the key was held, in song seconds, for rt_decay. */
  held: number;
}

/**
 * Whether a region sounds as a key or the pedal comes up. Such a voice still
 * belongs to a loop pass that ends at that instant.
 */
export const liftTriggered = (region: PianoVoiceRegion) =>
  region.trigger === "release" ||
  region.trigger === "release_key" ||
  region.trigger === "pedalUp";

/**
 * Every region of `voice` that a key at this pitch and velocity triggers. A
 * pitch beyond the piano uses its nearest key, as its note does.
 */
export function pianoVoiceRegions(
  voice: PianoVoice,
  pitch: number,
  velocity: number,
) {
  const value = midiVelocity(velocity),
    key = pianoKey(pitch);
  return PIANO_VOICE_GROUPS[voice].regions.filter(
    (region) =>
      key >= region.pitchMin &&
      key <= region.pitchMax &&
      value >= region.velocityMin &&
      value <= region.velocityMax,
  );
}

/** The pedal noise for a pedal change, chosen by a draw in [0, 1). */
export function pedalNoiseRegion(down: boolean, draw: number) {
  const trigger = down ? "pedalDown" : "pedalUp";
  return PIANO_VOICE_GROUPS.pedalNoise.regions.find(
    (region) =>
      region.trigger === trigger &&
      draw >= region.randomMin &&
      (draw < region.randomMax || region.randomMax >= 1),
  )!;
}

/**
 * Gain of an optional voice: the preset's velocity curve, the group's volume
 * and, for release triggers, rt_decay over the time the key was held. Pedal
 * noise has no key velocity, so it plays at its group volume.
 */
export function pianoVoiceLevel(event: PianoVoiceEvent, heldSeconds: number) {
  const { region } = event;
  return pianoLevel(
    {
      gainDb:
        region.gainDb - region.decayDbPerSecond * Math.max(0, heldSeconds),
    },
    region.voice === "pedalNoise" ? 1 : event.velocity,
  );
}

/**
 * A draw in [0, 1) for the pedal change at `index`, without a random
 * source: successive presses, and successive lifts, take turns between
 * their two recordings.
 */
const draw = (index: number) => (index % 2 ? 0.75 : 0.25);

/** Merge every channel's pedal into one foot pedal. */
function footPedal(spans: readonly PedalSpan[]) {
  const merged: {
    start: number;
    end: number;
    open: boolean;
    /** The channels whose presses end where this one does. */
    lifting: Set<number>;
  }[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1),
      open = !!span.open;
    // One channel's lift and press at one instant are both kept, but a
    // press that another channel takes over at that instant is not lifted.
    if (
      !last ||
      span.start > last.end ||
      (span.start === last.end && last.lifting.has(span.channel))
    )
      merged.push({
        start: span.start,
        end: span.end,
        open,
        lifting: new Set([span.channel]),
      });
    else if (span.end > last.end)
      Object.assign(last, {
        end: span.end,
        open,
        lifting: new Set([span.channel]),
      });
    else if (span.end === last.end) {
      // The foot pedal stays down while any channel is still down.
      last.open ||= open;
      last.lifting.add(span.channel);
    }
  }
  return merged;
}

/**
 * The optional voices a passage triggers, in time order, following the
 * preset's rules:
 * - sampled release sounds at key-up only while the pedal is up, which is
 *   when a note's sound ends with its key;
 * - key release noise sounds at every key-up, pedal or not (release_key);
 * - pedal noise sounds at every pedal press and lift, and the next change
 *   silences it (off_by);
 * - resonance doubles a note struck with the pedal down, from neighbouring
 *   strings' recordings, and is damped with the note.
 * Duplicate tracks that strike or release a key together trigger one voice.
 */
export function pianoVoiceEvents(
  notes: readonly Note[],
  pedals: readonly PedalSpan[] = [],
): PianoVoiceEvent[] {
  const byChannel = new Map<number, PedalSpan[]>();
  for (const span of pedals) {
    const list = byChannel.get(span.channel) ?? [];
    list.push(span);
    byChannel.set(span.channel, list);
  }
  /** A pedal still down where the file ends is down at its last instant too. */
  const pedalDown = (channel: number, time: number) => {
    const list = byChannel.get(channel) ?? [];
    const span = list[lastIndexAtOrBefore(list, "start", time)];
    return !!span && (time < span.end || (!!span.open && time === span.end));
  };
  const events = new Map<string, PianoVoiceEvent>();
  const trigger = (
    voice: PianoVoice,
    note: Note,
    time: number,
    songEnd: number,
  ) => {
    const regions = pianoVoiceRegions(voice, note.pitch, note.velocity);
    regions.forEach((region, index) => {
      const key = `${voice}:${index}:${note.pitch}:${time}`;
      const previous = events.get(key);
      const id = `${note.id}~${voice}~${index}`;
      if (!previous)
        events.set(key, {
          ids: [id],
          notes: [note.id],
          region,
          pitch: note.pitch,
          velocity: note.velocity,
          time,
          songEnd,
          held: note.end - note.start,
        });
      else {
        previous.ids.push(id);
        previous.notes.push(note.id);
        previous.songEnd = Math.max(previous.songEnd, songEnd);
        // A louder duplicate picks the region, as for the note itself.
        if (note.velocity > previous.velocity) {
          previous.velocity = note.velocity;
          previous.region = region;
        }
        previous.held = Math.min(previous.held, note.end - note.start);
      }
    });
  };
  // Duplicate tracks that strike a key together sound as one note, as the
  // player strikes them, so its key comes up only when the last does.
  const strikes = new Map<
    string,
    {
      end: number;
      soundEnd: number;
      /** The channels of the duplicates whose keys come up last. */
      releasing: number[];
    }
  >();
  for (const note of notes) {
    if (note.velocity <= 0) continue;
    const key = `${note.pitch}:${note.start}`,
      strike = strikes.get(key);
    if (!strike || note.end > strike.end)
      strikes.set(key, {
        end: note.end,
        soundEnd: Math.max(strike?.soundEnd ?? -Infinity, note.soundEnd),
        releasing: [note.channel],
      });
    else {
      strike.soundEnd = Math.max(strike.soundEnd, note.soundEnd);
      if (note.end === strike.end) strike.releasing.push(note.channel);
    }
  }
  for (const note of notes) {
    if (note.velocity <= 0) continue;
    const { end, soundEnd, releasing } = strikes.get(
        `${note.pitch}:${note.start}`,
      )!,
      released = { ...note, end };
    trigger("keyNoise", released, end, Infinity);
    // Only the pedal on a key that comes up then can hold its dampers off.
    if (
      soundEnd <= end &&
      !releasing.some((channel) => pedalDown(channel, end))
    )
      trigger("release", released, end, Infinity);
    if (pedalDown(note.channel, note.start))
      trigger("resonance", note, note.start, note.soundEnd);
  }
  const channels = new Set(notes.map((note) => note.channel));
  const presses = footPedal(
    pedals.filter((span) => channels.has(span.channel)),
  );
  presses.forEach((press, index) => {
    const next = presses[index + 1]?.start ?? Infinity;
    for (const [down, time, songEnd] of [
      // A press still down where the file ends rings out.
      [true, press.start, press.open ? Infinity : press.end],
      [false, press.end, next],
    ] as const) {
      // A file that ends with the pedal down has no lift to sound.
      if (!down && press.open) continue;
      events.set(`pedal:${index}:${down}`, {
        ids: [`pedal~${index}~${down ? "down" : "up"}`],
        notes: [],
        region: pedalNoiseRegion(down, draw(index)),
        pitch: 60,
        velocity: 1,
        time,
        songEnd,
        held: 0,
      });
    }
  });
  return [...events.values()].sort((a, b) => a.time - b.time);
}

/**
 * The recordings these events need for the enabled voices, smallest kinds
 * first, so that the recordings that fit within the cache are the ones that
 * serve the most voices.
 */
export function pianoVoiceFiles(
  events: readonly PianoVoiceEvent[],
  enabled: PianoVoices,
) {
  const order: PianoVoice[] = [
    "keyNoise",
    "pedalNoise",
    "release",
    "resonance",
  ];
  return [
    ...new Set(
      order.flatMap((voice) =>
        enabled[voice]
          ? events
              .filter((event) => event.region.voice === voice)
              .map((event) => event.region.file)
          : [],
      ),
    ),
  ];
}
