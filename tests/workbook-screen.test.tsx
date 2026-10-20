// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, WORKBOOK_PAGES } from "../src/workbook";

const fake = vi.hoisted(() => {
  const keys = new Set<(pitch: number, down: boolean) => void>();
  const listeners = new Set<() => void>();
  return {
    keys,
    studio: {
      input: { down: new Set<number>() },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onKey: (listener: (pitch: number, down: boolean) => void) => {
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
async function key(pitch: number, down: boolean) {
  await act(async () => {
    if (down) fake.studio.input.down.add(pitch);
    else fake.studio.input.down.delete(pitch);
    for (const listener of fake.keys) listener(pitch, down);
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
