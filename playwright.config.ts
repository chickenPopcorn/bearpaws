import { defineConfig, devices } from "@playwright/test";
import { SUPABASE_URL } from "./e2e/fake-supabase";

// Its own port and build folder, so a running `npm run dev` or `npm run
// build` is never mistaken for the e2e build.
const PORT = 4174;
const OUT_DIR = "e2e/.dist";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The production build, signed in through the fake Supabase project
    // that e2e/fake-supabase.ts answers for.
    command: `vite build --outDir ${OUT_DIR} --emptyOutDir && vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e",
    },
  },
});
