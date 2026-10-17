import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("regenerates the unchanged starter pack and separate original MIDI reproducibly", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pawpal-midi-export-"));
  try {
    // Run the real exporter with an empty output directory, without rewriting
    // the checked-in downloads or interfering with a running development app.
    for (const path of ["src", "scripts", "package.json"])
      cpSync(resolve(path), join(temporary, path), { recursive: true });
    symlinkSync(
      resolve("node_modules"),
      join(temporary, "node_modules"),
      "dir",
    );
    const generate = () =>
      execFileSync(process.execPath, ["scripts/create-library.mjs"], {
        cwd: temporary,
        stdio: "pipe",
      });
    const output = join(temporary, "public/midi");
    const expectedNames = readdirSync("public/midi").sort();
    const verify = () => {
      expect(readdirSync(output).sort()).toEqual(expectedNames);
      for (const filename of expectedNames)
        expect(readFileSync(join(output, filename))).toEqual(
          readFileSync(join("public/midi", filename)),
        );
      expect(readFileSync(join(output, "bearpaws-an-jing-v1.mid"))).toEqual(
        readFileSync("src/assets/an-jing.mid"),
      );
    };

    generate();
    verify();
    // A second generation must replace stale individual downloads and produce
    // the same starter ZIP even with a full arrangement beside its contents.
    writeFileSync(join(output, "bearpaws-an-jing-v1.mid"), "stale full MIDI");
    writeFileSync(
      join(output, "cadence-ode-to-joy-v1.mid"),
      "stale starter MIDI",
    );
    generate();
    verify();
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 30_000);
