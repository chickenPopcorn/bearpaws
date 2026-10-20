import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANSWER_ZONE,
  CONTROL_KEYS,
  CONTROL_ZONE,
  ControlKeys,
  HOLD_MS,
  PLAY_ZONE,
  PaintGame,
  WORKBOOK_PAGES,
  bookName,
  feedback,
  instruction,
  pageAfter,
  pageBefore,
  readStamps,
  stampPage,
  stampText,
  zoneOf,
  type ControlAction,
} from "../src/workbook";
import { workbookKeys } from "../src/workbookKeyboard";

const page = (number: number) => WORKBOOK_PAGES.find((p) => p.page === number)!;

describe("workbook pages", () => {
  it("lists pages 7, 9, 10 and 11 in book order", () => {
    expect(WORKBOOK_PAGES.map((p) => p.page)).toEqual([7, 9, 10, 11]);
  });

  it("keeps every printed note in the play zone, on a white key", () => {
    for (const p of WORKBOOK_PAGES)
      for (const { pitch } of [...p.steps, ...(p.areas ?? [])]) {
        expect(zoneOf(pitch)).toBe("play");
        expect(pitch).toBeGreaterThanOrEqual(PLAY_ZONE[0]);
        expect(pitch).toBeLessThanOrEqual(PLAY_ZONE[1]);
        expect([0, 2, 4, 5, 7, 9, 11]).toContain(pitch % 12);
      }
  });

  it("gives every Color by Note step an area, and every area a step", () => {
    for (const p of WORKBOOK_PAGES.filter((p) => p.game === "color-by-note")) {
      const steps = new Set(p.steps.map((s) => s.pitch));
      const areas = new Set(p.areas!.map((a) => a.pitch));
      expect(areas).toEqual(steps);
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
  });

  it("finds the built pages before and after a page", () => {
    expect(pageBefore(page(7))).toBeUndefined();
    expect(pageAfter(page(7))?.page).toBe(9);
    expect(pageBefore(page(10))?.page).toBe(9);
    expect(pageAfter(page(11))).toBeUndefined();
  });

  it("names notes as the book does", () => {
    expect(bookName(60)).toBe("MIDDLE C");
    expect(bookName(48)).toBe("BASS CLEF C");
    expect(bookName(52)).toBe("BASS CLEF E");
    expect(bookName(62)).toBe("TREBLE CLEF D");
    expect(bookName(38)).toBe("D");
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
    expect(game.current).toEqual({ crayon: "yellow", pitch: 62 });
    // The second step's note does not paint yet.
    expect(game.play(50)).toMatchObject({
      kind: "octave",
      direction: "higher",
    });
    expect(game.painted.size).toBe(0);
    expect(game.play(62)).toEqual({
      kind: "painted",
      pitch: 62,
      finished: false,
    });
    expect(game.play(50)).toEqual({
      kind: "painted",
      pitch: 50,
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
        page(11),
        { kind: "painted", pitch: 52, finished: true },
        undefined,
      ),
    ).toBe("Page 11 is done. This is the last page so far.");
    expect(feedback(page(11), { kind: "finished" }, undefined)).toBe(
      "Page 11 is done. This is the last page so far.",
    );
  });
  it("praises a painted key and finishes the page", () => {
    expect(
      feedback(p, { kind: "painted", pitch: 62, finished: false }, target),
    ).toBe("Yes! Next crayon.");
    expect(
      feedback(p, { kind: "painted", pitch: 50, finished: true }, undefined),
    ).toBe("Page 9 is done. Next page: E2.");
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
