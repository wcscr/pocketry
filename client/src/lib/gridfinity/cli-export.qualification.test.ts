import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withKernel } from "../manifold/runtime";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";
import { writeBinarySTL } from "../export/stl-writer";
import { extractPrintableMeshData } from "../mesh/mesh-data";
import { DEFAULT_PEG_BOTTOM, pegBottomExtensionMm } from "../../../../shared/gridfinity/peg-bottom";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, projectDocSchema } from "../../../../shared/gridfinity/project";
import { parseBinSpec } from "../../../../shared/gridfinity/types";
import { DEFAULT_BIN_MATERIALS } from "../../../../shared/gridfinity/materials";
import { exportProject } from "../../../../scripts/lib/export-bin";

const directories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "pocketry-export-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });


describe("current project export compatibility", () => {
  it.each(["flat", "sloped"] as const)("places %s peg bases on the bed and transforms material meshes together", async underside => {
    const directory = await temporaryDirectory();
    const project = projectDocSchema.parse({ schemaVersion: PROJECT_SCHEMA_VERSION,
      spec: parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 2, fill: "none",
        pegBottom: { ...DEFAULT_PEG_BOTTOM, underside, density: 1 } }), shapes: [], cutouts: [], fingerHoles: [],
      materials: { ...DEFAULT_BIN_MATERIALS, colorDividerTops: true } });
    const result = await exportProject(project, directory, `pegs-${underside}`);
    const stl = await readFile(result.paths.stl);
    const minMax = [Infinity, -Infinity];
    for (let i = 0; i < stl.readUInt32LE(80); i++) for (let v = 0; v < 3; v++) {
      const z = stl.readFloatLE(84 + i * 50 + 12 + v * 12 + 8);
      minMax[0] = Math.min(minMax[0], z); minMax[1] = Math.max(minMax[1], z);
    }
    expect(minMax[0]).toBeCloseTo(0, 5);
    expect(minMax[1]).toBeCloseTo(result.dimensions.totalHeightMm, 4);
    const model = strFromU8(unzipSync(await readFile(result.paths.threeMf))["3D/3dmodel.model"]);
    const zs = [...model.matchAll(/<vertex x="[^"]+" y="[^"]+" z="([^"]+)"/g)].map(m => Number(m[1]));
    expect(Math.min(...zs)).toBeCloseTo(0, 5);
    expect(Math.max(...zs)).toBeCloseTo(minMax[1], 4);
    await withKernel(kernel => {
      const built = buildBinWithCutouts(kernel, project.spec, null, EXPORT_QUALITY).solid;
      const transformed = underside === "flat"
        ? kernel.arena.track(kernel.arena.track(built.rotate([180, 0, 0])).translate([0, 0, built.boundingBox().max[2]]))
        : kernel.arena.track(built.translate([0, 0, pegBottomExtensionMm(project.spec)]));
      const expected = Buffer.from(writeBinarySTL(extractPrintableMeshData(kernel, transformed)));
      expect(stl.subarray(80)).toEqual(expected.subarray(80));
    });
  }, 20_000);

  it("runs the legacy CLI with its original defaults through the current builder", async () => {
    const directory = await temporaryDirectory();
    const run = promisify(execFile);
    await run(process.execPath, ["--import", "tsx", "scripts/export-bin.ts", "--out", directory], {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)), timeout: 20_000,
    });
    // Legacy exports write only the two printable files.
    expect((await readdir(directory)).sort()).toEqual(["bin-2x3x6.3mf", "bin-2x3x6.stl"]);
    const spec = parseBinSpec({ gridX: 2, gridY: 3, heightUnits: 6, fill: "none", lip: "standard" });
    const stl = await readFile(join(directory, "bin-2x3x6.stl"));
    await withKernel(kernel => {
      const built = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY);
      const expected = Buffer.from(writeBinarySTL(extractPrintableMeshData(kernel, built.solid)));
      expect(stl.subarray(80)).toEqual(expected.subarray(80));
    });
    const model = strFromU8(unzipSync(await readFile(join(directory, "bin-2x3x6.3mf")))["3D/3dmodel.model"]);
    expect(model.match(/<mesh>/g)).toHaveLength(1);
  }, 25_000);
});
