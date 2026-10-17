import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SheetTimeline } from "../src/SheetTimeline";
import type { Mode } from "../src/engine";
import type { Note, Song } from "../src/song";

function note(id: string, pitch = 60, start = 0.5, track = 0): Note {
  return {
    id,
    pitch,
    velocity: 0.7,
    start,
    end: start + 0.5,
    soundEnd: start + 0.5,
    track,
    channel: track,
    notatedBeats: 1,
  };
}

function song(notes: Note[]): Song {
  return {
    id: "sheet-view-fixture",
    title: "Sheet view fixture",
    notes,
    duration: 6,
    ppq: 480,
    tempos: [],
    warnings: [],
    tracks: [
      { id: 0, name: "Right", hand: "right", count: 0 },
      { id: 1, name: "Left", hand: "left", count: 0 },
      { id: 2, name: "Skipped", hand: "off", count: 0 },
    ],
  };
}

function render(
  piece: Song,
  options: {
    position?: number;
    mode?: Mode;
    hit?: Set<string>;
    selectedNotes?: Note[];
    from?: number;
    onSeek?: (seconds: number) => void;
  } = {},
) {
  return renderToStaticMarkup(
    createElement(SheetTimeline, {
      song: piece,
      position: options.position ?? 0,
      mode: options.mode ?? "wait",
      hit: options.hit ?? new Set(),
      selectedNotes: options.selectedNotes ?? piece.notes,
      from: options.from ?? 0,
      onSeek: options.onSeek,
    }),
  );
}

/** Inspect the public SVG output without coupling tests to component internals. */
function renderedNotes(markup: string) {
  const notes = new Map<string, Record<string, string>>();
  for (const group of markup.matchAll(
    /<g\b[^>]*\bdata-note-id="([^"]+)"[^>]*>/g,
  )) {
    const attributes: Record<string, string> = {};
    for (const attribute of group[0].matchAll(/([\w-]+)="([^"]*)"/g))
      attributes[attribute[1]] = attribute[2];
    notes.set(group[1], attributes);
  }
  return notes;
}

