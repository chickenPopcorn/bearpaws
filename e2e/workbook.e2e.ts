import { expect, test } from "./fake-supabase";

test("a workbook page paints on the piano and gets its stamp", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Music Workbook 3/ }).click();
  await page.getByRole("button", { name: /^Page 9 · Bass Clef D/ }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /Bass Clef D/,
  );
  await expect(page.locator(".kicker")).toHaveText("Music Workbook 3 · Page 9");
  const hint = page.getByRole("status").filter({ hasText: /./ }).last();
  await expect(page.locator(".workbook-prompt")).toHaveText(
    "Find TREBLE CLEF D",
  );

  // The computer keys stand in for the piano: S is D4, X is D3.
  await page.keyboard.press("x");
  await expect(page.locator(".workbook-hint")).toHaveText(
    "That is BASS CLEF D. Go higher.",
  );
  await page.keyboard.press("s");
  await expect(page.locator(".workbook-prompt")).toHaveText("Find BASS CLEF D");
  await page.keyboard.press("x");
  await expect(page.locator(".workbook-prompt")).toHaveText("Page 9 is done");
  await expect(hint).toBeVisible();
  await expect(page.locator(".workbook-stamp-date")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Page 9 · Bass Clef D/ }),
  ).toContainText("Done");

  // A song takes the page's place again.
  await page.getByRole("button", { name: /Music Recital Book 3/ }).click();
  await page.getByRole("button", { name: /^Dancing Raindrops/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /Dancing Raindrops/,
  );
  await expect(page.locator(".workbook-prompt")).toHaveCount(0);
});

test("the computer keys play a page's notes even with Duet moving the song", async ({
  page,
}) => {
  await page.goto("/");
  // Dancing Raindrops' duet moves the student part up an octave.
  await page.getByRole("button", { name: "Duet" }).click();
  await expect(page.getByRole("button", { name: "Duet" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /Music Workbook 3/ }).click();
  await page.getByRole("button", { name: /^Page 9 · Bass Clef D/ }).click();
  await page.keyboard.press("s");
  await expect(page.locator(".workbook-prompt")).toHaveText("Find BASS CLEF D");
});

test("a computer key held as a page opens lets go of the note it played", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Duet" }).click();
  await page.getByRole("button", { name: /Music Workbook 3/ }).click();
  // With Duet's octave up, Z plays middle C, page 7's first note.
  await page.keyboard.down("z");
  await page.getByRole("button", { name: /^Page 7 · Bass Clef C/ }).click();
  await page.keyboard.up("z");
  // A plays middle C on the page; it must be a fresh press.
  await page.keyboard.press("a");
  await expect(page.locator(".workbook-prompt")).toHaveText("Find BASS CLEF C");
});

test("a Find page can be finished from the computer keyboard, L being Skip", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Music Workbook 3/ }).click();
  await page.getByRole("button", { name: /^Page 20 · 2nds/ }).click();
  const hint = page.locator(".workbook-hint");
  // E3 then D3: a 2nd. A melodic interval's notes come one after the other,
  // not within TOGETHER_MS (150 ms) of each other.
  const apart = () => page.waitForTimeout(250);
  await page.keyboard.press("c");
  await apart();
  await page.keyboard.press("x");
  await expect(hint).toHaveText("Yes! That is a 2nd: blue.");
  // C4 to E4 is a 3rd: L skips it.
  await page.keyboard.press("l");
  await expect(hint).toHaveText("Right: no 2nd there. Next card.");
  // D4 to E4, G4 to F4, C3 to D3, then skip G3 to E3.
  for (const [first, second] of [
    ["s", "d"],
    ["g", "f"],
    ["z", "x"],
  ]) {
    await page.keyboard.press(first);
    await expect(hint).toHaveText("Now the note on the right.");
    await apart();
    await page.keyboard.press(second);
    await expect(hint).toHaveText("Yes! That is a 2nd: blue.");
  }
  await page.keyboard.press("l");
  await expect(page.locator(".workbook-prompt")).toHaveText("Page 20 is done");
});
