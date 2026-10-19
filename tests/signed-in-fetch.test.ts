import { afterEach, describe, expect, it, vi } from "vitest";

const LIBRARY_URL =
  "https://project.supabase.test/storage/v1/object/authenticated/library/index.json";

/** src/supabase.ts as built for a site with sign-in set up. */
async function signInSetUp(session: { access_token: string } | null) {
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.resetModules();
  const module = await import("../src/supabase");
  vi.spyOn(module.supabase!.auth, "getSession").mockResolvedValue({
    data: { session },
    error: null,
  } as never);
  return module;
}

describe("signed-in Storage requests", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("carry the user's access token, and keep the request's cache mode", async () => {
    const { signedInFetch } = await signInSetUp({ access_token: "user-jwt" });
    const fetch = vi.fn(async (..._: Parameters<typeof globalThis.fetch>) => {
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetch);

    const get = await signedInFetch();
    await get(LIBRARY_URL, {
      cache: "no-cache",
      headers: { Accept: "application/json" },
    });

    const [input, init] = fetch.mock.calls[0];
    expect(input).toBe(LIBRARY_URL);
    expect(init?.cache).toBe("no-cache");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer user-jwt");
    expect(headers.get("apikey")).toBe("sb_publishable_test");
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("refuse to start without a signed-in user", async () => {
    const { signedInFetch } = await signInSetUp(null);
    await expect(signedInFetch()).rejects.toThrow(/Sign in/);
  });

  it("refuse on a site without sign-in", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.resetModules();
    const { signedInFetch } = await import("../src/supabase");
    await expect(signedInFetch()).rejects.toThrow(/not set up/);
  });
});
