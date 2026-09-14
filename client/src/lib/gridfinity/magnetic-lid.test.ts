import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { parseBinSpec } from "@shared/gridfinity/types";
import { BASE_PROFILE_HEIGHT, MAGNET_HOLE_DEPTH, MAGNET_HOLE_RADIUS, binHeightMm } from "@shared/gridfinity/standard";
import { lidMagnetCenters } from "@shared/gridfinity/magnetic-lid";
import { fingerHoleSchema } from "@shared/gridfinity/cutout";
import { validateBinSpec, validateLayout } from "@shared/gridfinity/validate";
import { buildBin, buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { buildMagneticLid, magneticLidForPrint } from "./magnetic-lid";

let arena: Arena;
let kernel: Kernel;
beforeEach(async () => { arena = new Arena(); kernel = createKernel(await loadManifold(), arena); });
afterEach(() => arena.dispose());
const spec = (patch: Record<string, unknown> = {}) => parseBinSpec({ gridX: 2, gridY: 3, heightUnits: 6, fill: "none", magneticLid: true, ...patch });

describe("magnetic lids", () => {
  for (const quality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
    for (const patch of [{}, { gridX: 1, gridY: 1, heightUnits: 2 }, { flatBottom: true, fill: "solid" }, { gridPitch: "half", gridX: 3 }, { gridPitch: "quarter", gridX: 4, gridY: 4 }]) {
      it(`builds connected solids with mating clearance: ${JSON.stringify(patch)}, ${quality.circularSegments} segments`, () => {
        const s = spec(patch);
        const body = buildBin(kernel, s, quality).solid;
        const lid = buildMagneticLid(kernel, s, quality.circularSegments);
        const closed = arena.track(lid.translate([0, 0, binHeightMm(s.heightUnits)]));
        expect(body.status()).toBe("NoError");
        expect(lid.status()).toBe("NoError");
        const bodyPieces = body.decompose();
        const lidPieces = lid.decompose();
        bodyPieces.forEach(part => arena.track(part));
        lidPieces.forEach(part => arena.track(part));
        expect(bodyPieces).toHaveLength(1);
        expect(lidPieces).toHaveLength(1);
        expect(arena.track(body.intersect(closed)).volume()).toBeLessThan(1e-5);
        const print = magneticLidForPrint(kernel, lid);
        expect(print.boundingBox().min[2]).toBeCloseTo(0, 6);
        expect(print.boundingBox().max[2]).toBeCloseTo(BASE_PROFILE_HEIGHT, 6);
        // The existing stacking geometry must accept a normal bin with the lid removed.
        const upper = buildBin(kernel, parseBinSpec({ ...s, flatBottom: false, magneticLid: false }), quality).solid;
        const stacked = arena.track(upper.translate([0, 0, binHeightMm(s.heightUnits)]));
        expect(arena.track(body.intersect(stacked)).volume()).toBeLessThan(1e-5);
      });
    }
  }

  it("uses the base bore dimensions for all eight recesses and leaves closed floors", () => {
    const s = spec();
    const body = buildBin(kernel, s, EXPORT_QUALITY).solid;
    const lid = buildMagneticLid(kernel, s, 64);
    const probe = arena.track(kernel.Manifold.cylinder(MAGNET_HOLE_DEPTH - 0.02, MAGNET_HOLE_RADIUS - 0.03, MAGNET_HOLE_RADIUS - 0.03, 64));
    for (const { x, y } of lidMagnetCenters(s)) {
      const inBody = arena.track(probe.translate([x, y, 42 - MAGNET_HOLE_DEPTH + 0.01]));
      const inLid = arena.track(probe.translate([x, y, 0.01]));
      expect(arena.track(body.intersect(inBody)).volume()).toBeLessThan(1e-6);
      expect(arena.track(lid.intersect(inLid)).volume()).toBeLessThan(1e-6);
      const floorProbe = arena.track(kernel.Manifold.cube([1, 1, 0.1], true));
      expect(arena.track(body.intersect(arena.track(floorProbe.translate([x, y, 42 - MAGNET_HOLE_DEPTH - 0.1])))).volume()).toBeCloseTo(0.1, 6);
      expect(arena.track(lid.intersect(arena.track(floorProbe.translate([x, y, MAGNET_HOLE_DEPTH + 0.1])))).volume()).toBeCloseTo(0.1, 6);
    }
  });

  it("rejects a finger access that would remove a magnet support in both UI validation and the builder", () => {
    const s = spec({ fill: "solid" });
    const hole = fingerHoleSchema.parse({ id: "f1", center: lidMagnetCenters(s)[0], diameterMm: 7, depthMm: 8 });
    expect(validateLayout(s, [], new Map(), [hole]).some(issue => issue.code === "lid-support-collision")).toBe(true);
    expect(() => buildBinWithCutouts(kernel, s, { shapesById: new Map(), cutouts: [], fingerHoles: [hole] }, PREVIEW_QUALITY)).toThrow(/lid magnet support/);
    const central = { ...hole, center: { x: 0, y: 0 } };
    expect(validateLayout(s, [], new Map(), [central]).some(issue => issue.code === "lid-support-collision")).toBe(false);
    expect(buildBinWithCutouts(kernel, s, { shapesById: new Map(), cutouts: [], fingerHoles: [central] }, PREVIEW_QUALITY).solid.status()).toBe("NoError");
  });

  for (const patch of [{ lip: "none" }, { heightUnits: 1 }, { gridPitch: "quarter", gridX: 1 }, { footprint: { kind: "custom", cells: [{ x: 0, y: 0 }] }, gridX: 1, gridY: 1 }]) {
    it(`fails closed on unsupported geometry ${JSON.stringify(patch)}`, () => {
      const s = spec(patch);
      expect(validateBinSpec(s).ok).toBe(false);
      expect(() => buildBin(kernel, s, PREVIEW_QUALITY)).toThrow();
      expect(() => buildMagneticLid(kernel, s, 24)).toThrow();
    });
  }
});
