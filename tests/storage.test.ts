import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { progress, removeProgress, settings, write } from "../src/storage";
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("persists actual settings and song progress under independent browser keys", () => {
  write("settings", {
    mode: "rhythm",
    speed: 0.6,
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
    speed: 0.6,
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
it("removes one song's progress under the same key it was saved with", () => {
  write("progress:gone", { position: 3 });
  write("progress:kept", { position: 2 });
  removeProgress("gone");
  expect(progress("gone", 5).position).toBe(0);
  expect(progress("kept", 5).position).toBe(2);
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
it("keeps both hands off when that was the saved choice", () => {
  write("settings", { left: false, right: false });
  expect(settings()).toMatchObject({ left: false, right: false });
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
it("keeps optional piano voices on unless one was turned off", () => {
  expect(settings().pianoVoices).toEqual({
    release: true,
    keyNoise: true,
    pedalNoise: true,
    resonance: true,
  });
  write("settings", { pianoVoices: { resonance: false, keyNoise: 1 } });
  expect(settings().pianoVoices).toEqual({
    release: true,
    keyNoise: true,
    pedalNoise: true,
    resonance: false,
  });
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
it("snaps saved speeds onto the slider's 20% steps within its range", () => {
  for (const [saved, loaded] of [
    [0.75, 0.8],
    [0.25, 0.2],
    [1.5, 1.4],
    [3, 1.4],
    [0.01, 0.2],
  ]) {
    write("settings", { speed: saved });
    expect(settings().speed).toBe(loaded);
  }
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
  expect(settings().speed).toBe(1);
  expect(progress("blocked", 5).position).toBe(0);
});
