import { parseMidi } from "midi-file";
export type Hand = "left" | "right" | "off";
export interface Note {
  id: string;
  pitch: number;
  velocity: number;
  start: number;
  end: number;
  soundEnd: number;
  track: number;
  channel: number;
}
export interface Track {
  id: number;
  name: string;
  hand: Hand;
  count: number;
}
export interface Tempo {
  tick: number;
  microseconds: number;
}
export interface Song {
  id: string;
  title: string;
  notes: Note[];
  tracks: Track[];
  duration: number;
  tempos: Tempo[];
  ppq: number;
  warnings: string[];
}
const MAX_NOTES = 50000;
const MAX_EVENTS = 500000;
const MAX_TRACKS = 256;
const NOTE_LIMIT_MESSAGE =
  "This MIDI file has more than 50,000 notes. Export a smaller passage for practice.";

/** Count attacks without constructing parser events or normalized notes. */
function preflightTrack(
  bytes: Uint8Array,
  start: number,
  end: number,
  budget: { notes: number; events: number },
) {
  let cursor = start,
    runningStatus = 0,
    tick = 0;
  const malformed = () =>
    new Error("This MIDI file has malformed or incomplete track events.");
  const byte = () => {
    if (cursor >= end) throw malformed();
    return bytes[cursor++];
  };
  const variable = () => {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = byte();
      value = value * 128 + (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw malformed();
  };
  while (cursor < end) {
    if (++budget.events > MAX_EVENTS)
      throw new Error(
        "This MIDI file has more than 500,000 events. Export a smaller passage for practice.",
      );
    tick += variable();
    if (!Number.isSafeInteger(tick) || tick > 2 ** 40)
      throw new Error("MIDI timeline is too long.");
    let status = byte();
    let first: number | undefined;
    if (status < 0x80) {
      if (!runningStatus) throw malformed();
      first = status;
      status = runningStatus;
    } else if (status < 0xf0) {
      runningStatus = status;
    } else {
      // SMF SysEx and meta messages have explicit variable-length payloads.
      if (status === 0xff) byte();
      else {
        if (status !== 0xf0 && status !== 0xf7) throw malformed();
        runningStatus = 0;
      }
      const length = variable();
      if (length > end - cursor) throw malformed();
      cursor += length;
      continue;
    }
    first ??= byte();
    const type = status >> 4;
    const second = type === 0xc || type === 0xd ? undefined : byte();
    if (first >= 0x80 || (second !== undefined && second >= 0x80))
      throw malformed();
    if (type === 0x9 && second! > 0 && ++budget.notes > MAX_NOTES)
      throw new Error(NOTE_LIMIT_MESSAGE);
  }
}

export function tempoConverter(ppq: number, changes: Tempo[]) {
  const sorted = [{ tick: 0, microseconds: 500000 }, ...changes].sort(
    (a, b) => a.tick - b.tick,
  );
  const segments: { tick: number; microseconds: number; seconds: number }[] =
    [];
  let seconds = 0,
    last = 0,
    tempo = 500000;
  for (const t of sorted) {
    seconds += ((t.tick - last) * tempo) / ppq / 1e6;
    segments.push({ ...t, seconds });
    last = t.tick;
    tempo = t.microseconds;
  }
  return (tick: number) => {
    let lo = 0,
      hi = segments.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (segments[m].tick <= tick) lo = m + 1;
      else hi = m;
    }
    const s = segments[Math.max(0, lo - 1)];
    return s.seconds + ((tick - s.tick) * s.microseconds) / ppq / 1e6;
  };
}
export function parseSong(bytes: Uint8Array, title: string, id: string): Song {
  if (bytes.length > 10 * 1024 * 1024)
    throw new Error("Please choose a MIDI file smaller than 10 MB.");
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "MThd")
    throw new Error("This is not a standard MIDI file (.mid).");
  // Validate chunk boundaries because permissive parsers may accept a truncated header.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 14 || view.getUint32(4) !== 6)
    throw new Error("This MIDI file is malformed or incomplete.");
  const declaredTracks = view.getUint16(10);
  if (declaredTracks > MAX_TRACKS)
    throw new Error(
      "This MIDI file has more than 256 tracks. Export a smaller selection of tracks for practice.",
    );
  let offset = 14;
  const budget = { notes: 0, events: 0 };
  for (let i = 0; i < declaredTracks; i++) {
    if (
      offset + 8 > bytes.length ||
      String.fromCharCode(...bytes.slice(offset, offset + 4)) !== "MTrk"
    )
      throw new Error("This MIDI file has a missing or malformed track.");
    const size = view.getUint32(offset + 4);
    const start = offset + 8;
    offset = start + size;
    if (offset > bytes.length)
      throw new Error("This MIDI file has an incomplete track.");
    preflightTrack(bytes, start, offset, budget);
  }
  if (!declaredTracks) throw new Error("This MIDI file has no tracks.");
  let midi;
  try {
    midi = parseMidi(bytes);
  } catch {
    throw new Error(
      "This MIDI file is malformed or incomplete. Try exporting it again.",
    );
  }
  if (midi.header.format === 2)
    throw new Error(
      "MIDI format 2 uses independent timelines. Export as format 0 or 1.",
    );
  if (midi.header.format !== 0 && midi.header.format !== 1)
    throw new Error("Unsupported MIDI format. Export as format 0 or 1.");
  if (midi.header.format === 0 && declaredTracks !== 1)
    throw new Error("A format 0 MIDI file must contain one track.");
  const ppq = midi.header.ticksPerBeat;
  if (!ppq)
    throw new Error(
      "SMPTE time division is not supported. Export with ticks per beat.",
    );
  const tempos: Tempo[] = [];
  const warnings: string[] = [];
  const events = midi.tracks.map((track) => {
    let tick = 0;
    return track.map((e) => {
      if (!Number.isInteger(e.deltaTime) || e.deltaTime < 0)
        throw new Error("Malformed MIDI event timing.");
      tick += e.deltaTime;
      if (!Number.isSafeInteger(tick) || tick > 2 ** 40)
        throw new Error("MIDI timeline is too long.");
      if (e.type === "noteOn" || e.type === "noteOff") {
        if (
          !Number.isInteger(e.noteNumber) ||
          e.noteNumber < 0 ||
          e.noteNumber > 127 ||
          e.velocity < 0 ||
          e.velocity > 127
        )
          throw new Error("Malformed MIDI note data.");
      }
      if (e.type === "setTempo") {
        if (e.microsecondsPerBeat <= 0) throw new Error("Invalid MIDI tempo.");
        tempos.push({ tick, microseconds: e.microsecondsPerBeat });
      }
      return { e, tick };
    });
  });
  const time = tempoConverter(ppq, tempos);
  const notes: Note[] = [];
  const tracks = events.map((events, track) => {
    const active = new Map<
      string,
      { entries: { tick: number; velocity: number }[]; head: number }
    >();
    let count = 0;
    for (const { e, tick } of events) {
      if (e.type !== "noteOn" && e.type !== "noteOff") continue;
      const key = `${e.channel}:${e.noteNumber}`;
      if (e.type === "noteOn" && e.velocity > 0) {
        const q = active.get(key) || { entries: [], head: 0 };
        q.entries.push({ tick, velocity: e.velocity / 127 });
        active.set(key, q);
      } else {
        const q = active.get(key);
        if (!q || q.head >= q.entries.length) {
          warnings.push("Unpaired note-off ignored.");
          continue;
        }
        const first = q.entries[q.head++];
        if (q.head === q.entries.length) active.delete(key);
        if (notes.length >= MAX_NOTES) throw new Error(NOTE_LIMIT_MESSAGE);
        const n: Note = {
          id: `${track}-${count++}`,
          pitch: e.noteNumber,
          channel: e.channel,
          velocity: first.velocity,
          start: time(first.tick),
          end: time(tick),
          soundEnd: time(tick),
          track,
        };
        notes.push(n);
      }
    }
    const last = events.at(-1)?.tick || 0;
    for (const [key, q] of active)
      for (let i = q.head; i < q.entries.length; i++) {
        const n = q.entries[i];
        if (notes.length >= MAX_NOTES) throw new Error(NOTE_LIMIT_MESSAGE);
        const [channel, pitch] = key.split(":").map(Number);
        notes.push({
          id: `${track}-${count++}`,
          pitch,
          channel,
          velocity: n.velocity,
          start: time(n.tick),
          end: time(Math.max(last, n.tick + ppq / 4)),
          soundEnd: time(Math.max(last, n.tick + ppq / 4)),
          track,
        });
        warnings.push("Unclosed note ended at track boundary.");
      }
    const name = events.find((x) => x.e.type === "trackName")?.e;
    return {
      id: track,
      name:
        name?.type === "trackName"
          ? name.text.slice(0, 160)
          : `Track ${track + 1}`,
      hand: "off" as Hand,
      count,
    };
  });
  // Controllers are channel-wide in SMF, even when a different track owns them.
  const intervals = new Map<number, { start: number; end: number }[]>(),
    down = new Map<number, number>();
  const controls = events
    .flat()
    .filter((x) => x.e.type === "controller" && x.e.controllerType === 64)
    .sort((a, b) => a.tick - b.tick);
  const lastTick = events.reduce(
    (last, track) => Math.max(last, track.at(-1)?.tick || 0),
    0,
  );
  for (const { e, tick } of controls) {
    if (e.type !== "controller") continue;
    if (e.value >= 64) {
      if (!down.has(e.channel)) down.set(e.channel, time(tick));
    } else if (down.has(e.channel)) {
      const list = intervals.get(e.channel) || [];
      list.push({ start: down.get(e.channel)!, end: time(tick) });
      intervals.set(e.channel, list);
      down.delete(e.channel);
    }
  }
  for (const [channel, start] of down) {
    const list = intervals.get(channel) || [];
    list.push({ start, end: time(lastTick) });
    intervals.set(channel, list);
  }
  for (const n of notes) {
    n.soundEnd = n.end;
    const list = intervals.get(n.channel) || [];
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (list[m].start <= n.end) lo = m + 1;
      else hi = m;
    }
    const interval = list[lo - 1];
    if (interval && n.end < interval.end) n.soundEnd = interval.end;
  }
  if (!notes.length)
    throw new Error("No playable notes were found in this MIDI file.");
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const playable = tracks.filter((t) => t.count);
  if (playable.length === 1) playable[0].hand = "right";
  return {
    id,
    title,
    notes,
    tracks,
    duration: Math.max(...notes.map((n) => n.soundEnd)) + 0.5,
    tempos,
    ppq,
    warnings: [...new Set(warnings)],
  };
}
export function exampleSong(): Song {
  const notes: Note[] = [];
  let id = 0;
  const add = (pitch: number, start: number, duration: number, track: number) =>
    notes.push({
      id: `ex-${id++}`,
      pitch,
      start,
      end: start + duration,
      soundEnd: start + duration,
      velocity: 0.7,
      channel: track,
      track,
    });
  // Original exercise: four slow chord changes, then a repeated-note melody.
  [
    [60, 64, 67],
    [60, 65, 69],
    [59, 62, 67],
    [60, 64, 67],
  ].forEach((chord, i) => {
    chord.forEach((p) => add(p, 1 + i * 2, 0.95, 1));
    add([48, 53, 55, 48][i], 1 + i * 2, 1.7, 0);
  });
  [60, 60, 62, 64, 65, 64, 62, 60].forEach((p, i) =>
    add(p, 9 + i * 0.75, 0.55, 1),
  );
  [48, 53, 55, 48].forEach((p, i) => add(p, 9 + i * 1.5, 1.2, 0));
  return {
    id: "cadence-first-steps-v1",
    title: "First steps",
    notes: notes.sort((a, b) => a.start - b.start),
    duration: 15.5,
    tracks: [
      { id: 0, name: "Left · steady foundations", hand: "left", count: 8 },
      { id: 1, name: "Right · chords & melody", hand: "right", count: 20 },
    ],
    tempos: [{ tick: 0, microseconds: 750000 }],
    ppq: 480,
    warnings: [],
  };
}
export const noteName = (n: number) =>
  ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][n % 12] +
  (Math.floor(n / 12) - 1);
