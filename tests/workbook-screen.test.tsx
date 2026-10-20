// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, SKIP_KEY, WORKBOOK_PAGES } from "../src/workbook";

const fake = vi.hoisted(() => {
  const keys = new Set<(pitch: number, down: boolean, time: number) => void>();
  const listeners = new Set<() => void>();
  return {
    keys,
    studio: {
      input: { down: new Set<number>() },
      beat: () => {},
      playExample: async () => 0,
      stopExample: () => {},
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onKey: (
        listener: (pitch: number, down: boolean, time: number) => void,
      ) => {
        keys.add(listener);
        return () => keys.delete(listener);
      },
    },
  };
});
vi.mock("../src/session", () => ({ studio: fake.studio }));
const { Workbook } = await import("../src/WorkbookScreen");

type Props = ComponentProps<typeof Workbook>;
const page = (number: number) => WORKBOOK_PAGES.find((p) => p.page === number)!;
let root: Root;
let container: HTMLDivElement;
let props: Props;
async function render(overrides: Partial<Props> = {}) {
  props = { ...props, ...overrides };
  await act(async () =>
    root.render(<Workbook key={props.page.page} {...props} />),
  );
}
/** The keys' clock, in ms: each key is played 1 s after the last. */
let clock = 0;
async function key(pitch: number, down: boolean) {
  clock += 1000;
  await act(async () => {
    if (down) fake.studio.input.down.add(pitch);
    else fake.studio.input.down.delete(pitch);
    for (const listener of fake.keys) listener(pitch, down, clock);
  });
}
async function tap(pitch: number) {
  await key(pitch, true);
  await key(pitch, false);
}
const text = (selector: string) =>
  container.querySelector(selector)?.textContent;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fake.studio.input.down.clear();
  props = {
    page: page(9),
    onFinish: vi.fn(),
    onPage: vi.fn(),
    onLeave: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("workbook page", () => {
  it("shows the page as the book does, in the studio's header", async () => {
    await render();
    expect(text(".kicker")).toBe("Music Workbook 3 · Page 9");
    expect(text("h1 .sr-only")).toBe("Bass Clef D");
    expect(text(".song-tools .chip")).toBe("Use with page 9");
    expect(
      Array.from(
        container.querySelectorAll(".workbook-steps li"),
        (li) => li.textContent,
      ),
    ).toEqual(["Color TREBLE CLEF D yellow.", "Color BASS CLEF D blue."]);
    expect(text(".workbook-prompt")).toBe("Find TREBLE CLEF D");
    expect(text(".workbook-hint")).toBe("Play it on your piano.");
    expect(
      container.querySelector(".workbook-stamp")!.getAttribute("aria-label"),
    ).toBe("Not done yet");
  });

  it("shows storage and sync trouble on the page", async () => {
    await render({
      notice:
        "Browser storage is full or blocked. Workbook stamps will last for this session.",
      syncError: "Sync paused.",
    });
    expect(
      Array.from(container.querySelectorAll(".alert"), (p) => p.textContent),
    ).toEqual([
      "Browser storage is full or blocked. Workbook stamps will last for this session.",
      "Sync paused.",
    ]);
  });

  it("paints each step's key in order, then finishes the page", async () => {
    await render();
    await tap(62);
    expect(text(".workbook-hint")).toBe("Yes! Next crayon.");
    expect(text(".workbook-prompt")).toBe("Find BASS CLEF D");
    expect(container.querySelector(".workbook-steps li.done")).not.toBeNull();
    expect(text(".roll-actions")).toBe("Step 2 of 2");
    await tap(50);
    expect(text(".workbook-prompt")).toBe("Page 9 is done");
    expect(text(".roll-actions")).toBe("Next: page 10 (E2)");
    expect(props.onFinish).toHaveBeenCalledWith(9);
    await render({ stamp: "2026-10-20" });
    expect(text(".workbook-stamp-date")).toBe("OCT 20 2026");
    expect(
      container.querySelector(".workbook-stamp.earned.celebrate"),
    ).not.toBeNull();
  });

  it("hints at a wrong key, and ignores the answer keys", async () => {
    await render();
    await tap(64);
    expect(text(".workbook-hint")).toBe("That is E. Look for D.");
    await tap(80);
    expect(text(".workbook-hint")).toBe("That is E. Look for D.");
    await tap(50);
    expect(text(".workbook-hint")).toBe(
      "That is BASS CLEF D. Go higher. The letters are on the keys now.",
    );
    expect(props.onFinish).not.toHaveBeenCalled();
  });

  it("paints a staff page's note on the staff and the key", async () => {
    await render({ page: page(37) });
    const staff = () =>
      container.querySelector(".workbook-staff")!.getAttribute("aria-label");
    expect(staff()).toBe("Staff: TREBLE CLEF E, MIDDLE C");
    expect(text(".workbook-prompt")).toBe("Play the C on the staff");
    await tap(60);
    expect(staff()).toBe("Staff: TREBLE CLEF E, MIDDLE C (green)");
  });

  it("gives a title that starts with a number no initial", async () => {
    await render({ page: page(26) });
    expect(text("h1")).toBe("2nds and 3rds");
    expect(container.querySelector("h1 .song-title-initial")).toBeNull();
  });

  it("colors note heads, then circles each card and hops the paw", async () => {
    await render({ page: page(19) });
    expect(text("p")).toBe(
      "Interval Hop · Play each card's two notes on your piano.",
    );
    expect(
      Array.from(
        container.querySelectorAll(".workbook-steps li"),
        (li) => li.textContent,
      ),
    ).toEqual([
      "Color each G orange.",
      "Color each F pink.",
      "With a green crayon, circle each 2nd going UP.",
      "With a blue crayon, circle each 2nd going DOWN.",
    ]);
    expect(text(".workbook-prompt")).toBe("Play every G");
    expect(container.querySelector(".workbook-hopper")).not.toBeNull();
    for (const pitch of [55, 67, 53, 65]) await tap(pitch);
    expect(text(".workbook-hint")).toBe(
      "Yes! Now play each card, left then right.",
    );
    const title = (i: number) =>
      container.querySelectorAll(".workbook-area title")[i].textContent;
    expect(title(0)).toBe("TREBLE CLEF G then TREBLE CLEF F");
    expect(container.querySelectorAll(".workbook-staff-paint")).toHaveLength(8);
    expect(text(".workbook-prompt")).toBe(
      "Play the two notes, left then right",
    );
    expect(
      container.querySelector(".workbook-area.is-current title")!.textContent,
    ).toBe("TREBLE CLEF F then TREBLE CLEF G");
    await tap(65);
    await tap(67);
    expect(text(".workbook-hint")).toBe("Yes! A 2nd going up: green.");
    expect(title(1)).toBe("TREBLE CLEF F then TREBLE CLEF G, circled green");
    expect(container.querySelectorAll(".workbook-ring")).toHaveLength(1);
  });

  it("circles a Find page's cards and skips the others on G5", async () => {
    await render({ page: page(24) });
    expect(text("p")).toBe(
      "Interval Hop · Play the cards it asks for; skip the others on G5.",
    );
    expect(text(".workbook-prompt")).toBe(
      "Is it a 3rd? Play it, or press Skip",
    );
    // Card 0, C4 to D4, is a 2nd.
    await tap(SKIP_KEY);
    expect(text(".workbook-hint")).toBe("Right: no 3rd there. Next card.");
    const title = (i: number) =>
      container.querySelectorAll(".workbook-area title")[i].textContent;
    expect(title(0)).toBe("MIDDLE C then TREBLE CLEF D, skipped");
    // Card 1, C3 to E3, is a 3rd: Skip sends the child back.
    await tap(SKIP_KEY);
    expect(text(".workbook-hint")).toBe(
      "Look again: that is a 3rd. Play it, left then right.",
    );
    await tap(48);
    await tap(52);
    expect(text(".workbook-hint")).toBe("Yes! That is a 3rd: red.");
    expect(title(1)).toBe("BASS CLEF C then BASS CLEF E, circled red");
    // Other answer keys do nothing.
    await tap(SKIP_KEY + 2);
    expect(text(".workbook-hint")).toBe("Yes! That is a 3rd: red.");
  });

  it("draws a Note Snap line as each card's note is played", async () => {
    await render({ page: page(30) });
    expect(text("p")).toBe("Note Snap · Play each note on your piano.");
    expect(text(".roll-actions")).toBe("Step 1 of 1");
    const title = (i: number) =>
      container.querySelectorAll(".workbook-area title")[i].textContent;
    expect(title(0)).toBe("BASS CLEF D");
    await tap(50);
    expect(text(".workbook-hint")).toBe("Yes! That is D: line drawn.");
    expect(title(0)).toBe("BASS CLEF D, joined to D");
    expect(container.querySelectorAll(".workbook-snap-line")).toHaveLength(1);
    expect(
      container.querySelector(".workbook-area.is-current title")!.textContent,
    ).toBe("BASS CLEF C");
  });

  it("plays an Ear Detective example on C2 and takes its echo", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    await render({ page: page(46) });
    expect(text(".workbook-prompt")).toBe("Listen: press C2");
    await tap(60);
    expect(text(".workbook-hint")).toBe("Listen first: press C2.");
    await tap(36);
    await act(async () => {});
    expect(text(".workbook-prompt")).toBe("Play it back on the piano");
    // The bottom melody, C4 C4 D4.
    vi.useFakeTimers();
    await tap(60);
    await tap(60);
    await tap(62);
    await act(async () => vi.advanceTimersByTime(300));
    expect(text(".workbook-hint")).toBe(
      "You played it back: it was the bottom one!",
    );
    expect(
      container.querySelector(".workbook-picture")!.getAttribute("aria-label"),
    ).toBe("4 examples, 1 found");
    vi.restoreAllMocks();
  });

  it("times a Hold It! note while its key is held", async () => {
    await render({ page: page(6) });
    expect(text("p")).toBe("Hold It! · Play each note on your piano.");
    expect(text(".workbook-prompt")).toBe(
      "Hold a key for the quarter note's counts, then let go",
    );
    expect(container.querySelectorAll(".workbook-beat")).toHaveLength(1);
    // tap() holds a key for 1 s: one count.
    await tap(60);
    expect(text(".workbook-hint")).toBe("Yes! A quarter note gets 1 count.");
    expect(
      container.querySelectorAll(".workbook-area title")[0].textContent,
    ).toBe("quarter note, 1 count");
    expect(container.querySelectorAll(".workbook-beat")).toHaveLength(2);
    // The half note, held 1 s: too short.
    await tap(60);
    expect(text(".workbook-hint")).toBe(
      "Hold longer: a half note gets 2 counts.",
    );
    // Control keys still work, and answer keys do nothing.
    await tap(80);
    expect(text(".workbook-hint")).toBe(
      "Hold longer: a half note gets 2 counts.",
    );
  });

  it("takes Same or Different under a box's bottom card", async () => {
    await render({ page: page(47) });
    expect(text(".workbook-prompt")).toBe("Play the top card, left then right");
    await tap(67);
    await tap(60);
    expect(text(".workbook-hint")).toBe(
      "Now play the bottom card, left then right.",
    );
    await tap(67);
    await tap(62);
    expect(text(".workbook-prompt")).toBe("Same or different? Press G5 or A5");
    // A5 is Different: a 5th and a 4th.
    await tap(81);
    expect(text(".workbook-hint")).toBe(
      "Yes! A 5th and a 4th: Clara Schumann-Cat.",
    );
    expect(
      container.querySelectorAll(".workbook-area title")[1].textContent,
    ).toBe("TREBLE CLEF G then TREBLE CLEF D, Different circled red");
    // Only the bottom cards print the answers.
    expect(container.querySelectorAll(".workbook-choice")).toHaveLength(8);
    expect(
      container.querySelector(".workbook-picture")!.getAttribute("aria-label"),
    ).toBe("Picture with 4 boxes, 1 answered");
  });

  it("takes a How far answer on the answer keys and circles it", async () => {
    await render({ page: page(41) });
    expect(text(".workbook-prompt")).toBe(
      "Play the two notes, left then right",
    );
    await tap(SKIP_KEY);
    expect(text(".workbook-hint")).toBe(
      "Play the card first, then press how far apart.",
    );
    await tap(62);
    await tap(64);
    expect(text(".workbook-hint")).toBe("How far apart? Press 2, 3 or 4.");
    // A5 is 3: not this one.
    await tap(81);
    expect(text(".workbook-hint")).toBe(
      "Not 3. Count each line and space from one note to the other.",
    );
    await tap(79);
    expect(text(".workbook-hint")).toBe("Yes! 2: that is a 2nd.");
    expect(
      container.querySelectorAll(".workbook-area title")[0].textContent,
    ).toBe("TREBLE CLEF D then TREBLE CLEF E, 2 circled purple");
    expect(container.querySelectorAll(".workbook-choice")).toHaveLength(9);
  });

  it("plays an interval page one outlined area at a time", async () => {
    await render({ page: page(33) });
    const picture = () =>
      container.querySelector(".workbook-picture")!.getAttribute("aria-label");
    const outlined = () =>
      container.querySelector(".workbook-area.is-current title")!.textContent;
    expect(text("p")).toBe(
      "Color by Note · Play each pair of notes on your piano.",
    );
    expect(text(".workbook-steps li")).toBe(
      "Color the areas containing a melodic interval green.",
    );
    // The melodic ones first: E4, then F4.
    expect(outlined()).toBe("TREBLE CLEF E then TREBLE CLEF F");
    expect(text(".workbook-prompt")).toBe(
      "Play the two notes, left then right",
    );
    await tap(64);
    expect(text(".workbook-hint")).toBe("Now the note on the right.");
    await tap(65);
    expect(text(".workbook-hint")).toBe(
      "Yes! One after the other, so it is melodic: green.",
    );
    expect(picture()).toBe("Picture with 5 areas, 1 painted");
    expect(outlined()).toBe("TREBLE CLEF G then TREBLE CLEF F");
  });

  it("paints every area holding the note on a Color by Note page", async () => {
    await render({ page: page(10) });
    const picture = () =>
      container.querySelector(".workbook-picture")!.getAttribute("aria-label");
    expect(picture()).toBe("Picture with 7 areas, 0 painted");
    await tap(62);
    expect(picture()).toBe("Picture with 7 areas, 3 painted");
    expect(text(".workbook-prompt")).toBe("Play BASS CLEF D");
  });
});

