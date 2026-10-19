// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PracticeCalendar } from "../src/PracticeCalendar";
import { DAILY_GOAL_SECONDS } from "../src/practiceLog";

const goal = DAILY_GOAL_SECONDS;
let root: Root;
let container: HTMLDivElement;
const day = (date: number) =>
  container.querySelector<HTMLElement>(
    `[aria-label^="October ${date}${date === 18 ? ", today" : ""}:"]`,
  )!;
async function render(totals: [string, number][], today = "2026-10-18") {
  await act(async () =>
    root.render(<PracticeCalendar totals={new Map(totals)} today={today} />),
  );
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("practice calendar", () => {
  it("marks each day of the month by how much was practiced", async () => {
    await render([
      ["2026-10-14", 90],
      ["2026-10-15", goal],
      ["2026-10-16", goal + 120],
      ["2026-10-17", goal],
      ["2026-10-18", 185],
    ]);
    expect(container.querySelector("#practice-month")!.textContent).toBe(
      "October",
    );
    // October 2026 starts on a Thursday; weeks start on Monday.
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(31);
    expect(day(16).className).toContain("done");
    expect(day(16).getAttribute("aria-label")).toBe(
      "October 16: 7 minutes, star earned",
    );
    expect(day(14).className).toContain("some");
    expect(day(14).getAttribute("aria-label")).toBe("October 14: 1 minute");
    expect(day(13).getAttribute("aria-label")).toBe("October 13: no practice");
    expect(day(19).className).toContain("future");
    expect(day(18).getAttribute("aria-label")).toBe(
      "October 18, today: 3 of 5 minutes",
    );
    expect(day(18).querySelector(".practice-ring")).not.toBeNull();
    expect(container.querySelector(".practice-streak")!.textContent).toBe(
      "3-day streak",
    );
    expect(container.querySelector(".practice-today")!.textContent).toBe(
      "Today: 3 of 5 minutes",
    );
  });

  it("celebrates once when today reaches the goal", async () => {
    vi.useFakeTimers();
    await render([["2026-10-18", goal - 1]]);
    expect(container.querySelector(".celebrate")).toBeNull();
    expect(container.querySelector(".practice-streak")).toBeNull();
    await render([["2026-10-18", goal]]);
    expect(day(18).className).toContain("celebrate");
    expect(day(18).querySelectorAll(".practice-spark")).toHaveLength(8);
    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      "Today's star earned!",
    );
    expect(container.querySelector(".practice-streak")!.textContent).toBe(
      "1-day streak",
    );
    // More practice keeps the celebration running its course, then it ends.
    await render([["2026-10-18", goal + 1]]);
    await act(async () => vi.advanceTimersByTime(2400));
    expect(container.querySelector(".celebrate")).toBeNull();
    expect(container.querySelector(".practice-today")!.textContent).toBe(
      "Today's star earned. Great job!",
    );
    // Already met when the studio opens: no celebration.
    act(() => root.unmount());
    root = createRoot(container);
    await render([["2026-10-18", goal]]);
    expect(container.querySelector(".celebrate")).toBeNull();
  });
});
