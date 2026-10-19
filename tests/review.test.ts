import { afterEach, describe, expect, it, vi } from "vitest";
import { writeMidi } from "midi-file";
import { ReferenceAudio } from "../src/audio";
import { PIANO_REGIONS, selectPianoRegion } from "../src/piano";
import { MidiState, Practice, Transport } from "../src/engine";
import {
  draw,
  DUET_ALPHA,
  duetColor,
  KEYBOARD_HEIGHT,
  keyLayout,
  leftColor,
  MAX_VISIBLE_NOTES,
  range,
  rightColor,
} from "../src/render";
import { parseSong, type Note, type Song } from "../src/song";

const note = (
  id: string,
  pitch: number,
  start: number,
  end: number,
  track = 0,
): Note => ({
  id,
  pitch,
  start,
  end,
  soundEnd: end,
  velocity: 0.7,
  channel: 0,
  track,
});
const song = (notes: Note[]): Song => ({
  id: "review-fixture",
  title: "Review fixture",
  duration: 4,
  ppq: 480,
  tempos: [],
  warnings: [],
  notes,
  tracks: [{ id: 0, name: "Right", hand: "right", count: notes.length }],
});

const strikeLine = 400 - KEYBOARD_HEIGHT;
const pixelsPerSecond = strikeLine / 5;

function keyboardPaintMocks() {
  return {
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => {
      const stops: [number, string][] = [];
      return {
        stops,
        addColorStop: vi.fn((offset: number, color: string) => {
          stops.push([offset, color]);
        }),
      };
    }),
    measureText: vi.fn(function (this: { font?: string }, text: string) {
      const size = Number(this.font?.match(/([\d.]+)px/)?.[1] ?? 10);
      return {
        width: text.length * size * 0.6,
        actualBoundingBoxAscent: size * 0.7,
        actualBoundingBoxDescent: size * 0.3,
      };
    }),
  };
}

function drawingCanvas(width = 880) {
  const fills: { x: number; y: number; color: string }[] = [];
  const noteFills: {
    x: number;
    y: number;
    color: string;
    alpha: number;
  }[] = [];
  const labels: { text: string; alpha: number }[] = [];
  const labelPaints: {
    text: string;
    x: number;
    y: number;
    color: string;
  }[] = [];
  const noteStrokes: { x: number; y: number }[] = [];
  let noteShape: { x: number; y: number } | undefined;
  const context = {
    ...keyboardPaintMocks(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
  };
  context.fillRect.mockImplementation((x: number, y: number) => {
    fills.push({ x, y, color: context.fillStyle });
  });
  context.beginPath.mockImplementation(() => {
    noteShape = undefined;
  });
  context.roundRect.mockImplementation((x: number, y: number) => {
    noteShape = { x, y };
  });
  context.fill.mockImplementation(() => {
    if (noteShape)
      noteFills.push({
        ...noteShape,
        color: context.fillStyle,
        alpha: context.globalAlpha,
      });
  });
  context.stroke.mockImplementation(() => {
    if (
      noteShape &&
      context.strokeStyle === "#7354cf" &&
      context.lineWidth === 2
    )
      noteStrokes.push({ ...noteShape });
  });
  context.fillText.mockImplementation((text: string, x: number, y: number) => {
    labels.push({ text, alpha: context.globalAlpha });
    labelPaints.push({ text, x, y, color: context.fillStyle });
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width, height: 400 }),
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    context,
    fills,
    noteFills,
    labels,
    labelPaints,
    noteStrokes,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("teacher duet in the waterfall", () => {
  it("draws the duet yellow at quarter opacity behind both hands, widening the keys", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const student = note("student", 72, 1, 2);
    const fixture = {
      ...song([student]),
      duet: { octaves: 1, notes: [note("teacher", 36, 1, 2, 2)] },
    };
    const selected = [student];
    const { canvas, noteFills } = drawingCanvas();
    // Duet off: the teacher part is not drawn, and the keys fit the student.
    draw(
      canvas,
      fixture,
      selected,
      0,
      new MidiState(),
      new Practice(selected),
      false,
      false,
      false,
    );
    expect(noteFills.map(({ color }) => color)).toEqual([rightColor]);
    expect(range(fixture)).toEqual([48, 84]);
    noteFills.length = 0;
    draw(
      canvas,
      fixture,
      selected,
      0,
      new MidiState(),
      new Practice(selected),
      false,
      false,
      false,
      fixture.duet.notes,
    );
    expect(noteFills.map(({ color, alpha }) => ({ color, alpha }))).toEqual([
      { color: duetColor, alpha: DUET_ALPHA },
      { color: rightColor, alpha: 1 },
    ]);
    expect(DUET_ALPHA).toBe(0.25);
    // C2 is now on the keyboard, so the teacher's bass is visible.
    expect(range(fixture, true)).toEqual([36, 84]);
  });

  it("draws the duet from what is left of the shared budget, once per outline", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const students = Array.from({ length: MAX_VISIBLE_NOTES - 2 }, (_, i) =>
      note(`s${i}`, 60 + (i % 12), 1 + i * 0.0005, 2),
    );
    const teacher = [
      note("t0", 40, 1, 2, 2),
      note("t0-again", 40, 1, 2, 2),
      note("t1", 41, 1, 2, 2),
      note("t2", 42, 1, 2, 2),
    ];
    const fixture = { ...song(students), duet: { octaves: 1, notes: teacher } };
    const { canvas, noteFills } = drawingCanvas();
    draw(
      canvas,
      fixture,
      students,
      0,
      new MidiState(),
      new Practice(students),
      false,
      false,
      false,
      teacher,
    );
    const duetFills = noteFills.filter(({ color }) => color === duetColor);
    // Two shapes were left: the repeated outline counts once, and "t2" waits.
    expect(duetFills).toHaveLength(2);
    expect(noteFills).toHaveLength(MAX_VISIBLE_NOTES);
  });
});

