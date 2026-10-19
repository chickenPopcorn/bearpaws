import { afterEach, expect, it, vi } from "vitest";
import { Studio } from "../src/controller";
import type { Song } from "../src/song";
import { fixtureLibrary } from "./fixtures/library";
afterEach(() => vi.unstubAllGlobals());
it("reuses selected notes between clock/render reads and invalidates on hand or assignment changes", () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const studio = new Studio(fixtureLibrary());
  let handReads = 0;
  const tracks = Array.from({ length: 256 }, (_, id) => ({
    id,
    name: `Track ${id}`,
    get hand() {
      handReads++;
      return (id % 2 ? "right" : "left") as "right" | "left";
    },
    count: 1,
  }));
  const song: Song = {
    id: "many-tracks",
    title: "Many tracks",
    duration: 10,
    ppq: 480,
    tempos: [],
    warnings: [],
    tracks,
    notes: tracks.map((t) => ({
      id: String(t.id),
      pitch: 48 + (t.id % 24),
      start: 1,
      end: 2,
      soundEnd: 2,
      velocity: 0.7,
      track: t.id,
      channel: t.id % 16,
    })),
  };
  studio.load(song);
  const all = studio.notes;
  const count = handReads;
  for (let frame = 0; frame < 100; frame++) expect(studio.notes).toBe(all);
  expect(handReads).toBe(count);
  expect(studio.notes).toHaveLength(256);
  studio.hand("left");
  expect(studio.notes).toHaveLength(128);
  studio.assign(0, "right");
  expect(studio.notes).toHaveLength(129);
  studio.assign(1, "off");
  expect(studio.notes).toHaveLength(128);
  studio.destroy();
});
