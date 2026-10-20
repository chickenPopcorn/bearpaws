import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANSWER_ZONE,
  CONTROL_KEYS,
  CONTROL_ZONE,
  ControlKeys,
  HOLD_MS,
  IntervalGame,
  PLAY_ZONE,
  PaintGame,
  RETRY_MS,
  TOGETHER_MS,
  WORKBOOK_PAGES,
  bookName,
  feedback,
  instruction,
  intervalFeedback,
  intervalInstruction,
  intervalName,
  intervalPrompt,
  intervalSize,
  prompt,
  pageAfter,
  pageBefore,
  readStamps,
  stampPage,
  stampText,
  zoneOf,
  type ControlAction,
  type IntervalPage,
  type NotePage,
} from "../src/workbook";
import { workbookKeys } from "../src/workbookKeyboard";

const page = (number: number) =>
  WORKBOOK_PAGES.find((p) => p.page === number) as NotePage;
const intervals = (number: number) =>
  WORKBOOK_PAGES.find((p) => p.page === number) as IntervalPage;
const notePages = WORKBOOK_PAGES.filter(
  (p): p is NotePage => p.game !== "color-by-interval",
);
const intervalPages = WORKBOOK_PAGES.filter(
  (p): p is IntervalPage => p.game === "color-by-interval",
);

