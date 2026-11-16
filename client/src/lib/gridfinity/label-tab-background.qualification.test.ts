import { expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { parseBinSpec } from "@shared/gridfinity/types";
import { labelTabSurfaces, labelTabTopZ } from "@shared/gridfinity/label-tab-surfaces";
import { ringBounds } from "@shared/geometry/rings";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { withKernel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { buildLabelTabBackgroundRegion } from "./label-tab";
import { placeSurfaceTextOnTab } from "./surface-text";
import { getHandler, context, nonManifoldEdgeCount, printableMeshVolume, previewMeshVolume } from "./bin-worker-handlers.test-support";
import type { BuildBinRequest } from "./worker-api";

it.each(["north", "south", "east", "west"] as const)("keeps %s label faces separate from rims, dividers and body", async wall => {
  for (const scope of ["outer", "compartments"] as const) for (const slanted of [false, true]) {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 5, fill: "none", lip: slanted ? "none" : "standard",
      wallSlant: slanted ? { axis: wall === "north" || wall === "south" ? "y" : "x", angleDeg: 30, side: "positive" } : null,
      compartments: { rows: 2, columns: 2 },
      labelTab: { wall, scope, width: slanted ? "center" : "full", recessMm: 0.5, frontRim: true } });
    await withKernel(kernel => {
      const plain = buildBinWithCutouts(kernel, spec, null, PREVIEW_QUALITY);
      const result = buildBinWithCutouts(kernel, spec, null, PREVIEW_QUALITY, {
        labelBackgroundThicknessMm: 0.6, rimInsertThicknessMm: 1.25, colorDividerTops: true, floorInsertThicknessMm: 0.6,
      });
      const material = result.materialParts!;
      const parts = [material.body, material.labelBackground!, material.stackingRim!, material.pocketFloors!];
      expect(result.solid.volume()).toBeCloseTo(plain.solid.volume(), 6);
      expect(parts.reduce((sum, part) => sum + part.volume(), 0)).toBeCloseTo(plain.solid.volume(), 4);
      for (let i = 0; i < parts.length; i++) {
        expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, parts[i]))).toBe(0);
        for (let j = i + 1; j < parts.length; j++) expect(kernel.arena.track(parts[i].intersect(parts[j])).volume()).toBeLessThan(1e-5);
      }
      // Probe the centre of every shelf at the top and below the color layer.
      for (const surface of labelTabSurfaces(spec)) {
        const b = ringBounds(surface.ring)!;
        const point = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        if (wall === "north" || wall === "south") point.x += 3; else point.y += 3;
        for (const [depth, colored] of [[0.1, true], [0.8, false]] as const) {
          const z = labelTabTopZ(spec) - depth;
          const p = point;
          const probe = kernel.arena.track(kernel.arena.track(kernel.Manifold.cube([0.1, 0.1, 0.1], true)).translate([p.x, p.y, z]));
          expect(kernel.arena.track(material.labelBackground!.intersect(probe)).volume(), JSON.stringify({ wall, scope, slanted, depth })).toBeCloseTo(colored ? 0.001 : 0, 6);
          if (colored) expect(kernel.arena.track(material.stackingRim!.intersect(probe)).volume()).toBeCloseTo(0, 6);
        }
      }
    });
  }
});

it("colors flush shelves without front rims, and skips absent, buried or disabled labels", async () => {
  await withKernel(kernel => {
    const base = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 4, fill: "none", lip: "none", labelTab: { width: "full", recessMm: 0 } });
    expect(buildBinWithCutouts(kernel, base, null, PREVIEW_QUALITY, { labelBackgroundThicknessMm: 0.6 }).materialParts!.labelBackground!.volume()).toBeGreaterThan(1);
    expect(buildBinWithCutouts(kernel, base, null, PREVIEW_QUALITY).materialParts).toBeNull();
    for (const spec of [{ ...base, labelTab: null }, parseBinSpec({ ...base, fill: "solid" })]) {
      expect(buildLabelTabBackgroundRegion(kernel, spec, 24, 0.6)).toBeNull();
    }
    for (const depth of [0, -1, Infinity, NaN]) expect(buildLabelTabBackgroundRegion(kernel, base, 24, depth)).toBeNull();
  });
});

