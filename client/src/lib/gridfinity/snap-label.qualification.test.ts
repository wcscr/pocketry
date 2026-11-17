import { expect, it } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, serializeProjectDoc } from "@shared/gridfinity/project";
import { labelTabSurfaces } from "@shared/gridfinity/label-tab-surfaces";
import { ringBounds } from "@shared/geometry/rings";
import { withKernel } from "@/lib/manifold/runtime";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";
import { getHandler, context, nonManifoldEdgeCount } from "./bin-worker-handlers.test-support";
import { writeThreeMf } from "@/lib/mesh/threemf";

const spec = parseBinSpec({ gridX: 4, gridY: 4, gridPitch: "half", heightUnits: 3,
  fill: "none", lip: "none", bottomFilletRadiusMm: 8,
  compartments: { rows: 2, columns: 3, dividerThicknessMm: 1.2 },
  wallSlant: { axis: "y", angleDeg: 30 },
  labelTab: { wall: "south", autoWall: true, scope: "compartments", width: "full",
    recessMm: 0.5, frontRim: true,
    snap: { widthMm: 22, clearanceMm: 0.25, clearanceByTab: {
      r0c0: 0.3, r0c1: 0.25, r0c2: 0.2,
      r1c0: 0.3, r1c1: 0.25, r1c2: 0.2,
    }, labels: ["M1.4x4", "M1.7x4"] } },
});

it("persists snap settings through project migration and export", () => {
  const input = { schemaVersion: 61, shapes: [], spec, cutouts: [], fingerHoles: [] };
  const migrated = parseProjectDoc(input)!;
  expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  expect(migrated.spec.labelTab?.snap).toEqual(spec.labelTab?.snap);
  expect(parseProjectDoc(serializeProjectDoc(migrated))?.spec.labelTab?.snap).toEqual(spec.labelTab?.snap);
  const previous = parseProjectDoc({ ...input, schemaVersion: 62 })!;
  expect(previous.spec.labelTab?.snap?.face).toBeUndefined();
});

it("cuts six fit-test sockets and builds two separate printable labels", async () => {
  await withKernel(kernel => {
    const plain = buildBinWithCutouts(kernel, { ...spec, labelTab: { ...spec.labelTab!, snap: null } }, null, EXPORT_QUALITY);
    const built = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY);
    expect(built.validationIssues).toEqual([]);
    expect(built.bodySolid.status()).toBe("NoError");
    expect(built.bodySolid.volume()).toBeLessThan(plain.bodySolid.volume() - 300);
    expect(built.snapLabelParts.map(part => part.text)).toEqual(["M1.4x4", "M1.7x4"]);
    expect(labelTabSurfaces(spec)).toHaveLength(6);
    for (const part of built.snapLabelParts) {
      expect(part.solid.status()).toBe("NoError");
      expect(part.solid.decompose().map(solid => kernel.arena.track(solid))
        .filter(solid => solid.volume() > 1e-5)).toHaveLength(1);
    }
    for (const surface of labelTabSurfaces(spec)) {
      const bounds = ringBounds(surface.ring)!;
      const x = (bounds.minX + bounds.maxX) / 2, y = (bounds.minY + bounds.maxY) / 2;
      const z = surface.z - 1.2;
      const seated = kernel.arena.track(kernel.arena.track(built.snapLabelParts[0].solid
        .rotate([0, 0, surface.rotationDeg])).translate([x, y, z]));
      expect(kernel.arena.track(seated.intersect(built.bodySolid)).volume()).toBeLessThan(1e-4);
      const lifted = kernel.arena.track(seated.translate([0, 0, 0.3]));
      expect(kernel.arena.track(lifted.intersect(built.bodySolid)).volume()).toBeGreaterThan(0.05);
    }
  });
});

it("blocks export when edited shelves are too narrow for a saved socket", async () => {
  await withKernel(kernel => {
    const narrow = parseBinSpec({ ...spec, labelTab: { ...spec.labelTab!, snap: { ...spec.labelTab!.snap!, widthMm: 30 } } });
    const built = buildBinWithCutouts(kernel, narrow, null, EXPORT_QUALITY);
    expect(built.validationIssues.some(issue => issue.code === "snap-label-socket" && issue.severity === "error")).toBe(true);
  });
});

