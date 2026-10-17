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
async function render(ambience = 0.22) {
  await act(async () =>
    root.render(<PianoSoundControls ambience={ambience} onChange={onChange} />),
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
