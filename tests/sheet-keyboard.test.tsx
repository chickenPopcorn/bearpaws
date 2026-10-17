// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetTimeline } from "../src/SheetTimeline";
import type { Song } from "../src/song";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const song = (): Song => ({
  id: "meter-keyboard",
  title: "Meter keyboard",
  ppq: 480,
  tempos: [],
  warnings: [],
  duration: 12,
  tracks: [{ id: 0, name: "Piano", hand: "right", count: 1 }],
  notes: [
    {
      id: "end",
      pitch: 60,
      velocity: 0.7,
      channel: 0,
      track: 0,
      start: 10,
      end: 10.5,
      soundEnd: 10.5,
    },
  ],
  timeSignatures: [{ tick: 0, numerator: 6, denominator: 8 }],
});

async function seek(
  piece: Song,
  position: number,
  key: string,
  shiftKey = false,
) {
  const onSeek = vi.fn();
  await act(async () =>
    root.render(
      <SheetTimeline
        song={piece}
        position={position}
        mode="wait"
        hit={new Set()}
        selectedNotes={piece.notes}
        onSeek={onSeek}
      />,
    ),
  );
  await act(async () =>
    container
      .querySelector("svg")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }),
      ),
  );
  return onSeek;
}

describe("meter-aware score keyboard seeking", () => {
  it("steps by an eighth note or a complete bar in 6/8", async () => {
    expect(await seek(song(), 0, "ArrowRight")).toHaveBeenCalledWith(0.25);
    expect(await seek(song(), 0, "ArrowRight", true)).toHaveBeenCalledWith(1.5);
  });

  it("preserves relative bar position across a 4/4 to 3/4 change", async () => {
    const piece = song();
    piece.timeSignatures = [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 8 * 480, numerator: 3, denominator: 4 },
    ];
    expect(await seek(piece, 3, "ArrowRight", true)).toHaveBeenCalledWith(4.75);
    expect(await seek(piece, 4.75, "ArrowLeft", true)).toHaveBeenCalledWith(3);
  });

  it("retains built-in count-in seeking and clamps backward movement to the beginning", async () => {
    const piece = song();
    piece.timeSignatures = undefined;
    piece.beatsPerBar = 4;
    piece.leadInBeats = 1;
    expect(await seek(piece, 0, "ArrowRight", true)).toHaveBeenCalledWith(2);
    expect(await seek(piece, 0.75, "ArrowLeft", true)).toHaveBeenCalledWith(0);
  });
});
