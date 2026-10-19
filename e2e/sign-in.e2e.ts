import { expect, test } from "./fake-supabase";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Google sign-in opens the learner's studio", async ({
    page,
    supabase,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Paw Pal" })).toBeVisible();
    await expect(
      page.getByText("Sign in to keep your practice progress on every device."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Continue with Google" }).click();

    // The studio opens once supabase-js has traded the code for a session.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(supabase.authorizations).toHaveLength(1);
    const [authorize] = supabase.authorizations;
    expect(authorize.searchParams.get("provider")).toBe("google");
    expect(authorize.searchParams.get("redirect_to")).toBe(
      new URL("/", page.url()).href,
    );
    expect(authorize.searchParams.get("code_challenge_method")).toBe("s256");
    // The code leaves the address bar, and the name comes from Google.
    await expect(page).not.toHaveURL(/code=/);
    await expect(page.getByText("George’s practice")).toBeVisible();
  });
});

test("Sign out returns to the sign-in page", async ({ page, supabase }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  expect(supabase.signOuts).toBe(1);

  // Signed out for good: a reload does not reopen the studio.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});
