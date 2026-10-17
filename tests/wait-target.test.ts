import { expect, it } from "vitest";
import { describeWaitTarget } from "../src/waitTarget";
import type { Note, Song } from "../src/song";

const note = (id: string, pitch: number, track: number): Note => ({
  id,
  pitch,
  track,
  channel: track,
  velocity: 0.7,
  start: 1,
  end: 2,
  soundEnd: 2,
});
const song = {
  tracks: [
    { id: 0, name: "Left", hand: "left", count: 1 },
    { id: 1, name: "Right", hand: "right", count: 2 },
  ],
} as Song;

it("names each expected note with its hand, finger and held state", () => {
  const notes = [
    { ...note("c3", 48, 0), finger: 5 as const, fingerHand: "left" as const },
    { ...note("e4", 64, 1), finger: 3 as const, fingerHand: "right" as const },
    note("g4", 67, 1),
  ];
  expect(describeWaitTarget(song, { start: 1, notes }, new Set([64]))).toBe(
    "Next: C3, left hand, finger 5; E4, right hand, finger 3, held; G4, right hand.",
  );
});

it("lists a pitch doubled across tracks once per hand and says when nothing is left", () => {
  const notes = [note("a", 60, 1), note("b", 60, 1)];
  expect(describeWaitTarget(song, { start: 1, notes }, new Set())).toBe(
    "Next: C4, right hand.",
  );
  expect(describeWaitTarget(song, undefined, new Set())).toBe(
    "No more notes to play in this passage.",
  );
});