it.each(["outer", "compartments"] as const)("clips deep %s backgrounds to a custom footprint and wide rim", async scope => {
  const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 2, fill: "none", lip: "none",
    footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
    wallSlant: { axis: "y", angleDeg: 30, side: "negative" }, compartments: { rows: 2, columns: 2 },
    labelTab: { wall: "south", scope, width: "full", recessMm: 0.5, frontRim: true } });
  await withKernel(kernel => {
    const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY, {
      labelBackgroundThicknessMm: 3, rimInsertThicknessMm: 7.35, borderWidthMm: 20, colorDividerTops: true, floorInsertThicknessMm: 0.6,
    });
    const { body, labelBackground, stackingRim, pocketFloors } = result.materialParts!;
    const parts = [body, labelBackground!, stackingRim!, pocketFloors!];
    expect(labelBackground!.volume()).toBeGreaterThan(1);
    expect(parts.reduce((sum, part) => sum + part.volume(), 0)).toBeCloseTo(result.solid.volume(), 4);
    for (const [index, part] of parts.entries()) {
      try { expect(nonManifoldEdgeCount(extractPrintableMeshData(kernel, part))).toBe(0); }
      catch (error) { throw new Error(`Part ${index} (${scope}): ${error}`); }
    }
    expect(kernel.arena.track(labelBackground!.intersect(stackingRim!)).volume()).toBeLessThan(1e-5);
  });
});

