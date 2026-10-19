// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpeningStudio } from "../src/OpeningStudio";
import { SignIn } from "../src/SignIn";

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

describe("signing in", () => {
  it("says so when Google sign-in cannot start, and allows another try", async () => {
    const onSignIn = vi.fn().mockRejectedValueOnce(new Error("offline"));
    await act(async () => root.render(<SignIn error="" onSignIn={onSignIn} />));
    const button = container.querySelector("button")!;
    await act(async () => button.click());
    expect(onSignIn).toHaveBeenCalledOnce();
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Google sign-in could not start. Please try again.",
    );
    expect(button.disabled).toBe(false);
  });

  it("shows why sign-in is unavailable", async () => {
    await act(async () =>
      root.render(
        <SignIn
          error="Sign-in is not set up for this site."
          onSignIn={async () => {}}
        />,
      ),
    );
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Sign-in is not set up for this site.",
    );
  });
});
