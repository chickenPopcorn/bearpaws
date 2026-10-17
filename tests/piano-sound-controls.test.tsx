// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PianoSoundControls } from "../src/PianoSoundControls";

let root: Root, container: HTMLDivElement;
const onChange = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onChange.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(
  profile: "natural" | "original" = "natural",
  ambience = 0.22,
) {
  await act(async () =>
    root.render(
      <PianoSoundControls
        profile={profile}
        ambience={ambience}
        onChange={onChange}
      />,
    ),
  );
}
it("offers a labelled native popover and retains the room amount when switching profile", async () => {
  await render();
  const button = container.querySelector("button")!;
  const panel = container.querySelector("[popover]")!;
  expect(button.textContent).toBe("Piano sound");
  expect(button.getAttribute("popovertarget")).toBe(panel.id);
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = "original";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith("original", 0.22);
});
it("shows the selected room amount and disables it only for Original", async () => {
  await render("natural", 0.38);
  expect(container.querySelector("output")?.textContent).toBe("38%");
  expect(container.querySelector("input")?.disabled).toBe(false);
  await render("original", 0.38);
  expect(container.querySelector("output")?.textContent).toBe("Off");
  expect(container.querySelector("input")?.disabled).toBe(true);
});
it("updates the room amount without switching the sound profile", async () => {
  await render();
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "47");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith("natural", 0.47);
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