describe("workbook pages", () => {
  it("lists the built pages in book order", () => {
    expect(WORKBOOK_PAGES.map((p) => p.page)).toEqual([
      4, 7, 8, 9, 10, 11, 12, 14, 21, 26, 33, 36, 37, 38, 42, 45, 48,
    ]);
  });

  it("keeps every printed note in the play zone, on a white key", () => {
    for (const pitch of [
      ...notePages.flatMap((p) => [
        ...p.steps.flatMap((s) => s.pitches),
        ...(p.areas ?? []).map((a) => a.pitch),
      ]),
      ...intervalPages.flatMap((p) => p.areas.flatMap((a) => a.notes)),
    ]) {
      expect(zoneOf(pitch)).toBe("play");
      expect(pitch).toBeGreaterThanOrEqual(PLAY_ZONE[0]);
      expect(pitch).toBeLessThanOrEqual(PLAY_ZONE[1]);
      expect([0, 2, 4, 5, 7, 9, 11]).toContain(pitch % 12);
    }
  });

  it("gives every Color by Note note an area, and every area one step", () => {
    for (const p of notePages.filter((p) => p.game === "color-by-note")) {
      const steps = p.steps.flatMap((s) => s.pitches);
      expect(new Set(steps).size).toBe(steps.length);
      expect(new Set(p.areas!.map((a) => a.pitch))).toEqual(new Set(steps));
    }
  });

  it("puts exactly the steps' notes on a Crayon Keys staff", () => {
    for (const p of notePages.filter((p) => p.staff)) {
      const steps = p.steps.flatMap((s) => s.pitches);
      expect(p.staff!.map((n) => n.pitch).sort()).toEqual(steps.sort());
    }
    // Page 36's staff, left to right, as printed.
    expect(page(36).staff!.map((n) => n.pitch)).toEqual([52, 50, 53, 55, 48]);
    expect(page(37).staff).toEqual([
      { pitch: 64, clef: "treble" },
      { pitch: 60, clef: "bass" },
    ]);
  });

  it("has each picture's areas as printed", () => {
    // Areas per note, as read from the book's pages.
    const counts = (number: number) => {
      const tally: Record<number, number> = {};
      for (const { pitch } of page(number).areas!)
        tally[pitch] = (tally[pitch] ?? 0) + 1;
      return tally;
    };
    expect(counts(4)).toEqual({
      53: 1,
      55: 1,
      57: 2,
      59: 2,
      60: 2,
      62: 6,
      64: 2,
      65: 1,
      67: 1,
    });
    expect(counts(8)).toEqual({ 48: 3, 60: 2 });
    expect(counts(10)).toEqual({ 48: 2, 50: 2, 62: 3 });
    expect(counts(12)).toEqual({ 48: 2, 50: 2, 52: 2, 64: 2 });
    expect(counts(21)).toEqual({
      48: 1,
      50: 1,
      52: 1,
      53: 1,
      55: 1,
      60: 1,
      62: 1,
      64: 1,
      65: 1,
      67: 1,
    });
    expect(counts(48)).toEqual({
      48: 1,
      50: 2,
      52: 1,
      53: 1,
      55: 1,
      57: 2,
      59: 2,
      60: 2,
      62: 1,
      64: 1,
      65: 1,
      67: 1,
    });
    // Middle C in the bass clef, with its ledger line above the staff.
    expect(
      [4, 48].map((n) => page(n).areas!.filter((a) => a.clef === "bass")),
    ).toEqual([
      [expect.objectContaining({ pitch: 60 })],
      [expect.objectContaining({ pitch: 60 })],
    ]);
  });

  it("keeps every area inside its picture", () => {
    for (const p of WORKBOOK_PAGES) {
      if (!p.areas) continue;
      const height = p.picture?.height ?? 300;
      for (const a of p.areas!) {
        expect(a.x).toBeGreaterThan(0);
        expect(a.x).toBeLessThan(640);
        expect(a.y).toBeGreaterThan(0);
        expect(a.y).toBeLessThan(height);
      }
    }
  });

  it("words each step as the book does", () => {
    expect(page(7).steps.map((s) => instruction(page(7), s))).toEqual([
      "Color MIDDLE C green.",
      "Color BASS CLEF C red.",
    ]);
    expect(page(10).steps.map((s) => instruction(page(10), s))).toEqual([
      "Color the areas containing TREBLE CLEF D yellow.",
      "Color the areas containing BASS CLEF D blue.",
      "Color the areas containing BASS CLEF C pink.",
    ]);
    expect(page(4).steps.map((s) => instruction(page(4), s))).toEqual([
      "Color the areas containing an A pink.",
      "Color the areas containing a B green.",
      "Color the areas containing a C yellow.",
      "Color the areas containing a D brown.",
      "Color the areas containing an E red.",
      "Color the areas containing an F blue.",
      "Color the areas containing a G orange.",
    ]);
  });

  it("words staff pages and page 14 as the book does", () => {
    expect(page(36).steps.map((s) => instruction(page(36), s))[0]).toBe(
      "Color the BASS CLEF C on the keyboard and staff green.",
    );
    expect(page(37).steps.map((s) => instruction(page(37), s))).toEqual([
      "Color the C on the keyboard and staff green.",
      "Color the E on the keyboard and staff red.",
    ]);
    expect(instruction(page(14), page(14).steps[0])).toBe(
      "Color C, D, E, F and G from the Left Hand C POSITION blue.",
    );
    expect(prompt(page(14), page(14).steps[0])).toBe(
      "Find Left Hand C Position: C D E F G",
    );
    expect(prompt(page(38), page(38).steps[0])).toBe("Play the D on the staff");
    expect(prompt(page(42), page(42).steps[0])).toBe("Find TREBLE CLEF F");
  });

  it("prompts by clef, or by letter where the book uses letters", () => {
    expect(prompt(page(9), page(9).steps[1])).toBe("Find BASS CLEF D");
    expect(prompt(page(12), page(12).steps[0])).toBe("Play TREBLE CLEF E");
    expect(prompt(page(21), page(21).steps[3])).toBe("Play every F");
  });

  it("finds the built pages before and after a page", () => {
    expect(pageBefore(page(4))).toBeUndefined();
    expect(pageAfter(page(7))?.page).toBe(8);
    expect(pageBefore(page(10))?.page).toBe(9);
    expect(pageAfter(page(12))?.page).toBe(14);
    expect(pageBefore(page(48))?.page).toBe(45);
    expect(pageAfter(page(21))?.page).toBe(26);
    expect(pageAfter(page(48))).toBeUndefined();
  });

  it("names notes as the book does", () => {
    expect(bookName(60)).toBe("MIDDLE C");
    expect(bookName(48)).toBe("BASS CLEF C");
    expect(bookName(52)).toBe("BASS CLEF E");
    expect(bookName(62)).toBe("TREBLE CLEF D");
    expect(bookName(38)).toBe("D");
  });
});

