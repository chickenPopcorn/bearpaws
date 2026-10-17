import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  deleteSong,
  library,
  progress,
  saveSong,
  settings,
  write,
} from "../src/storage";
import type { Song } from "../src/song";
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("persists actual settings and song progress under independent browser keys", () => {
  write("settings", {
    mode: "rhythm",
    speed: 0.5,
    tolerance: 0.35,
    left: false,
    right: true,
    selected: "imported",
  });
  write("progress:imported", {
    position: 3,
    best: 75,
    attempts: 2,
    assignments: { 0: "left" },
    loop: [1, 4],
  });
  expect(settings()).toMatchObject({
    mode: "rhythm",
    speed: 0.5,
    tolerance: 0.35,
    selected: "imported",
  });
  expect(progress("imported", 5)).toMatchObject({
    position: 3,
    best: 75,
    attempts: 2,
    assignments: { 0: "left" },
    loop: [1, 4],
  });
  expect(progress("other", 5).position).toBe(0);
});
it("recovers corrupt or invalid storage shapes without crashing", () => {
  values.set("cadence:settings", "{bad");
  values.set(
    "cadence:progress:broken",
    JSON.stringify({
      position: "oops",
      assignments: null,
      best: 700,
      loop: [4, 1],
    }),
  );
  expect(settings().mode).toBe("wait");
  expect(progress("broken", 5)).toMatchObject({
    position: 0,
    assignments: {},
    best: 100,
    loop: null,
  });
  values.set("cadence:progress:broken", "null");
  expect(progress("broken", 5).position).toBe(0);
});
it("migrates the removed 500ms tolerance to the widest available setting", () => {
  write("settings", { tolerance: 0.5 });
  expect(settings().tolerance).toBe(0.35);
});
it("preserves the room amount and discards the removed sound profile", () => {
  expect(settings()).toMatchObject({ ambience: 0.22 });
  write("settings", { soundProfile: "original", ambience: 0.37 });
  expect(settings()).toMatchObject({
    ambience: 0.37,
  });
  expect(settings()).not.toHaveProperty("soundProfile");
});
it.each([
  [{ soundProfile: "unknown", ambience: "loud" }, { ambience: 0.22 }],
  [{ soundProfile: "natural", ambience: -1 }, { ambience: 0 }],
  [{ soundProfile: "original", ambience: 8 }, { ambience: 1 }],
])("normalizes invalid sound preferences: %j", (saved, expected) => {
  write("settings", saved);
  expect(settings()).toMatchObject(expected);
});
it.each([undefined, { loop: null }, { loop: [1, 4] }])(
  "defaults new and legacy progress to looping on: %j",
  (saved) => {
    if (saved) write("progress:loop-default", saved);
    const restored = progress("loop-default", 5);
    expect(restored.loopEnabled).toBe(true);
    expect(restored.loop).toEqual(saved?.loop ?? null);
  },
);
it("preserves an explicit loop preference separately from its custom range", () => {
  write("progress:loop-off", { loopEnabled: false, loop: [1, 4] });
  expect(progress("loop-off", 5)).toMatchObject({
    loopEnabled: false,
    loop: [1, 4],
  });
});
it("reports quota or denied storage instead of throwing", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    },
  });
  expect(write("settings", {})).toBe(false);
  expect(settings().speed).toBe(0.75);
  expect(progress("blocked", 5).position).toBe(0);
});

/** A minimal IndexedDB whose transactions either commit or abort at commit time. */
function stubIndexedDB(outcome: "complete" | "abort", rows: unknown[] = []) {
  const close = vi.fn();
  const database = {
    close,
    transaction: () => {
      const request: { result?: unknown; onsuccess?: () => void } = {};
      const tx = {
        error: null as DOMException | null,
        oncomplete: null as null | (() => void),
        onabort: null as null | (() => void),
        objectStore: () => ({
          getAll: () => request,
          put: () => request,
          delete: () => request,
        }),
      };
      queueMicrotask(() => {
        if (outcome === "complete") {
          request.result = rows;
          request.onsuccess?.();
          tx.oncomplete?.();
        } else {
          // Quota failures surface at commit as an abort, without an error event.
          tx.error = new DOMException("Disk is full", "QuotaExceededError");
          tx.onabort?.();
        }
      });
      return tx;
    },
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request = {
        result: database,
        onsuccess: null as null | (() => void),
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  return close;
}
const storedSong = { id: "stored" } as Song;
it("returns stored songs and closes the database", async () => {
  const close = stubIndexedDB("complete", [storedSong]);
  await expect(library()).resolves.toEqual([storedSong]);
  await expect(saveSong(storedSong)).resolves.toBeUndefined();
  await expect(deleteSong(storedSong.id)).resolves.toBeUndefined();
  expect(close).toHaveBeenCalledTimes(3);
});
it.each([
  ["library", () => library()],
  ["saveSong", () => saveSong(storedSong)],
  ["deleteSong", () => deleteSong(storedSong.id)],
])("rejects when %s's transaction aborts at commit", async (_, run) => {
  const close = stubIndexedDB("abort");
  await expect(run()).rejects.toMatchObject({ name: "QuotaExceededError" });
  expect(close).toHaveBeenCalledOnce();
});
