// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const createClient = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
let values: Map<string, string>;
beforeEach(() => {
  // Its own store: newer Node versions define an unusable localStorage
  // global that hides happy-dom's.
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  createClient.mockClear();
  window.history.replaceState({}, "", "/");
});
describe("local development account", () => {
  it("isolates local practice and never creates an account client", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    window.history.replaceState({}, "", "/?local=1");
    localStorage.setItem(
      "cadence:settings",
      JSON.stringify({ learnerName: "Account learner" }),
    );
    const { localDevelopment } = await import("../src/development");
    const { read, write } = await import("../src/storage");
    const { supabase } = await import("../src/supabase");
    expect(localDevelopment).toBe(true);
    expect(supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(read("settings", null)).toBeNull();
    write("settings", { learnerName: "Local developer" });
    expect(JSON.parse(localStorage.getItem("cadence:settings")!)).toEqual({
      learnerName: "Account learner",
    });
    expect(JSON.parse(localStorage.getItem("pawpal-local:settings")!)).toEqual({
      learnerName: "Local developer",
    });
  });
  it("ignores the local flag in production", async () => {
    vi.stubEnv("DEV", false);
    window.history.replaceState({}, "", "/?local=1");
    expect((await import("../src/development")).localDevelopment).toBe(false);
    const { write } = await import("../src/storage");
    write("settings", { learnerName: "Normal account" });
    expect(localStorage.getItem("pawpal-local:settings")).toBeNull();
    expect(localStorage.getItem("cadence:settings")).not.toBeNull();
  });
  it("requires an explicit local flag even on a development server", async () => {
    vi.stubEnv("DEV", true);
    expect((await import("../src/development")).localDevelopment).toBe(false);
  });
});
