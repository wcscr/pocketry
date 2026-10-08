import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { migrateProfilePocket, resetPocketPlane, rigidPocket } from "@shared/gridfinity/rigid-pocket";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { toCrossSection } from "@/lib/geometry/offset";
import { buildCutoutCutters, buildRigidPocket } from "./cutouts";
import { buildProfileBottomCutout } from "./profile-bottom";
import { resolvedPocketGeometry } from "./pocket-geometry";
import { EXPORT_QUALITY } from "./bin";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const shape: TracedShape = { id: "s", name: "Step", sourceMmPerPx: 1, pointCount: 6,
  bboxMm: { minX: -20, maxX: 20, minY: 0, maxY: 20 },
  outlineMm: [{ outer: [[-20,0],[0,0],[0,8],[20,8],[20,20],[-20,20]].map(([x,y]) => ({x,y})), holes: [] }] };
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, fill: "solid", lip: "none" });
const pocket = parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 3, y: -4 },
  depth: { mode: "mm", value: 6 }, elevationMm: 8, clearanceMm: 0, cornerRoundMm: 0, bottomFilletMm: 0 });

describe("rigid generated pockets", () => {
  it.each([[0,0,0],[90,0,17],[0,90,17],[180,0,32],[125,-24,20],[-30,70,17],[360,0,0]])(
    "preserves dimensions and exact surface sections at %s/%s/%s", (xDeg,yDeg,rotationDeg) => {
      const p = { ...pocket, tilt: { xDeg, yDeg }, rotationDeg, elevationMm: 25 };
      const complete = buildRigidPocket(kernel, shape, p, spec, EXPORT_QUALITY).cutters[0];
      expect(complete.volume()).toBeCloseTo(640 * 6, 5);
      expect(complete.boundingBox().min[2]).toBeCloseTo(25, 6);
      const outlines = resolvedPocketGeometry(kernel, shape, p, spec);
      const expected = arena.track(complete.slice(42 - 1e-7));
      const actual = toCrossSection(kernel, outlines.opening);
      expect(arena.track(actual.subtract(expected)).area()).toBeCloseTo(0, 5);
      expect(arena.track(expected.subtract(actual)).area()).toBeCloseTo(0, 5);
      const moved = buildRigidPocket(kernel, shape, { ...p, elevationMm: 80 }, spec, EXPORT_QUALITY).cutters[0];
      expect(moved.volume()).toBeCloseTo(complete.volume(), 5);
      expect(moved.boundingBox().max[2] - complete.boundingBox().max[2]).toBeCloseTo(55, 5);
      expect(resolvedPocketGeometry(kernel, shape, { ...p, elevationMm: 80 }, spec).opening).toEqual([]);
    });
  it("leaves a closed surface above a submerged tool", () => {
    const p = { ...pocket, tilt: { xDeg: 180, yDeg: 0 } };
    expect(resolvedPocketGeometry(kernel, shape, p, spec).opening).toEqual([]);
    expect(buildCutoutCutters(kernel, new Map([[shape.id,shape]]), [p], spec, EXPORT_QUALITY).cutters[0].volume()).toBeCloseTo(3840, 5);
  });
  it("retains generated clearance, corner rounding, fillets and split seats under rotation", () => {
    const p = { ...pocket, clearanceMm: 0.4, cornerRoundMm: 1, bottomFilletMm: 1, topFilletMm: 1,
      split: { boundary: [{ x: -20, y: 10 }, { x: 20, y: 10 }],
        depths: [{ mode: "mm" as const, value: 5 }, { mode: "mm" as const, value: 12 }] as const } };
    const cutout = parseCutoutPlacement(p);
    const source = buildRigidPocket(kernel, shape, cutout, spec, EXPORT_QUALITY).cutters[0];
    const rotated = buildRigidPocket(kernel, shape, { ...cutout, tilt: {xDeg:125,yDeg:-24}, rotationDeg:20 }, spec, EXPORT_QUALITY).cutters[0];
    expect(rotated.volume()).toBeCloseTo(source.volume(), 4);
    expect(rotated.boundingBox().min[2]).toBeCloseTo(8, 5);
    expect(source.volume()).not.toBeCloseTo(3840, 0);
  });
  it.each(["bottom", "top", "left", "right"] as const)("migrates the old %s profile without changing its solid", edge => {
    const old = { ...pocket, elevationMm: undefined, profileBottom: { edge, widthMm: 6, elevationMm: 8 },
      profileRotation: { xDeg: 125, yDeg: -24 }, rotationDeg: 20, scaleX: 1.2, scaleY: 0.8, mirrored: true };
    const before = buildProfileBottomCutout(kernel, shape, old, spec).cutters[0];
    const converted = migrateProfilePocket(old);
    const after = buildCutoutCutters(kernel, new Map([[shape.id,shape]]), [converted], spec, EXPORT_QUALITY).cutters[0];
    expect(arena.track(before.subtract(after)).volume()).toBeCloseTo(0, 4);
    expect(arena.track(after.subtract(before)).volume()).toBeCloseTo(0, 4);
  });
  it("migrates saved prototype history and creation references together", () => {
    const old = { ...pocket, elevationMm: undefined, profileBottom: {edge:"bottom" as const,widthMm:6,elevationMm:8} };
    const doc = { spec, cutouts: [old], fingerHoles: [] };
    const project = parseProjectDoc({ ...doc, schemaVersion: 25, shapes: [shape],
      history: { stack: [{ doc, label: "Prototype" }], index: 0 }, transformOrigins: { pockets: [{ cutout:old, spec }], fingerHoles:[] } });
    expect(project?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(project?.cutouts[0].profileBottom).toBeUndefined();
    expect(project?.cutouts[0].tilt?.xDeg).toBeCloseTo(90);
    expect(project?.history?.stack[0].doc.cutouts).toEqual(project?.cutouts);
    expect(project?.transformOrigins?.pockets[0].cutout).toEqual(project?.cutouts[0]);
  });
  it("resets X/Y while retaining heading, elevation, position, and source dimensions", () => {
    const p = { ...pocket, tilt: {xDeg:125,yDeg:-24}, rotationDeg:20 };
    const reset = resetPocketPlane(p, shape, spec);
    expect(reset).toEqual({ ...p, tilt:{xDeg:0,yDeg:0} });
    const source = buildRigidPocket(kernel, shape, p, spec, EXPORT_QUALITY).cutters[0];
    const flat = buildRigidPocket(kernel, shape, reset, spec, EXPORT_QUALITY).cutters[0];
    expect(source.volume()).toBeCloseTo(flat.volume(), 5);
  });
  it("freezes the current depth before a rigid edit", () => {
    const p = { ...pocket, elevationMm:undefined, depth:{mode:"remaining" as const,floorThicknessMm:9} };
    expect(rigidPocket(p,shape,spec)).toMatchObject({ elevationMm:9, depth:{mode:"remaining",floorThicknessMm:9,sourceDepthMm:33} });
  });
  it.each([{xDeg:0,yDeg:0},{xDeg:90,yDeg:0},{xDeg:180,yDeg:0},{xDeg:30,yDeg:60}])("retains a finite original through object at every rotation %j", tilt => {
    const p = {...pocket, depth:{mode:"through" as const,sourceDepthMm:6}, tilt};
    const solid = buildRigidPocket(kernel, shape, p, spec, EXPORT_QUALITY).cutters[0];
    expect(solid.status()).toBe("NoError");
    expect(Math.max(...solid.boundingBox().max.map((n,i)=>n-solid.boundingBox().min[i]))).toBeLessThan(60);
    expect(solid.boundingBox().min[2]).toBeCloseTo(p.elevationMm!,6);
    const original = buildRigidPocket(kernel,shape,{...p,depth:{mode:"mm",value:6}},spec,EXPORT_QUALITY).cutters[0];
    expect(arena.track(original.subtract(solid)).volume()).toBeLessThan(1e-7);
    expect(arena.track(solid.subtract(original)).volume()).toBeLessThan(1e-7);
  });
});
