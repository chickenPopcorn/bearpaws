import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Turn Vitest's json-summary into a shields.io endpoint badge. The Pages
// deploy publishes it next to the app, and the README badge reads it there.
const summaryPath = resolve(
  process.argv[2] ?? "coverage/coverage-summary.json",
);
const badgePath = resolve(process.argv[3] ?? "dist/badges/coverage.json");
const { total } = JSON.parse(await readFile(summaryPath, "utf8"));
const pct = total.lines.pct;
const colors = [
  [90, "brightgreen"],
  [80, "green"],
  [70, "yellowgreen"],
  [60, "yellow"],
  [50, "orange"],
];
const color = colors.find(([min]) => pct >= min)?.[1] ?? "red";
const badge = {
  schemaVersion: 1,
  label: "coverage",
  message: `${pct.toFixed(1)}%`,
  color,
};
await mkdir(dirname(badgePath), { recursive: true });
await writeFile(badgePath, `${JSON.stringify(badge)}\n`);
console.log(`Coverage badge: ${badge.message} (${color}) at ${badgePath}`);
