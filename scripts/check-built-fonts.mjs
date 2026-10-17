import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

// Validate generated URLs, not source paths: Vite rewrites public assets at build time.
const root = resolve(process.argv[2] ?? "dist");
const base = new URL("https://example.test/nested/piano/");
const htmlUrl = new URL("index.html", base);
const html = await readFile(resolve(root, "index.html"), "utf8");
const references = [];
for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
  if (!/\bas=["']font["']/.test(tag)) continue;
  const href = tag.match(/\bhref=["']([^"']+)["']/)?.[1];
  assert.ok(href, "A font preload must have a URL");
  references.push(new URL(href, htmlUrl));
}
assert.ok(references.length, "Expected self-hosted font preloads in the build");
let cssFonts = 0;
for (const name of await readdir(resolve(root, "assets"))) {
  if (!name.endsWith(".css")) continue;
  const css = await readFile(resolve(root, "assets", name), "utf8");
  for (const [, value] of css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
    if (!/\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(value)) continue;
    references.push(new URL(value, new URL(`assets/${name}`, base)));
    cssFonts++;
  }
}
assert.ok(cssFonts, "Expected font-face URLs in generated CSS");
const paths = new Set();
for (const url of references) {
  assert.equal(url.origin, base.origin, `Font is not self-hosted: ${url}`);
  assert.ok(
    url.pathname.startsWith(base.pathname),
    `Font escapes the deployment path: ${url}`,
  );
  const path = decodeURIComponent(url.pathname.slice(base.pathname.length));
  assert.ok(
    (await stat(resolve(root, path))).isFile(),
    `Missing built font: ${path}`,
  );
  paths.add(path);
}
console.log(`Validated ${paths.size} built fonts under ${base.pathname}`);
