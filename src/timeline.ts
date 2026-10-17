import type { Tempo } from "./song";

/** Index of the last item whose `key` is at most `value`, or -1. Items are sorted by `key`. */
export function lastIndexAtOrBefore<K extends string>(
  items: readonly Record<K, number>[],
  key: K,
  value: number,
) {
  let low = 0,
    high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle][key] <= value) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** The MIDI tempo map in quarter-note beats, in both directions. */
export function createBeatClock(ppq: number, changes: Tempo[]) {
  const resolution = ppq > 0 ? ppq : 480;
  // SMF timing is 120 BPM until the first tempo event; later events at the same tick win.
  const sorted = [{ tick: 0, microseconds: 500000 }, ...changes].sort(
    (a, b) => a.tick - b.tick,
  );
  let seconds = 0,
    lastTick = 0,
    tempo = 500000;
  const segments = sorted.map((change) => {
    seconds += ((change.tick - lastTick) * tempo) / resolution / 1e6;
    lastTick = change.tick;
    tempo = change.microseconds;
    return {
      beat: change.tick / resolution,
      seconds,
      secondsPerBeat: change.microseconds / 1e6,
    };
  });
  const find = (value: number, key: "beat" | "seconds") =>
    segments[Math.max(0, lastIndexAtOrBefore(segments, key, value))];
  return {
    at(time: number) {
      const segment = find(time, "seconds");
      return segment.beat + (time - segment.seconds) / segment.secondsPerBeat;
    },
    time(beat: number) {
      const segment = find(beat, "beat");
      return segment.seconds + (beat - segment.beat) * segment.secondsPerBeat;
    },
  };
}
