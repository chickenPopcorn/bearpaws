import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { progress, remove, settings, write } from "../src/storage";
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
    beat: 3,
    best: 75,
    attempts: 2,
    assignments: { 0: "left" },
    loopBeats: [1, 4],
    version: "v1",
  });
  expect(settings()).toMatchObject({
    mode: "rhythm",
    speed: 0.6,
    tolerance: 0.35,
    selected: "imported",
  });
  expect(progress("imported", "v1", 10)).toMatchObject({
    beat: 3,
    best: 75,
    attempts: 2,
    assignments: { 0: "left" },
    loopBeats: [1, 4],
    version: "v1",
  });
  expect(progress("other", "v1", 10)).toMatchObject({
    beat: 0,
    loopBeats: null,
    version: "v1",
  });
});
it("removes one song's progress under the same key it was saved with", () => {
  write("progress:gone", { beat: 3, version: "v1" });
  write("progress:kept", { beat: 2, version: "v1" });
  expect(remove("progress:gone")).toBe(true);
  expect(progress("gone", "v1", 10).beat).toBe(0);
  expect(progress("kept", "v1", 10).beat).toBe(2);
});
it("recovers corrupt or invalid storage shapes without crashing", () => {
  values.set("cadence:settings", "{bad");
  values.set(
    "cadence:progress:broken",
    JSON.stringify({
      beat: "oops",
      assignments: null,
      best: 700,
      loopBeats: [4, 1],
      version: "v1",
    }),
  );
  expect(settings().mode).toBe("wait");
  expect(progress("broken", "v1", 10)).toMatchObject({
    beat: 0,
    assignments: {},
    best: 100,
    loopBeats: null,
  });
  for (const loopBeats of [
    [-1, 4],
    [10, null],
    [2, "end"],
    [2],
    [null, 4],
    "1-4",
  ]) {
    write("progress:broken", { loopBeats, version: "v1" });
    expect(progress("broken", "v1", 10).loopBeats).toBeNull();
  }
  values.set("cadence:progress:broken", "null");
  expect(progress("broken", "v1", 10)).toMatchObject({
    beat: 0,
    loopBeats: null,
    version: "v1",
  });
});
it("starts the position and passage over when saved in seconds or for other notes", () => {
  const kept = {
    best: 80,
    attempts: 6,
    assignments: { 0: "left", 1: "off" },
    loopEnabled: false,
  };
  // Saved before versions, in seconds.
  write("progress:legacy", { ...kept, position: 3, loop: [1, 4] });
  expect(progress("legacy", "v2", 10)).toEqual({
    ...kept,
    beat: 0,
    updated: "",
    loopBeats: null,
    version: "v2",
  });
  // Saved for the song's earlier notes.
  write("progress:changed", {
    ...kept,
    beat: 6,
    loopBeats: [2, 8],
    version: "v1",
  });
  expect(progress("changed", "v2", 10)).toMatchObject({
    ...kept,
    beat: 0,
    loopBeats: null,
    version: "v2",
  });
  expect(progress("changed", "v1", 10)).toMatchObject({
    ...kept,
    beat: 6,
    loopBeats: [2, 8],
    version: "v1",
  });
});
it("keeps a passage that runs past the song's end, ending it there", () => {
  write("progress:long", { beat: 12, loopBeats: [2, 12], version: "v1" });
  expect(progress("long", "v1", 10)).toMatchObject({
    beat: 10,
    loopBeats: [2, 10],
  });
  // A passage to the end runs to wherever the end is.
  write("progress:long", { loopBeats: [2, null], version: "v1" });
  expect(progress("long", "v1", 10).loopBeats).toEqual([2, null]);
});
it("keeps the learner's name and a daily goal from the choices", () => {
  expect(settings()).toMatchObject({ learnerName: "", dailyGoalMinutes: 5 });
  write("settings", { learnerName: "George ", dailyGoalMinutes: 15 });
  expect(settings()).toMatchObject({
    learnerName: "George ",
    dailyGoalMinutes: 15,
  });
  write("settings", { learnerName: "x".repeat(60), dailyGoalMinutes: 7 });
  expect(settings()).toMatchObject({
    learnerName: "x".repeat(40),
    dailyGoalMinutes: 5,
  });
  write("settings", { learnerName: 4, dailyGoalMinutes: "10" });
  expect(settings()).toMatchObject({ learnerName: "", dailyGoalMinutes: 5 });
  // Only a saved true counts as a name someone chose.
  expect(settings().learnerNameChosen).toBe(false);
  write("settings", { learnerName: "", learnerNameChosen: true });
  expect(settings()).toMatchObject({
    learnerName: "",
    learnerNameChosen: true,
  });
  write("settings", { learnerNameChosen: "yes" });
  expect(settings().learnerNameChosen).toBe(false);
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
it("discards the removed Rhythm reference sound", () => {
  write("settings", { mode: "rhythm", reference: true });
  expect(settings().mode).toBe("rhythm");
  expect(settings()).not.toHaveProperty("reference");
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
it.each([
  undefined,
  { loop: [1, 4] },
  { loopBeats: null, version: "v1" },
  { loopBeats: [1, 4], version: "v1" },
])("defaults new and legacy progress to looping on: %j", (saved) => {
  if (saved) write("progress:loop-default", saved);
  const restored = progress("loop-default", "v1", 10);
  expect(restored.loopEnabled).toBe(true);
  expect(restored.loopBeats).toEqual(
    saved && "loopBeats" in saved ? saved.loopBeats : null,
  );
});
it("preserves an explicit loop preference separately from its custom range", () => {
  write("progress:loop-off", {
    loopEnabled: false,
    loopBeats: [1, 4],
    version: "v1",
  });
  expect(progress("loop-off", "v1", 10)).toMatchObject({
    loopEnabled: false,
    loopBeats: [1, 4],
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
  expect(progress("blocked", "v1", 10).beat).toBe(0);
});
