import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "./",
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text-summary", "json-summary", "html"],
      // A floor just under today's numbers, so coverage cannot quietly drop.
      thresholds: { statements: 85, branches: 80, functions: 80, lines: 85 },
    },
  },
});
