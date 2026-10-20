import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANSWER_ZONE,
  CONTROL_KEYS,
  CONTROL_ZONE,
  ControlKeys,
  HOLD_MS,
  HopGame,
  IntervalGame,
  PLAY_ZONE,
  PaintGame,
  RETRY_MS,
  SKIP_KEY,
  TOGETHER_MS,
  WORKBOOK_PAGES,
  bookName,
  feedback,
  hopFeedback,
  instruction,
  intervalFeedback,
  intervalInstruction,
  intervalName,
  intervalPrompt,
  intervalSize,
  findPrompt,
  letterName,
  namePrompt,
  rightAnswer,
  prompt,
  stepColors,
  pageAfter,
  pageBefore,
  readStamps,
  stampPage,
  stampText,
  zoneOf,
  inPlayZone,
  type ControlAction,
  type FindPage,
  type NamePage,
  type TwinsPage,
  type HoldPage,
  type HopPage,
  type IntervalPage,
  type NotePage,
} from "../src/workbook";
import { workbookKeys } from "../src/workbookKeyboard";
import {
  BEAT_MS,
  FULL_MS,
  HoldGame,
  STACCATO_MS,
  cardCounts,
  holdFeedback,
  holdHint,
  holdPrompt,
} from "../src/workbookHold";

const page = (number: number) =>
  WORKBOOK_PAGES.find((p) => p.page === number) as NotePage;
const intervals = (number: number) =>
  WORKBOOK_PAGES.find((p) => p.page === number) as IntervalPage;
const twins = (number: number) =>
  WORKBOOK_PAGES.find((p) => p.page === number) as TwinsPage;
const named = (number: number) =>
  WORKBOOK_PAGES.find((p) => p.page === number) as NamePage;
const find = (number: number) =>
  WORKBOOK_PAGES.find((p) => p.page === number) as FindPage;
const hop = (number: number) =>
  WORKBOOK_PAGES.find((p) => p.page === number) as HopPage;
const notePages = WORKBOOK_PAGES.filter(
  (p): p is NotePage => p.game === "crayon-keys" || p.game === "color-by-note",
);
const intervalPages = WORKBOOK_PAGES.filter(
  (p): p is IntervalPage => p.game === "color-by-interval",
);
const hopPages = WORKBOOK_PAGES.filter(
  (p): p is HopPage => p.game === "interval-hop",
);
const findPages = WORKBOOK_PAGES.filter(
  (p): p is FindPage => p.game === "interval-find",
);
const namePages = WORKBOOK_PAGES.filter(
  (p): p is NamePage => p.game === "interval-name",
);
const twinPages = WORKBOOK_PAGES.filter(
  (p): p is TwinsPage => p.game === "interval-twins",
);

