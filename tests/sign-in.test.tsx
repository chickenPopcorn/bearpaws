// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpeningStudio } from "../src/SignIn";

let root: Root;
let container: HTMLDivElement;
const buttons = () =>
  Array.from(container.querySelectorAll("button"), (b) => b.textContent);

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("opening the studio", () => {
  it("offers sign-out when the studio cannot open", async () => {
    const onSignOut = vi.fn();
    await act(async () =>
      root.render(
        <OpeningStudio
          error="Your songs could not be loaded."
          onSignOut={onSignOut}
        />,
      ),
    );
    expect(buttons()).toEqual(["Try again", "Sign out"]);
    await act(async () => container.querySelectorAll("button")[1].click());
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("shows only progress while loading", async () => {
    await act(async () =>
      root.render(<OpeningStudio error="" onSignOut={() => {}} />),
    );
    expect(buttons()).toEqual([]);
    expect(container.textContent).toContain("Opening your studio…");
  });
});
