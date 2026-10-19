import { expect, test } from "./fake-supabase";

test("a library that fails to load offers a retry", async ({
  page,
  supabase,
}) => {
  supabase.libraryDown = true;
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText(
    "Your songs could not be loaded. Check your connection and try again.",
  );
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  supabase.libraryDown = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /Dancing Raindrops/,
  );
});

test("only one tab runs the studio, and another can take it over", async ({
  context,
  page,
}) => {
  const studio = page.getByRole("heading", { level: 1 });
  const elsewhere =
    "Paw Pal is open in another tab. Practice there, or move it here.";
  await page.goto("/");
  await expect(studio).toHaveText(/Dancing Raindrops/);

  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByRole("alert")).toHaveText(elsewhere);

  await second.getByRole("button", { name: "Use here" }).click();
  await expect(second.getByRole("heading", { level: 1 })).toHaveText(
    /Dancing Raindrops/,
  );
  await expect(page.getByRole("alert")).toHaveText(elsewhere);
});
