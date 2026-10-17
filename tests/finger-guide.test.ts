import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BearPaw } from "../src/BearPaw";
import { FingerGuide } from "../src/FingerGuide";
import { builtInSongs } from "../src/lessons";

const lesson = () => builtInSongs()[0];
const renderGuide = (piece = lesson(), left = true, right = true) =>
  renderToStaticMarkup(
    createElement(FingerGuide, { song: piece, left, right }),
  );

function storedPreference(value: string | null = null) {
  const storage = {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

beforeEach(() => storedPreference());
afterEach(() => vi.unstubAllGlobals());

describe("finger guide", () => {
  it("always shows bear paws with a heading and no mode toggle", () => {
    const markup = renderGuide();
    expect(markup).toContain(
      '<h2 class="finger-guide-heading">Where your fingers go</h2>',
    );
    expect(markup).toContain("Playful left bear paw finger guide");
    expect(markup).toContain("Playful right bear paw finger guide");
    expect(markup).not.toContain("hand viewed from above");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("aria-pressed");
  });

  it("renders bear paws without accessing blocked browser storage", () => {
    const unavailable = vi.fn(() => {
      throw new Error("Storage unavailable");
    });
    vi.stubGlobal("localStorage", {
      getItem: unavailable,
      setItem: unavailable,
      removeItem: unavailable,
    });
    const markup = renderGuide();
    expect(markup).toContain("Playful left bear paw finger guide");
    expect(markup).toContain("Playful right bear paw finger guide");
    expect(unavailable).not.toHaveBeenCalled();
  });

  it.each(["true", "false", '"true"', "1", "{}", "null", "{invalid", null])(
    "ignores legacy, invalid, or missing browser preferences (%j)",
    (value) => {
      const storage = storedPreference(value);
      const markup = renderGuide();
      expect(markup).toContain("Playful left bear paw finger guide");
      expect(markup).toContain("Playful right bear paw finger guide");
      expect(markup).not.toContain("hand viewed from above");
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    },
  );

  it("does not show a suggested hand position for a track reassigned to the other hand", () => {
    const piece = lesson();
    const reassigned = {
      ...piece,
      tracks: piece.tracks.map((track) => ({
        ...track,
        hand: "right" as const,
      })),
    };
    const markup = renderGuide(reassigned);
    expect(markup).toContain(
      "Restore this track’s original hand to use its fingering.",
    );
    expect(markup).not.toContain(piece.lesson!.handPositions.left);
  });

  it("keeps an inactive hand visible and identifies it as off", () => {
    const markup = renderGuide(lesson(), false);
    expect(markup).toContain('class="hand-position left inactive"');
    expect(markup).toContain("Left hand · off");
    expect(markup).toContain("Playful left bear paw finger guide");
  });

  it("omits the guide for imported pieces without reliable finger annotations", () => {
    const piece = lesson();
    expect(renderGuide({ ...piece, lesson: undefined })).toBe("");
    expect(
      renderGuide({
        ...piece,
        notes: piece.notes.map((note) => ({ ...note, finger: undefined })),
      }),
    ).toBe("");
  });
});

describe("bear-paw fingering", () => {
  it("mirrors finger positions between hands without mirroring their numbers", () => {
    const positions = (hand: "left" | "right") => {
      const markup = renderToStaticMarkup(createElement(BearPaw, { hand }));
      const digits = [
        ...markup.matchAll(
          /<g transform="translate\(([-\d.]+) ([-\d.]+)\)"><g class="bear-paw-digit"[^>]*>[\s\S]*?<text[^>]*>(\d)<\/text>/g,
        ),
      ];
      expect(digits).toHaveLength(5);
      return new Map(
        digits.map((digit) => [
          Number(digit[3]),
          [Number(digit[1]), Number(digit[2])],
        ]),
      );
    };
    const left = positions("left");
    const right = positions("right");
    for (const finger of [1, 2, 3, 4, 5]) {
      expect(left.get(finger)![0] + right.get(finger)![0]).toBe(220);
      expect(left.get(finger)![1]).toBe(right.get(finger)![1]);
    }
    expect(left.get(1)![0]).toBeGreaterThan(left.get(5)![0]);
    expect(right.get(1)![0]).toBeLessThan(right.get(5)![0]);
  });
});