describe("interval pages", () => {
  // Each area's notes, as read from the printed pages.
  const printed = (number: number) =>
    intervals(number).areas.map(
      (a) => `${a.notes.join(a.harmonic ? "+" : ">")}`,
    );

  it("has each area's two notes as printed", () => {
    expect(printed(26)).toEqual([
      "65>62",
      "60>59",
      "53>55",
      "65>67",
      "59>55",
      "60>64",
    ]);
    expect(printed(33)).toEqual(["53+55", "64>65", "52+55", "67>65", "60>62"]);
    expect(printed(45)).toEqual([
      "60>65",
      "53>60",
      "62>67",
      "60+67",
      "60+65",
      "55+60",
      "48>55",
      "55>50",
    ]);
  });

  it("gives every area exactly one step", () => {
    for (const p of intervalPages)
      for (const area of p.areas) {
        const steps = p.steps.filter((step) =>
          "size" in step.match
            ? intervalSize(area.notes) === step.match.size
            : area.harmonic === step.match.harmonic,
        );
        expect(steps).toHaveLength(1);
      }
  });

  it("measures intervals on the staff", () => {
    expect(intervalSize([60, 62])).toBe(2);
    expect(intervalSize([65, 62])).toBe(3);
    expect(intervalSize([60, 65])).toBe(4);
    expect(intervalSize([48, 55])).toBe(5);
    expect([2, 3, 4, 5].map(intervalName)).toEqual([
      "2nd",
      "3rd",
      "4th",
      "5th",
    ]);
  });

  it("words each step as the book does", () => {
    expect(intervals(26).steps.map(intervalInstruction)).toEqual([
      "Color the areas containing 2nds pink.",
      "Color the areas containing 3rds purple.",
    ]);
    expect(intervals(33).steps.map(intervalInstruction)).toEqual([
      "Color the areas containing a melodic interval green.",
      "Color the areas containing a harmonic interval blue.",
    ]);
    expect(intervals(45).steps.map(intervalInstruction)).toEqual([
      "Color the areas containing 4ths green.",
      "Color the areas containing 5ths yellow.",
    ]);
    expect(intervalPrompt(intervals(33).areas[0])).toBe(
      "Play the two notes together",
    );
    expect(intervalPrompt(intervals(33).areas[1])).toBe(
      "Play the two notes, left then right",
    );
  });
});

