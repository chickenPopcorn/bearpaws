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

function storedPreference(value: unknown) {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) =>
      key === "cadence:bear-paws" ? JSON.stringify(value) : null,
    ),
  });
}

beforeEach(() => storedPreference(null));
afterEach(() => vi.unstubAllGlobals());

describe("finger guide", () => {
  it("keeps conventional hands as the default and exposes the surprise as a toggle", () => {
    const markup = renderGuide();
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain("left hand viewed from above");
    expect(markup).toContain("right hand viewed from above");
    expect(markup).not.toContain('class="bear-paw"');
  });

  it("restores the bear-paw preference on a new render", () => {
    storedPreference(true);
    const markup = renderGuide();
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Playful left bear paw finger guide");
    expect(markup).toContain("Playful right bear paw finger guide");
    expect(markup).not.toContain("hand viewed from above");
  });

  it("still renders if the browser blocks preference storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage unavailable");
      },
    });
    expect(renderGuide()).toContain('aria-pressed="false"');
  });

  it.each([false, "true", 1, {}, null])(
    "uses human hands for an invalid or disabled stored preference (%j)",
    (value) => {
      storedPreference(value);
      expect(renderGuide()).toContain('aria-pressed="false"');
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
    expect(markup).toContain("left hand viewed from above");
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
