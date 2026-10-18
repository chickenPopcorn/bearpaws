import { noteName, suggestedFinger, type Note, type Song } from "./song";
import type { Group, MidiState, Practice } from "./engine";
import { createMeterMap } from "./notation";
import { createBeatClock } from "./timeline";
const scoreFont = '"Libre Baskerville", Baskerville, Georgia, serif';
const ranges = new WeakMap<Song, [number, number]>();
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
export const rightColor = "#a086e9",
  leftColor = "#51b3a5";
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
export function pianoKeyAt(song: Song, x: number, y: number, height: number) {
  const top = height - KEYBOARD_HEIGHT;
  if (y < top || y > height || x < 0 || x > 1) return undefined;
  const keys = keyLayout(...range(song));
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
  const keyHeight = KEYBOARD_HEIGHT,
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
      c.fillStyle = labelColor;
      c.font = `12px ${scoreFont}`;
      c.textAlign = "left";
      const writtenBeat =
        bar.writtenBeat + (bar.start - bar.beat) / bar.beatUnit;
      c.fillText("beat " + String(writtenBeat + 1), 7, y - 5);
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
  const reference = new Map<number, Note>();
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
      !reference.has(n.pitch)
    )
      reference.set(n.pitch, n);
    collect(n, true);
  }
  for (const n of song.notes) {
    if (rendered.size >= MAX_VISIBLE_NOTES) break;
    if (selectedIds.has(n.id)) continue;
    const hand = hands.get(n.track);
    // Tracks assigned to Skip remain excluded; disabled practice hands provide context.
    if (hand === "left" || hand === "right") collect(n, false);
  }
  c.save();
  c.beginPath();
  c.rect(0, 0, width, fall);
  c.clip();
  // Avoid thousands of blur operations on densely overlapping imported notes.
  const noteShadows = activeNotes.length + dimmedNotes.length <= 256;
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
    const finger = suggestedFinger(n, hand ?? "off");
    if ((names || finger) && w > 18) {
      c.fillStyle = "#262232";
      c.textAlign = "center";
      const top = Math.max(0, y);
      const bottom = Math.min(fall, y + h);
      const visibleHeight = bottom - top;
      if (visibleHeight >= 7) {
        const centerX = x + w / 2;
        const centerY = (top + bottom) / 2;
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
            c.fillText(label.text, centerX, inkTop + label.ascent, maxWidth);
            inkTop += label.height + 4;
          }
        } else {
          // Finger position takes priority when a short note cannot fit both.
          const label = noteLabel(
            c,
            finger ? String(finger) : noteName(n.pitch),
            Math.max(7, Math.min(finger ? 13 : 12, visibleHeight - 2)),
            finger ? 700 : 400,
          );
          c.fillText(
            label.text,
            centerX,
            centerY + (label.ascent - label.descent) / 2,
            maxWidth,
          );
        }
      }
    }
    c.globalAlpha = 1;
  };
  // Context goes behind the selected hand, including at shared-pitch onsets.
  for (const note of dimmedNotes) drawNote(note, false);
  for (const note of activeNotes) drawNote(note, true);
  c.restore();
  const paints = keyboardColors(c, fall, dpr);
  c.fillStyle = "#24252c";
  c.fillRect(0, fall, width, keyHeight);
  const drawKey = (k: ReturnType<typeof keyLayout>[number]) => {
    const x = k.x * width,
      w = k.width * width,
      h = k.black ? BLACK_KEY_HEIGHT : keyHeight;
    const ref = reference.get(k.pitch);
    const target = expected?.targets.get(k.pitch);
    const hand = hands.get((ref || target)?.track ?? -1);
    const color = hand === "left" ? leftColor : rightColor;
    const textColor = hand === "left" ? leftText : rightText;
    c.fillStyle = input.down.has(k.pitch)
      ? "#7354cf"
      : ref
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
    const fingerNote = target || ref;
    const finger = fingerNote && suggestedFinger(fingerNote, hand ?? "off");
    if (finger && w > 18) {
      c.fillStyle =
        input.down.has(k.pitch) || k.black || ref ? "#fff" : textColor;
      c.font = `700 14px ${scoreFont}`;
      c.textAlign = "center";
      c.fillText(String(finger), x + w / 2, fall + (k.black ? 48 : h - 15));
    }
    if (names && (fingerNote || input.down.has(k.pitch)) && w > 18) {
      c.fillStyle =
        input.down.has(k.pitch) || k.black || ref ? "#fff" : textColor;
      c.font = `700 12px ${scoreFont}`;
      c.textAlign = "center";
      c.fillText(
        noteName(k.pitch),
        x + w / 2,
        fall + (k.black ? 26 : h - 35),
        w - 4,
      );
    } else if (!k.black && k.pitch % 12 === 0 && w > 12) {
      c.fillStyle = input.down.has(k.pitch) ? "#fff" : labelColor;
      c.font = `12px ${scoreFont}`;
      c.textAlign = "center";
      c.fillText(noteName(k.pitch), x + w / 2, fall + h - 35, w - 4);
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