describe("IntervalGame", () => {
  const held = (...pitches: number[]) => new Set(pitches);

  it("plays the areas in step order and paints each in its step's crayon", () => {
    const game = new IntervalGame(intervals(26));
    // The 2nds (areas 1, 2, 3), then the 3rds (0, 4, 5).
    expect(game.order).toEqual([1, 2, 3, 0, 4, 5]);
    expect(game.current).toBe(1);
    expect(game.step).toBe(0);
    expect(game.play(60, 0, held(60))).toEqual({ kind: "next" });
    expect(game.play(59, 500, held(59))).toEqual({
      kind: "painted",
      finished: false,
    });
    expect([...game.painted]).toEqual([[1, "pink"]]);
    expect(game.current).toBe(2);
    let time = 1000;
    for (const index of [2, 3, 0, 4, 5]) {
      const [first, second] = intervals(26).areas[index].notes;
      game.play(first, (time += 500), held(first));
      game.play(second, (time += 500), held(second));
    }
    expect(game.finished).toBe(true);
    expect(game.step).toBe(2);
    expect([...game.painted.values()]).toEqual([
      "pink",
      "pink",
      "pink",
      "purple",
      "purple",
      "purple",
    ]);
    expect(game.play(60, 9000, held(60))).toEqual({ kind: "finished" });
  });

  it("wants a melodic interval's notes in order, one after the other", () => {
    const game = new IntervalGame(intervals(26));
    // Area 1: C4, then B3.
    expect(game.play(59, 0, held(59))).toEqual({ kind: "order" });
    expect(game.play(60, 100, held(60))).toEqual({ kind: "next" });
    expect(game.play(59, 100 + TOGETHER_MS - 1, held(60, 59))).toEqual({
      kind: "together",
    });
    // A together try starts over from the left note.
    expect(game.play(59, 1000, held(59))).toEqual({ kind: "order" });
    game.play(60, 2000, held(60));
    expect(game.play(59, 2400, held(60, 59))).toMatchObject({
      kind: "painted",
    });
  });

  it("wants a harmonic interval's notes together", () => {
    const game = new IntervalGame(intervals(33));
    // The melodic ones come first; skip to the harmonic F3 + G3.
    let time = 0;
    for (const index of [1, 3, 4]) {
      const [first, second] = intervals(33).areas[index].notes;
      game.play(first, (time += 500), held(first));
      game.play(second, (time += 500), held(second));
    }
    expect(game.current).toBe(0);
    expect(game.step).toBe(1);
    // One note is half a try; the other, long after with the first held, is apart.
    expect(game.play(53, 5000, held(53))).toEqual({ kind: "waiting" });
    expect(game.play(55, 5600, held(53, 55))).toEqual({ kind: "apart" });
    // Both within the window paints, in either order.
    expect(game.play(55, 7000, held(55))).toEqual({ kind: "waiting" });
    expect(game.play(53, 7000 + TOGETHER_MS, held(55, 53))).toMatchObject({
      kind: "painted",
    });
    expect(game.painted.get(0)).toBe("blue");
  });

  it("starts a new try when a harmonic note comes long after the other", () => {
    const game = new IntervalGame(intervals(45));
    // Area 3, C4 + G4, is the third 4th... the first harmonic is area 4.
    const harmonicIndex = game.order.find(
      (i) => intervals(45).areas[i].harmonic,
    )!;
    let time = 0;
    while (game.current !== harmonicIndex) {
      const [first, second] = intervals(45).areas[game.current!].notes;
      game.play(first, (time += 500), held(first));
      game.play(second, (time += 500), held(second));
    }
    const [low, high] = intervals(45).areas[harmonicIndex].notes;
    game.play(low, 10_000, held(low));
    // Let go, and much later the other note alone: a new try, not a mistake.
    expect(game.play(high, 10_000 + RETRY_MS + 1, held(high))).toEqual({
      kind: "waiting",
    });
    expect(
      game.play(low, 10_000 + RETRY_MS + 50, held(high, low)),
    ).toMatchObject({ kind: "painted" });
  });

  it("hints at a wrong key, then shows the letters", () => {
    const game = new IntervalGame(intervals(26));
    expect(game.play(57, 0, held(57))).toEqual({
      kind: "wrong",
      pitch: 57,
      lettersShown: false,
    });
    expect(game.play(72, 100, held(72))).toEqual({
      kind: "octave",
      pitch: 72,
      direction: "lower",
      lettersShown: true,
    });
    expect(game.letters).toBe(true);
    game.play(60, 1000, held(60));
    game.play(59, 1500, held(59));
    expect(game.letters).toBe(false);
    game.hint();
    expect(game.letters).toBe(true);
  });

  it("names the interval painted, in the page's words", () => {
    const p26 = intervals(26),
      p33 = intervals(33);
    const painted = { kind: "painted", finished: false } as const;
    expect(intervalFeedback(p26, painted, p26.areas[0])).toBe(
      "Yes! That is a 3rd: purple.",
    );
    expect(intervalFeedback(p33, painted, p33.areas[0])).toBe(
      "Yes! Together, so it is harmonic: blue.",
    );
    expect(intervalFeedback(p33, painted, p33.areas[1])).toBe(
      "Yes! One after the other, so it is melodic: green.",
    );
    expect(intervalFeedback(p33, { kind: "waiting" }, p33.areas[0])).toBeNull();
    expect(intervalFeedback(p33, { kind: "apart" }, p33.areas[0])).toBe(
      "These notes are stacked: play them at the same time.",
    );
    expect(intervalFeedback(p26, { kind: "order" }, p26.areas[1])).toBe(
      "Start with the note on the left.",
    );
    expect(
      intervalFeedback(
        p26,
        { kind: "wrong", pitch: 61, lettersShown: false },
        p26.areas[1],
      ),
    ).toBe("That is a black key. Both notes are on white keys.");
    expect(
      intervalFeedback(
        intervals(45),
        { kind: "painted", finished: true },
        undefined,
      ),
    ).toBe("Page 45 is done. Next page: E2.");
  });
});