describe("workbook control keys", () => {
  it("moves to the next and previous page", async () => {
    await render();
    await tap(40);
    expect(props.onPage).toHaveBeenCalledWith(10);
    await tap(38);
    expect(props.onPage).toHaveBeenCalledWith(8);
  });

  it("says when there is no page before or after", async () => {
    await render({ page: page(4) });
    await tap(38);
    expect(text(".workbook-hint")).toBe("This is the first page so far.");
    await render({ page: page(48) });
    await tap(40);
    expect(text(".workbook-hint")).toBe("This is the last page so far.");
    expect(props.onPage).not.toHaveBeenCalled();
  });

  it("shows the letters on the hint key", async () => {
    await render();
    await tap(36);
    expect(text(".workbook-hint")).toBe("Hint: the letters are on the keys.");
  });

  it("leaves the workbook only when D2 is held", async () => {
    vi.useFakeTimers();
    await render();
    await key(38, true);
    expect(text(".workbook-hint")).toBe(
      "Keep holding D2 to leave the workbook. Let go to go back.",
    );
    await act(async () => vi.advanceTimersByTime(HOLD_MS));
    await key(38, false);
    expect(props.onLeave).toHaveBeenCalledOnce();
    expect(props.onPage).not.toHaveBeenCalled();
  });

  it("starts the page over only when F2 is held", async () => {
    vi.useFakeTimers();
    await render();
    await tap(62);
    await tap(41);
    expect(text(".workbook-hint")).toBe("Hold F2 for 2 seconds to start over.");
    expect(text(".workbook-prompt")).toBe("Find BASS CLEF D");
    await key(41, true);
    await act(async () => vi.advanceTimersByTime(HOLD_MS));
    await key(41, false);
    expect(text(".workbook-prompt")).toBe("Find TREBLE CLEF D");
    expect(text(".workbook-hint")).toBe("Started over. Play it on your piano.");
  });

  it("stops listening to the piano once the page closes", async () => {
    await render();
    expect(fake.keys.size).toBe(1);
    await act(async () => root.unmount());
    expect(fake.keys.size).toBe(0);
    root = createRoot(container);
  });
});
