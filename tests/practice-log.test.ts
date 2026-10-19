import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HISTORY_DAYS,
  PracticeLog,
  addDays,
  localDay,
  storedSessions,
  streak,
  type PracticeSession,
} from "../src/practiceLog";

const stored = new Map<string, string>();
let now: Date;
const clock = () => now;
const saved = () =>
  JSON.parse(stored.get("cadence:practice") ?? "[]") as PracticeSession[];

beforeEach(() => {
  stored.clear();
  now = new Date(2026, 9, 18, 10, 0, 0);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("practice log", () => {
  it("names days by the local calendar", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("adds up playing time and reports each whole second gained", () => {
    const onCommit = vi.fn();
    const log = new PracticeLog(onCommit, clock);
    log.add(0.6, "ode");
    // Totals show the session in progress before it is saved.
    expect(log.totals().get("2026-10-18")).toBe(0);
    log.add(0.6, "ode");
    expect(log.totals().get("2026-10-18")).toBe(1);
    expect(log.commit()).toBe(true);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0][0]).toMatchObject({
      day: "2026-10-18",
      seconds: 1,
      songs: { ode: 1 },
    });
    // Nothing new to report until another whole second.
    log.add(0.3, "lamb");
    log.commit();
    expect(onCommit).toHaveBeenCalledOnce();
    log.add(0.5, "lamb");
    log.commit();
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit.mock.calls[1][0]).toMatchObject({
      seconds: 2,
      songs: { ode: 1, lamb: 0 },
    });
    expect(saved()).toHaveLength(1);
  });

  it("starts a new session at midnight and after a long pause", () => {
    const log = new PracticeLog(undefined, clock);
    log.add(3, "ode");
    now = new Date(2026, 9, 18, 10, 20);
    log.add(2, "ode");
    now = new Date(2026, 9, 18, 11, 0);
    log.add(4, "ode");
    now = new Date(2026, 9, 19, 0, 0, 5);
    log.add(6, "ode");
    log.commit();
    const sessions = saved();
    expect(sessions.map((s) => [s.day, s.seconds])).toEqual([
      ["2026-10-18", 5],
      ["2026-10-18", 4],
      ["2026-10-19", 6],
    ]);
    expect(new Set(sessions.map((s) => s.id)).size).toBe(3);
    expect(log.totals()).toEqual(
      new Map([
        ["2026-10-18", 9],
        ["2026-10-19", 6],
      ]),
    );
  });

  it("keeps sessions across reloads, dropping malformed and old ones", () => {
    const old: PracticeSession = {
      id: "old",
      day: addDays("2026-10-18", -HISTORY_DAYS - 1),
      startedAt: "",
      seconds: 400,
      songs: {},
    };
    stored.set(
      "cadence:practice",
      JSON.stringify([old, { id: "broken", day: "today" }]),
    );
    expect(storedSessions().map((s) => s.id)).toEqual(["old"]);
    const log = new PracticeLog(undefined, clock);
    log.add(2, "ode");
    log.commit();
    expect(saved().map((s) => s.seconds)).toEqual([2]);
    expect([...new PracticeLog(undefined, clock).totals()]).toEqual([
      ["2026-10-18", 2],
    ]);
  });

  it("totals songs whose ids match object properties", () => {
    const log = new PracticeLog(() => {}, clock);
    log.add(2, "__proto__");
    log.add(1, "constructor");
    log.commit();
    expect(Object.entries(saved()[0].songs)).toEqual([
      ["__proto__", 2],
      ["constructor", 1],
    ]);
  });

  it("tells the sync when browser storage refused a session", () => {
    const onCommit = vi.fn();
    const log = new PracticeLog(onCommit, clock);
    log.add(1, "ode");
    expect(log.commit()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith(
      expect.objectContaining({ seconds: 1 }),
      true,
    );
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: () => {
        throw new Error("full");
      },
      removeItem: (key: string) => void stored.delete(key),
    });
    log.add(1, "ode");
    expect(log.commit()).toBe(false);
    expect(onCommit).toHaveBeenLastCalledWith(
      expect.objectContaining({ seconds: 2 }),
      false,
    );
  });

  it("keeps other tabs' sessions when saving its own", () => {
    const tabA = new PracticeLog(() => {}, clock);
    const tabB = new PracticeLog(() => {}, clock);
    tabA.add(3, "ode");
    tabA.commit();
    tabB.add(2, "lamb");
    tabB.commit();
    tabA.add(4, "ode");
    tabA.commit();
    tabB.add(1, "lamb");
    tabB.commit();
    // Neither tab's save erases or shrinks the other's session.
    expect(saved().map((s) => [s.songs, s.seconds])).toEqual([
      [{ ode: 7 }, 7],
      [{ lamb: 3 }, 3],
    ]);
    expect(tabB.totals().get("2026-10-18")).toBe(10);
  });

  it("counts a streak of days that met the goal", () => {
    const goal = 5 * 60;
    const totals = new Map([
      ["2026-10-14", goal],
      ["2026-10-15", goal + 60],
      ["2026-10-16", goal],
      ["2026-10-17", goal],
      ["2026-10-13", goal - 1],
    ]);
    // Today not met yet: the streak runs through yesterday.
    expect(streak(totals, "2026-10-18", goal)).toBe(4);
    totals.set("2026-10-18", goal);
    expect(streak(totals, "2026-10-18", goal)).toBe(5);
    expect(streak(totals, "2026-10-20", goal)).toBe(0);
    // A higher goal leaves only the longer day.
    expect(streak(totals, "2026-10-18", goal + 60)).toBe(0);
    expect(streak(totals, "2026-10-16", goal + 60)).toBe(1);
  });
});
