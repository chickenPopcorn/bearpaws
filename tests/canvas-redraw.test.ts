// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchCanvasRedraws } from "../src/canvasRedraw";

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let resize: () => void;
let observed: Element[];
let disconnects: number;
let queries: { media: string; listeners: Set<() => void> }[];
let fonts: EventTarget & { ready: Promise<void> };
let fontsReady: () => void;
let canvas: HTMLCanvasElement;

function store() {
  const listeners = new Set<() => void>();
  return {
    listeners,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => listeners.forEach((listener) => listener()),
  };
}
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(performance.now());
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  observed = [];
  disconnects = 0;
  queries = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(element: Element) {
        observed.push(element);
      }
      disconnect() {
        disconnects++;
      }
    },
  );
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("matchMedia", (media: string) => {
    const query = { media, listeners: new Set<() => void>() };
    queries.push(query);
    return {
      media,
      addEventListener: (_: string, listener: () => void) =>
        query.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        query.listeners.delete(listener),
    };
  });
  fonts = Object.assign(new EventTarget(), {
    ready: new Promise<void>((resolve) => (fontsReady = resolve)),
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: fonts,
  });
  canvas = document.createElement("canvas");
});
afterEach(() => {
  Reflect.deleteProperty(document, "fonts");
  vi.unstubAllGlobals();
});

it("paints once on start and schedules nothing while idle", () => {
  const paint = vi.fn();
  const stop = watchCanvasRedraws(canvas, store().subscribe, paint);
  expect(paint).toHaveBeenCalledOnce();
  expect(observed).toEqual([canvas]);
  expect(frames.size).toBe(0);
  flushFrames();
  expect(paint).toHaveBeenCalledOnce();
  stop();
});

it("coalesces store changes into one paint per frame", () => {
  const paint = vi.fn();
  const studio = store();
  const stop = watchCanvasRedraws(canvas, studio.subscribe, paint);
  studio.emit();
  studio.emit();
  studio.emit();
  expect(frames.size).toBe(1);
  expect(paint).toHaveBeenCalledTimes(1);
  flushFrames();
  expect(paint).toHaveBeenCalledTimes(2);
  flushFrames();
  expect(paint).toHaveBeenCalledTimes(2);
  studio.emit();
  flushFrames();
  expect(paint).toHaveBeenCalledTimes(3);
  stop();
});

it("repaints after a resize and after the device pixel ratio changes", () => {
  const paint = vi.fn();
  const stop = watchCanvasRedraws(canvas, store().subscribe, paint);
  resize();
  flushFrames();
  expect(paint).toHaveBeenCalledTimes(2);
  expect(queries.map((query) => query.media)).toEqual(["(resolution: 1dppx)"]);
  vi.stubGlobal("devicePixelRatio", 2);
  queries[0].listeners.forEach((listener) => listener());
  flushFrames();
  expect(paint).toHaveBeenCalledTimes(3);
  // The old query no longer matches anything new, so it is replaced.
  expect(queries.map((query) => query.media)).toEqual([
    "(resolution: 1dppx)",
    "(resolution: 2dppx)",
  ]);
  expect(queries[0].listeners.size).toBe(0);
  expect(queries[1].listeners.size).toBe(1);
  stop();
});

it("repaints when web fonts finish loading", async () => {
  const paint = vi.fn();
  const stop = watchCanvasRedraws(canvas, store().subscribe, paint);
  fontsReady();
  await fonts.ready;
  flushFrames();
  expect(paint).toHaveBeenCalledTimes(2);
  fonts.dispatchEvent(new Event("loadingdone"));
  flushFrames();
  expect(paint).toHaveBeenCalledTimes(3);
  stop();
});

it("cancels the pending paint and removes every trigger when stopped", async () => {
  const paint = vi.fn();
  const studio = store();
  const stop = watchCanvasRedraws(canvas, studio.subscribe, paint);
  studio.emit();
  stop();
  expect(frames.size).toBe(0);
  expect(studio.listeners.size).toBe(0);
  expect(disconnects).toBe(1);
  expect(queries[0].listeners.size).toBe(0);
  resize();
  fonts.dispatchEvent(new Event("loadingdone"));
  fontsReady();
  await fonts.ready;
  expect(frames.size).toBe(0);
  expect(paint).toHaveBeenCalledOnce();
});
