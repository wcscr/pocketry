/**
 * Builds a Gridfinity bin and writes `.3mf` + `.stl` artifacts — the G1
 * print-gate deliverable, runnable before any UI exists:
 *
 *   npm run export:bin                     # 2x3x6 empty bin with lip → exports/
 *   npm run export:bin -- 4x2x3           # custom GRIDXxGRIDYxUNITS
 *   npm run export:bin -- 2x3x6 --fill solid --no-lip --out /tmp
 *
 * Runs under plain Node via tsx, which is why it assembles its own Kernel
 * instead of importing `lib/manifold/runtime`: that module's
 * `manifold-3d/manifold.wasm?url` import only resolves under Vite. Everything
 * else it uses is kernel-injected and Vite-free by design.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import Module from "manifold-3d";

import { binDimensionsMm, buildBin, EXPORT_QUALITY } from "../client/src/lib/gridfinity/bin";
import { writeBinarySTL } from "../client/src/lib/export/stl-writer";
import { Arena } from "../client/src/lib/manifold/arena";
import type { Kernel } from "../client/src/lib/manifold/runtime";
import { extractMeshData } from "../client/src/lib/mesh/mesh-data";
import { writeThreeMf } from "../client/src/lib/mesh/threemf";
import { parseBinSpec, type BinSpecInput } from "../shared/gridfinity/types";
import { validateBinSpec } from "../shared/gridfinity/validate";

interface CliOptions {
  gridX: number;
  gridY: number;
  heightUnits: number;
  fill: "none" | "solid";
  lip: "standard" | "none";
  outDir: string;
}

function usage(): never {
  console.error(
    "Usage: npm run export:bin -- [GRIDXxGRIDYxUNITS] [--fill solid|none] [--no-lip] [--out DIR]",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    gridX: 2,
    gridY: 3,
    heightUnits: 6,
    fill: "none",
    lip: "standard",
    outDir: "exports",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fill") {
      const value = argv[++i];
      if (value !== "solid" && value !== "none") usage();
      options.fill = value;
    } else if (arg === "--no-lip") {
      options.lip = "none";
    } else if (arg === "--out") {
      options.outDir = argv[++i] ?? usage();
    } else if (/^\d+x\d+x\d+$/i.test(arg)) {
      const [gridX, gridY, heightUnits] = arg.toLowerCase().split("x").map(Number);
      options.gridX = gridX;
      options.gridY = gridY;
      options.heightUnits = heightUnits;
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }
  return options;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const specInput: BinSpecInput = {
    gridX: cli.gridX,
    gridY: cli.gridY,
    heightUnits: cli.heightUnits,
    fill: cli.fill,
    lip: cli.lip,
  };
  const spec = parseBinSpec(specInput);

  const { issues, ok } = validateBinSpec(spec);
  for (const issue of issues) {
    console.warn(`[${issue.severity}] ${issue.code}: ${issue.message}`);
  }
  if (!ok) {
    console.error("Errors block export; adjust the spec.");
    process.exit(1);
  }

  // Node-side kernel: resolve the wasm through the package exports map, the
  // same way lib/manifold/runtime does for Vitest.
  const require = createRequire(import.meta.url);
  const wasm = await Module({
    locateFile: () => require.resolve("manifold-3d/manifold.wasm"),
  });
  wasm.setup();

  const arena = new Arena();
  const kernel: Kernel = {
    CrossSection: wasm.CrossSection,
    Manifold: wasm.Manifold,
    triangulate: wasm.triangulate,
    arena,
  };

  try {
    const dims = binDimensionsMm(spec);
    const label =
      `${spec.gridX}x${spec.gridY}x${spec.heightUnits}` +
      (spec.fill === "solid" ? "-solid" : "") +
      (spec.lip === "none" ? "-nolip" : "");
    console.log(
      `Building bin ${label}: ${dims.widthMm} × ${dims.lengthMm} × ${dims.totalHeightMm.toFixed(2)} mm ` +
        `at ${EXPORT_QUALITY.circularSegments} segments/circle…`,
    );

    const started = performance.now();
    const { solid } = buildBin(kernel, spec, EXPORT_QUALITY);
    const mesh = extractMeshData(kernel, solid);
    const builtMs = performance.now() - started;

    const volumeCm3 = solid.volume() / 1000;
    console.log(
      `  ${mesh.indices.length / 3} triangles, ${volumeCm3.toFixed(1)} cm³ ` +
        `(≈ ${(volumeCm3 * 1.24).toFixed(0)} g solid PLA), built in ${builtMs.toFixed(0)} ms`,
    );

    mkdirSync(cli.outDir, { recursive: true });
    const baseName = join(cli.outDir, `bin-${label}`);

    const threeMf = writeThreeMf([{ name: `Gridfinity bin ${label}`, mesh }], {
      title: `ToolTrace Gridfinity bin ${label}`,
    });
    writeFileSync(`${baseName}.3mf`, threeMf);
    console.log(`  wrote ${baseName}.3mf (${(threeMf.length / 1024).toFixed(0)} KiB)`);

    const stl = writeBinarySTL(
      { positions: mesh.positions, indices: mesh.indices },
      `ToolTrace Gridfinity bin ${label}`,
    );
    writeFileSync(`${baseName}.stl`, Buffer.from(stl));
    console.log(`  wrote ${baseName}.stl (${(stl.byteLength / 1024).toFixed(0)} KiB)`);
  } finally {
    arena.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
