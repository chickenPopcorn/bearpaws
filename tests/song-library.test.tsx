// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SongLibrary } from "../src/SongLibrary";
import { builtInSongs } from "../src/lessons";
import { midiPieces } from "../src/midiPieces";
import { popsPieces } from "../src/popsPieces";
import type { Song } from "../src/song";

type LibraryProps = ComponentProps<typeof SongLibrary>;
const base = builtInSongs()[0];
const song = (id: string, title: string, composer?: string): Song => ({
  ...base,
  id,
  title,
  lesson: composer ? { ...base.lesson!, composer } : undefined,
});
const songs = [
  song("cadence-dancing-raindrops-v1", "Dancing Raindrops", "Émile Example"),
  song("cadence-ode-to-joy-v1", "Frère Jacques", "Traditional"),
  song(popsPieces[0].id, "Jasmine Flower", "Traditional"),
  song("imported-waltz", "My Waltz"),
];
const fullPiano: Song = {
  ...song(midiPieces[0].id, "安静 · 周杰伦"),
  source: {
    composer: "周杰伦 · Jay Chou",
    description: "Full piano arrangement without suggested finger numbers.",
    url: "https://example.com/an-jing",
    credit: "Example arranger",
  },
};

let root: Root;
let container: HTMLDivElement;
let props: LibraryProps;
const search = () => container.querySelector<HTMLInputElement>("input")!;
const titles = () =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>(".song"),
    (button) => button.firstChild!.textContent,
  );
const groupToggle = (group: string) =>
  container.querySelector<HTMLButtonElement>(
    `[aria-controls="library-${group}"]`,
  )!;
const groupContent = (group: string) =>
  container.querySelector<HTMLDivElement>(`#library-${group}`)!;
