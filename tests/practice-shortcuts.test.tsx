// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetTimeline } from "../src/SheetTimeline";
import type { Song } from "../src/song";
import { usePianoFullscreen } from "../src/usePianoFullscreen";
import { usePracticeShortcuts } from "../src/usePracticeShortcuts";

type ShortcutOptions = Parameters<typeof usePracticeShortcuts>[0];
const widgetRoles = [
  "slider",
  "spinbutton",
  "combobox",
  "listbox",
  "grid",
  "treegrid",
  "tree",
  "tablist",
  "menu",
  "menubar",
  "radiogroup",
  "toolbar",
] as const;

function Harness(props: ShortcutOptions) {
  usePracticeShortcuts(props);
  return (
    <div>
      <button className="fullscreen-toggle">Exit full screen</button>
      <button className="play" onClick={props.onTogglePlayback}>
        Play
      </button>
      <button className="other-control">
        <span>Other control</span>
      </button>
      <a href="#song" className="other-link">
        <span>Song link</span>
      </a>
      <details>
        <summary>
          <span>Collection</span>
        </summary>
      </details>
      <div role="button" tabIndex={0}>
        <span>Custom button</span>
      </div>
      <input aria-label="Search songs" />
      <input type="range" aria-label="Playback speed" />
      <textarea />
      <select>
        <option>One</option>
      </select>
      <div contentEditable suppressContentEditableWarning>
        <span>Editable</span>
      </div>
      <div role="textbox">
        <span>Custom editor</span>
      </div>
      {widgetRoles.map((role) => (
        <div key={role} role={role} tabIndex={0}>
          <span>Composite {role}</span>
        </div>
      ))}
    </div>
  );
}

function FullscreenHarness({
  onEnter,
  onTogglePlayback,
  onPreviousSong = () => {},
  onNextSong = () => {},
}: {
  onEnter(): void;
  onTogglePlayback(): void;
  onPreviousSong?(): void;
  onNextSong?(): void;
}) {
  const screen = usePianoFullscreen(onEnter);
  usePracticeShortcuts({
    expanded: screen.expanded,
    busy: false,
    onEnter: () => void screen.enter(),
    onTogglePlayback,
    onPreviousSong,
    onNextSong,
  });
  return (
    <div ref={screen.stage} data-expanded={screen.expanded}>
      <button
        className="fullscreen-toggle"
        onClick={() => void screen.toggle()}
      >
        {screen.expanded ? "Exit full screen" : "Full screen"}
      </button>
    </div>
  );
}

let root: Root;
let container: HTMLDivElement;
const query = (selector: string) =>
  container.querySelector<HTMLElement>(selector)!;
