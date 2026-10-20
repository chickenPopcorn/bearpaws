import {
  BLACK_KEY_HEIGHT,
  KEYBOARD_HEIGHT,
  fittedSize,
  keyLayout,
  keyOutline,
  keyboardColors,
  labelColor,
  rightText,
  scoreFont,
} from "./render";
import { noteName } from "./song";
import {
  ANSWER_ZONE,
  CONTROL_KEYS,
  CONTROL_ZONE,
  CRAYONS,
  PLAY_ZONE,
  letterName,
  type Crayon,
  type Zone,
} from "./workbook";

/** Each control key's mark and word, drawn on the key. */
export const CONTROL_LABELS: Record<number, { mark: string; word: string }> = {
  [CONTROL_KEYS.hint]: { mark: "?", word: "Hint" },
  [CONTROL_KEYS.back]: { mark: "←", word: "Back" },
  [CONTROL_KEYS.next]: { mark: "→", word: "Next" },
  [CONTROL_KEYS.restart]: { mark: "↺", word: "Hold" },
};

/** One white key's width between the zones. */
const GAP = 1;
const zones: { zone: Zone; range: readonly [number, number] }[] = [
  { zone: "control", range: CONTROL_ZONE },
  { zone: "play", range: PLAY_ZONE },
  { zone: "answer", range: ANSWER_ZONE },
];
const whites = (min: number, max: number) =>
  keyLayout(min, max).filter((k) => !k.black).length;

/**
 * The workbook's keyboard: the control keys, the play zone and the answer
 * keys side by side, as fractions of the full width, with a white key's gap
 * between zones. Every key keeps the studio keyboard's proportions.
 */
export function workbookKeys() {
  const units =
    zones.reduce((sum, { range }) => sum + whites(...range), 0) +
    GAP * (zones.length - 1);
  let offset = 0;
  return zones.flatMap(({ zone, range }) => {
    const count = whites(...range),
      start = offset / units,
      span = count / units;
    offset += count + GAP;
    return keyLayout(...range).map((k) => ({
      ...k,
      zone,
      x: start + k.x * span,
      width: k.width * span,
    }));
  });
}
const layout = workbookKeys();

export interface WorkbookKeyboardScene {
  /** Keys held down now. */
  down: ReadonlySet<number>;
  /** Painted keys and their crayons. */
  painted: ReadonlyMap<number, Crayon>;
  /** Letter names on the play zone's white keys. */
  letters: boolean;
}

export function drawWorkbookKeyboard(
  canvas: HTMLCanvasElement,
  { down, painted, letters }: WorkbookKeyboardScene,
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
  c.clearRect(0, 0, width, height);
  const top = height - KEYBOARD_HEIGHT,
    paints = keyboardColors(c, top, dpr);
  // Each zone sits on the studio keyboard's dark base, with a gap between.
  for (const { range } of zones) {
    const keys = layout.filter(
      (k) => k.pitch >= range[0] && k.pitch <= range[1],
    );
    const first = keys[0],
      last = keys.filter((k) => !k.black).at(-1)!;
    const x = first.x * width,
      right = (last.x + last.width) * width;
    c.fillStyle = "#24252c";
    c.fillRect(x, top, right - x, KEYBOARD_HEIGHT);
    c.strokeStyle = "#7354cf";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, top);
    c.lineTo(right, top);
    c.stroke();
  }
  const drawKey = (k: (typeof layout)[number]) => {
    const x = k.x * width,
      w = k.width * width,
      h = k.black ? BLACK_KEY_HEIGHT : KEYBOARD_HEIGHT,
      pressed = down.has(k.pitch),
      crayon = painted.get(k.pitch);
    c.fillStyle = pressed
      ? "#7354cf"
      : crayon
        ? CRAYONS[crayon]
        : k.black
          ? paints.black
          : paints.white;
    if (k.black) {
      c.save();
      c.shadowColor = "#13172255";
      c.shadowBlur = 5;
      c.shadowOffsetY = 3;
      keyOutline(c, x, top, w, h, 4);
      c.fill();
      c.restore();
      c.strokeStyle = "#0d1017";
      c.lineWidth = 1;
      keyOutline(c, x + 0.5, top + 0.5, w - 1, h - 1, 3.5);
      c.stroke();
    } else {
      c.fillRect(x, top, w, h);
      c.fillStyle = "#0000000b";
      c.fillRect(x + 1, top + h - 6, w - 2, 5);
      c.strokeStyle = "#c6c5c0";
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
    }
    if (k.black) return;
    c.textAlign = "center";
    const ink = pressed ? "#fff" : crayon ? "#282635" : labelColor;
    const control = CONTROL_LABELS[k.pitch];
    if (k.zone === "control" && control) {
      // Below the black keys, which cover the top of the white ones.
      const markSize = fittedSize(c, control.mark, 16, 700, w - 6),
        wordSize = fittedSize(c, control.word, 11, 400, w - 4);
      c.fillStyle = pressed ? "#fff" : rightText;
      c.font = `700 ${markSize}px ${scoreFont}`;
      c.fillText(control.mark, x + w / 2, top + h - 25);
      c.fillStyle = ink;
      c.font = `${wordSize}px ${scoreFont}`;
      c.fillText(control.word, x + w / 2, top + h - 10);
      return;
    }
    if (k.zone !== "play") return;
    if (letters) {
      const letter = letterName(k.pitch),
        size = fittedSize(c, letter, 16, 700, w - 4);
      c.fillStyle = pressed ? "#fff" : crayon ? "#282635" : rightText;
      c.font = `700 ${size}px ${scoreFont}`;
      c.fillText(letter, x + w / 2, top + h - 35);
    } else if (k.pitch % 12 === 0) {
      const name = noteName(k.pitch),
        size = fittedSize(c, name, 12, 400, w - 4);
      c.fillStyle = ink;
      c.font = `${size}px ${scoreFont}`;
      c.fillText(name, x + w / 2, top + h - 35);
    }
  };
  layout.filter((k) => !k.black).forEach(drawKey);
  layout.filter((k) => k.black).forEach(drawKey);
  // The answer keys wait, faded, for a question that needs them.
  const answers = layout.filter((k) => k.zone === "answer"),
    last = answers.filter((k) => !k.black).at(-1)!;
  c.fillStyle = "#eeedf5b3";
  c.fillRect(
    answers[0].x * width,
    top,
    (last.x + last.width - answers[0].x) * width,
    KEYBOARD_HEIGHT,
  );
}
