// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LoopBoundInput } from "../src/LoopBoundInput";

let root: Root, container: HTMLDivElement;
const onCommit = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onCommit.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Mirrors Studio.bounds(): the loop end stays 0.2 s after a start at 5. */
function LoopEnd() {
  const [end, setEnd] = useState(5.2);
  return (
    <LoopBoundInput
      label="Loop end seconds"
      value={end}
      min={5.2}
      max={30}
      onCommit={(seconds) => {
        onCommit(seconds);
        setEnd(Math.max(5.2, Math.min(30, seconds)));
      }}
    />
  );
}
async function render() {
  await act(async () => root.render(<LoopEnd />));
  const input = container.querySelector("input")!;
  input.focus();
  return input;
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("holds a partial number instead of clamping it mid-typing", async () => {
  const input = await render();
  await type(input, "1");
  expect(onCommit).not.toHaveBeenCalled();
  expect(input.value).toBe("1");
  await type(input, "12");
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(12);
  expect(input.value).toBe("12");
  await act(async () => input.blur());
  expect(onCommit).toHaveBeenCalledOnce();
  expect(input.value).toBe("12");
});

it("applies an out-of-range draft on blur or Enter and shows the clamped value", async () => {
  const input = await render();
  await type(input, "3");
  expect(onCommit).not.toHaveBeenCalled();
  await act(async () => input.blur());
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(3);
  expect(input.value).toBe("5.2");

  input.focus();
  await type(input, "40");
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(onCommit).toHaveBeenLastCalledWith(40);
  expect(input.value).toBe("30");
});

it("restores the current value when the field is left empty", async () => {
  const input = await render();
  await type(input, "");
  await act(async () => input.blur());
  expect(onCommit).not.toHaveBeenCalled();
  expect(input.value).toBe("5.2");
});
