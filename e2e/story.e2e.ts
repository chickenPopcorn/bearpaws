import type { Page } from "@playwright/test";
import { expect, test } from "./fake-supabase";

const MANIFEST = "mflm-3/manifest.json";
/** The opening story, and the one leading into Five O'Clock. */
const OPENING = "mflm-3/disc-1/01.mp3";
const LEAD_IN = "mflm-3/disc-1/02.mp3";

const songTitle = (page: Page) => page.getByRole("heading", { level: 1 });
const book = (page: Page, title: string) =>
  page.getByRole("button", { name: new RegExp(title) });
const song = (page: Page, title: string) =>
  page.getByRole("button", { name: new RegExp(`^${title}`) });
const playStory = (page: Page) =>
  page.getByRole("button", { name: "Play story" });
const stopStory = (page: Page) =>
  page.getByRole("button", { name: "Stop story" });

/**
 * Keep hold of the story's audio element, which the page keeps out of the
 * document, and of each source it plays.
 */
function watchStory(page: Page) {
  return page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const page = window as unknown as {
        story?: HTMLMediaElement;
        played?: string[];
      };
      page.story = this;
      (page.played ??= []).push(this.src);
      return play.call(this);
    };
  });
}
/** Whether the story's audio element is playing. */
const storyPlaying = (page: Page) =>
  page.evaluate(() => {
    const story = (window as unknown as { story?: HTMLMediaElement }).story;
    return !!story && !story.paused;
  });

test.beforeEach(async ({ page, supabase }) => {
  supabase.settings = { selected: "pawpal-five-oclock-v1" };
  await watchStory(page);
});

test("the Story button plays the story before a Lesson Book 3 piece", async ({
  page,
  supabase,
}) => {
  supabase.cdTrackSeconds[OPENING] = 0.5;
  supabase.cdTrackSeconds[LEAD_IN] = 0.5;
  await page.goto("/");
  await expect(songTitle(page)).toHaveText(/Five O'Clock/);
  await expect(playStory(page)).toHaveAttribute("aria-pressed", "false");
  // Its audio loads only to play.
  expect(supabase.cdAudioRequests).toEqual([MANIFEST]);

  await playStory(page).click();
  await expect(stopStory(page)).toHaveAttribute("aria-pressed", "true");
  // The first piece's story is the opening story, then the one leading in.
  await expect(playStory(page)).toHaveAttribute("aria-pressed", "false", {
    timeout: 10_000,
  });
  expect(supabase.cdAudioRequests.slice(1).sort()).toEqual([OPENING, LEAD_IN]);
  const played = await page.evaluate(
    () => (window as unknown as { played: string[] }).played,
  );
  expect(played).toHaveLength(2);
  expect(played[0]).not.toBe(played[1]);
});

test("the story stops for practice, and a recital piece has none", async ({
  page,
  supabase,
}) => {
  await page.goto("/");
  await playStory(page).click();
  await expect(stopStory(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => storyPlaying(page)).toBe(true);
  await stopStory(page).click();
  await expect(playStory(page)).toHaveAttribute("aria-pressed", "false");
  expect(await storyPlaying(page)).toBe(false);

  // The click leaves Space and Enter to practice, which stops the story.
  await playStory(page).click();
  await expect.poll(() => storyPlaying(page)).toBe(true);
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Ⅱ Pause" })).toBeVisible();
  await expect(playStory(page)).toHaveAttribute("aria-pressed", "false");
  expect(await storyPlaying(page)).toBe(false);

  // The story pauses practice.
  await playStory(page).click();
  await expect(page.getByRole("button", { name: "▷ Play" })).toBeVisible();
  await expect.poll(() => storyPlaying(page)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Exit full screen" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Ⅱ Pause" })).toBeVisible();
  expect(await storyPlaying(page)).toBe(false);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "▷ Play" })).toBeVisible();

  // Another song stops it. The CD has no Recital Book 3 tracks.
  await playStory(page).click();
  await expect.poll(() => storyPlaying(page)).toBe(true);
  await book(page, "Music Recital Book 3").click();
  await song(page, "Dancing Raindrops").click();
  await expect(songTitle(page)).toHaveText(/Dancing Raindrops/);
  expect(await storyPlaying(page)).toBe(false);
  await expect(page.getByRole("button", { name: /story/ })).toHaveCount(0);

  await book(page, "Music Lesson Book 3").click();
  await song(page, "Five O'Clock").click();
  await expect(playStory(page)).toHaveAttribute("aria-pressed", "false");
  // The manifest loaded once for the page.
  expect(
    supabase.cdAudioRequests.filter((file) => file === MANIFEST),
  ).toHaveLength(1);
});

test("a story that cannot load says so, and without the CD's manifest there is no Story button", async ({
  page,
  supabase,
}) => {
  supabase.cdAudioDown.add(LEAD_IN);
  await page.goto("/");
  await playStory(page).click();
  await expect(page.locator(".piano-notice")).toHaveText(
    "The story before Five O'Clock could not be played. Check your connection and try again.",
  );
  await expect(playStory(page)).toHaveAttribute("aria-pressed", "false");

  supabase.cdAudioDown.add(MANIFEST);
  await page.reload();
  await expect(songTitle(page)).toHaveText(/Five O'Clock/);
  await expect(
    page.getByRole("button", { name: "Download Five O'Clock MIDI" }),
  ).toBeVisible();
  await expect.poll(() => supabase.cdAudioRequests.at(-1)).toBe(MANIFEST);
  await expect(page.getByRole("button", { name: /story/ })).toHaveCount(0);
});
