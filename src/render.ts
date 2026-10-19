import { noteName, suggestedFinger, type Note, type Song } from "./song";
import type { Group, MidiState, Practice } from "./engine";
import { createMeterMap } from "./notation";
import { createBeatClock } from "./timeline";
const scoreFont = '"Libre Baskerville", Baskerville, Georgia, serif';
const ranges = new WeakMap<Song, [number, number]>(),
  duetRanges = new WeakMap<Song, [number, number]>();
const beatTimelines = new WeakMap<
  Song,
  {
    clock: ReturnType<typeof createBeatClock>;
    meter: ReturnType<typeof createMeterMap>;
  }
>();
const waitGroups = new WeakMap<
  Group,
  { ids: Set<string>; targets: Map<number, Note> }
>();
const selections = new WeakMap<Note[], Set<string>>();
/** Limit Canvas work on dense files; the full note set still drives practice and audio. */
export const MAX_VISIBLE_NOTES = 4096;
export const KEYBOARD_HEIGHT = 132;
export const BLACK_KEY_HEIGHT = 88;
/** Smallest finger number drawn on a note bar narrower than its usual label. */
const MIN_NARROW_LABEL = 9;
/** Smallest label size; a label that cannot fit at this size is left off. */
const MIN_LABEL = 7;
export const rightColor = "#a086e9",
  leftColor = "#51b3a5",
  /** The teacher duet, drawn faintly behind both hands. */
  duetColor = "#f2c12e",
  DUET_ALPHA = 0.25;
/** Darker hand colours for text on white keys, which the fills fail (2.5-3:1). */
const rightText = "#6a4bc6",
  leftText = "#22766a",
  labelColor = "#625c70";
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
      x: (index + (b ? 0.72 : 0)) / whites.length,
      width: (b ? 0.56 : 1) / whites.length,
    };
  });
}
/**
 * The keys to show: whole octaves around the notes, at least C3 to C6. With
 * `duet`, the keys reach just past the student's and the duet's notes to a
 * white key, since the duet's span already squeezes them and a whole octave
 * for one bass note would leave most of it empty.
 */
export function range(song: Song, duet = false): [number, number] {
  const withDuet = duet && !!song.duet?.notes.length;
  const cache = withDuet ? duetRanges : ranges;
  const cached = cache.get(song);
  if (cached) return cached;
  let lo = withDuet ? 127 : 48,
    hi = withDuet ? 0 : 84;
  for (const notes of [song.notes, withDuet ? song.duet!.notes : []])
    for (const note of notes) {
      lo = Math.min(lo, note.pitch);
      hi = Math.max(hi, note.pitch);
    }
  // A black key's neighbours are white, and C0 and G9 are white.
  const result: [number, number] = withDuet
    ? [black(lo) ? lo - 1 : lo, black(hi) ? hi + 1 : hi]
    : [
        Math.max(0, Math.floor(lo / 12) * 12),
        Math.min(127, Math.ceil(hi / 12) * 12),
      ];
  cache.set(song, result);
  return result;
}
export function pianoKeyAt(
  song: Song,
  x: number,
  y: number,
  height: number,
  duet = false,
) {
  const top = height - KEYBOARD_HEIGHT;
  if (y < top || y > height || x < 0 || x > 1) return undefined;
  const keys = keyLayout(...range(song, duet));
  return (
    keys.find(
      (key) =>
        key.black &&
        y < top + BLACK_KEY_HEIGHT &&
        x >= key.x &&
        x < key.x + key.width,
    ) || keys.find((key) => !key.black && x >= key.x && x < key.x + key.width)
  )?.pitch;
}

const keyboardPaints = new WeakMap<
  CanvasRenderingContext2D,
  {
    key: string;
    white: CanvasGradient;
    black: CanvasGradient;
  }
