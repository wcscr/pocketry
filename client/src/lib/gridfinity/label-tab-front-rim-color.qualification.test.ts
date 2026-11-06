import { expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { parseBinSpec } from "@shared/gridfinity/types";
import { labelTabSurfaces, labelTabTopZ } from "@shared/gridfinity/label-tab-surfaces";
import { labelTabFrontRimHeightMm, labelTabFrontRimWidthMm } from "@shared/gridfinity/label-tab";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { ringBounds } from "@shared/geometry/rings";
import { wallSlantPointMm } from "@shared/gridfinity/wall-slant";
import { withKernel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { buildLabelTabFrontRimRegion } from "./label-tab";
import { placeSurfaceTextOnTab } from "./surface-text";
import { getHandler, context, nonManifoldEdgeCount, printableMeshVolume, previewMeshVolume } from "./bin-worker-handlers.test-support";
import type { BuildBinRequest } from "./worker-api";

it.each(["north", "south", "east", "west"] as const)("colors %s front edges at their own height and preserves the writing surface", async wall => {
  for (const scope of ["outer", "compartments"] as const) for (const side of [null, "both", "positive"] as const) {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: side ? "none" : "standard",
      wallSlant: side ? { axis: wall === "north" || wall === "south" ? "y" : "x", angleDeg: 30, side } : null,
      compartments: { rows: 2, columns: 2 },
      labelTab: { wall, scope, width: side === "positive" ? "center" : "full", recessMm: 0.5, frontRim: true } });
    await withKernel(kernel => {
      const plain = buildBinWithCutouts(kernel, spec, null, PREVIEW_QUALITY);
      for (const depth of [0.2, 1.25]) {
        const result = buildBinWithCutouts(kernel, spec, null, PREVIEW_QUALITY, { rimInsertThicknessMm: depth });
        const parts = result.materialParts!;
        expect(result.solid.volume()).toBeCloseTo(plain.solid.volume(), 6);
        expect(parts.body.volume() + parts.stackingRim!.volume()).toBeCloseTo(plain.solid.volume(), 5);
        expect(kernel.arena.track(parts.body.intersect(parts.stackingRim!)).volume()).toBeLessThan(1e-5);
        expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, parts.body))).toBe(0);
        expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, parts.stackingRim!))).toBe(0);
        const top = labelTabTopZ(spec) + labelTabFrontRimHeightMm(spec);
        const width = labelTabFrontRimWidthMm(spec, 100);
        for (const surface of labelTabSurfaces({ ...spec, wallSlant: null, labelTab: { ...spec.labelTab!, frontRim: false } })) {
          const b = ringBounds(surface.ring)!;
          const centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
          if (wall === "north" || wall === "south") centre.x += 3;
          else centre.y += 3;
          const edge = { ...centre };
          if (wall === "north") edge.y = b.minY + width / 2;
          if (wall === "south") edge.y = b.maxY - width / 2;
          if (wall === "east") edge.x = b.minX + width / 2;
          if (wall === "west") edge.x = b.maxX - width / 2;
          for (const [point, z, colored] of [[edge, top - 0.1, true], [edge, top - depth - 0.1, false],
            [centre, labelTabTopZ(spec) - 0.1, false]] as const) {
            const p = wallSlantPointMm(spec, point, z);
            const probe = kernel.arena.track(kernel.arena.track(kernel.Manifold.cube([0.1, 0.1, 0.1], true)).translate([p.x, p.y, z]));
            const message = JSON.stringify({ wall, scope, side, depth, point, z });
            expect(kernel.arena.track(parts.stackingRim!.intersect(probe)).volume(), message).toBeCloseTo(colored ? 0.001 : 0, 6);
            expect(kernel.arena.track(parts.body.intersect(probe)).volume(), message).toBeCloseTo(colored ? 0 : 0.001, 6);
          }
        }
      }
    });
  }
});

it("leaves disabled, flush, buried and missing front rims unchanged", async () => {
  await withKernel(kernel => {
    const base = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "none",
      labelTab: { recessMm: 0.5, frontRim: true } });
    for (const spec of [parseBinSpec({ ...base, fill: "solid" }), { ...base, labelTab: null },
      ...[undefined, false].map(frontRim => parseBinSpec({ ...base, labelTab: { ...base.labelTab, frontRim } })),
      parseBinSpec({ ...base, labelTab: { ...base.labelTab, recessMm: 0 } })]) {
      expect(buildLabelTabFrontRimRegion(kernel, spec, 24, 1.25)).toBeNull();
    }
    for (const depth of [0, -1, Infinity, NaN]) expect(buildLabelTabFrontRimRegion(kernel, base, 24, depth)).toBeNull();
    expect(buildBinWithCutouts(kernel, base, null, PREVIEW_QUALITY).materialParts).toBeNull();
  });
});

