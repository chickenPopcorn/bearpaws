import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HISTORY_DAYS,
  PracticeLog,
  addDays,
  localDay,
  storedSessions,
  streak,
  watchSessions,
  type PracticeSession,
} from "../src/practiceLog";

const stored = new Map<string, string>();
let now: Date;
const clock = () => now;
const sessionKey = (id: string) => `cadence:practice:${id}`;
/** The saved sessions, as the app reads them. */
const saved = () =>
  [...stored]
    .filter(([key]) => key.startsWith(sessionKey("")))
    .flatMap(([, value]) => {
      try {
        const session = JSON.parse(value) as PracticeSession;
        return typeof session.seconds === "number" ? [session] : [];
      } catch {
        return [];
      }
    });
const storage = (
  setItem = (key: string, value: string) => {
    stored.set(key, value);
  },
) => ({
  get length() {
    return stored.size;
  },
  key: (i: number) => [...stored.keys()][i] ?? null,
  getItem: (key: string) => stored.get(key) ?? null,
  setItem,
  removeItem: (key: string) => void stored.delete(key),
});

beforeEach(() => {
  stored.clear();
  now = new Date(2026, 9, 18, 10, 0, 0);
  vi.stubGlobal("localStorage", storage());
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

  it("adds up playing time and saves each whole second gained", () => {
    const log = new PracticeLog(clock);
    log.add(0.6, "ode");
    // Totals show the session in progress before it is saved.
    expect(log.totals().get("2026-10-18")).toBe(0);
    log.add(0.6, "ode");
    expect(log.totals().get("2026-10-18")).toBe(1);
    expect(saved()).toHaveLength(0);
    expect(log.commit()).toBe(true);
    expect(saved()).toEqual([
      expect.objectContaining({
        day: "2026-10-18",
        seconds: 1,
        songs: { ode: 1 },
      }),
    ]);
    // Nothing new to save until another whole second.
    const writes = vi.spyOn(localStorage, "setItem");
    log.add(0.3, "lamb");
    log.commit();
    expect(writes).not.toHaveBeenCalled();
    log.add(0.5, "lamb");
    log.commit();
    expect(writes).toHaveBeenCalledOnce();
    expect(saved()).toEqual([
      expect.objectContaining({
        seconds: 2,
        songs: { ode: 1, lamb: 0 },
      }),
    ]);
  });

  it("starts a new session at midnight and after a long pause", () => {
    const log = new PracticeLog(clock);
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
    stored.set(sessionKey("old"), JSON.stringify(old));
    stored.set(sessionKey("broken"), JSON.stringify({ id: "broken" }));
    stored.set(sessionKey("garbled"), "{");
    expect(storedSessions().map((s) => s.id)).toEqual(["old"]);
    const log = new PracticeLog(clock);
    log.add(2, "ode");
    log.commit();
    expect(saved().map((s) => s.seconds)).toEqual([2]);
    expect(stored.has(sessionKey("old"))).toBe(false);
    expect([...new PracticeLog(clock).totals()]).toEqual([["2026-10-18", 2]]);
  });

  it("totals songs whose ids match object properties", () => {
    const log = new PracticeLog(clock);
    log.add(2, "__proto__");
    log.add(1, "constructor");
    log.commit();
    expect(Object.entries(saved()[0].songs)).toEqual([
      ["__proto__", 2],
      ["constructor", 1],
    ]);
  });

  it("reports when browser storage refused a session, and keeps counting it", () => {
    const log = new PracticeLog(clock);
    log.add(1, "ode");
    expect(log.commit()).toBe(true);
    vi.stubGlobal(
      "localStorage",
      storage(() => {
        throw new Error("full");
      }),
    );
    log.add(1, "ode");
    expect(log.commit()).toBe(false);
    expect(log.totals().get("2026-10-18")).toBe(2);
  });

  it("takes in a session another tab saved while this one sits idle", () => {
    const tabA = new PracticeLog(clock);
    const tabB = new PracticeLog(clock);
    tabA.add(300, "ode");
    tabA.commit();
    expect(tabB.totals().get("2026-10-18")).toBeUndefined();
    const revision = tabB.revision;
    expect(tabB.refresh()).toBe(true);
    expect(tabB.totals().get("2026-10-18")).toBe(300);
    expect(tabB.revision).toBe(revision + 1);
    // Nothing new: no change, so views can skip work.
    expect(tabB.refresh()).toBe(false);
    expect(tabB.revision).toBe(revision + 1);
  });

  it("hears another tab save or remove a session, and nothing else", () => {
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    const onChange = vi.fn();
    const stop = watchSessions(onChange);
    const storage = (key: string | null) =>
      events.dispatchEvent(Object.assign(new Event("storage"), { key }));
    storage("cadence:practice:s1");
    storage("cadence:progress:song");
    // Storage cleared in another tab.
    storage(null);
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
    storage("cadence:practice:s2");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("keeps other tabs' sessions when saving its own", () => {
    const tabA = new PracticeLog(clock);
    const tabB = new PracticeLog(clock);
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

  it("saves only its own session, so tabs saving together cannot overwrite each other", () => {
    const tabA = new PracticeLog(clock);
    const tabB = new PracticeLog(clock);
    const writes: string[] = [];
    vi.stubGlobal(
      "localStorage",
      storage((key, value) => {
        writes.push(key);
        stored.set(key, value);
      }),
    );
    tabA.add(3, "ode");
    tabB.add(2, "lamb");
    tabA.commit();
    tabB.commit();
    const [a, b] = saved();
    expect(writes).toEqual([sessionKey(a.id), sessionKey(b.id)]);
    expect([a.seconds, b.seconds]).toEqual([3, 2]);
  });

  it("keeps exactly HISTORY_DAYS days of sessions, today included", () => {
    const session = (id: string, back: number): PracticeSession => ({
      id,
      day: addDays("2026-10-18", -back),
      startedAt: "",
      seconds: 60,
      songs: {},
    });
    for (const s of [
      session("oldest-kept", HISTORY_DAYS - 1),
      session("one-too-old", HISTORY_DAYS),
    ])
      stored.set(sessionKey(s.id), JSON.stringify(s));
    const log = new PracticeLog(clock);
    log.add(1, "ode");
    log.commit();
    expect(saved().map((s) => s.id)).toEqual([
      "oldest-kept",
      expect.any(String),
    ]);
    expect(log.totals().size).toBe(2);
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