describe("review regressions", () => {
  it("keeps an unselected hand's notes and labels dimmed without Listen keys or Wait targets", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const right: Note = {
      ...note("selected-right", 64, 1, 2),
      finger: 3,
      fingerHand: "right",
    };
    const left: Note = {
      ...note("dimmed-left", 55, 1, 2, 1),
      finger: 2,
      fingerHand: "left",
    };
    const fixture = song([
      left,
      note("off-track", 67, 1, 2, 2),
      note("unknown-track", 69, 1, 2, 99),
      right,
    ]);
    fixture.tracks.push(
      { id: 1, name: "Left", hand: "left", count: 1 },
      { id: 2, name: "Off", hand: "off", count: 1 },
    );
    const selected = [right];
    const practice = new Practice(selected);
    const { canvas, context, fills, noteFills, labels, noteStrokes } =
      drawingCanvas();
    draw(
      canvas,
      fixture,
      selected,
      1.25,
      new MidiState(),
      practice,
      true,
      false,
      true,
    );

    expect(noteFills.map(({ color, alpha }) => ({ color, alpha }))).toEqual([
      { color: leftColor, alpha: 0.5 },
      { color: rightColor, alpha: 1 },
    ]);
    expect(labels.filter(({ text }) => text === "2" || text === "G3")).toEqual([
      { text: "G3", alpha: 0.5 },
      { text: "2", alpha: 0.5 },
    ]);
    expect(labels.filter(({ text }) => text === "3")).toEqual([
      { text: "3", alpha: 1 },
      { text: "3", alpha: 1 },
    ]);
    expect(labels.filter(({ text }) => text === "E4")).toEqual([
      { text: "E4", alpha: 1 },
      { text: "E4", alpha: 1 },
    ]);
    const [min, max] = range(fixture);
    const keys = keyLayout(min, max);
    const leftKey = keys.find((key) => key.pitch === left.pitch)!;
    const rightKey = keys.find((key) => key.pitch === right.pitch)!;
    expect(fills).toContainEqual({
      x: leftKey.x * 880,
      y: strikeLine,
      color: expect.objectContaining({ addColorStop: expect.any(Function) }),
    });
    expect(fills).toContainEqual({
      x: rightKey.x * 880,
      y: strikeLine,
      color: rightColor,
    });
    expect(context.globalAlpha).toBe(1);

    draw(
      canvas,
      fixture,
      selected,
      1.25,
      new MidiState(),
      practice,
      false,
      true,
      false,
    );
    expect(noteStrokes).toHaveLength(1);
    expect(noteStrokes[0].x).toBeCloseTo(rightKey.x * 880 + 2);
    expect(noteStrokes[0].y).toBeCloseTo(strikeLine - 0.75 * pixelsPerSecond);
    expect(practice.notes).toEqual(selected);
  });

  it("prioritizes selected notes within the drawing budget when dense inactive notes come first", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const background = Array.from({ length: 5000 }, (_, i) =>
      note(`inactive-${i}`, 48, i / 1000, i / 1000 + 0.25, 1),
    );
    const selected = [note("selected-late", 64, 4.75, 5, 0)];
    const fixture = song(
      [...background, ...selected].sort((a, b) => a.start - b.start),
    );
    fixture.tracks.push({
      id: 1,
      name: "Inactive left",
      hand: "left",
      count: background.length,
    });
    const { canvas, context, noteFills } = drawingCanvas();
    draw(
      canvas,
      fixture,
      selected,
      0,
      new MidiState(),
      new Practice(selected),
      false,
      false,
      false,
    );
    expect(context.roundRect).toHaveBeenCalledTimes(MAX_VISIBLE_NOTES);
    expect(noteFills.filter(({ alpha }) => alpha === 0.5)).toHaveLength(
      MAX_VISIBLE_NOTES - 1,
    );
    const [min, max] = range(fixture);
    const selectedKey = keyLayout(min, max).find((key) => key.pitch === 64)!;
    expect(noteFills.at(-1)).toMatchObject({
      x: selectedKey.x * 880 + 2,
      color: rightColor,
      alpha: 1,
    });
    expect(noteFills.at(-1)!.y).toBeCloseTo(0);
  });

  it("aligns the waltz bar grid to its first musical beat after the lead-in", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const piece = {
      ...song([]),
      beatsPerBar: 3,
      leadInBeats: 1,
      tempos: [{ tick: 0, microseconds: 1_000_000 }],
    };
    const { canvas, context } = drawingCanvas();
    draw(
      canvas,
      piece,
      piece.notes,
      0,
      new MidiState(),
      new Practice([]),
      false,
      false,
      false,
    );
    expect(context.fillText).toHaveBeenCalledWith(
      "beat 1",
      7,
      strikeLine - pixelsPerSecond - 5,
    );
    expect(context.fillText).toHaveBeenCalledWith(
      "beat 4",
      7,
      strikeLine - 4 * pixelsPerSecond - 5,
    );
  });

  it("draws six eighth-note pulses per 6/8 bar in the waterfall", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const piece = {
      ...song([]),
      timeSignatures: [{ tick: 0, numerator: 6, denominator: 8 }],
    };
    const { canvas, context } = drawingCanvas();
    draw(
      canvas,
      piece,
      piece.notes,
      0,
      new MidiState(),
      new Practice([]),
      false,
      false,
      false,
    );
    expect(context.fillText).toHaveBeenCalledWith(
      "beat 7",
      7,
      strikeLine - 1.5 * pixelsPerSecond - 5,
    );
    expect(context.lineTo).toHaveBeenCalledWith(
      880,
      strikeLine - 0.25 * pixelsPerSecond,
    );
  });

  it("shows suggested fingers on notes and keys without note names, and hides them after hand reassignment", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const n: Note = {
      ...note("fingered", 64, 1, 2),
      finger: 3,
      fingerHand: "right",
    };
    const piece = song([n]);
    const practice = new Practice(piece.notes);
    const { canvas, context } = drawingCanvas();
    draw(
      canvas,
      piece,
      piece.notes,
      0,
      new MidiState(),
      practice,
      false,
      true,
      false,
    );
    expect(
      context.fillText.mock.calls.filter(([text]) => text === "3"),
    ).toHaveLength(2);
    expect(context.fillText.mock.calls.some(([text]) => text === "E4")).toBe(
      false,
    );
    piece.tracks[0].hand = "left";
    context.fillText.mockClear();
    draw(
      canvas,
      piece,
      piece.notes,
      0,
      new MidiState(),
      practice,
      false,
      true,
      false,
    );
    expect(context.fillText.mock.calls.some(([text]) => text === "3")).toBe(
      false,
    );
  });

  it("centers only the finger when a short block cannot fit a pitch name and finger", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const notes: Note[] = [
      { ...note("short-c", 60, 1, 1.005), finger: 1, fingerHand: "right" },
      { ...note("short-sharp", 61, 1, 1.005), finger: 2, fingerHand: "right" },
    ];
    const fixture = song(notes);
    const { canvas, context, labelPaints } = drawingCanvas();
    draw(
      canvas,
      fixture,
      notes,
      0,
      new MidiState(),
      new Practice(notes),
      true,
      false,
      false,
    );
    expect(
      context.roundRect.mock.calls.map(([, , , height]) => height),
    ).toEqual([8, 8]);
    expect(
      context.fillText.mock.calls
        .filter(
          ([text, , y]) =>
            Number(y) < strikeLine && !String(text).startsWith("beat "),
        )
        .map(([text]) => text),
    ).toEqual(["1", "2"]);
    for (const [index, finger] of ["1", "2"].entries()) {
      const [x, y, width, height] = context.roundRect.mock.calls[
        index
      ] as number[];
      const label = labelPaints.find(({ text }) => text === finger)!;
      expect(label.x).toBeCloseTo(x + width / 2);
      // The tiny 7px glyph's ink is centered, rather than its alphabetic baseline.
      expect(label.y - (7 * 0.7 - 7 * 0.3) / 2).toBeCloseTo(y + height / 2);
    }
  });

  it("shrinks a pitch name to fit a narrow block instead of squeezing its glyphs", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const n = note("narrow-sharp", 61, 1, 2);
    const fixture = song([n]);
    let shrunk = false;
    for (const width of [600, 880, 1200, 1760]) {
      const { canvas, context } = drawingCanvas(width);
      const paints: { args: unknown[]; font: string }[] = [];
      context.fillText.mockImplementation((...args: unknown[]) => {
        paints.push({
          args,
          font: (context as unknown as { font: string }).font,
        });
      });
      draw(
        canvas,
        fixture,
        fixture.notes,
        0,
        new MidiState(),
        new Practice(fixture.notes),
        true,
        false,
        false,
      );
      const [, , blockWidth] = context.roundRect.mock.calls[0] as number[];
      const label = paints.find(({ args }) => args[0] === "C♯4");
      if (blockWidth <= 18) continue;
      if (!label) {
        // Left off only when even the smallest size would not fit.
        expect("C♯4".length * 7 * 0.6).toBeGreaterThan(blockWidth - 6);
        continue;
      }
      expect(label.args).toHaveLength(3);
      const size = Number(label.font.match(/([\d.]+)px/)![1]);
      expect(size).toBeLessThanOrEqual(12);
      if (size < 12) shrunk = true;
      expect("C♯4".length * size * 0.6).toBeLessThanOrEqual(
        blockWidth - 6 + 1e-9,
      );
    }
    expect(shrunk).toBe(true);
  });

  it("centers the full sharp pitch and finger as one stack when both fit in a waterfall block", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const n: Note = {
      ...note("centered-stack", 61, 1, 2),
      finger: 2,
      fingerHand: "right",
    };
    const fixture = song([n]);
    const { canvas, context, labelPaints } = drawingCanvas(1760);
    draw(
      canvas,
      fixture,
      fixture.notes,
      0,
      new MidiState(),
      new Practice(fixture.notes),
      true,
      false,
      false,
    );
    const [x, y, width, height] = context.roundRect.mock.calls[0] as number[];
    const labels = labelPaints.filter(
      ({ text }) => text === "C♯4" || text === "2",
    );
    expect(labels.map(({ text }) => text).sort()).toEqual(["2", "C♯4"]);
    for (const label of labels) expect(label.x).toBeCloseTo(x + width / 2);
    const top = labels.find(({ text }) => text === "C♯4")!.y - 12 * 0.7;
    const bottom = labels.find(({ text }) => text === "2")!.y + 13 * 0.3;
    expect((top + bottom) / 2).toBeCloseTo(y + height / 2);
    expect(top).toBeGreaterThan(y);
    expect(bottom).toBeLessThan(y + height);
  });

  it("centers a finger within the visible part of a note clipped by the waterfall edge", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const n: Note = {
      ...note("clipped-finger", 64, 1, 7),
      finger: 3,
      fingerHand: "right",
    };
    const fixture = song([n]);
    const { canvas, context, labelPaints } = drawingCanvas();
    draw(
      canvas,
      fixture,
      fixture.notes,
      0,
      new MidiState(),
      new Practice(fixture.notes),
      false,
      false,
      false,
    );
    const [x, y, width, height] = context.roundRect.mock.calls[0] as number[];
    const label = labelPaints.find(({ text }) => text === "3")!;
    expect(y).toBeLessThan(0);
    expect(label.x).toBeCloseTo(x + width / 2);
    expect(label.y - (13 * 0.7 - 13 * 0.3) / 2).toBeCloseTo(
      (Math.max(0, y) + Math.min(strikeLine, y + height)) / 2,
    );
  });

  it.each([
    // [canvas width, pitch, label expected]: C3-C6 spans 22 white keys.
    ["phone white key", 330, 60, true],
    ["tablet black key", 452, 61, true],
    ["phone black key", 330, 61, false],
  ] as const)(
    "shows only the finger on a narrow waterfall bar (%s)",
    (_, width, pitch, shown) => {
      vi.stubGlobal("window", { devicePixelRatio: 1 });
      const n: Note = {
        ...note("narrow-finger", pitch, 1, 2),
        finger: 2,
        fingerHand: "right",
      };
      const fixture = song([n]);
      const { canvas, context, labelPaints } = drawingCanvas(width);
      draw(
        canvas,
        fixture,
        fixture.notes,
        0,
        new MidiState(),
        new Practice(fixture.notes),
        true,
        false,
        false,
      );
      const [x, , w] = context.roundRect.mock.calls[0] as number[];
      expect(w).toBeLessThanOrEqual(18);
      const waterfall = labelPaints.filter(({ y }) => y < strikeLine);
      expect(waterfall.some(({ text }) => text.startsWith("C"))).toBe(false);
      const finger = waterfall.filter(({ text }) => text === "2");
      expect(finger).toHaveLength(shown ? 1 : 0);
      if (shown) expect(finger[0].x).toBeCloseTo(x + w / 2);
    },
  );

  it.each([
    ["left edge when nothing covers it", [] as number[], "left"],
    ["right edge when a low note covers the left", [48], "right"],
    ["left edge on a chip when both edges are covered", [48, 84], "chip"],
  ] as const)("places a bar label at the %s", (_, pitches, place) => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    // Beat 5 is at 2 seconds; each note spans the label just below its line.
    const fixture = song(
      pitches.map((pitch) => note(`edge-${pitch}`, pitch, 1.8, 2.4)),
    );
    const { canvas, labelPaints, noteFills } = drawingCanvas();
    draw(
      canvas,
      fixture,
      fixture.notes,
      0,
      new MidiState(),
      new Practice(fixture.notes),
      false,
      false,
      false,
    );
    const label = labelPaints.find(({ text }) => text === "beat 5")!;
    expect(label.y).toBeCloseTo(strikeLine - 2 * pixelsPerSecond - 5);
    // The test canvas measures text at 0.6 em per character.
    expect(label.x).toBeCloseTo(place === "right" ? 880 - 7 - 6 * 12 * 0.6 : 7);
    expect(noteFills.some(({ color }) => color === "#eeedf5")).toBe(
      place === "chip",
    );
  });

  it("labels the playing key with its full pitch and finger while inactive keys stay unlabelled", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const right: Note = {
      ...note("playing-sharp", 61, 1, 2),
      finger: 2,
      fingerHand: "right",
    };
    const left: Note = {
      ...note("inactive-e", 64, 1, 2, 1),
      finger: 3,
      fingerHand: "left",
    };
    const fixture = song([right, left]);
    fixture.tracks.push({ id: 1, name: "Left", hand: "left", count: 1 });
    const { canvas, context } = drawingCanvas();
    draw(
      canvas,
      fixture,
      [right],
      1.25,
      new MidiState(),
      new Practice([right]),
      true,
      false,
      true,
    );
    const keyLabels = context.fillText.mock.calls
      .filter(([, , y]) => Number(y) >= strikeLine)
      .map(([text]) => text);
    expect(keyLabels.filter((text) => text === "C♯4")).toHaveLength(1);
    expect(keyLabels.filter((text) => text === "2")).toHaveLength(1);
    expect(keyLabels).not.toContain("E4");
    expect(keyLabels).not.toContain("3");
  });

  it("uses contrasting white pitch and finger labels on a white key colored during Listen", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const n: Note = {
      ...note("listen-c", 60, 1, 2),
      finger: 1,
      fingerHand: "right",
    };
    const fixture = song([n]);
    const { canvas, fills, labelPaints } = drawingCanvas();
    draw(
      canvas,
      fixture,
      fixture.notes,
      1.25,
      new MidiState(),
      new Practice(fixture.notes),
      true,
      false,
      true,
    );
    const [min, max] = range(fixture);
    const key = keyLayout(min, max).find((entry) => entry.pitch === n.pitch)!;
    expect(fills).toContainEqual({
      x: key.x * 880,
      y: strikeLine,
      color: rightColor,
    });
    expect(
      labelPaints.filter(
        ({ text, y }) => y >= strikeLine && (text === "C4" || text === "1"),
      ),
    ).toEqual([
      {
        text: "1",
        x: (key.x + key.width / 2) * 880,
        y: 400 - 15,
        color: "#fff",
      },
      {
        text: "C4",
        x: (key.x + key.width / 2) * 880,
        y: 400 - 35,
        color: "#fff",
      },
    ]);
  });

  it("applies a controller-track pedal to matching channels on other tracks, through tempo changes", () => {
    const tracks: Parameters<typeof writeMidi>[0]["tracks"] = [
      [
        { deltaTime: 0, type: "setTempo", microsecondsPerBeat: 500000 },
        {
          deltaTime: 0,
          type: "controller",
          channel: 0,
          controllerType: 64,
          value: 127,
        },
        { deltaTime: 480, type: "setTempo", microsecondsPerBeat: 1000000 },
        {
          deltaTime: 480,
          type: "controller",
          channel: 0,
          controllerType: 64,
          value: 0,
        },
        { deltaTime: 0, type: "endOfTrack" },
      ],
      [
        {
          deltaTime: 0,
          type: "noteOn",
          channel: 0,
          noteNumber: 60,
          velocity: 80,
        },
        {
          deltaTime: 240,
          type: "noteOff",
          channel: 0,
          noteNumber: 60,
          velocity: 0,
        },
        { deltaTime: 0, type: "endOfTrack" },
      ],
      [
        {
          deltaTime: 0,
          type: "noteOn",
          channel: 1,
          noteNumber: 64,
          velocity: 80,
        },
        {
          deltaTime: 240,
          type: "noteOff",
          channel: 1,
          noteNumber: 64,
          velocity: 0,
        },
        { deltaTime: 0, type: "endOfTrack" },
      ],
    ];
    const bytes = Uint8Array.from(
      writeMidi({
        header: { format: 1, ticksPerBeat: 480, numTracks: tracks.length },
        tracks,
      }),
    );
    const imported = parseSong(bytes, "Cross-track sustain", "cross-track");
    expect(imported.notes.find((n) => n.pitch === 60)).toMatchObject({
      track: 1,
      channel: 0,
      end: 0.25,
      soundEnd: 1.5,
    });
    expect(imported.notes.find((n) => n.pitch === 64)).toMatchObject({
      track: 2,
      channel: 1,
      end: 0.25,
      soundEnd: 0.25,
    });
  });

  it("matches a shared-pitch onset on selected tracks with one press while preserving the next repeated note", () => {
    const notes = [
      note("left-c", 60, 1, 1.4, 0),
      note("right-c", 60, 1, 1.4, 1),
      note("repeat-c", 60, 2, 2.4, 1),
    ];
    const practice = new Practice(notes);
    practice.reset(0);
    practice.input(60, 1.05, "rhythm", 0.22, 1, new Set([60]));
    expect(practice.hit).toEqual(new Set(["left-c", "right-c"]));
    practice.expire(1.5, 0.22, 1);
    expect(practice.missed.size).toBe(0);
    practice.input(60, 2, "rhythm", 0.22, 1, new Set([60]));
    expect(practice.hit).toEqual(new Set(["left-c", "right-c", "repeat-c"]));
  });

  it("anchors a very short waterfall note to its true onset and the same keyboard column", () => {
    // These drawing calls are a geometry unit check, not a real-browser rendering check.
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const context = {
      ...keyboardPaintMocks(),
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn(),
      arc: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      getBoundingClientRect: () => ({ width: 880, height: 400 }),
    } as unknown as HTMLCanvasElement;
    const short = note("short", 61, 1, 1.005),
      fixture = song([short]);
    const practice = new Practice(fixture.notes);
    const check = (position: number) => {
      context.roundRect.mockClear();
      draw(
        canvas,
        fixture,
        fixture.notes,
        position,
        new MidiState(),
        practice,
        false,
        false,
        false,
      );
      return context.roundRect.mock.calls[0] as number[];
    };
    const before = check(0.9),
      atOnset = check(1);
    expect(before[3]).toBe(8); // Kept visible despite a subpixel physical duration.
    expect(before[1] + before[3]).toBeCloseTo(
      strikeLine - 0.1 * pixelsPerSecond,
    );
    expect(atOnset[1] + atOnset[3]).toBeCloseTo(strikeLine);
    const [min, max] = range(fixture),
      key = keyLayout(min, max).find((k) => k.pitch === 61)!;
    expect(atOnset[0]).toBeCloseTo(key.x * 880 + 2);
    expect(
      context.moveTo.mock.calls.some(
        ([x, y]) => Math.abs(x - key.x * 880) < 0.001 && y === strikeLine,
      ),
    ).toBe(true);
    expect(canvas.width).toBe(1760);
    expect(canvas.height).toBe(800);
  });

  it("caches each song's tempo scan and tick bound while retaining its tempo-aware beat grid", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const context = {
      ...keyboardPaintMocks(),
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn(),
      arc: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      getBoundingClientRect: () => ({ width: 880, height: 400 }),
    } as unknown as HTMLCanvasElement;
    let tempoReads = 0;
    const tempos = [
      {
        tick: 0,
        get microseconds() {
          tempoReads++;
          return 1000000;
        },
      },
      {
        tick: 960,
        get microseconds() {
          tempoReads++;
          return 500000;
        },
      },
    ];
    const fixture = song([note("tempo-grid", 60, 0, 0.5)]);
    fixture.duration = 6;
    const readTempos = vi.fn(() => tempos);
    Object.defineProperty(fixture, "tempos", { get: readTempos });
    const render = (current: Song, position: number) => {
      context.fillText.mockClear();
      draw(
        canvas,
        current,
        current.notes,
        position,
        new MidiState(),
        new Practice(current.notes),
        false,
        false,
        false,
      );
      return context.fillText.mock.calls.find(([text]) => text === "beat 5");
    };

    // Beat 5 lands at 3 seconds: two 1-second beats, then two .5-second beats.
    expect(render(fixture, 0)).toEqual([
      "beat 5",
      7,
      strikeLine - 3 * pixelsPerSecond - 5,
    ]);
    const initialReads = tempoReads;
    expect(initialReads).toBeGreaterThan(0);
    expect(readTempos).toHaveBeenCalledOnce();
    for (let frame = 1; frame <= 50; frame++) render(fixture, frame / 50);
    expect(tempoReads).toBe(initialReads);
    expect(readTempos).toHaveBeenCalledOnce();
    expect(context.fillText.mock.calls).toContainEqual([
      "beat 5",
      7,
      strikeLine - 2 * pixelsPerSecond - 5,
    ]);

    // Another song uses its own default-tempo grid; returning retains the first cache.
    expect(render(song([note("default-grid", 60, 0, 0.5)]), 0)).toEqual([
      "beat 5",
      7,
      strikeLine - 2 * pixelsPerSecond - 5,
    ]);
    expect(render(fixture, 1)).toEqual([
      "beat 5",
      7,
      strikeLine - 2 * pixelsPerSecond - 5,
    ]);
    expect(tempoReads).toBe(initialReads);
    expect(readTempos).toHaveBeenCalledOnce();
  });

  it("bounds 50,000 visible rectangles while scanning all active pitches for the keyboard", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const notes = Array.from({ length: 50000 }, (_, i) =>
      note(`dense-${i}`, 60, 0, 1 + i / 50000),
    );
    notes[notes.length - 1] = note("last-left", 48, 0, 2, 1);
    const fixture = song(notes);
    fixture.tracks.push({ id: 1, name: "Left", hand: "left", count: 1 });
    const { canvas, context, fills } = drawingCanvas();
    draw(
      canvas,
      fixture,
      notes,
      0.5,
      new MidiState(),
      new Practice(notes),
      false,
      false,
      true,
    );
    expect(context.roundRect).toHaveBeenCalledTimes(MAX_VISIBLE_NOTES);
    const [min, max] = range(fixture);
    const left = keyLayout(min, max).find((key) => key.pitch === 48)!;
    expect(fills).toContainEqual({
      x: left.x * 880,
      y: strikeLine,
      color: leftColor,
    });
  });

  it("keeps the nearest notes in onset order when the visible drawing budget is exhausted", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const notes = Array.from({ length: 5000 }, (_, i) =>
      note(`ordered-${i}`, 60, i / 1000, i / 1000 + 0.25),
    );
    const fixture = song(notes);
    const { canvas, context } = drawingCanvas();
    draw(
      canvas,
      fixture,
      notes,
      0,
      new MidiState(),
      new Practice(notes),
      false,
      false,
      false,
    );
    expect(context.roundRect).toHaveBeenCalledTimes(MAX_VISIBLE_NOTES);
    const rectangles = context.roundRect.mock.calls as number[][];
    expect(rectangles[0][1] + rectangles[0][3]).toBe(strikeLine);
    const last = rectangles.at(-1)!;
    expect(last[1] + last[3]).toBeCloseTo(
      strikeLine - ((MAX_VISIBLE_NOTES - 1) / 1000) * pixelsPerSecond,
    );
  });

  it("coalesces dense duplicate geometry per hand and caches Wait targets without per-note chord scans", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const notes = Array.from({ length: 50000 }, (_, i) =>
      note(`chord-${i}`, 60, 1, 2, i === 49999 ? 1 : 0),
    );
    const fixture = song(notes);
    fixture.tracks.push({ id: 1, name: "Left", hand: "left", count: 1 });
    const practice = new Practice(notes),
      group = practice.gate!;
    const expected = group.notes;
    const readExpected = vi.fn(() => expected);
    Object.defineProperty(group, "notes", { get: readExpected });
    const scanExpected = vi.spyOn(expected, "some").mockImplementation(() => {
      throw new Error("Expected chord membership must use the cached ID set.");
    });
    const { canvas, context } = drawingCanvas();
    for (let frame = 0; frame < 3; frame++) {
      context.roundRect.mockClear();
      draw(
        canvas,
        fixture,
        notes,
        frame / 10,
        new MidiState(),
        practice,
        false,
        true,
        false,
      );
      expect(context.roundRect).toHaveBeenCalledTimes(2);
    }
    expect(readExpected).toHaveBeenCalledOnce();
    expect(scanExpected).not.toHaveBeenCalled();
    expect(practice.notes).toHaveLength(50000); // Rendering never removes scoring notes.
  });
});