describe("sheet timeline SVG progress", () => {
  it("shows imported 6/8 as six eighth-note beats, including after a meter change", () => {
    const piece = song([note("first", 60, 0), note("later", 62, 4)]);
    piece.timeSignatures = [
      { tick: 0, numerator: 3, denominator: 4 },
      { tick: 6 * 480, numerator: 6, denominator: 8 },
    ];
    const markup = render(piece, { position: 3.25 });
    expect(markup).toContain("Bar 3 of 3 · Beat 2");
    const signature = markup.match(
      /<g class="sheet-time-signature"[^>]*>(.*?)<\/g>/,
    )![1];
    expect(signature).toContain(String.fromCodePoint(0xe086));
    expect(signature).toContain(String.fromCodePoint(0xe088));
    expect(signature).not.toContain(String.fromCodePoint(0xe084));
    expect([...markup.matchAll(/class="sheet-beat-number"/g)]).toHaveLength(12);
  });

  it("exposes the interactive score as a focusable slider with the current time", () => {
    const onSeek = vi.fn();
    const markup = render(song([note("middle-c")]), { position: 1.25, onSeek });
    const svg = markup.match(/<svg\b[^>]*>/)![0];
    expect(svg).toContain('role="slider"');
    expect(svg).toContain('tabindex="0"');
    expect(svg).toContain('aria-valuemin="0"');
    expect(svg).toContain('aria-valuemax="6"');
    expect(svg).toContain('aria-valuenow="1.25"');
    expect(svg).toMatch(/aria-valuetext="[^"]+"/);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("can still render a read-only score without a seek callback or slider focus stop", () => {
    const svg = render(song([note("middle-c")])).match(/<svg\b[^>]*>/)![0];
    expect(svg).toContain('role="img"');
    expect(svg).not.toContain("tabindex=");
    expect(svg).not.toContain("aria-valuenow=");
  });

  it.each(["wait", "rhythm"] as const)(
    "fades only the accepted member of a chord to exactly half opacity in %s mode",
    (mode) => {
      const piece = song([
        note("accepted", 60),
        note("unplayed", 64),
        note("upcoming", 67, 1.5),
      ]);
      const notes = renderedNotes(
        render(piece, { mode, position: 0.5, hit: new Set(["accepted"]) }),
      );
      expect(notes.get("accepted")).toMatchObject({
        opacity: "0.5",
        "data-played": "true",
        "data-enabled": "true",
      });
      for (const id of ["unplayed", "upcoming"])
        expect(notes.get(id)).toMatchObject({
          opacity: "1",
          "data-played": "false",
          "data-enabled": "true",
        });
    },
  );

  it("clears faded note states when a new attempt starts", () => {
    const piece = song([note("again")]);
    expect(
      renderedNotes(render(piece, { hit: new Set(["again"]) })).get("again")
        ?.opacity,
    ).toBe("0.5");
    expect(
      renderedNotes(render(piece, { position: 0 })).get("again"),
    ).toMatchObject({
      opacity: "1",
      "data-played": "false",
    });
  });

  it("dims elapsed Listen notes but leaves skipped earlier notes and future notes unplayed", () => {
    const piece = song([
      note("before-seek", 60, 0),
      note("heard", 64, 0.5),
      note("future", 67, 1.5),
    ]);
    const notes = renderedNotes(
      render(piece, { mode: "listen", from: 0.5, position: 1 }),
    );
    expect(notes.get("heard")).toMatchObject({
      opacity: "0.5",
      "data-played": "true",
    });
    expect(notes.get("before-seek")).toMatchObject({
      opacity: "0.5",
      "data-played": "false",
      "data-past": "true",
    });
    expect(notes.get("future")).toMatchObject({
      opacity: "1",
      "data-played": "false",
      "data-past": "false",
    });
  });

  it.each(["wait", "rhythm"] as const)(
    "fades past unmatched notes in %s mode and restores them when seeking back",
    (mode) => {
      const piece = song([
        note("unmatched-past", 60, 0),
        note("current", 64, 0.5),
        note("future", 67, 1.5),
      ]);
      const passed = renderedNotes(
        render(piece, { mode, position: 0.5, from: 0.5 }),
      );
      expect(passed.get("unmatched-past")).toMatchObject({
        opacity: "0.5",
        "data-played": "false",
        "data-past": "true",
      });
      for (const id of ["current", "future"])
        expect(passed.get(id)).toMatchObject({
          opacity: "1",
          "data-played": "false",
          "data-past": "false",
        });
      const rewound = renderedNotes(render(piece, { mode, position: 0 }));
      expect(rewound.get("unmatched-past")).toMatchObject({
        opacity: "1",
        "data-played": "false",
        "data-past": "false",
      });
    },
  );

  it.each(["wait", "listen"] as const)(
    "keeps a disabled hand at half opacity without claiming it was played in %s mode",
    (mode) => {
      const piece = song([note("enabled"), note("hidden-hand", 48, 0.5, 1)]);
      const notes = renderedNotes(
        render(piece, {
          mode,
          position: 1.2,
          selectedNotes: [piece.notes[0]],
          hit: new Set(["hidden-hand"]),
        }),
      );
      expect(notes.get("hidden-hand")).toMatchObject({
        opacity: "0.5",
        "data-played": "false",
        "data-enabled": "false",
      });
    },
  );

  it("omits skipped and unassigned tracks, without letting them consume the visible-note limit", () => {
    const skipped = Array.from({ length: 200 }, (_, index) =>
      note(`skipped-${index}`, 48, 0, 2),
    );
    const piece = song([
      ...skipped,
      note("unassigned", 55, 0, 99),
      note("practice", 60, 0),
    ]);
    expect([...renderedNotes(render(piece)).keys()]).toEqual(["practice"]);
  });

  it("separates adjacent chord noteheads while keeping their stems aligned", () => {
    const markup = render(
      song([note("f3", 53, 0.5, 1), note("g3", 55, 0.5, 1)]),
    );
    const geometry = (id: string) => {
      const group = markup.match(
        new RegExp(`<g\\b[^>]*data-note-id="${id}"[^>]*>([\\s\\S]*?)</g>`),
      )![1];
      const head = group.match(/<ellipse\b[^>]*\bcx="([^"]+)"/)!;
      const stem = group.match(/<line\b[^>]*stroke-width="1\.4"[^>]*>/)![0];
      return {
        head: Number(head[1]),
        stem: Number(stem.match(/x1="([^"]+)"/)![1]),
      };
    };
    const f = geometry("f3");
    const g = geometry("g3");
    expect(Math.abs(f.head - g.head)).toBe(11);
    expect(f.stem).toBe(g.stem);
  });

  it("keeps a 50,000-note dense import to at most 240 rendered note groups", () => {
    const notes = Array.from({ length: 50_000 }, (_, index) =>
      note(`dense-${index}`, 60 + (index % 12), (index % 8) * 2),
    );
    const markup = render({ ...song(notes), duration: 16 }, { position: 4 });
    const visible = renderedNotes(markup);
    expect(visible.size).toBeGreaterThan(0);
    expect(visible.size).toBeLessThanOrEqual(240);
    expect(markup).toContain("Dense passage");
    expect(markup).toContain("condensed preview");
  });

  it("leaves room below all three left-hand chord labels, including descenders", () => {
    const markup = render(
      song([
        note("left-c", 48, 0.5, 1),
        note("left-e", 52, 0.5, 1),
        note("left-g", 55, 0.5, 1),
      ]),
    );
    const [, top, , height] = markup
      .match(/viewBox="([^"]+)"/)![1]
      .split(" ")
      .map(Number);
    const labels = [
      ...markup.matchAll(
        /<text\b[^>]*class="sheet-note-label"[^>]*y="([^"]+)"/g,
      ),
    ];
    expect(labels).toHaveLength(3);
    for (const label of labels)
      expect(Number(label[1]) + 5).toBeLessThanOrEqual(top + height);
  });

  it("includes beat labels inside the vertical SVG view box", () => {
    const markup = render(song([note("middle-c")]));
    const coordinates = markup
      .match(/viewBox="([^"]+)"/)![1]
      .split(" ")
      .map(Number);
    expect(coordinates[1]).toBeLessThanOrEqual(0);
    expect(coordinates[1] + coordinates[3]).toBeGreaterThanOrEqual(264);
  });
});