it.each([{ heightUnits: 4, recessMm: 0.5 }, { heightUnits: 4, recessMm: 0.8 }, { heightUnits: 5.5, recessMm: 0.5 }])("exports six clean label backgrounds for %j, with independent text and matching preview volumes", async ({ heightUnits, recessMm }) => {
  const spec = parseBinSpec({ gridX: 4, gridY: 4, gridPitch: "half", heightUnits, fill: "none", lip: "none",
    wallSlant: { axis: "y", angleDeg: 30 }, bottomFilletRadiusMm: 8, compartments: { rows: 2, columns: 3 },
    labelTab: { wall: "south", scope: "compartments", recessMm, frontRim: true } });
  for (let i = 0; i < 6; i++) spec.surfaceTexts.push(placeSurfaceTextOnTab(spec, surfaceTextSchema.parse({
    id: String(i), text: "M2x8", font: "helvetiker-bold", sizeMm: 3.2, heightMm: 0.5, position: { x: 0, y: 0 } })));
  const request: BuildBinRequest = { spec, quality: EXPORT_QUALITY, labelBackgroundMaterialThicknessMm: 0.6 };
  const preview = await getHandler()(request, context());
  const exported = (await getHandler()({ ...request, exportTopology: true }, context())).value;
  expect(exported.materialMeshes!.stackingRim).toBeUndefined();
  expect(previewMeshVolume(preview.value.materialMeshes!.labelBackground!)).toBeCloseTo(printableMeshVolume(exported.materialMeshes!.labelBackground!), 2);
  expect(preview.transfer).toContain(preview.value.materialMeshes!.labelBackground!.positions.buffer);
  const parts = [
    { name: "Body", mesh: exported.materialMeshes!.body, material: { name: "Light gray", displayColor: "#bfc2c4" as const } },
    { name: "Label background", mesh: exported.materialMeshes!.labelBackground!, material: { name: "Charcoal", displayColor: "#242628" as const } },
    ...exported.textMeshes!.map(part => ({ name: part.label.text, mesh: part.mesh, material: { name: "Light gray", displayColor: "#bfc2c4" as const } })),
  ];
  expect(parts).toHaveLength(8);
  expect(parts.reduce((sum, part) => sum + printableMeshVolume(part.mesh), 0)).toBeCloseTo(exported.stats.volumeMm3, 2);
  for (const part of parts) expect(nonManifoldEdgeCount(part.mesh)).toBe(0);
  const xml = strFromU8(unzipSync(writeThreeMf(parts, { assemble: true }))["3D/3dmodel.model"]);
  expect(xml.match(/<mesh>/g)).toHaveLength(8);
  expect(xml).toContain('#242628FF');
  expect(xml).toContain('#BFC2C4FF');
  expect(xml).toContain('Label background');
  // Slicer-compatible painting must retain the same independently printable regions
  // when body and lettering share a color and only label backgrounds differ.
  const paintedEntries = unzipSync(writeThreeMf(parts, { combineObjects: true, prusaPaint: true }));
  const combined = strFromU8(paintedEntries["3D/3dmodel.model"]);
  expect(combined.match(/<mesh>/g)).toHaveLength(1);
  expect(combined.match(/<m:color /g)).toHaveLength(2);
  const backgroundTriangles = exported.materialMeshes!.labelBackground!.indices.length / 3;
  const totalTriangles = parts.reduce((sum, part) => sum + part.mesh.indices.length / 3, 0);
  expect(combined.match(/pid="1" p1="1"/g)).toHaveLength(backgroundTriangles);
  expect(combined.match(/pid="1" p1="0"/g)).toHaveLength(totalTriangles - backgroundTriangles);
  const facets: { triangle: number; dividing: string }[] = JSON.parse(strFromU8(paintedEntries["Metadata/Slic3r_facets_annotation.json"]))[0].mmSegmentationFacets;
  expect(facets).toHaveLength(totalTriangles);
  expect(facets.map(face => face.triangle)).toEqual(Array.from({ length: totalTriangles }, (_, index) => index));
  expect(facets.filter(face => face.dividing === "8")).toHaveLength(backgroundTriangles);
  expect(facets.filter(face => face.dividing === "4")).toHaveLength(totalTriangles - backgroundTriangles);
  // Volumes and closed edges do not catch a microscopic body skin that
  // collapses onto the colored shelf after Float32 serialization. Probe the
  // actual 3MF triangles above every shelf, including the reported 0.8 mm case.
  const meshes = [...xml.matchAll(/<mesh>([\s\S]*?)<\/mesh>/g)];
  for (const surface of labelTabSurfaces(spec)) {
    const bounds = ringBounds(surface.ring)!;
    const x = (bounds.minX + bounds.maxX) / 2 + 3;
    const y = (bounds.minY + bounds.maxY) / 2;
    expect(highestSurfaceAt(meshes[0][1], x, y)).toBeCloseTo(labelTabTopZ(spec) - 0.6, 5);
    expect(highestSurfaceAt(meshes[1][1], x, y)).toBeCloseTo(labelTabTopZ(spec), 5);
  }

  const section = (await getHandler()({ ...request, section: { axis: "x", offsetMm: 0 } }, context())).value;
  expect(previewMeshVolume(section.materialMeshes!.labelBackground!)).toBeLessThan(previewMeshVolume(preview.value.materialMeshes!.labelBackground!));
});

it.each([0, -1, 3.1, NaN, Infinity])("rejects invalid worker label color thickness %s", async depth => {
  await expect(getHandler()({ spec: parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 3 }), quality: PREVIEW_QUALITY, labelBackgroundMaterialThicknessMm: depth }, context())).rejects.toThrow("Label-background material thickness");
});

/** Intersect a vertical ray with serialized triangles, without rebuilding CSG. */
function highestSurfaceAt(meshXml: string, x: number, y: number): number {
  const vertices = [...meshXml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)]
    .map(match => match.slice(1).map(Number));
  let highest = -Infinity;
  for (const match of meshXml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"[^>]*\/>/g)) {
    const [a, b, c] = match.slice(1).map(index => vertices[Number(index)]);
    const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(determinant) < 1e-12) continue;
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / determinant;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / determinant;
    const w = 1 - u - v;
    if (Math.min(u, v, w) >= -1e-7) highest = Math.max(highest, u * a[2] + v * b[2] + w * c[2]);
  }
  return highest;
}