function audioContext() {
  const sources: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    playbackRate: { value: number };
    onended: (() => void) | null;
  }[] = [];
  const envelopes: {
    setTargetAtTime: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const context = {
    currentTime: 10,
    sampleRate: 48000,
    state: "running",
    destination: {},
    createBufferSource: () => {
      const source = {
        playbackRate: { value: 1 },
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null as (() => void) | null,
      };
      source.connect.mockImplementation((target) => target);
      sources.push(source);
      return source;
    },
    createGain: () => {
      const gain = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          setTargetAtTime: vi.fn(),
          cancelAndHoldAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gain.connect.mockImplementation((target) => target);
      envelopes.push({
        setTargetAtTime: gain.gain.setTargetAtTime,
        disconnect: gain.disconnect,
      });
      return gain;
    },
  };
  return { context, sources, envelopes };
}

describe("reference audio scheduling with a fake Web Audio context", () => {
  it("uses transport speed for onset and sustain duration, avoids duplicate scheduling, and cancels on seek", () => {
    const { context, sources, envelopes } = audioContext();
    const audio = new ReferenceAudio();
    audio.context = context as unknown as AudioContext;
    for (const region of PIANO_REGIONS)
      audio.samples.set(region.file, {
        duration: 20,
        length: 20 * 48000,
        numberOfChannels: 2,
      } as AudioBuffer);
    const transport = new Transport(4);
    transport.speed = 0.5;
    transport.play(10);
    const n = { ...note("reference", 69, 0.05, 0.25), soundEnd: 0.5 };
    const region = selectPianoRegion(n.pitch, n.velocity)!;
    audio.schedule([n], transport, true);
    expect(sources).toHaveLength(1);
    expect(sources[0].start.mock.calls[0][0]).toBeCloseTo(10.1);
    expect(sources[0].start.mock.calls[0][1]).toBe(region.offset);
    expect(sources[0].playbackRate.value).toBe(1);
    expect(envelopes[0].setTargetAtTime.mock.calls[0][1]).toBeCloseTo(11);
    audio.schedule([n], transport, true);
    expect(sources).toHaveLength(1);

    context.currentTime = 10.2;
    // Studio.seek stops the reference before it moves the transport.
    audio.stop(false);
    transport.seek(0.2, context.currentTime);
    audio.schedule([n], transport, true);
    expect(sources).toHaveLength(2);
    expect(sources[0].stop.mock.lastCall![0]).toBeCloseTo(10.25);
    expect(envelopes[0].disconnect).not.toHaveBeenCalled();
    sources[0].onended!();
    expect(envelopes[0].disconnect).toHaveBeenCalled();
    expect(sources[1].start).toHaveBeenCalledWith(10.2, region.offset);
    expect(envelopes[1].setTargetAtTime.mock.calls[0][1]).toBeCloseTo(10.8);

    transport.pause(context.currentTime);
    audio.stop();
    expect(audio.voices.size).toBe(0);
    expect(audio.scheduled.size).toBe(0);
    expect(sources[1].stop.mock.lastCall![0]).toBeCloseTo(10.25);
    audio.schedule([n], transport, true);
    expect(sources).toHaveLength(2);
  });
});
