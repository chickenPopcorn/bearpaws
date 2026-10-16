import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { settings, progress, write } from "../src/storage";
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