describe("zones", () => {
  it("splits the piano into control, play and answer keys", () => {
    expect(zoneOf(CONTROL_ZONE[0])).toBe("control");
    expect(zoneOf(41)).toBe("control");
    expect(zoneOf(42)).toBe("play");
    expect(zoneOf(78)).toBe("play");
    expect(zoneOf(ANSWER_ZONE[0])).toBe("answer");
    expect(zoneOf(84)).toBe("answer");
  });

  it("lays the three zones out left to right without overlap", () => {
    const keys = workbookKeys();
    const pitches = keys.map((k) => k.pitch);
    expect(pitches[0]).toBe(36);
    expect(pitches.at(-1)).toBe(84);
    const whites = keys.filter((k) => !k.black);
    for (let i = 1; i < whites.length; i++)
      expect(whites[i].x).toBeGreaterThanOrEqual(
        whites[i - 1].x + whites[i - 1].width - 1e-9,
      );
    const last = whites.at(-1)!;
    expect(last.x + last.width).toBeCloseTo(1);
    // A gap separates the zones.
    const f2 = whites.find((k) => k.pitch === 41)!,
      c3 = whites.find((k) => k.pitch === 48)!;
    expect(c3.x - (f2.x + f2.width)).toBeCloseTo(f2.width);
  });
});

