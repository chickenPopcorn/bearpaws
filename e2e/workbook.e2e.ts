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