>();
function keyboardColors(c: CanvasRenderingContext2D, top: number, dpr: number) {
  const key = `${top}:${dpr}`;
  const cached = keyboardPaints.get(c);
  if (cached?.key === key) return cached;
  const white = c.createLinearGradient(0, top, 0, top + KEYBOARD_HEIGHT);
  [
    [0, "#e6e5e1"],
    [0.12, "#fffefa"],
    [0.7, "#ffffff"],
    [0.94, "#f2f1ec"],
    [1, "#d7d6d0"],
  ].forEach(([stop, color]) => white.addColorStop(Number(stop), String(color)));
  const black = c.createLinearGradient(0, top, 0, top + BLACK_KEY_HEIGHT);
  [
    [0, "#4c4f59"],
    [0.1, "#333640"],
    [0.65, "#1a1d25"],
    [0.86, "#292d37"],
    [1, "#101219"],
  ].forEach(([stop, color]) => black.addColorStop(Number(stop), String(color)));
  const paint = { key, white, black };
  keyboardPaints.set(c, paint);
  return paint;
}
function keyOutline(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.min(radius, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x + w, y);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.closePath();
}
function noteLabel(
  c: CanvasRenderingContext2D,
  text: string,
  size: number,
  weight: number,
) {
  const font = `${weight} ${size}px ${scoreFont}`;
  c.font = font;
  const metrics = c.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent ?? size * 0.8;
  const descent = metrics.actualBoundingBoxDescent ?? size * 0.2;
  return {
    text,
    font,
    width: metrics.width,
    ascent,
    descent,
    height: ascent + descent,
  };
}
/** Shrinks a label to fit, since a fillText maxWidth squeezes the glyphs. */
function fittedSize(
  c: CanvasRenderingContext2D,
  text: string,
  size: number,
  weight: number,
  maxWidth: number,
) {
  const { width } = noteLabel(c, text, size, weight);
  return width > maxWidth ? (size * maxWidth) / width : size;
}
/** What the waterfall and keyboard show. */
export interface PianoScene {
  song: Song;
  /** The notes of the hands being practiced. */
  notes: Note[];
  position: number;
  input: MidiState;
  practice: Practice;
  /** Note names on the notes and keys. */
  names: boolean;
  /** Wait for me is holding at a chord: mark its notes and keys. */
  waiting: boolean;
  /** Listen: light the keys it plays. */
  listen: boolean;
  /** The teacher duet while Duet is on; the keys widen to fit it. */
  duet?: readonly Note[];
}
export function draw(
  canvas: HTMLCanvasElement,
  {
    song,
    notes,
    position,
    input,
    practice,
    names,
    waiting,
    listen,
    duet = [],
  }: PianoScene,
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
  const keyHeight = KEYBOARD_HEIGHT,
    fall = height - keyHeight,
    px = fall / 5,
    [min, max] = range(song, duet.length > 0),
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
    timeline = {
      clock: createBeatClock(song.ppq, song.tempos),
      meter: createMeterMap(song),
    };
    beatTimelines.set(song, timeline);
  }
  const { clock, meter } = timeline;
  const leadIn = meter.leadIn;
  const currentBeat = clock.at(position) - leadIn;
  const initialBar = meter.at(currentBeat);
  let beat =
    currentBeat < 0
      ? Math.floor(currentBeat)
      : initialBar.start +
        Math.floor(initialBar.offset / initialBar.beatUnit) *
          initialBar.beatUnit;
  const beatLabels: { text: string; y: number }[] = [];
  // Keep the work bounded even at extreme tempos or small written note units.
  for (let i = 0; i < 128; i++) {
    const t = clock.time(beat + leadIn);
    if (t > position + 5) break;
    const y = fall - (t - position) * px;
    const bar = meter.at(beat);
    const barStart = beat >= 0 && Math.abs(beat - bar.start) < 1e-9;
    c.strokeStyle = barStart ? "#c4bdd6" : "#dcd8e8";
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(width, y);
    c.stroke();
    if (barStart) {
      const writtenBeat =
        bar.writtenBeat + (bar.start - bar.beat) / bar.beatUnit;
      beatLabels.push({ text: "beat " + String(writtenBeat + 1), y: y - 5 });
    }
    beat =
      beat < 0 ? Math.min(0, beat + 1) : Math.min(bar.end, beat + bar.beatUnit);
  }
  const group = waiting ? practice.gate : undefined;
  let expected = group ? waitGroups.get(group) : undefined;
  if (group && !expected) {
    const ids = new Set<string>(),
      targets = new Map<number, Note>();
    for (const note of group.notes) {
      ids.add(note.id);
      targets.set(note.pitch, note);
    }
    expected = { ids, targets };
    waitGroups.set(group, expected);
  }
  const hands = new Map(song.tracks.map((track) => [track.id, track.hand]));
  /** The keys Listen is playing now, by pitch. */
  const listening = new Map<number, Note>();
  const rendered = new Set<string>();
  let selectedIds = selections.get(notes);
  if (!selectedIds) {
    selectedIds = new Set(notes.map((note) => note.id));
    selections.set(notes, selectedIds);
  }
  const activeNotes: Note[] = [];
  const dimmedNotes: Note[] = [];
  const collect = (n: Note, active: boolean) => {
    if (rendered.size >= MAX_VISIBLE_NOTES) return;
    const k = geometry.get(n.pitch);
    if (!k || n.end < position || n.start > position + 5) return;
    const hand = hands.get(n.track);
    const shape = `${active}:${n.pitch}:${n.start}:${n.end}:${hand}`;
    if (rendered.has(shape)) return;
    rendered.add(shape);
    (active ? activeNotes : dimmedNotes).push(n);
  };
  // Reserve the drawing budget for the practiced hand before adding context.
  // Listen highlights still scan every selected note, including dense passages.
  for (const n of notes) {
    if (
      listen &&
      n.start <= position &&
      n.soundEnd > position &&
      !listening.has(n.pitch)
    )
      listening.set(n.pitch, n);
    collect(n, true);
  }
  for (const n of song.notes) {
    if (rendered.size >= MAX_VISIBLE_NOTES) break;
    if (selectedIds.has(n.id)) continue;
    const hand = hands.get(n.track);
    // Tracks assigned to Skip remain excluded; disabled practice hands provide context.
    if (hand === "left" || hand === "right") collect(n, false);
  }
  // The duet takes what is left of the same budget, one shape per outline.
  const duetNotes: Note[] = [];
  for (const n of duet) {
    if (rendered.size >= MAX_VISIBLE_NOTES) break;
    if (!geometry.has(n.pitch) || n.end < position || n.start > position + 5)
      continue;
    const shape = `duet:${n.pitch}:${n.start}:${n.end}`;
    if (rendered.has(shape)) continue;
    rendered.add(shape);
    duetNotes.push(n);
  }
  c.save();
  c.beginPath();
  c.rect(0, 0, width, fall);
  c.clip();
  // Avoid thousands of blur operations on densely overlapping notes.
  const noteShadows = activeNotes.length + dimmedNotes.length <= 256;
  const noteRects: [number, number, number, number][] = [];
  const drawNote = (n: Note, active: boolean) => {
    const k = geometry.get(n.pitch)!;
    const hand = hands.get(n.track);
    const color = hand === "left" ? leftColor : rightColor;
    const h = Math.max(8, (n.end - n.start) * px),
      y = fall - (n.start - position) * px - h,
      x = k.x * width + 2,
      w = Math.max(3, k.width * width - 4);
    const missed = active && practice.missed.has(n.id);
    c.fillStyle = missed ? "#d79883" : color;
    const alpha = active ? (practice.hit.has(n.id) ? 0.55 : 1) : 0.5;
    c.globalAlpha = alpha;
    c.shadowColor = noteShadows ? "#3d30551c" : "transparent";
    c.shadowBlur = noteShadows ? 3 * dpr : 0;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = noteShadows ? 1.5 * dpr : 0;
    c.beginPath();
    c.roundRect(x, y, w, h, 4);
    c.fill();
    c.shadowColor = "transparent";
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    c.strokeStyle = missed
      ? "#b57964"
      : hand === "left"
        ? "#548c80"
        : "#8f73b3";
    c.lineWidth = 1;
    c.stroke();
    if (active && expected?.ids.has(n.id)) {
      c.strokeStyle = "#7354cf";
      c.lineWidth = 2;
      c.stroke();
    }
    if (active) c.globalAlpha = 1;
    noteRects.push([x, y, w, h]);
    const finger = suggestedFinger(n, hand ?? "off");
    const top = Math.max(0, y);
    const bottom = Math.min(fall, y + h);
    const visibleHeight = bottom - top;
    const centerX = x + w / 2;
    const centerY = (top + bottom) / 2;
    if ((names || finger) && visibleHeight >= 7) {
      c.fillStyle = "#262232";
      c.textAlign = "center";
      if (w > 18) {
        const maxWidth = w - 6;
        const pitchLabel = names
          ? noteLabel(c, noteName(n.pitch), 12, 400)
          : null;
        const fingerLabel = finger
          ? noteLabel(c, String(finger), 13, 700)
          : null;
        const stackHeight =
          (pitchLabel?.height ?? 0) + (fingerLabel?.height ?? 0) + 4;
        if (
          pitchLabel &&
          fingerLabel &&
          visibleHeight >= 32 &&
          pitchLabel.width <= maxWidth &&
          fingerLabel.width <= maxWidth &&
          stackHeight <= visibleHeight - 6
        ) {
          let inkTop = centerY - stackHeight / 2;
          for (const label of [pitchLabel, fingerLabel]) {
            c.font = label.font;
            c.fillText(label.text, centerX, inkTop + label.ascent);
            inkTop += label.height + 4;
          }
        } else {
          // Finger position takes priority when a short note cannot fit both.
          const text = finger ? String(finger) : noteName(n.pitch),
            base = finger ? 13 : 12,
            weight = finger ? 700 : 400;
          const size = Math.min(
            Math.max(MIN_LABEL, Math.min(base, visibleHeight - 2)),
            fittedSize(c, text, base, weight, maxWidth),
          );
          if (size >= MIN_LABEL) {
            const label = noteLabel(c, text, size, weight);
            c.fillText(
              label.text,
              centerX,
              centerY + (label.ascent - label.descent) / 2,
            );
          }
        }
      } else if (finger) {
        // Narrow bars (tablet and phone widths) show only the finger number,
        // shrunk to fit the bar but never below a legible size.
        const digit = String(finger);
        const full = noteLabel(c, digit, 13, 700);
        const size = Math.min(
          13,
          visibleHeight - 2,
          (13 * (w - 2)) / full.width,
        );
        if (size >= MIN_NARROW_LABEL) {
          const label = noteLabel(c, digit, size, 700);
          c.fillText(
            digit,
            centerX,
            centerY + (label.ascent - label.descent) / 2,
          );
        }
      }
    }
    c.globalAlpha = 1;
  };
  // The duet goes behind both hands: it is heard, never played or scored.
  c.fillStyle = duetColor;
  c.globalAlpha = DUET_ALPHA;
  for (const n of duetNotes) {
    const k = geometry.get(n.pitch)!;
    const h = Math.max(8, (n.end - n.start) * px);
    c.beginPath();
    c.roundRect(
      k.x * width + 2,
      fall - (n.start - position) * px - h,
      Math.max(3, k.width * width - 4),
      h,
      4,
    );
    c.fill();
  }
  c.globalAlpha = 1;
  // Context goes behind the selected hand, including at shared-pitch onsets.
  for (const note of dimmedNotes) drawNote(note, false);
  for (const note of activeNotes) drawNote(note, true);
  // Bar labels follow the notes so they can move clear of them: the left edge,
  // else the right edge, else the left edge on a backing chip.
  for (const { text, y } of beatLabels) {
    const label = noteLabel(c, text, 12, 400);
    const top = y - label.ascent - 2,
      bottom = y + label.descent + 2;
    const clear = (left: number) =>
      !noteRects.some(
        ([nx, ny, nw, nh]) =>
          nx < left + label.width + 3 &&
          nx + nw > left - 3 &&
          ny < bottom &&
          ny + nh > top,
      );
    const right = width - 7 - label.width;
    const left = clear(7) ? 7 : clear(right) ? right : undefined;
    if (left === undefined) {
      c.fillStyle = "#eeedf5";
      c.globalAlpha = 0.9;
      c.beginPath();
      c.roundRect(4, top, label.width + 6, bottom - top, 4);
      c.fill();
      c.globalAlpha = 1;
    }
    c.fillStyle = labelColor;
    c.textAlign = "left";
    c.fillText(text, left ?? 7, y);
  }
  c.restore();
  const paints = keyboardColors(c, fall, dpr);
  c.fillStyle = "#24252c";
  c.fillRect(0, fall, width, keyHeight);
  const drawKey = (k: ReturnType<typeof keyLayout>[number]) => {
    const x = k.x * width,
      w = k.width * width,
      h = k.black ? BLACK_KEY_HEIGHT : keyHeight;
    const heard = listening.get(k.pitch);
    const target = expected?.targets.get(k.pitch);
    const hand = hands.get((heard || target)?.track ?? -1);
    const color = hand === "left" ? leftColor : rightColor;
    const textColor = hand === "left" ? leftText : rightText;
    c.fillStyle = input.down.has(k.pitch)
      ? "#7354cf"
      : heard
        ? color
        : k.black
          ? paints.black
          : paints.white;
    if (k.black) {
      c.save();
      c.shadowColor = "#13172255";
      c.shadowBlur = 5;
      c.shadowOffsetY = 3;
      keyOutline(c, x, fall, w, h, 4);
      c.fill();
      c.restore();
      c.strokeStyle = "#0d1017";
      c.lineWidth = 1;
      keyOutline(c, x + 0.5, fall + 0.5, w - 1, h - 1, 3.5);
      c.stroke();
      c.fillStyle = "#00000026";
      keyOutline(c, x + 1, fall + h - 8, w - 2, 7, 3);
      c.fill();
      c.strokeStyle = "#ffffff2b";
      c.beginPath();
      c.moveTo(x + 2, fall + 2);
      c.lineTo(x + w - 2, fall + 2);
      c.stroke();
    } else {
      c.fillRect(x, fall, w, h);
      c.fillStyle = "#0000000b";
      c.fillRect(x + 1, fall + h - 6, w - 2, 5);
      c.strokeStyle = "#c6c5c0";
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, fall + 0.5, w - 1, h - 1);
    }
    if (target && !input.down.has(k.pitch)) {
      c.fillStyle = color;
      c.globalAlpha = 0.5;
      c.fillRect(x + 1, fall, w - 2, 8);
      c.globalAlpha = 1;
    }
    if (input.sounding.has(k.pitch) && !input.down.has(k.pitch)) {
      c.fillStyle = "#51b3a5";
      c.beginPath();
      c.arc(x + w - 8, fall + h - 11, 3, 0, Math.PI * 2);
      c.fill();
    }
    const fingerNote = target || heard;
    const finger = fingerNote && suggestedFinger(fingerNote, hand ?? "off");
    if (finger && w > 18) {
      c.fillStyle =
        input.down.has(k.pitch) || k.black || heard ? "#fff" : textColor;
      c.font = `700 14px ${scoreFont}`;
      c.textAlign = "center";
      c.fillText(String(finger), x + w / 2, fall + (k.black ? 48 : h - 15));
    }
    if (names && (fingerNote || input.down.has(k.pitch)) && w > 18) {
      const name = noteName(k.pitch),
        size = fittedSize(c, name, 12, 700, w - 4);
      if (size >= MIN_LABEL) {
        c.fillStyle =
          input.down.has(k.pitch) || k.black || heard ? "#fff" : textColor;
        c.font = `700 ${size}px ${scoreFont}`;
        c.textAlign = "center";
        c.fillText(name, x + w / 2, fall + (k.black ? 26 : h - 35));
      }
    } else if (!k.black && k.pitch % 12 === 0 && w > 12) {
      const name = noteName(k.pitch),
        size = fittedSize(c, name, 12, 400, w - 4);
      if (size >= MIN_LABEL) {
        c.fillStyle = input.down.has(k.pitch) ? "#fff" : labelColor;
        c.font = `${size}px ${scoreFont}`;
        c.textAlign = "center";
        c.fillText(name, x + w / 2, fall + h - 35);
      }
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