describe("PaintGame", () => {
  it("paints a Crayon Keys page in step order, then finishes", () => {
    const game = new PaintGame(page(9));
    expect(game.current).toEqual({ crayon: "yellow", pitches: [62] });
    // The second step's note does not paint yet.
    expect(game.play(50)).toMatchObject({
      kind: "octave",
      direction: "higher",
    });
    expect(game.painted.size).toBe(0);
    expect(game.play(62)).toEqual({
      kind: "painted",
      pitch: 62,
      left: 0,
      finished: false,
    });
    expect(game.play(50)).toEqual({
      kind: "painted",
      pitch: 50,
      left: 0,
      finished: true,
    });
    expect(game.finished).toBe(true);
    expect([...game.painted]).toEqual([
      [62, "yellow"],
      [50, "blue"],
    ]);
    expect(game.play(60)).toEqual({ kind: "finished" });
  });

  it("shows letters after two misses on a step, until the step is done", () => {
    const game = new PaintGame(page(7));
    expect(game.play(62)).toEqual({
      kind: "wrong",
      pitch: 62,
      lettersShown: false,
    });
    expect(game.letters).toBe(false);
    expect(game.play(61)).toEqual({
      kind: "wrong",
      pitch: 61,
      lettersShown: true,
    });
    expect(game.letters).toBe(true);
    // Only the miss that shows them says so.
    expect(game.play(72)).toMatchObject({
      kind: "octave",
      lettersShown: false,
    });
    game.play(60);
    expect(game.letters).toBe(false);
  });

  it("shows letters on the hint key, but not once the page is done", () => {
    const game = new PaintGame(page(11));
    game.hint();
    expect(game.letters).toBe(true);
    game.play(64);
    game.play(52);
    game.hint();
    expect(game.letters).toBe(false);
  });

  it("paints every area holding the step's note on Color by Note", () => {
    const p = page(10);
    const game = new PaintGame(p);
    game.play(62);
    const painted = p.areas!.filter((a) => game.painted.has(a.pitch));
    expect(painted).toHaveLength(3);
    expect(painted.every((a) => a.pitch === 62)).toBe(true);
    game.play(50);
    game.play(48);
    expect(game.finished).toBe(true);
    expect(p.areas!.every((a) => game.painted.has(a.pitch))).toBe(true);
  });

  it("paints page 14's five keys in any order before finishing", () => {
    const game = new PaintGame(page(14));
    for (const pitch of [55, 48, 52, 50]) game.play(pitch);
    expect(game.finished).toBe(false);
    expect(game.left).toEqual([53]);
    expect(game.play(53)).toMatchObject({ kind: "painted", finished: true });
    expect(game.painted.size).toBe(5);
  });

  it("finishes a letter step once each of its notes is played", () => {
    const game = new PaintGame(page(21));
    expect(game.play(48)).toEqual({
      kind: "painted",
      pitch: 48,
      left: 1,
      finished: false,
    });
    expect(game.step).toBe(0);
    expect(game.play(48)).toEqual({ kind: "again", pitch: 48 });
    // The C still to find is below C5.
    expect(game.play(72)).toMatchObject({ kind: "octave", direction: "lower" });
    expect(game.play(60)).toMatchObject({ kind: "painted", left: 0 });
    expect(game.step).toBe(1);
    expect([...game.painted.values()]).toEqual(["green", "green"]);
  });
});

describe("feedback", () => {
  const p = page(9);
  const target = p.steps[0];
  it("points to the other octave", () => {
    expect(
      feedback(
        p,
        { kind: "octave", pitch: 50, direction: "higher", lettersShown: false },
        target,
      ),
    ).toBe("That is BASS CLEF D. Go higher.");
  });
  it("names a wrong white key and says when letters appear", () => {
    expect(
      feedback(p, { kind: "wrong", pitch: 64, lettersShown: true }, target),
    ).toBe("That is E. Look for D. The letters are on the keys now.");
  });
  it("says a black key is not the white key wanted", () => {
    expect(
      feedback(p, { kind: "wrong", pitch: 63, lettersShown: false }, target),
    ).toBe("That is a black key. D is a white key.");
  });
  it("says the last page is the last, with no next page to go to", () => {
    expect(
      feedback(
        page(48),
        { kind: "painted", pitch: 67, left: 0, finished: true },
        undefined,
      ),
    ).toBe("Page 48 is done. This is the last page so far.");
    expect(feedback(page(48), { kind: "finished" }, undefined)).toBe(
      "Page 48 is done. This is the last page so far.",
    );
  });
  it("praises a painted key and finishes the page", () => {
    expect(
      feedback(
        p,
        { kind: "painted", pitch: 62, left: 0, finished: false },
        target,
      ),
    ).toBe("Yes! Next crayon.");
    expect(
      feedback(
        p,
        { kind: "painted", pitch: 50, left: 0, finished: true },
        undefined,
      ),
    ).toBe("Page 9 is done. Next page: E2.");
  });
  it("counts down a step of several letters", () => {
    const step = page(14).steps[0];
    expect(
      feedback(
        page(14),
        { kind: "painted", pitch: 48, left: 4, finished: false },
        step,
      ),
    ).toBe("Yes! 4 more to find.");
    expect(feedback(page(14), { kind: "again", pitch: 48 }, step)).toBe(
      "That C is painted.",
    );
    expect(
      feedback(
        page(14),
        { kind: "wrong", pitch: 57, lettersShown: false },
        step,
      ),
    ).toBe("That is A. Look for C, D, E, F or G.");
  });
  it("sends the child to a letter's other note", () => {
    const c = page(21).steps[0];
    expect(
      feedback(
        page(21),
        { kind: "painted", pitch: 48, left: 1, finished: false },
        c,
      ),
    ).toBe("Yes! Now find the other C.");
    expect(feedback(page(21), { kind: "again", pitch: 48 }, c)).toBe(
      "That C is painted. Find the other C.",
    );
  });
});

