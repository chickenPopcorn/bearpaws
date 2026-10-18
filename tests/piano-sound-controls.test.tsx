// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PianoSoundControls } from "../src/PianoSoundControls";
import { DEFAULT_PIANO_SOUND, type PianoVoices } from "../src/pianoSound";

let root: Root, container: HTMLDivElement;
const onChange = vi.fn();
const onVoiceChange = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onChange.mockClear();
  onVoiceChange.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(
  ambience = 0.22,
  voices: PianoVoices = DEFAULT_PIANO_SOUND.voices,
) {
  await act(async () =>
    root.render(
      <PianoSoundControls
        ambience={ambience}
        onChange={onChange}
        voices={voices}
        onVoiceChange={onVoiceChange}
      />,
    ),
  );
}
it("offers Natural piano in a labelled native popover without a profile selector", async () => {
  await render();
  const button = container.querySelector("button")!;
  const panel = container.querySelector("[popover]")!;
  expect(button.textContent).toBe("Piano sound");
  expect(button.getAttribute("popovertarget")).toBe(panel.id);
  expect(panel.textContent).toContain("Natural piano");
  expect(container.querySelector("select")).toBeNull();
  expect(panel.textContent).not.toContain("Original");
});
it.each([0, 0.38])(
  "shows the room amount and always enables adjustment: %s",
  async (ambience) => {
    await render(ambience);
    expect(container.querySelector("output")?.textContent).toBe(
      `${Math.round(ambience * 100)}%`,
    );
    expect(container.querySelector("input")?.disabled).toBe(false);
  },
);
it("updates the room amount", async () => {
  await render();
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "47");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(0.47);
});
it("turns each recorded detail on and off", async () => {
  await render(0.22, { ...DEFAULT_PIANO_SOUND.voices, pedalNoise: false });
  const boxes = [
    ...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
  ];
  expect(
    boxes.map((box) => [box.parentElement!.textContent!.trim(), box.checked]),
  ).toEqual([
    ["Release harmonics", true],
    ["Key release noise", true],
    ["Pedal noise", false],
    ["Pedal resonance", true],
  ]);
  await act(async () => boxes[3].click());
  expect(onVoiceChange).toHaveBeenLastCalledWith("resonance", false);
  await act(async () => boxes[2].click());
  expect(onVoiceChange).toHaveBeenLastCalledWith("pedalNoise", true);
});
it("leaves Escape available to the native popover and fullscreen handler", async () => {
  await render();
  const outside = vi.fn();
  document.addEventListener("keydown", outside);
  try {
    const input = container.querySelector("input")!;
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    expect(outside).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  } finally {
    document.removeEventListener("keydown", outside);
  }
});