it.each(["outer", "compartments"] as const)("clips %s front-edge color to shallow custom bins", async scope => {
  const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 2, fill: "none", lip: "none",
    footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
    wallSlant: { axis: "y", angleDeg: 30, side: "negative" }, compartments: { rows: 2, columns: 2 },
    labelTab: { wall: "south", scope, width: "full", recessMm: 0.5, frontRim: true } });
  await withKernel(kernel => {
    const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY, { floorInsertThicknessMm: 0.6,
      rimInsertThicknessMm: 7.35, colorDividerTops: true });
    const { body, stackingRim, pocketFloors } = result.materialParts!;
    expect(stackingRim!.boundingBox().min[2]).toBeGreaterThanOrEqual(14 - 7.35 - 1e-5);
    expect(body.volume() + stackingRim!.volume() + pocketFloors!.volume()).toBeCloseTo(result.solid.volume(), 4);
    for (const part of [body, stackingRim!, pocketFloors!]) expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, part))).toBe(0);
  });
});

it("keeps the metric bin's front rims in the same preview/export material, separate from its six labels", async () => {
  const spec = parseBinSpec({ gridX: 4, gridY: 4, gridPitch: "half", heightUnits: 5.5, fill: "none", lip: "none",
    wallSlant: { axis: "y", angleDeg: 30 }, bottomFilletRadiusMm: 8, compartments: { rows: 2, columns: 3 },
    labelTab: { wall: "south", scope: "compartments", recessMm: 0.5, frontRim: true } });
  for (let i = 0; i < 6; i++) spec.surfaceTexts.push(placeSurfaceTextOnTab(spec, surfaceTextSchema.parse({
    id: String(i), text: "M2x8", font: "helvetiker-bold", sizeMm: 3.2, heightMm: 0.5, position: { x: 0, y: 0 } })));
  const request: BuildBinRequest = { spec, quality: EXPORT_QUALITY, colorDividerTops: true,
    stackingRimMaterialThicknessMm: 1.25, pocketFloorMaterialThicknessMm: 0.6 };
  const preview = (await getHandler()(request, context())).value;
  const exported = (await getHandler()({ ...request, exportTopology: true }, context())).value;
  expect(previewMeshVolume(preview.materialMeshes!.stackingRim!)).toBeCloseTo(printableMeshVolume(exported.materialMeshes!.stackingRim!), 2);
  const parts = [...Object.entries(exported.materialMeshes!).map(([name, mesh]) => ({ name, mesh,
    material: { name, displayColor: (name === "stackingRim" ? "#000000" : "#bfbfbf") as `#${string}` } })),
    ...exported.textMeshes!.map(({ label, mesh }) => ({ name: label.text, mesh, material: { name: "Lettering", displayColor: "#ff8800" as const } }))];
  expect(exported.textMeshes).toHaveLength(6);
  for (const part of parts) expect(nonManifoldEdgeCount(part.mesh)).toBe(0);
  expect(parts.reduce((sum, part) => sum + printableMeshVolume(part.mesh), 0)).toBeCloseTo(exported.stats.volumeMm3, 1);
  const xml = strFromU8(unzipSync(writeThreeMf(parts, { assemble: true }))["3D/3dmodel.model"]);
  expect(xml).toContain('name="stackingRim"');
  expect(xml).toContain('#FF8800');
  expect(xml.match(/<component /g)).toHaveLength(parts.length);
  for (const object of xml.matchAll(/<mesh>([\s\S]*?)<\/mesh>/g)) {
    const positions = [...object[1].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\s*\/>/g)].flatMap(match => match.slice(1).map(Number));
    const indices = [...object[1].matchAll(/<triangle v1="([^"]+)" v2="([^"]+)" v3="([^"]+)"[^>]*\/>/g)].flatMap(match => match.slice(1).map(Number));
    expect(nonManifoldEdgeCount({ positions: new Float32Array(positions), indices: new Uint32Array(indices), normals: null })).toBe(0);
  }
});