describe("workbook pages", () => {
  it("lists the built pages in book order", () => {
    const pages = WORKBOOK_PAGES.map((p) => p.page);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
    expect(pages).toEqual([
      4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 23, 24, 26, 28, 33,
      36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 47, 48,
    ]);
  });

  it("keeps every printed note in the play zone, on a white key", () => {
    for (const pitch of [
      ...notePages.flatMap((p) => [
        ...p.steps.flatMap((s) => s.pitches),
        ...(p.areas ?? []).map((a) => a.pitch),
      ]),
      ...[
        ...intervalPages,
        ...hopPages,
        ...findPages,
        ...namePages,
        ...twinPages,
      ].flatMap((p) => p.areas.flatMap((a) => a.notes)),
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
      if (!("areas" in p) || !p.areas) continue;
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
    expect(pageAfter(page(12))?.page).toBe(13);
    expect(pageBefore(page(48))?.page).toBe(47);
    expect(pageAfter(page(21))?.page).toBe(23);
    expect(pageAfter(hop(19))?.page).toBe(20);
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
        const steps = p.steps.filter((step) => stepColors(step, area));
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

describe("Interval Hop pages", () => {
  const printed = (number: number) =>
    hop(number).areas.map((a) => a.notes.join(">"));

  it("has each card's two notes as printed", () => {
    expect(printed(13)).toEqual([
      "50>50",
      "64>67",
      "48>50",
      "52>48",
      "62>60",
      "64>64",
    ]);
    expect(printed(19)).toEqual(["67>65", "65>67", "53>55", "55>53"]);
    expect(printed(23)).toEqual(["64>67", "67>64", "55>52", "52>55"]);
    expect(printed(39)).toEqual(["65>60", "60>65", "55>60", "60>55"]);
    expect(printed(43)).toEqual(["60>67", "67>60", "55>48", "48>55"]);
    for (const p of hopPages)
      expect(p.areas.every((a) => !a.harmonic)).toBe(true);
  });

  it("puts every card in exactly one circle step", () => {
    for (const p of hopPages)
      for (const area of p.areas)
        expect(p.steps.filter((s) => stepColors(s, area))).toHaveLength(1);
    // Pages 19 to 43 practise one interval each.
    expect(
      [19, 23, 39, 43].map((n) => [
        ...new Set(hop(n).areas.map((a) => intervalSize(a.notes))),
      ]),
    ).toEqual([[2], [3], [4], [5]]);
  });

  it("colors only letters the cards hold", () => {
    for (const p of hopPages)
      for (const { letter } of p.colors)
        expect(
          p.areas.some((a) => a.notes.some((n) => letterName(n) === letter)),
        ).toBe(true);
  });
});

describe("Interval Hop Find pages", () => {
  const sizes = (number: number) =>
    find(number).areas.map((a) => intervalSize(a.notes));

  it("has each card's two notes as printed", () => {
    const printed = (number: number) =>
      find(number).areas.map((a) => a.notes.join(">"));
    expect(printed(20)).toEqual([
      "52>50",
      "60>64",
      "62>64",
      "67>65",
      "48>50",
      "55>52",
    ]);
    expect(printed(24)).toEqual([
      "60>62",
      "48>52",
      "64>60",
      "52>53",
      "64>67",
      "55>52",
    ]);
    expect(printed(40)).toEqual([
      "64>67",
      "53>55",
      "55>50",
      "65>64",
      "62>67",
      "52>48",
    ]);
    expect(printed(44)).toEqual([
      "53>60",
      "64>67",
      "53>57",
      "67>65",
      "55>60",
      "67>60",
    ]);
  });

  it("mixes the interval it asks for with others", () => {
    expect(sizes(20)).toEqual([2, 3, 2, 2, 2, 3]);
    expect(sizes(24)).toEqual([2, 3, 3, 2, 3, 3]);
    expect(sizes(40)).toEqual([3, 2, 4, 2, 4, 3]);
    expect(sizes(44)).toEqual([5, 3, 3, 2, 4, 5]);
  });

  it("words each page as the book does", () => {
    expect(
      findPages.map((p) => [p.title, intervalInstruction(p.steps[0])]),
    ).toEqual([
      ["2nds", "Using a blue crayon, circle each 2nd."],
      ["3rds", "Using a red crayon, circle each 3rd."],
      ["4ths", "Using a purple crayon, circle each 4th."],
      ["5ths", "Using a green crayon, circle each 5th."],
    ]);
    expect(findPrompt(find(20))).toBe("Is it a 2nd? Play it, or press Skip");
    expect(SKIP_KEY).toBe(79);
  });
});

describe("Hold It!", () => {
  const hold = (number: number) =>
    WORKBOOK_PAGES.find((p) => p.page === number) as HoldPage;
  const at = (beats: number) => beats * BEAT_MS;

  it("has each page's cards as printed", () => {
    expect(hold(6).cards).toEqual([
      { kind: "note", value: "quarter" },
      { kind: "note", value: "half" },
      { kind: "note", value: "dotted-half" },
      { kind: "note", value: "whole" },
    ]);
    expect(hold(15).cards.map((c) => c.kind === "tap" && c.staccato)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(
      hold(16).cards.map((c) => c.kind === "rest" && cardCounts(c)),
    ).toEqual([1, 2, 4]);
  });

  it("holds each note for its counts, half a count either way", () => {
    const p = hold(6);
    const game = new HoldGame(p);
    expect(holdPrompt(game)).toBe(
      "Hold a key for the quarter note's counts, then let go",
    );
    expect(game.down(60, 0)).toEqual({ kind: "holding" });
    expect(game.beats(at(0.5))).toBe(0.5);
    const short = game.up(60, at(0.4));
    expect(holdFeedback(p, short, p.cards[0])).toBe(
      "Hold longer: a quarter note gets 1 count.",
    );
    game.down(60, at(10));
    expect(holdFeedback(p, game.up(60, at(11.2)), p.cards[0])).toBe(
      "Yes! A quarter note gets 1 count.",
    );
    // Another key while one is held does nothing.
    game.down(62, at(20));
    expect(game.down(64, at(20.1))).toEqual({ kind: "ignored" });
    expect(game.up(64, at(20.2))).toEqual({ kind: "ignored" });
    expect(holdFeedback(p, game.up(62, at(23)), p.cards[1])).toBe(
      "Let go sooner: a half note gets 2 counts.",
    );
    game.down(62, at(30));
    game.up(62, at(32));
    game.down(62, at(40));
    expect(holdFeedback(p, game.up(62, at(43)), p.cards[2])).toBe(
      "Yes! A dotted half note gets 3 counts.",
    );
    game.down(62, at(50));
    expect(game.up(62, at(54.4))).toEqual({ kind: "done", finished: true });
    expect([...game.done]).toEqual([0, 1, 2, 3]);
  });

  it("hints at the card's counts on the hint key", () => {
    const game = new HoldGame(hold(6));
    expect(holdHint(game)).toBe(
      "Hint: a quarter note gets 1 count. Let go when the bar is full.",
    );
    expect(holdHint(new HoldGame(hold(16)))).toBe(
      "Hint: a quarter rest gets 1 count. Play when the bar is full.",
    );
    expect(holdHint(new HoldGame(hold(15)))).toBe(
      "Hint: no dot, so hold the key for a whole count.",
    );
  });

  it("plays short for a staccato dot and a full count without", () => {
    const p = hold(15);
    const game = new HoldGame(p);
    expect(holdPrompt(game)).toBe("Play this note as written");
    game.down(60, 0);
    expect(holdFeedback(p, game.up(60, 200), p.cards[0])).toBe(
      "No dot on this one: hold it for a whole count.",
    );
    game.down(60, 1000);
    expect(holdFeedback(p, game.up(60, 1000 + FULL_MS), p.cards[0])).toBe(
      "Yes! A full count: that one is not staccato.",
    );
    game.down(60, 3000);
    expect(holdFeedback(p, game.up(60, 3800), p.cards[1])).toBe(
      "That note has a dot: play it short and bounce off the key.",
    );
    game.down(60, 5000);
    expect(holdFeedback(p, game.up(60, 5000 + STACCATO_MS), p.cards[1])).toBe(
      "Yes! Short and bouncy: that is staccato.",
    );
    // A tap has no counting bar.
    game.down(60, 6000);
    expect(game.beats(6500)).toBeNull();
  });

  it("rests for the rest's counts between two notes", () => {
    const p = hold(16);
    const game = new HoldGame(p);
    expect(holdPrompt(game)).toBe("Play a note and let go: then rest");
    game.down(60, 0);
    expect(game.beats(500)).toBeNull();
    const resting = game.up(60, 400);
    expect(holdFeedback(p, resting, p.cards[0])).toBe(
      "Shh… rest for 1 count, then play when the bar is full.",
    );
    expect(game.resting).toBe(true);
    expect(holdPrompt(game)).toBe("Rest… then play when the bar is full");
    expect(game.beats(900)).toBe(0.5);
    // Too soon: start again with a note.
    expect(holdFeedback(p, game.down(60, 800), p.cards[0])).toBe(
      "Shh! Too soon: a quarter rest gets 1 count. Let go and rest again.",
    );
    expect(game.resting).toBe(false);
    // Its release starts the rest again.
    game.up(60, 900);
    expect(game.down(62, 900 + at(1.1))).toEqual({
      kind: "done",
      finished: false,
    });
    // The note after the rest: letting it go does nothing.
    expect(game.up(62, 5000)).toEqual({ kind: "ignored" });
    expect(game.resting).toBe(false);
    game.down(60, at(10));
    game.up(60, at(10.5));
    expect(holdFeedback(p, game.down(60, at(14)), p.cards[1])).toBe(
      "Play right when the rest ends. Let go and rest again.",
    );
    game.up(60, at(14.5));
    game.down(60, at(16.5));
    game.up(60, at(17));
    game.down(60, at(20));
    game.up(60, at(20.3));
    expect(game.down(60, at(24.3))).toEqual({ kind: "done", finished: true });
  });
});

describe("Same and Different pages", () => {
  const held = (...pitches: number[]) => new Set(pitches);
  const boxes = (number: number) => {
    const { areas } = twins(number);
    return [0, 2, 4, 6].map(
      (i) => `${areas[i].notes.join(">")} ${areas[i + 1].notes.join(">")}`,
    );
  };
  const play = (game: IntervalGame, time: number) => {
    const [first, second] = game.page.areas[game.current!].notes;
    game.play(first, time, held(first));
    return game.play(second, time + 500, held(second));
  };

  it("has each box's two cards as printed", () => {
    expect(boxes(28)).toEqual([
      "60>64 60>62",
      "62>60 62>60",
      "60>57 60>57",
      "59>60 57>60",
    ]);
    expect(boxes(47)).toEqual([
      "67>60 67>62",
      "67>65 67>65",
      "55>50 55>50",
      "55>53 55>52",
    ]);
    // Boxes 1 and 4 differ, 2 and 3 are the same, on both pages.
    for (const p of twinPages)
      expect([1, 3, 5, 7].map((i) => rightAnswer(p, i))).toEqual([
        "Different",
        "Same",
        "Same",
        "Different",
      ]);
  });

  it("words the page with its characters", () => {
    expect(intervalInstruction(twins(28).steps[0])).toBe(
      "Circle Beethoven Bear if the intervals are the same. Circle Mozart Mouse if the intervals are different.",
    );
    expect(twins(47).characters).toEqual({
      same: "Haydn Hippo",
      different: "Clara Schumann-Cat",
    });
  });

  it("plays the top card, the bottom card, then takes Same or Different", () => {
    const p = twins(28);
    const game = new IntervalGame(p);
    expect(game.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(namePrompt(game, p.areas[0])).toBe(
      "Play the top card, left then right",
    );
    expect(game.answer("Same")).toEqual({ kind: "play-first" });
    const first = play(game, 0);
    expect(intervalFeedback(p, first, p.areas[0])).toBe(
      "Now play the bottom card, left then right.",
    );
    expect(game.lastHop).toMatchObject({ from: 60, to: 64 });
    expect(namePrompt(game, p.areas[1])).toBe(
      "Play the bottom card, left then right",
    );
    const second = play(game, 2000);
    expect(intervalFeedback(p, second, p.areas[1])).toBe(
      "Same or different? Same is G5, Different is A5.",
    );
    // The paw hops as the bottom card is played, not at the answer.
    expect(game.lastHop).toEqual({ from: 60, to: 62, count: 2 });
    const wrong = game.answer("Same");
    expect(intervalFeedback(p, wrong, p.areas[1])).toBe(
      "Look again: count how far apart the notes on each card are.",
    );
    const right = game.answer("Different");
    expect(intervalFeedback(p, right, p.areas[1])).toBe(
      "Yes! A 3rd and a 2nd: Mozart Mouse.",
    );
    expect(game.lastHop?.count).toBe(2);
    expect(game.answers.get(1)).toBe("Different");
    play(game, 4000);
    play(game, 6000);
    expect(intervalFeedback(p, game.answer("Same"), p.areas[3])).toBe(
      "Yes! Both are 2nds: Beethoven Bear.",
    );
    play(game, 10_000);
    play(game, 12_000);
    game.answer("Same");
    play(game, 14_000);
    play(game, 16_000);
    // The last box's character, then the page is done.
    expect(intervalFeedback(p, game.answer("Different"), p.areas[7])).toBe(
      "Yes! A 2nd and a 3rd: Mozart Mouse. Page 28 is done. Next page: E2.",
    );
    expect(game.finished).toBe(true);
  });
});

describe("How far page", () => {
  const held = (...pitches: number[]) => new Set(pitches);
  const p41 = named(41);

  it("has each card as printed, one of each answer", () => {
    expect(p41.areas.map((a) => a.notes.join(a.harmonic ? "+" : ">"))).toEqual([
      "62>64",
      "55+60",
      "64>60",
    ]);
    expect(p41.areas.map((a) => intervalSize(a.notes))).toEqual([2, 4, 3]);
    expect(p41.choices).toEqual([2, 3, 4]);
    expect(intervalInstruction(p41.steps[0])).toBe(
      "Identify each interval: circle 2 for the 2nd, 3 for the 3rd and 4 for the 4th.",
    );
  });

  it("plays each card, then takes how far apart its notes are", () => {
    const game = new IntervalGame(p41);
    expect(game.order).toEqual([0, 1, 2]);
    expect(game.answer(2)).toEqual({ kind: "play-first" });
    expect(namePrompt(game, p41.areas[0])).toBe(
      "Play the two notes, left then right",
    );
    game.play(62, 0, held(62));
    const played = game.play(64, 500, held(64));
    expect(intervalFeedback(p41, played, p41.areas[0])).toBe(
      "How far apart? Press 2, 3 or 4.",
    );
    expect(namePrompt(game, p41.areas[0])).toBe(
      "How far apart? Press 2, 3 or 4",
    );
    expect(
      intervalFeedback(p41, game.play(62, 900, held(62)), p41.areas[0]),
    ).toBe("Now press how far apart: 2, 3 or 4.");
    const wrong = game.answer(3);
    expect(intervalFeedback(p41, wrong, p41.areas[0])).toBe(
      "Not 3. Count each line and space from one note to the other.",
    );
    const right = game.answer(2);
    expect(intervalFeedback(p41, right, p41.areas[0])).toBe(
      "Yes! 2: that is a 2nd.",
    );
    expect(game.answers.get(0)).toBe(2);
    expect(game.painted.get(0)).toBe("purple");
    // The harmonic 4th, together.
    game.play(55, 2000, held(55));
    game.play(60, 2050, held(55, 60));
    expect(game.answer(4)).toMatchObject({ kind: "painted" });
    game.play(64, 3000, held(64));
    game.play(60, 3500, held(60));
    const last = game.answer(3);
    expect(last).toEqual({ kind: "painted", finished: true });
    expect(intervalFeedback(p41, last, p41.areas[2])).toBe(
      "Yes! 3: that is a 3rd. Page 41 is done. Next page: E2.",
    );
    expect(game.step).toBe(1);
  });
});

describe("Find pages", () => {
  const held = (...pitches: number[]) => new Set(pitches);
  const playCard = (game: IntervalGame, time: number) => {
    const [first, second] = game.page.areas[game.current!].notes;
    game.play(first, time, held(first));
    return game.play(second, time + 500, held(second));
  };

  it("circles the cards it asks for and skips the others, in order", () => {
    const p = find(20);
    const game = new IntervalGame(p);
    expect(game.order).toEqual([0, 1, 2, 3, 4, 5]);
    expect(intervalFeedback(p, playCard(game, 0), p.areas[0])).toBe(
      "Yes! That is a 2nd: blue.",
    );
    expect(game.lastHop).toEqual({ from: 52, to: 50, count: 1 });
    // Card 1 is a 3rd: playing it is not enough.
    const third = playCard(game, 2000);
    expect(third).toEqual({ kind: "not-it", size: 3 });
    expect(intervalFeedback(p, third, p.areas[1])).toBe(
      "That is a 3rd, not a 2nd. Press Skip (G5).",
    );
    expect(game.current).toBe(1);
    const skipped = game.skip();
    expect(intervalFeedback(p, skipped, p.areas[1])).toBe(
      "Right: no 2nd there. Next card.",
    );
    // Skip on a 2nd sends the child back to it.
    const back = game.skip();
    expect(back).toEqual({ kind: "look-again", size: 2 });
    expect(intervalFeedback(p, back, p.areas[2])).toBe(
      "Look again: that is a 2nd. Play it, left then right.",
    );
    expect(game.current).toBe(2);
    let time = 5000;
    for (const index of [2, 3, 4]) {
      expect(game.current).toBe(index);
      playCard(game, (time += 1000));
    }
    expect(game.skip()).toEqual({ kind: "skipped", finished: true });
    expect(game.finished).toBe(true);
    expect([...game.painted.keys()]).toEqual([0, 2, 3, 4]);
    expect([...game.skipped]).toEqual([1, 5]);
    expect(game.step).toBe(1);
  });

  it("keeps the step on the one step while cards are skipped", () => {
    const game = new IntervalGame(find(44));
    expect(game.step).toBe(0);
    playCard(game, 0);
    expect(game.current).toBe(1);
    expect(game.step).toBe(0);
  });
});

describe("HopGame", () => {
  const held = (...pitches: number[]) => new Set(pitches);
  const playCard = (game: HopGame, time: number) => {
    const [first, second] = game.page.areas[game.current!].notes;
    game.play(first, time, held(first));
    return game.play(second, time + 500, held(second));
  };

  it("colors the note heads by letter, then circles the cards", () => {
    const game = new HopGame(hop(19));
    expect(game.coloring).toBe(true);
    expect(game.colors.page.steps).toEqual([
      { crayon: "orange", pitches: [55, 67] },
      { crayon: "pink", pitches: [53, 65] },
    ]);
    expect(game.current).toBeUndefined();
    // A card's note before its step: not yet.
    expect(game.play(65, 0, held(65))).toMatchObject({
      phase: "color",
      outcome: { kind: "wrong" },
    });
    for (const pitch of [55, 67, 53]) game.play(pitch, 0, held(pitch));
    expect(game.step).toBe(1);
    const last = game.play(65, 0, held(65));
    expect(hopFeedback(game, last)).toBe(
      "Yes! Now play each card, left then right.",
    );
    expect(game.coloring).toBe(false);
    expect(game.step).toBe(2);
    // Up first: cards 1 and 2 (F4 to G4, F3 to G3), then down.
    expect(game.cards.order).toEqual([1, 2, 0, 3]);
    const circled = playCard(game, 1000);
    expect(hopFeedback(game, circled)).toBe("Yes! A 2nd going up: green.");
    expect(game.lastHop).toEqual({ from: 65, to: 67, count: 1 });
    let time = 2000;
    while (!game.finished) playCard(game, (time += 1000));
    expect([...game.cards.painted.values()]).toEqual([
      "green",
      "green",
      "blue",
      "blue",
    ]);
    expect(game.lastHop?.count).toBe(4);
  });

  it("plays a repeat as the same key twice", () => {
    const game = new HopGame(hop(13));
    expect(game.coloring).toBe(false);
    // Steps first, then skips, then repeats.
    expect(game.cards.order).toEqual([2, 4, 1, 3, 0, 5]);
    let time = 0;
    for (let i = 0; i < 4; i++) playCard(game, (time += 1000));
    expect(game.current).toBe(0);
    const first = game.play(50, 9000, held(50));
    expect(hopFeedback(game, first)).toBe("Now the same note again.");
    // Even quickly: one key cannot sound twice at once.
    const again = game.play(50, 9050, held(50));
    expect(hopFeedback(game, again)).toBe("Yes! That is a repeat: purple.");
    expect(game.lastHop).toMatchObject({ from: 50, to: 50 });
  });

  it("names steps and skips on page 13", () => {
    const game = new HopGame(hop(13));
    expect(hopFeedback(game, playCard(game, 0))).toBe(
      "Yes! That is a step: pink.",
    );
    playCard(game, 2000);
    expect(hopFeedback(game, playCard(game, 4000))).toBe(
      "Yes! That is a skip: green.",
    );
  });

  it("finishes the page with its last card", () => {
    const game = new HopGame(hop(43));
    for (const pitch of [48, 60, 55, 67]) game.play(pitch, 0, held(pitch));
    let time = 0,
      last;
    while (!game.finished) last = playCard(game, (time += 1000));
    expect(hopFeedback(game, last!)).toBe("Page 43 is done. Next page: E2.");
  });
});

describe("zones", () => {
  it("knows the play zone's own keys, C3 to C5", () => {
    expect([47, 48, 72, 73, 30, 90].map(inPlayZone)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

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