describe("ControlKeys", () => {
  let actions: ControlAction[];
  let keys: ControlKeys;
  beforeEach(() => {
    vi.useFakeTimers();
    actions = [];
    keys = new ControlKeys((action) => actions.push(action));
  });
  afterEach(() => {
    keys.clear();
    vi.useRealTimers();
  });

  it("ignores keys outside the control zone", () => {
    expect(keys.down(60)).toBe(false);
    expect(keys.up(60)).toBe(false);
    expect(keys.down(80)).toBe(false);
    expect(actions).toEqual([]);
  });

  it("acts on hint and next as they go down", () => {
    expect(keys.down(CONTROL_KEYS.hint)).toBe(true);
    keys.up(CONTROL_KEYS.hint);
    keys.down(CONTROL_KEYS.next);
    keys.up(CONTROL_KEYS.next);
    expect(actions).toEqual(["hint", "next"]);
  });

  it("goes back on a short press of D2, and leaves on a hold", () => {
    keys.down(CONTROL_KEYS.back);
    vi.advanceTimersByTime(HOLD_MS - 1);
    keys.up(CONTROL_KEYS.back);
    keys.down(CONTROL_KEYS.back);
    vi.advanceTimersByTime(HOLD_MS);
    keys.up(CONTROL_KEYS.back);
    expect(actions).toEqual([
      "holding-leave",
      "back",
      "holding-leave",
      "leave",
    ]);
  });

  it("starts over only after F2 is held", () => {
    keys.down(CONTROL_KEYS.restart);
    keys.up(CONTROL_KEYS.restart);
    keys.down(CONTROL_KEYS.restart);
    vi.advanceTimersByTime(HOLD_MS);
    keys.up(CONTROL_KEYS.restart);
    expect(actions).toEqual([
      "holding-restart",
      "restart-short",
      "holding-restart",
      "restart",
    ]);
  });

  it("does nothing when a held key was let go unseen", () => {
    const held = new Set([CONTROL_KEYS.restart as number]);
    keys = new ControlKeys(
      (action) => actions.push(action),
      (pitch) => held.has(pitch),
    );
    keys.down(CONTROL_KEYS.restart);
    held.clear();
    vi.advanceTimersByTime(HOLD_MS);
    expect(actions).toEqual(["holding-restart"]);
  });

  it("drops a pending hold when cleared", () => {
    keys.down(CONTROL_KEYS.restart);
    keys.clear();
    vi.advanceTimersByTime(HOLD_MS);
    expect(actions).toEqual(["holding-restart"]);
  });

  it("treats the control zone's black keys as controls that do nothing", () => {
    expect(keys.down(37)).toBe(true);
    expect(keys.up(37)).toBe(true);
    expect(actions).toEqual([]);
  });
});

describe("stamps", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("stamps a page with the local day and reads it back", () => {
    const { stamps, saved } = stampPage(9, new Date(2026, 9, 20, 18));
    expect(saved).toBe(true);
    expect(stamps).toEqual({ 9: "2026-10-20" });
    expect(readStamps()).toEqual({ 9: "2026-10-20" });
  });

  it("skips stored stamps that are not days", () => {
    store.set(
      "cadence:workbook-3:stamps",
      JSON.stringify({ 7: "yesterday", 9: "2026-10-20", x: "2026-10-20" }),
    );
    expect(readStamps()).toEqual({ 9: "2026-10-20" });
  });

  it("prints a stamp like the teacher's", () => {
    expect(stampText("2026-10-05")).toBe("OCT 5 2026");
  });
});
