// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RELOAD_SNAPSHOT_KEY, saveReloadSnapshot } from "../src/reloadSnapshot";

const page = readFileSync("index.html", "utf8");
// The classic script in index.html that runs before the app loads.
const restore = new Function(/<script>([\s\S]*?)<\/script>/.exec(page)![1]);
const image = "data:image/webp;base64,AAAA";
let root: HTMLElement;
let values: Map<string, string>;
// Whether a value is too big for the browser to keep.
let full: (value: string) => boolean;

beforeEach(() => {
  values = new Map();
  full = () => false;
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full(v)) throw new DOMException("full", "QuotaExceededError");
      values.set(k, v);
    },
    removeItem: (k: string) => values.delete(k),
  });
  document.head.innerHTML = '<link rel="stylesheet" />';
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById("root")!;
  root.innerHTML = `
    <div class="app">
      <h1>Ode to Joy</h1>
      <select><option>Focused</option><option>Relaxed</option></select>
      <input type="checkbox" />
      <input type="search" />
      <canvas class="piano"></canvas>
    </div>`;
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(image);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function leave() {
  // The app sets form state as properties, which markup leaves out.
  root.querySelector("select")!.value = "Relaxed";
  root.querySelector<HTMLInputElement>("[type=checkbox]")!.checked = true;
  root.querySelector<HTMLInputElement>("[type=search]")!.value = "lamb";
  saveReloadSnapshot(root);
  root.innerHTML = "";
}

it("shows the page as it was left, form state included, until the app renders", () => {
  leave();
  restore();
  expect(root.querySelector("h1")?.textContent).toBe("Ode to Joy");
  expect(root.querySelector("select")!.value).toBe("Relaxed");
  expect(root.querySelector<HTMLInputElement>("[type=checkbox]")!.checked).toBe(
    true,
  );
  expect(root.querySelector<HTMLInputElement>("[type=search]")!.value).toBe(
    "lamb",
  );
  expect(root.querySelector("canvas")!.getAttribute("style")).toContain(image);
  expect((root.firstElementChild as HTMLElement).inert).toBe(true);
});

it("uses a snapshot only for the next load", () => {
  leave();
  restore();
  expect(sessionStorage.getItem(RELOAD_SNAPSHOT_KEY)).toBeNull();
  root.innerHTML = "";
  restore();
  expect(root.innerHTML).toBe("");
});

it("leaves the page empty while the stylesheet comes from script", () => {
  leave();
  document.head.innerHTML = "";
  restore();
  expect(root.innerHTML).toBe("");
  expect(sessionStorage.getItem(RELOAD_SNAPSHOT_KEY)).toBeNull();
});

it("keeps the markup alone when the canvas images do not fit", () => {
  full = (value) => value.includes(image);
  leave();
  restore();
  expect(root.querySelector("h1")?.textContent).toBe("Ode to Joy");
  expect(root.querySelector("canvas")!.getAttribute("style")).toBeNull();
});

it("drops an older snapshot when storage refuses the new one", () => {
  leave();
  full = () => true;
  root.innerHTML = "<p>Newer page</p>";
  saveReloadSnapshot(root);
  root.innerHTML = "";
  restore();
  expect(root.innerHTML).toBe("");
});
