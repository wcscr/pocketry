import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { strFromU8, unzipSync } from "fflate";
import { afterEach, expect, it } from "vitest";

/**
 * `npm run export:bin` runs `scripts/export-bin.ts` under tsx in plain Node,
 * not through Vite. Vitest resolves imports through Vite, which turns
 * `manifold-3d/manifold.wasm?url` into a string, so a test that imports the
 * bin generator directly cannot detect a geometry module that value-imports
 * `lib/manifold/runtime`. Plain Node loads that specifier as a WebAssembly ES
 * module, which fails on its minified imports before the script writes
 * anything. Running the script in a child process exercises the Node module
 * graph and the script's own kernel loading.
 */
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

let outDir: string | null = null;

afterEach(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
  outDir = null;
});

it("writes 3MF and STL artifacts when run under tsx in plain Node", () => {
  outDir = mkdtempSync(join(tmpdir(), "pocketry-export-bin-"));
  const result = spawnSync(
    process.execPath,
    [tsxCli, "scripts/export-bin.ts", "2x3x6", "--out", outDir],
    { cwd: repoRoot, encoding: "utf8", timeout: 60_000 },
  );

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(readdirSync(outDir).sort()).toEqual(["bin-2x3x6.3mf", "bin-2x3x6.stl"]);

  // Binary STL: 80-byte header, uint32 triangle count, 50 bytes per triangle.
  const stl = readFileSync(join(outDir, "bin-2x3x6.stl"));
  const triangles = stl.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(0);
  expect(stl.length).toBe(84 + 50 * triangles);

  // Both files come from the same mesh, so the 3MF has the same triangles.
  const archive = unzipSync(readFileSync(join(outDir, "bin-2x3x6.3mf")));
  const model = strFromU8(archive["3D/3dmodel.model"]);
  expect(model.match(/<triangle /g)).toHaveLength(triangles);
  expect(result.stdout).toContain(`${triangles} triangles`);
}, 60_000);