async function key(
  keyValue: string,
  options: KeyboardEventInit = {},
  target: EventTarget = document.body,
  type = "keydown",
) {
  const event = new KeyboardEvent(type, {
    key: keyValue,
    code: keyValue === " " ? "Space" : keyValue,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}
async function mount(overrides: Partial<ShortcutOptions> = {}) {
  const props: ShortcutOptions = {
    expanded: false,
    busy: false,
    onEnter: vi.fn(),
    onTogglePlayback: vi.fn(),
    onPreviousSong: vi.fn(),
    onNextSong: vi.fn(),
    ...overrides,
  };
  await act(async () => root.render(<Harness {...props} />));
  return props;
}

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("practice keyboard shortcuts", () => {
  it("enters fullscreen, then controls playback while Exit has focus", async () => {
    const onEnter = vi.fn();
    const onTogglePlayback = vi.fn();
    await act(async () =>
      root.render(
        <FullscreenHarness
          onEnter={onEnter}
          onTogglePlayback={onTogglePlayback}
        />,
      ),
    );
    const stage = query("[data-expanded]");
    const requestFullscreen = vi.fn(async () => {
      throw new Error("Use fallback");
    });
    Object.defineProperty(stage, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    expect((await key("Enter")).defaultPrevented).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(onEnter).toHaveBeenCalledOnce();
    expect(stage.dataset.expanded).toBe("true");
    expect(document.activeElement).toBe(query(".fullscreen-toggle"));

    expect((await key(" ", {}, document.activeElement!)).defaultPrevented).toBe(
      true,
    );
    expect(
      (await key(" ", {}, document.activeElement!, "keyup")).defaultPrevented,
    ).toBe(true);
    await key(" ", {}, document.activeElement!);
    await key(" ", {}, document.activeElement!, "keyup");
    expect(onTogglePlayback).toHaveBeenCalledTimes(2);
    expect(stage.dataset.expanded).toBe("true");
    expect(
      (await key("Enter", {}, document.activeElement!)).defaultPrevented,
    ).toBe(true);
    expect(stage.dataset.expanded).toBe("true");
    expect(onEnter).toHaveBeenCalledTimes(2);
    expect(requestFullscreen).toHaveBeenCalledOnce();

    await key("Escape");
    expect(stage.dataset.expanded).toBe("false");
  });

  it("resumes paused fullscreen practice with Enter without exiting or requesting fullscreen again", async () => {
    let playing = false;
    const startPlayback = vi.fn(() => {
      playing = true;
    });
    const onEnter = () => {
      if (!playing) startPlayback();
    };
    await act(async () =>
      root.render(
        <FullscreenHarness
          onEnter={onEnter}
          onTogglePlayback={() => {
            playing = !playing;
          }}
        />,
      ),
    );
    const stage = query("[data-expanded]");
    const requestFullscreen = vi.fn(async () => {
      throw new Error("Use fallback");
    });
    Object.defineProperty(stage, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    await key("Enter");
    expect(playing).toBe(true);
    expect(startPlayback).toHaveBeenCalledOnce();
    await key(" ", {}, document.activeElement!);
    await key(" ", {}, document.activeElement!, "keyup");
    expect(playing).toBe(false);

    await key("Enter", {}, document.activeElement!);
    expect(playing).toBe(true);
    expect(startPlayback).toHaveBeenCalledTimes(2);
    expect(stage.dataset.expanded).toBe("true");
    expect(requestFullscreen).toHaveBeenCalledOnce();

    await key("Enter", {}, stage);
    await key("Enter", {}, document.body);
    expect(startPlayback).toHaveBeenCalledTimes(2);
    expect(stage.dataset.expanded).toBe("true");
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it("uses current callbacks, fullscreen state, and loading state after rerender", async () => {
    const initial = await mount();
    const latest = {
      ...initial,
      expanded: true,
      onEnter: vi.fn(),
      onTogglePlayback: vi.fn(),
      onPreviousSong: vi.fn(),
      onNextSong: vi.fn(),
    };
    await act(async () => root.render(<Harness {...latest} />));
    await key("Enter");
    await key(" ");
    await key(" ", {}, document.body, "keyup");
    await key("ArrowLeft");
    await key("ArrowRight");
    expect(initial.onEnter).not.toHaveBeenCalled();
    expect(initial.onTogglePlayback).not.toHaveBeenCalled();
    expect(initial.onPreviousSong).not.toHaveBeenCalled();
    expect(initial.onNextSong).not.toHaveBeenCalled();
    expect(latest.onEnter).toHaveBeenCalledOnce();
    expect(latest.onTogglePlayback).toHaveBeenCalledOnce();
    expect(latest.onPreviousSong).toHaveBeenCalledOnce();
    expect(latest.onNextSong).toHaveBeenCalledOnce();

    await act(async () => root.render(<Harness {...latest} busy />));
    expect((await key(" ")).defaultPrevented).toBe(true);
    expect((await key(" ", {}, document.body, "keyup")).defaultPrevented).toBe(
      true,
    );
    expect(latest.onTogglePlayback).toHaveBeenCalledOnce();

    await act(async () =>
      root.render(<Harness {...latest} expanded={false} />),
    );
    await key("Enter");
    expect(latest.onEnter).toHaveBeenCalledTimes(2);
  });

  it("toggles once per Space press and rearms after release or window blur", async () => {
    const props = await mount();
    await key(" ");
    expect((await key(" ", { repeat: true })).defaultPrevented).toBe(true);
    await key(" ");
    expect(props.onTogglePlayback).toHaveBeenCalledOnce();
    await key(" ", {}, document.body, "keyup");
    await key(" ");
    expect(props.onTogglePlayback).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("blur"));
    await key(" ");
    expect(props.onTogglePlayback).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])(
    "navigates songs with Left and Right when fullscreen is %s",
    async (expanded) => {
      const props = await mount({ expanded });
      expect((await key("ArrowLeft")).defaultPrevented).toBe(true);
      expect(props.onPreviousSong).toHaveBeenCalledOnce();
      expect(props.onNextSong).not.toHaveBeenCalled();

      expect((await key("ArrowRight")).defaultPrevented).toBe(true);
      expect(props.onPreviousSong).toHaveBeenCalledOnce();
      expect(props.onNextSong).toHaveBeenCalledOnce();
      expect(props.onEnter).not.toHaveBeenCalled();
      expect(props.onTogglePlayback).not.toHaveBeenCalled();
    },
  );

  it("consumes navigation arrows while busy or repeating without changing songs", async () => {
    const props = await mount();
    for (const direction of ["ArrowLeft", "ArrowRight"]) {
      expect((await key(direction, { repeat: true })).defaultPrevented).toBe(
        true,
      );
    }
    await act(async () => root.render(<Harness {...props} busy />));
    for (const direction of ["ArrowLeft", "ArrowRight"]) {
      expect((await key(direction)).defaultPrevented).toBe(true);
    }
    expect(props.onPreviousSong).not.toHaveBeenCalled();
    expect(props.onNextSong).not.toHaveBeenCalled();

    await act(async () => root.render(<Harness {...props} />));
    await key("ArrowLeft");
    await key("ArrowRight");
    expect(props.onPreviousSong).toHaveBeenCalledOnce();
    expect(props.onNextSong).toHaveBeenCalledOnce();
  });

  it("consumes global song-navigation arrows before downstream handlers", async () => {
    const props = await mount();
    const downstream = vi.fn();
    container.addEventListener("keydown", downstream);
    window.addEventListener("keydown", downstream);
    try {
      for (const direction of ["ArrowLeft", "ArrowRight"]) {
        expect((await key(direction, {}, container)).defaultPrevented).toBe(
          true,
        );
        await key(direction, { repeat: true }, container);
      }
      await act(async () => root.render(<Harness {...props} busy />));
      await key("ArrowLeft", {}, container);
      await key("ArrowRight", {}, container);
      expect(downstream).not.toHaveBeenCalled();
      expect(props.onPreviousSong).toHaveBeenCalledOnce();
      expect(props.onNextSong).toHaveBeenCalledOnce();

      await key("Home", {}, container);
      expect(downstream).toHaveBeenCalledTimes(2);
    } finally {
      container.removeEventListener("keydown", downstream);
      window.removeEventListener("keydown", downstream);
    }
  });

  it("leaves typing fields and modified or composing keys untouched", async () => {
    const props = await mount();
    const targets = container.querySelectorAll(
      "input,textarea,select,[contenteditable] span,[role=textbox] span",
    );
    for (const target of targets) {
      expect((await key("Enter", {}, target)).defaultPrevented).toBe(false);
      expect((await key(" ", {}, target)).defaultPrevented).toBe(false);
      expect((await key("ArrowLeft", {}, target)).defaultPrevented).toBe(false);
      expect((await key("ArrowRight", {}, target)).defaultPrevented).toBe(
        false,
      );
      expect((await key(" ", {}, target, "keyup")).defaultPrevented).toBe(
        false,
      );
    }
    for (const modifier of [
      "ctrlKey",
      "metaKey",
      "altKey",
      "shiftKey",
      "isComposing",
    ]) {
      const options = { [modifier]: true };
      expect((await key("Enter", options)).defaultPrevented).toBe(false);
      expect((await key(" ", options)).defaultPrevented).toBe(false);
      expect((await key("ArrowLeft", options)).defaultPrevented).toBe(false);
      expect((await key("ArrowRight", options)).defaultPrevented).toBe(false);
      await key(" ", options, document.body, "keyup");
    }
    await key("Enter", { repeat: true });
    expect(props.onEnter).not.toHaveBeenCalled();
    expect(props.onTogglePlayback).not.toHaveBeenCalled();
    expect(props.onPreviousSong).not.toHaveBeenCalled();
    expect(props.onNextSong).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves Enter and Space on ordinary focused controls when fullscreen is %s",
    async (expanded) => {
      const props = await mount({ expanded });
      for (const selector of [
        ".other-control",
        ".other-link",
        "summary",
        '[role="button"]',
      ]) {
        const control = query(selector);
        control.tabIndex = 0;
        control.focus();
        expect(document.activeElement).toBe(control);
        // Happy DOM does not synthesize native keyboard clicks; both phases
        // must remain uncancelled for the browser to activate these controls.
        for (const name of ["Enter", " "]) {
          expect(
            (await key(name, {}, document.activeElement!)).defaultPrevented,
          ).toBe(false);
          expect(
            (await key(name, {}, document.activeElement!, "keyup"))
              .defaultPrevented,
          ).toBe(false);
        }
        // Nested content must retain the same native activation behavior.
        expect(
          (await key("Enter", {}, control.querySelector("span")!))
            .defaultPrevented,
        ).toBe(false);
      }
      expect(props.onEnter).not.toHaveBeenCalled();
      expect(props.onTogglePlayback).not.toHaveBeenCalled();
      expect(props.onPreviousSong).not.toHaveBeenCalled();
      expect(props.onNextSong).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "keeps explicit Play shortcuts when fullscreen is %s",
    async (expanded) => {
      const props = await mount({ expanded });
      const play = query(".play");
      play.focus();
      expect((await key("Enter", {}, play)).defaultPrevented).toBe(true);
      expect(props.onTogglePlayback).toHaveBeenCalledOnce();
      await key("Enter", { repeat: true }, play);
      expect(props.onTogglePlayback).toHaveBeenCalledOnce();
      expect((await key(" ", {}, play)).defaultPrevented).toBe(true);
      expect((await key(" ", {}, play, "keyup")).defaultPrevented).toBe(true);
      expect(props.onTogglePlayback).toHaveBeenCalledTimes(2);
      expect(props.onEnter).not.toHaveBeenCalled();

      await act(async () => root.render(<Harness {...props} busy />));
      await key("Enter", {}, query(".play"));
      await key(" ", {}, query(".play"));
      await key(" ", {}, query(".play"), "keyup");
      expect(props.onTogglePlayback).toHaveBeenCalledTimes(2);
    },
  );

  it("leaves focused composite widgets in charge of their navigation and activation keys", async () => {
    const props = await mount();
    for (const role of widgetRoles) {
      const widget = query(`[role="${role}"]`);
      widget.focus();
      for (const name of ["ArrowLeft", "ArrowRight", "Enter", " "]) {
        expect(
          (await key(name, {}, document.activeElement!)).defaultPrevented,
        ).toBe(false);
        expect(
          (await key(name, {}, widget.querySelector("span")!)).defaultPrevented,
        ).toBe(false);
      }
      await key(" ", {}, widget, "keyup");
    }
    expect(props.onPreviousSong).not.toHaveBeenCalled();
    expect(props.onNextSong).not.toHaveBeenCalled();
    expect(props.onEnter).not.toHaveBeenCalled();
    expect(props.onTogglePlayback).not.toHaveBeenCalled();
  });

  it("keeps Left and Right seeking the mounted score instead of switching songs", async () => {
    const props = await mount();
    const piece: Song = {
      id: "shortcut-score",
      title: "Shortcut score",
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
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    };
    const onSeek = vi.fn();
    function ScoreHarness() {
      usePracticeShortcuts(props);
      return (
        <SheetTimeline
          song={piece}
          position={3}
          mode="wait"
          hit={new Set()}
          selectedNotes={piece.notes}
          onSeek={onSeek}
        />
      );
    }
    await act(async () => root.render(<ScoreHarness />));
    const score = query('[role="slider"]');
    score.focus();
    expect(document.activeElement).toBe(score);
    expect((await key("ArrowRight", {}, score)).defaultPrevented).toBe(true);
    expect(onSeek).toHaveBeenLastCalledWith(3.5);
    expect((await key("ArrowLeft", {}, score)).defaultPrevented).toBe(true);
    expect(onSeek).toHaveBeenLastCalledWith(2.5);
    await key("ArrowRight", { shiftKey: true }, score);
    expect(onSeek).toHaveBeenLastCalledWith(5);
    expect(onSeek).toHaveBeenCalledTimes(3);
    expect(props.onPreviousSong).not.toHaveBeenCalled();
    expect(props.onNextSong).not.toHaveBeenCalled();
  });

  it("retains Enter for other controls in fullscreen and removes listeners on unmount", async () => {
    const props = await mount({ expanded: true });
    for (const selector of [
      ".other-control span",
      ".other-link span",
      "summary span",
      '[role="button"] span',
    ]) {
      expect((await key("Enter", {}, query(selector))).defaultPrevented).toBe(
        false,
      );
    }
    expect(props.onEnter).not.toHaveBeenCalled();
    expect(
      (await key("Enter", {}, query(".fullscreen-toggle"))).defaultPrevented,
    ).toBe(true);
    await act(async () => root.render(null));
    expect((await key("Enter")).defaultPrevented).toBe(false);
    expect((await key(" ")).defaultPrevented).toBe(false);
    expect((await key("ArrowLeft")).defaultPrevented).toBe(false);
    expect((await key("ArrowRight")).defaultPrevented).toBe(false);
    expect((await key(" ", {}, document.body, "keyup")).defaultPrevented).toBe(
      false,
    );
    expect(props.onEnter).toHaveBeenCalledOnce();
    expect(props.onTogglePlayback).not.toHaveBeenCalled();
  });
});