async function render(overrides: Partial<LibraryProps> = {}) {
  props = { ...props, ...overrides };
  await act(async () => root.render(<SongLibrary {...props} />));
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function type(value: string) {
  await act(async () => {
    // Bypass React's value tracker to simulate a user edit.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search(), value);
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    songs,
    selected: songs[1].id,
    onSelect: vi.fn(),
    onImport: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("song library", () => {
  it("shows every collection and identifies the selected song and imported files", async () => {
    await render();
    expect(titles()).toEqual([
      "Dancing Raindrops",
      "Frère Jacques",
      "My Waltz",
      "Jasmine Flower",
    ]);
    expect(container.querySelectorAll(".library-section")).toHaveLength(3);
    expect(
      container.querySelector(".song[aria-pressed=true]")?.textContent,
    ).toContain("Frère Jacques");
    expect(groupContent("songs").textContent).toContain(
      "Imported MIDI · On this browser",
    );
    expect(container.querySelector(".nav-label span")?.textContent).toBe("4");
  });

  it.each([
    ["  fReRe  ", ["Frère Jacques"]],
    ["ÉMILE", ["Dancing Raindrops"]],
    ["traditional", ["Frère Jacques", "Jasmine Flower"]],
    ["waltz", ["My Waltz"]],
  ])(
    "searches titles and composers without case or accent sensitivity: %s",
    async (term, expected) => {
      await render();
      await type(term);
      expect(titles()).toEqual(expected);
      expect(search().value).toBe(term);
    },
  );

  it("matches uppercase searches even when the browser defaults to Turkish casing", async () => {
    const nativeLocaleLowerCase = String.prototype.toLocaleLowerCase;
    const localeLowerCase = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(function (
        this: string,
        locales?: Parameters<typeof nativeLocaleLowerCase>[0],
      ) {
        return nativeLocaleLowerCase.call(this, locales ?? "tr");
      });
    try {
      const jingle = song(
        "jingle-bells",
        "Jingle Bells",
        "James Lord Pierpont",
      );
      await render({ songs: [jingle], selected: jingle.id });
      await type("JINGLE");
      expect(titles()).toEqual(["Jingle Bells"]);
    } finally {
      localeLowerCase.mockRestore();
    }
  });

  it.each(["  JAY CHOU  ", "周杰伦", "安静"])(
    "finds a full piano arrangement by its source composer or title: %s",
    async (term) => {
      await render({ songs: [...songs, fullPiano] });
      await type(term);
      expect(titles()).toEqual([fullPiano.title]);
      expect(search().value).toBe(term);
    },
  );

  it("labels source arrangements as full piano without suggesting finger numbers", async () => {
    await render({ songs: [fullPiano], selected: fullPiano.id });
    const button =
      groupContent("pops").querySelector<HTMLButtonElement>(".song")!;
    expect(button.querySelector("small")?.textContent).toBe(
      "Full piano · No finger numbers",
    );
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await click(button);
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(fullPiano);
  });

  it("keeps a matching source-composer search when revealing the selected arrangement", async () => {
    await render({ songs: [...songs, fullPiano] });
    await type("JAY CHOU");
    await click(groupToggle("pops"));
    await render({ selected: fullPiano.id });
    expect(groupContent("pops").hidden).toBe(false);
    expect(search().value).toBe("JAY CHOU");
    expect(titles()).toEqual([fullPiano.title]);
    expect(
      container.querySelector(".song[aria-pressed=true]")?.textContent,
    ).toContain(fullPiano.title);
  });

  it("clears an unrelated search when revealing a selected source arrangement", async () => {
    await render({ songs: [...songs, fullPiano] });
    await type("waltz");
    await click(groupToggle("pops"));
    await render({ selected: fullPiano.id });
    expect(groupContent("pops").hidden).toBe(false);
    expect(search().value).toBe("");
    expect(titles()).toContain(fullPiano.title);
  });

  it("keeps the startup-restored song folded, then reveals a later song change", async () => {
    await render({ selected: songs[0].id, savedSelection: songs[2].id });
    // The saved song loads after the first render, as the library does.
    await render({ selected: songs[2].id });
    expect(groupContent("pops").hidden).toBe(true);
    expect(groupContent("classes").hidden).toBe(true);
    await render({ selected: songs[0].id });
    expect(groupContent("classes").hidden).toBe(false);
    expect(groupContent("pops").hidden).toBe(true);
  });

  it("starts with collections folded, toggles each one, and opens all when searching", async () => {
    await render();
    for (const group of ["classes", "songs", "pops"]) {
      expect(groupToggle(group).getAttribute("aria-expanded")).toBe("false");
      expect(groupContent(group).hidden).toBe(true);
      await click(groupToggle(group));
      expect(groupToggle(group).getAttribute("aria-expanded")).toBe("true");
      expect(groupContent(group).hidden).toBe(false);
      await click(groupToggle(group));
      expect(groupContent(group).hidden).toBe(true);
    }
    await type("traditional");
    for (const group of ["classes", "songs", "pops"]) {
      expect(groupToggle(group).getAttribute("aria-expanded")).toBe("true");
      expect(groupContent(group).hidden).toBe(false);
    }
    expect(titles()).toEqual(["Frère Jacques", "Jasmine Flower"]);
  });

  it("reveals an externally selected song even if its group and search hid it", async () => {
    await render();
    await type("frere");
    await click(groupToggle("pops"));
    await render({ selected: songs[2].id });
    expect(groupContent("pops").hidden).toBe(false);
    expect(search().value).toBe("");
    expect(titles()).toContain("Jasmine Flower");
    expect(
      container.querySelector(".song[aria-pressed=true]")?.textContent,
    ).toContain("Jasmine Flower");
  });

  it("keeps a search while typing or rerendering without a selection change", async () => {
    await render();
    await type("waltz");
    await render({ songs: [...songs] });
    expect(search().value).toBe("waltz");
    expect(titles()).toEqual(["My Waltz"]);
  });

  it("keeps a search when the next selected song matches it", async () => {
    await render();
    await type("traditional");
    await render({ selected: songs[2].id });
    expect(search().value).toBe("traditional");
    expect(titles()).toEqual(["Frère Jacques", "Jasmine Flower"]);
  });

  it("dispatches selection and import actions with the selected song object", async () => {
    await render();
    const raindrops = container.querySelector<HTMLButtonElement>(
      "#library-classes .song",
    )!;
    await click(raindrops);
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(songs[0]);
    await click(container.querySelector<HTMLButtonElement>(".import")!);
    expect(props.onImport).toHaveBeenCalledOnce();
  });

  it("shows search-specific empty results and restores songs after clearing", async () => {
    await render();
    await type("no such melody");
    expect(titles()).toEqual([]);
    const messages = Array.from(
      container.querySelectorAll(".library-empty"),
      (element) => element.textContent,
    );
    expect(messages).toEqual(Array(3).fill("No matches in this section."));
    await type("");
    expect(titles()).toHaveLength(songs.length);
  });

  it("shows an empty-library message while retaining the import action", async () => {
    await render({ songs: [] });
    expect(titles()).toEqual([]);
    expect(container.textContent).toContain("Songs you add will appear here.");
    await click(container.querySelector<HTMLButtonElement>(".import")!);
    expect(props.onImport).toHaveBeenCalledOnce();
  });

  it.each(["./", "/practice/"])(
    "downloads the ZIP using the deployment base %s",
    async (baseUrl) => {
      vi.stubEnv("BASE_URL", baseUrl);
      await render();
      const link =
        container.querySelector<HTMLAnchorElement>(".library-download")!;
      expect(link.getAttribute("href")).toBe(
        `${baseUrl}midi/cadence-starter-library.zip`,
      );
      expect(link.hasAttribute("download")).toBe(true);
    },
  );
});
