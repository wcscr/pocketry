import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import Module from "manifold-3d";
import { Arena } from "../client/src/lib/manifold/arena";
import { referenceStripThreeMf } from "../client/src/lib/calibrate/reference-strip-mesh";
import { referenceStripPdf } from "../client/src/lib/calibrate/reference-strip-pdf";
import { referenceStripSvg } from "../client/src/lib/calibrate/reference-strip";
import { MEASUREMENT_AID_LENGTHS, MEASUREMENT_AIDS } from "../client/src/lib/calibrate/reference-strip";
import { measurementAidMeshes, measurementAidThreeMf } from "../client/src/lib/calibrate/measurement-aid-mesh";
import { measurementAidSvg, MEASUREMENT_AID_EDGE } from "../client/src/lib/calibrate/measurement-aid";

// Like export:bin, inject a Node kernel without Vite's browser WASM URL import.
const wasmPath = createRequire(import.meta.url).resolve("manifold-3d/manifold.wasm");
const wasm = await Module({ locateFile: () => wasmPath });
wasm.setup();
const arena = new Arena();
const directory = resolve(process.argv[2] ?? "exports/reference-strip");
await mkdir(directory, { recursive: true });
try {
  const kernel = { Manifold: wasm.Manifold, CrossSection: wasm.CrossSection, triangulate: wasm.triangulate, arena };
  for (const length of MEASUREMENT_AID_LENGTHS) {
    const name = `pocketry-measurement-aid-${length}mm-v2`;
    await writeFile(resolve(directory, `${name}.3mf`), measurementAidThreeMf(kernel, length));
    await writeFile(resolve(directory, `${name}.svg`), measurementAidSvg(length));
    await writeFile(resolve(directory, `${name}-mesh.json`), JSON.stringify(measurementAidMeshes(kernel, length).map(({ name, mesh, material }) => ({ name, material, positions: Array.from(mesh.positions), indices: Array.from(mesh.indices) }))));
  }
  await writeFile(resolve(directory, "measurement-aids.json"), JSON.stringify({ designs: MEASUREMENT_AIDS, edges: MEASUREMENT_AID_EDGE, physicalValidation: "Print and measure before use" }, null, 2));
  await writeFile(resolve(directory, "README.md"), await readFile(new URL("../docs/calibration/object-reference-strip.md", import.meta.url)));
  await writeFile(resolve(directory, "pocketry-reference-strip-v1.3mf"), referenceStripThreeMf({
    Manifold: wasm.Manifold, CrossSection: wasm.CrossSection, triangulate: wasm.triangulate, arena,
  }));
  for (const paper of ["a4", "letter"] as const) {
    await writeFile(resolve(directory, `pocketry-reference-strip-v1-${paper}.pdf`), referenceStripPdf(paper));
  }
  await writeFile(resolve(directory, "pocketry-reference-strip-v1.svg"), referenceStripSvg());
} finally { arena.dispose(); }
console.log(`Reference strip downloads written to ${directory}`);