it("fills each assigned tab above the unchanged latch on a flush shelf", async () => {
  await withKernel(kernel => {
    const expanded = parseBinSpec({ ...spec, labelTab: { ...spec.labelTab!, recessMm: 0, frontRim: false,
      snap: { ...spec.labelTab!.snap!, face: { mode: "auto", marginMm: 0.6,
        widthMm: 24, heightMm: 13, thicknessMm: 0.4, textSizeMm: 3.2 } } } });
    const built = buildBinWithCutouts(kernel, expanded, null, EXPORT_QUALITY);
    expect(built.validationIssues).toEqual([]);
    expect(built.snapLabelParts).toHaveLength(2);
    for (const part of built.snapLabelParts) {
      expect(part.widthMm).toBeGreaterThan(24);
      expect(part.solid.decompose().filter(solid => solid.volume() > 1e-5)).toHaveLength(1);
      const box = part.solid.boundingBox();
      expect(box.max[2]).toBeCloseTo(2, 5);
    }
    expect(built.snapLabelParts.map(part => part.tabKey)).toEqual(["r0c0", "r0c1"]);
    const widerTabs = parseBinSpec({ ...expanded, gridX: 5 });
    const wider = buildBinWithCutouts(kernel, widerTabs, null, EXPORT_QUALITY);
    expect(wider.validationIssues).toEqual([]);
    expect(wider.snapLabelParts[0].widthMm).toBeGreaterThan(built.snapLabelParts[0].widthMm);
    const fittingManual = parseBinSpec({ ...expanded, labelTab: { ...expanded.labelTab!, snap: {
      ...expanded.labelTab!.snap!, tabKeys: ["r0c1", "r0c0"],
      face: { ...expanded.labelTab!.snap!.face!, mode: "manual", widthMm: 24, heightMm: 13 } } } });
    const manualBuilt = buildBinWithCutouts(kernel, fittingManual, null, EXPORT_QUALITY);
    expect(manualBuilt.validationIssues).toEqual([]);
    expect(manualBuilt.snapLabelParts.map(part => part.tabKey)).toEqual(["r0c1", "r0c0"]);
    const manual = parseBinSpec({ ...expanded, labelTab: { ...expanded.labelTab!, snap: {
      ...expanded.labelTab!.snap!, face: { ...expanded.labelTab!.snap!.face!, mode: "manual", widthMm: 26, heightMm: 15 } } } });
    const tooLarge = buildBinWithCutouts(kernel, manual, null, EXPORT_QUALITY);
    expect(tooLarge.validationIssues.some(issue => issue.code === "snap-label-text" && issue.severity === "error")).toBe(true);
  });
});

it("exports the socketed bin and flat label meshes through the worker", async () => {
  const { value, transfer } = await getHandler()({ spec, quality: EXPORT_QUALITY, exportTopology: true }, context());
  expect(value.validationIssues).toEqual([]);
  expect(value.snapLabelMeshes?.map(part => part.text)).toEqual(["M1.4x4", "M1.7x4"]);
  for (const part of value.snapLabelMeshes ?? []) {
    expect(nonManifoldEdgeCount(part.mesh)).toBe(0);
    expect(transfer).toContain(part.mesh.positions.buffer);
    expect(Math.min(...part.mesh.positions.filter((_, index) => index % 3 === 2))).toBeCloseTo(0, 5);
  }
  const file = writeThreeMf(value.snapLabelMeshes!.map(part => ({ name: part.text, mesh: part.mesh })));
  expect(file.byteLength).toBeGreaterThan(1000);
});

it("exports expanded faces as separate manifold objects with a safe gap", async () => {
  const expanded = parseBinSpec({ ...spec, labelTab: { ...spec.labelTab!, recessMm: 0, frontRim: false,
    snap: { ...spec.labelTab!.snap!, face: { mode: "auto", marginMm: 0.6,
      widthMm: 24, heightMm: 13, thicknessMm: 0.4, textSizeMm: 3.2 } } } });
  const { value } = await getHandler()({ spec: expanded, quality: EXPORT_QUALITY, exportTopology: true }, context());
  expect(value.validationIssues).toEqual([]);
  const boxes = (value.snapLabelMeshes ?? []).map(part => {
    expect(nonManifoldEdgeCount(part.mesh)).toBe(0);
    const xs = part.mesh.positions.filter((_, index) => index % 3 === 0);
    return { min: Math.min(...xs), max: Math.max(...xs) };
  });
  expect(boxes).toHaveLength(2);
  expect(boxes[1].min - boxes[0].max).toBeGreaterThanOrEqual(4.99);
});
