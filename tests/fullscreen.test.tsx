// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePianoFullscreen } from "../src/usePianoFullscreen";

function Harness({ onEnter }: { onEnter(): void }) {
  const screen = usePianoFullscreen(onEnter);
  return (
    <>
      <button id="launcher" onClick={() => void screen.toggle()}>
        Full screen
      </button>
      <aside id="outside" inert>
        Already inactive
      </aside>
      <div id="stage" ref={screen.stage} data-expanded={screen.expanded}>
        <button id="first">First control</button>
        <button
          className="fullscreen-toggle"
          onClick={() => void screen.toggle()}
        >
          Exit full screen
        </button>
      </div>
    </>
  );
}

let root: Root;
let container: HTMLDivElement;
let nativeElement: Element | null;
let exit: ReturnType<typeof vi.fn>;
const button = (selector: string) =>
  container.querySelector<HTMLButtonElement>(selector)!;
const click = async (selector: string) => {
  await act(async () => button(selector).click());
};
const expanded = () =>
  container.querySelector("#stage")!.getAttribute("data-expanded");
async function mount(onEnter = vi.fn()) {
  await act(async () => root.render(<Harness onEnter={onEnter} />));
  const stage = container.querySelector<HTMLDivElement>("#stage")!;
  const request = vi.fn<() => Promise<void>>(async () => {
    throw new Error("Native fullscreen unavailable");
  });
  Object.defineProperty(stage, "requestFullscreen", {
    configurable: true,
    value: request,
  });
  return { stage, request, onEnter };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  nativeElement = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => nativeElement,
  });
  exit = vi.fn(async () => {
    nativeElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exit,
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("piano fullscreen", () => {
  it("starts audio before requesting fullscreen and keeps fallback controls focused", async () => {
    const order: string[] = [];
    const { request, onEnter } = await mount(
      vi.fn(() => {
        order.push("audio");
      }),
    );
    request.mockImplementation(async () => {
      order.push("fullscreen");
      throw new Error("Unsupported in this frame");
    });
    button("#launcher").focus();
    document.body.style.overflow = "scroll";
    await click("#launcher");
    expect(order).toEqual(["audio", "fullscreen"]);
    expect(expanded()).toBe("true");
    expect(document.activeElement).toBe(button(".fullscreen-toggle"));
    expect(document.body.style.overflow).toBe("hidden");
    expect(button("#launcher").inert).toBe(true);
    await click(".fullscreen-toggle");
    expect(onEnter).toHaveBeenCalledOnce();
    expect(expanded()).toBe("false");
    expect(document.body.style.overflow).toBe("scroll");
    expect(button("#launcher").inert).toBe(false);
    expect(container.querySelector<HTMLElement>("#outside")!.inert).toBe(true);
    expect(document.activeElement).toBe(button("#launcher"));
  });

  it("exits the fallback with Escape and does not autoplay on exit", async () => {
    const { onEnter } = await mount();
    button("#launcher").focus();
    await click("#launcher");
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      );
    });
    expect(expanded()).toBe("false");
    expect(onEnter).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button("#launcher"));
  });

  it("wraps keyboard focus inside the expanded piano", async () => {
    await mount();
    await click("#launcher");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })),
    );
    expect(document.activeElement).toBe(button("#first"));
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }),
      ),
    );
    expect(document.activeElement).toBe(button(".fullscreen-toggle"));
  });

  it("closes a late native fullscreen result if the user already exited", async () => {
    const { stage, request, onEnter } = await mount();
    let finish!: () => void;
    request.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await click("#launcher");
    await click(".fullscreen-toggle");
    await act(async () => {
      nativeElement = stage;
      document.dispatchEvent(new Event("fullscreenchange"));
      finish();
    });
    expect(exit).toHaveBeenCalledOnce();
    expect(nativeElement).toBeNull();
    expect(expanded()).toBe("false");
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("follows browser fullscreen exit and restores the page", async () => {
    const { stage, request } = await mount();
    request.mockImplementation(async () => {
      nativeElement = stage;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    button("#launcher").focus();
    await click("#launcher");
    await act(async () => {
      nativeElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(expanded()).toBe("false");
    expect(button("#launcher").inert).toBe(false);
    expect(document.activeElement).toBe(button("#launcher"));
  });

  it("keeps the exit control usable when native exit fails", async () => {
    const { stage, request } = await mount();
    request.mockImplementation(async () => {
      nativeElement = stage;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    exit.mockRejectedValue(new Error("Native exit failed"));
    await click("#launcher");
    await click(".fullscreen-toggle");
    expect(expanded()).toBe("true");
    expect(document.activeElement).toBe(button(".fullscreen-toggle"));
    expect(button("#launcher").inert).toBe(true);
  });

  it("restores page styles and inert state on unmount", async () => {
    await mount();
    document.body.style.overflow = "auto";
    await click("#launcher");
    await act(async () => root.render(null));
    expect(document.body.style.overflow).toBe("auto");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(exit).not.toHaveBeenCalled();
  });
});
