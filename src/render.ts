import { tempoConverter, noteName, type Note, type Song } from "./song";
import type { MidiState, Practice } from "./engine";
const ranges = new WeakMap<Song, [number, number]>();
const beatTimelines = new WeakMap<
  Song,
  { converter: ReturnType<typeof tempoConverter>; tickLimit: number }
>();
export const rightColor = "#a086e9",
  leftColor = "#51b3a5";
export const black = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);
export function keyLayout(min: number, max: number) {
  const whites: number[] = [];
  for (let p = min; p <= max; p++) if (!black(p)) whites.push(p);
  return Array.from({ length: max - min + 1 }, (_, i) => {
    const pitch = min + i;
    const b = black(pitch),
      index = b ? whites.indexOf(pitch - 1) : whites.indexOf(pitch);
    return {
      pitch,
      black: b,
      x: (index + (b ? 0.68 : 0)) / whites.length,
      width: (b ? 0.64 : 1) / whites.length,
    };
  });
}
export function range(song: Song): [number, number] {
  const cached = ranges.get(song);
  if (cached) return cached;
  let lo = 48,
    hi = 84;
  for (const note of song.notes) {
    lo = Math.min(lo, note.pitch);
    hi = Math.max(hi, note.pitch);
  }
  const result: [number, number] = [
    Math.max(0, Math.floor(lo / 12) * 12),
    Math.min(127, Math.ceil(hi / 12) * 12),
  ];
  ranges.set(song, result);
  return result;
}
export function draw(
  canvas: HTMLCanvasElement,
  song: Song,
  notes: Note[],
  position: number,
  input: MidiState,
  practice: Practice,
  names: boolean,
  waiting: boolean,
  listen: boolean,
) {
  const rect = canvas.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1,
    width = rect.width,
    height = rect.height;
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const c = canvas.getContext("2d");
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const keyHeight = 100,
    fall = height - keyHeight,
    px = fall / 5,
    [min, max] = range(song),
    keys = keyLayout(min, max),
    geometry = new Map(keys.map((k) => [k.pitch, k]));
  c.fillStyle = "#eeedf5";
  c.fillRect(0, 0, width, fall);
  for (const k of keys)
    if (!k.black) {
      c.strokeStyle = k.pitch % 12 === 0 ? "#cfccdf" : "#e2dfec";
      c.beginPath();
      c.moveTo(k.x * width, 0);
      c.lineTo(k.x * width, fall);
      c.stroke();
    }
  // Beat grid follows the actual tempo map, including changes.
  let timeline = beatTimelines.get(song);
  if (!timeline) {
    const tempos = song.tempos;
    let minimumTempo = 500000;
    for (const tempo of tempos)
      minimumTempo = Math.min(minimumTempo, tempo.microseconds);
    timeline = {
      converter: tempoConverter(song.ppq, tempos),
      tickLimit: Math.ceil((song.duration * song.ppq * 1e6) / minimumTempo),
    };
    beatTimelines.set(song, timeline);
  }
  const { converter, tickLimit } = timeline;
  // A bounded binary search locates the visible beat even in a long imported song.
  let low = 0,
    high = tickLimit;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (converter(mid) < position) low = mid + 1;
    else high = mid;
  }
  let beat = Math.floor(low / song.ppq);
  for (let i = 0; i < 128; i++, beat++) {
    const t = converter(beat * song.ppq);
    if (t > position + 5) break;
    const y = fall - (t - position) * px;
    c.strokeStyle = beat % 4 === 0 ? "#d5d1e3" : "#e3e0ed";
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(width, y);
    c.stroke();
    if (beat % 4 === 0) {
      c.fillStyle = "#777287";
      c.font = "10px system-ui";
      c.fillText("beat " + String(beat + 1), 7, y - 5);
    }
  }
  const expected = waiting ? practice.gate?.notes : [];
  const hands = new Map(song.tracks.map((track) => [track.id, track.hand]));
  const reference = new Map<number, Note>();
  const targets = new Map((expected || []).map((note) => [note.pitch, note]));
  c.save();
  c.beginPath();
  c.rect(0, 0, width, fall);
  c.clip();
  for (const n of notes) {
    if (
      listen &&
      n.start <= position &&
      n.soundEnd > position &&
      !reference.has(n.pitch)
    )
      reference.set(n.pitch, n);
    const k = geometry.get(n.pitch);
    if (!k || n.end < position || n.start > position + 5) continue;
    const hand = hands.get(n.track);
    const color = hand === "left" ? leftColor : rightColor;
    const h = Math.max(8, (n.end - n.start) * px),
      y = fall - (n.start - position) * px - h,
      x = k.x * width + 2,
      w = Math.max(3, k.width * width - 4);
    c.fillStyle = practice.missed.has(n.id) ? "#d79883" : color;
    c.globalAlpha = practice.hit.has(n.id) ? 0.55 : 1;
    c.beginPath();
    c.roundRect(x, y, w, h, 4);
    c.fill();
    c.globalAlpha = 1;
    if (expected?.some((e) => e.id === n.id)) {
      c.strokeStyle = "#7354cf";
      c.lineWidth = 2;
      c.stroke();
    }
    if (names && w > 18) {
      c.fillStyle = "#262232";
      c.font = "10px system-ui";
      c.textAlign = "center";
      c.fillText(
        noteName(n.pitch).replace(/-?\d+$/, ""),
        x + w / 2,
        Math.min(fall - 8, y + h - 9),
      );
    }
  }
  c.restore();
  const drawKey = (k: ReturnType<typeof keyLayout>[number]) => {
    const x = k.x * width,
      w = k.width * width,
      h = k.black ? 63 : keyHeight;
    const ref = reference.get(k.pitch);
    const target = targets.get(k.pitch);
    const hand = hands.get((ref || target)?.track ?? -1);
    const color = hand === "left" ? leftColor : rightColor;
    c.fillStyle = input.down.has(k.pitch)
      ? "#7354cf"
      : ref
        ? color
        : k.black
          ? "#292634"
          : "#fcfbff";
    c.fillRect(x, fall, w, h);
    c.strokeStyle = k.black ? "#201c29" : "#cfcbdc";
    c.lineWidth = 1;
    c.strokeRect(x, fall, w, h);
    if (target && !input.down.has(k.pitch)) {
      c.fillStyle = color;
      c.globalAlpha = 0.5;
      c.fillRect(x + 1, fall, w - 2, 8);
      c.globalAlpha = 1;
    }
    if (input.sounding.has(k.pitch) && !input.down.has(k.pitch)) {
      c.fillStyle = "#51b3a5";
      c.beginPath();
      c.arc(x + w / 2, fall + h - 14, 3, 0, Math.PI * 2);
      c.fill();
    }
    if (!k.black && k.pitch % 12 === 0 && w > 12) {
      c.fillStyle = input.down.has(k.pitch) ? "#fff" : "#777287";
      c.font = "10px system-ui";
      c.textAlign = "center";
      c.fillText(noteName(k.pitch), x + w / 2, fall + h - 14);
    }
  };
  keys.filter((k) => !k.black).forEach(drawKey);
  keys.filter((k) => k.black).forEach(drawKey);
  c.strokeStyle = "#7354cf";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, fall);
  c.lineTo(width, fall);
  c.stroke();
}
