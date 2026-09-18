import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import Module from "manifold-3d";
import { Arena } from "../client/src/lib/manifold/arena";
import { referenceStripThreeMf } from "../client/src/lib/calibrate/reference-strip-mesh";
import { referenceStripPdf } from "../client/src/lib/calibrate/reference-strip-pdf";
import { referenceStripSvg } from "../client/src/lib/calibrate/reference-strip";

// Like export:bin, inject a Node kernel without Vite's browser WASM URL import.
const wasmPath = createRequire(import.meta.url).resolve("manifold-3d/manifold.wasm");
const wasm = await Module({ locateFile: () => wasmPath });
wasm.setup();
const arena = new Arena();
const directory = resolve(process.argv[2] ?? "exports/reference-strip");
await mkdir(directory, { recursive: true });
try {
  await writeFile(resolve(directory, "pocketry-reference-strip-v1.3mf"), referenceStripThreeMf({
    Manifold: wasm.Manifold, CrossSection: wasm.CrossSection, triangulate: wasm.triangulate, arena,
  }));
  for (const paper of ["a4", "letter"] as const) {
    await writeFile(resolve(directory, `pocketry-reference-strip-v1-${paper}.pdf`), referenceStripPdf(paper));
  }
  await writeFile(resolve(directory, "pocketry-reference-strip-v1.svg"), referenceStripSvg());
} finally { arena.dispose(); }
console.log(`Reference strip downloads written to ${directory}`);