/** Measure the rendered note, including the score's moving coordinate system. */
function screenNoteX(markup: string, id: string) {
  const motion = markup.match(/<g\b[^>]*class="sheet-score-motion"[^>]*>/)?.[0];
  expect(motion).toBeDefined();
  const translate = motion!.match(
    /transform="translate\(([-+\d.eE]+)[, ]+([-+\d.eE]+)\)"/,
  );
  expect(translate).not.toBeNull();
  const group = markup.match(
    new RegExp(`<g\\b[^>]*data-note-id="${id}"[^>]*>([\\s\\S]*?)</g>`),
  );
  expect(group).not.toBeNull();
  const head = group![1].match(/<ellipse\b[^>]*\bcx="([^"]+)"/);
  expect(head).not.toBeNull();
  return {
    local: Number(head![1]),
    screen: Number(head![1]) + Number(translate![1]),
  };
}

describe("smooth printed score motion", () => {
  const longPiece = () => ({
    ...song(
      Array.from({ length: 32 }, (_, index) =>
        note(`flow-${index}`, 60, index * 0.5),
      ),
    ),
    duration: 16,
  });

  it("keeps notes moving smoothly across a bar boundary", () => {
    const piece = longPiece();
    const before = screenNoteX(render(piece, { position: 3.9995 }), "flow-12");
    const after = screenNoteX(render(piece, { position: 4.0005 }), "flow-12");
    expect(after.screen).toBeLessThan(before.screen);
    expect(Math.abs(after.screen - before.screen)).toBeLessThan(1);
  });

  it("preserves a note's screen position when an earlier bar leaves the rendered window", () => {
    const piece = longPiece();
    const opening = render(piece);
    const viewWidth = Number(
      opening.match(/viewBox="([^"]+)"/)![1].split(" ")[2],
    );
    const measureWidth =
      screenNoteX(opening, "flow-4").local -
      screenNoteX(opening, "flow-0").local;
    const rebaseTime =
      ((measureWidth + (viewWidth - 103) * 0.34 - 24) / measureWidth) * 2;
    const before = screenNoteX(
      render(piece, { position: rebaseTime - 0.0005 }),
      "flow-12",
    );
    const after = screenNoteX(
      render(piece, { position: rebaseTime + 0.0005 }),
      "flow-12",
    );
    // The local coordinates rebase by a whole measure, but the visible note does not jump.
    expect(Math.abs(after.local - before.local)).toBeGreaterThan(200);
    expect(after.screen).toBeLessThan(before.screen);
    expect(Math.abs(after.screen - before.screen)).toBeLessThan(1);
  });

  it.each([0.25, 0.0625])(
    "keeps the final %s-beat note and its label inside the score at the end",
    (beats) => {
      const piece = longPiece();
      piece.notes[31] = {
        ...note("final-short-note", 60, (32 - beats) * 0.5),
        notatedBeats: beats,
        end: 16,
        soundEnd: 16,
      };
      const markup = render(piece, { position: piece.duration });
      const clip = markup.match(/<clipPath\b[^>]*>\s*<rect\b[^>]*>/)![0];
      const clipRight =
        Number(clip.match(/\bx="([^"]+)"/)![1]) +
        Number(clip.match(/\bwidth="([^"]+)"/)![1]);
      expect(
        screenNoteX(markup, "final-short-note").screen + 16,
      ).toBeLessThanOrEqual(clipRight);
    },
  );

  it("holds the same staff framing when high and low notes enter the viewport", () => {
    const piece = longPiece();
    piece.notes[28] = note("low", 0, 14, 1);
    piece.notes[29] = note("high", 127, 14.5);
    const opening = render(piece, { position: 0 });
    const later = render(piece, { position: 14 });
    expect(renderedNotes(opening).has("low")).toBe(false);
    expect(renderedNotes(later).has("low")).toBe(true);
    expect(renderedNotes(later).has("high")).toBe(true);
    expect(later.match(/viewBox="([^"]+)"/)![1]).toBe(
      opening.match(/viewBox="([^"]+)"/)![1],
    );
  });
});
