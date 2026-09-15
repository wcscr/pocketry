import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { parseBinSpec } from "@shared/gridfinity/types";
import { STACKING_LIP_HEIGHT_ACTUAL, MAGNET_HOLE_DEPTH, MAGNET_HOLE_RADIUS, binHeightMm, binFootprintMm } from "@shared/gridfinity/standard";
import { LID_OVERLAP_MM, LID_SHOULDER_GAP_MM, overlapLidRimInsetMm, LID_CAP_THICKNESS_MM, lidCapTopMm, lidTopMm, lidMagnetCenters } from "@shared/gridfinity/magnetic-lid";
import { magnetHoleDepthMm, magnetHoleRadiusMm, magnetCrushRadiusMm } from "@shared/gridfinity/magnets";
import { fingerHoleSchema } from "@shared/gridfinity/cutout";
import { validateBinSpec, validateLayout } from "@shared/gridfinity/validate";
import { binDimensionsMm, buildBin, buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { buildMagneticLid, magneticLidForPrint } from "./magnetic-lid";

let arena: Arena;
let kernel: Kernel;
beforeEach(async () => { arena = new Arena(); kernel = createKernel(await loadManifold(), arena); });
afterEach(() => arena.dispose());
const spec = (patch: Record<string, unknown> = {}) => parseBinSpec({ gridX: 2, gridY: 3, heightUnits: 6, fill: "none", magneticLid: true, ...patch });

describe("magnetic lids", () => {
  for (const quality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
    for (const patch of [{}, { gridX: 1, gridY: 1, heightUnits: 2 }, { flatBottom: true, fill: "solid" }, { gridPitch: "half", gridX: 3 }, { gridPitch: "quarter", gridX: 4, gridY: 4 }].flatMap(patch => (["overlap", "inset"] as const).flatMap(magneticLidStyle => (["flat", "stacking"] as const).map(magneticLidTop => ({ ...patch, magneticLidStyle, magneticLidTop }))))) {
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
        const print = magneticLidForPrint(kernel, lid, s);
        expect(print.boundingBox().min[2]).toBeCloseTo(0, 6);
        expect(print.boundingBox().max[2]).toBeCloseTo(lidTopMm(s) + (s.magneticLidStyle === "overlap" ? LID_OVERLAP_MM - LID_SHOULDER_GAP_MM : 0), 6);
        expect(body.boundingBox().max[2]).toBeCloseTo(binDimensionsMm(s).totalHeightMm, 6);
        if (s.magneticLidTop === "stacking") {
          const upper = buildBin(kernel, parseBinSpec({ ...s, flatBottom: false, magneticLid: false }), quality).solid;
          const stacked = arena.track(upper.translate([0, 0, lidCapTopMm(s)]));
          expect(arena.track(lid.intersect(stacked)).volume()).toBeLessThan(1e-5);
        }
        if (s.magneticLidStyle === "inset") {
        // The inset style retains ordinary stacking when the lid is removed.
        const upper = buildBin(kernel, parseBinSpec({ ...s, flatBottom: false, magneticLid: false }), quality).solid;
        const stacked = arena.track(upper.translate([0, 0, binHeightMm(s.heightUnits)]));
        expect(arena.track(body.intersect(stacked)).volume()).toBeLessThan(1e-5);
        }
      });
    }
  }

  it.each((["overlap", "inset"] as const).flatMap(magneticLidStyle => [1.2, 4].map(wallThicknessMm => ({ magneticLidStyle, wallThicknessMm }))))("uses the base bore dimensions and closed floors ($magneticLidStyle, $wallThicknessMm mm walls)", patch => {
    const s = spec(patch);
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


  it.each(["overlap", "inset"] as const)("keeps color on the lid instead of splitting off a bin rim (%s)", magneticLidStyle => {
    const result = buildBinWithCutouts(kernel, spec({ magneticLidStyle }), null, PREVIEW_QUALITY, { rimInsertThicknessMm: 1.25 });
    expect(result.materialParts?.stackingRim ?? null).toBeNull();
  });

  it("overlaps a recessed rim without increasing the bin footprint", () => {
    const s = spec({ magneticLidStyle: "overlap", lip: "none" });
    const body = buildBin(kernel, s, EXPORT_QUALITY).solid;
    const lid = buildMagneticLid(kernel, s, 64);
    expect(body.boundingBox().max[0]).toBeCloseTo(lid.boundingBox().max[0]);
    expect(lid.boundingBox().min[2]).toBeLessThan(-4);
    const slice = arena.track(body.slice(41));
    const maxX = Math.max(...slice.toPolygons().flat().map(point => point[0]));
    expect(maxX).toBeCloseTo(body.boundingBox().max[0] - overlapLidRimInsetMm(s), 4);
    expect(body.boundingBox().max[2]).toBe(42);
    expect(lid.boundingBox().max[2]).toBeCloseTo(LID_CAP_THICKNESS_MM, 6);
  });

  it("protects the overlapping rim from edge finger access", () => {
    const s = spec({ magneticLidStyle: "overlap", fill: "solid" });
    const hole = fingerHoleSchema.parse({ id: "rim", center: { x: 37.5, y: 0 }, diameterMm: 6, depthMm: 8, topFilletMm: 0 });
    expect(validateLayout(s, [], new Map(), [hole]).some(issue => issue.code === "lid-rim-collision")).toBe(true);
    expect(() => buildBinWithCutouts(kernel, s, { shapesById: new Map(), cutouts: [], fingerHoles: [hole] }, PREVIEW_QUALITY)).toThrow(/inset lid rim/);
  });

  it("leaves a grabbable top above the inset rim", () => {
    const s = spec({ magneticLidStyle: "inset" });
    const lid = buildMagneticLid(kernel, s, 64);
    expect(lid.boundingBox().max[2] - STACKING_LIP_HEIGHT_ACTUAL).toBeGreaterThan(3);
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


it.each(["overlap", "inset"] as const)("builds lids without closure magnets or corner supports (%s)", magneticLidStyle => {
  const s = spec({ magneticLidStyle, lidMagnetHoles: false, lidMagnetCrushRibs: true });
  const body = buildBin(kernel, s, EXPORT_QUALITY).solid;
  const lid = buildMagneticLid(kernel, s, 64);
  const { x, y } = lidMagnetCenters(s)[0];
  const probe = arena.track(kernel.Manifold.cube([1, 1, 1], true));
  const inBody = arena.track(probe.translate([x, y, 40]));
  const inLid = arena.track(probe.translate([x, y, 1]));
  expect(arena.track(body.intersect(inBody)).volume()).toBeLessThan(1e-6);
  expect(arena.track(lid.intersect(inLid)).volume()).toBeCloseTo(1, 6);
  const hole = fingerHoleSchema.parse({ id: "corner", center: { x, y }, diameterMm: 6, depthMm: 8 });
  expect(validateLayout({ ...s, fill: "solid" }, [], new Map(), [hole]).some(issue => issue.code === "lid-support-collision")).toBe(false);
  expect(buildBinWithCutouts(kernel, { ...s, fill: "solid" }, { shapesById: new Map(), cutouts: [], fingerHoles: [hole] }, PREVIEW_QUALITY).solid.status()).toBe("NoError");
  expect(arena.track(body.intersect(arena.track(lid.translate([0, 0, 42])))).volume()).toBeLessThan(1e-5);
});

it("controls underside and closure crush ribs independently", () => {
  const plain = spec({ magnetHoles: true });
  const baseRibbed = { ...plain, magnetCrushRibs: true };
  const lidRibbed = { ...plain, lidMagnetCrushRibs: true };
  const normalBody = buildBin(kernel, plain, PREVIEW_QUALITY).solid;
  const ribbedBody = buildBin(kernel, baseRibbed, PREVIEW_QUALITY).solid;
  const closureBody = buildBin(kernel, lidRibbed, PREVIEW_QUALITY).solid;
  const lower = arena.track(arena.track(kernel.Manifold.cube([200, 200, 7], true)).translate([0, 0, 3.5]));
  expect(arena.track(ribbedBody.intersect(lower)).volume()).toBeGreaterThan(arena.track(normalBody.intersect(lower)).volume());
  expect(arena.track(closureBody.intersect(lower)).volume()).toBeCloseTo(arena.track(normalBody.intersect(lower)).volume(), 5);
  expect(buildMagneticLid(kernel, baseRibbed, 24).volume()).toBeCloseTo(buildMagneticLid(kernel, plain, 24).volume(), 6);
  expect(buildMagneticLid(kernel, lidRibbed, 24).volume()).toBeGreaterThan(buildMagneticLid(kernel, plain, 24).volume());
  expect(closureBody.volume()).toBeGreaterThan(normalBody.volume());
});


it.each(["overlap", "inset"] as const)("has a uniform edge through each side midpoint without local blocks or cutouts (%s)", magneticLidStyle => {
  const lid = buildMagneticLid(kernel, spec({ magneticLidStyle, magneticLidTop: "stacking" }), 64);
  for (const angle of [0, 90, 180, 270]) {
    const half = (angle % 180 === 0 ? 125.5 : 83.5) / 2;
    const band = arena.track(arena.track(kernel.Manifold.cube([2, 5, 20])).translate([-1, half - 4.5, -5]));
    const center = arena.track(band.rotate([0, 0, angle]));
    const neighbor = arena.track(arena.track(band.translate([10, 0, 0])).rotate([0, 0, angle]));
    expect(arena.track(lid.intersect(center)).volume()).toBeCloseTo(arena.track(lid.intersect(neighbor)).volume(), 5);
  }
});

for (const quality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
  it.each([0.8, 1.2, 2, 4])(`changes overlapping wall thickness with a matching rim and fixed footprint (${quality.circularSegments}, %s mm)`, wallThicknessMm => {
    for (const magneticLidTop of ["flat", "stacking"] as const) {
      for (const closure of [{ lidMagnetHoles: true }, { lidMagnetHoles: false }, { lidMagnetHoles: false, lidFit: "friction" }] as const) {
        const s = spec({ gridX: 1, gridY: 1, heightUnits: 2, magneticLidStyle: "overlap", magneticLidTop, wallThicknessMm, ...closure });
        const body = buildBin(kernel, s, quality).solid;
        const lid = buildMagneticLid(kernel, s, quality.circularSegments);
        expect(body.status()).toBe("NoError");
        expect(lid.status()).toBe("NoError");
        expect(lid.boundingBox().max[0] - lid.boundingBox().min[0]).toBeCloseTo(41.5, 6);
        const wallProbe = arena.track(arena.track(kernel.Manifold.cube([1, 20, 0.1], true)).translate([0, 20, -0.5]));
        const wall = arena.track(lid.intersect(wallProbe)).boundingBox();
        expect(wall.max[1] - wall.min[1]).toBeCloseTo(wallThicknessMm, 6);
        const rim = arena.track(body.slice(13));
        expect(Math.max(...rim.toPolygons().flat().map(point => point[0]))).toBeCloseTo(20.75 - wallThicknessMm - 0.3, 6);
        const rimProbe = arena.track(wallProbe.translate([0, 0, 13.5]));
        const rimWall = arena.track(body.intersect(rimProbe)).boundingBox();
        expect(rimWall.max[1] - rimWall.min[1]).toBeCloseTo(wallThicknessMm, 6);
        const plain = buildBin(kernel, { ...s, magneticLid: false, lip: "none" }, quality).solid;
        const bodyProbe = arena.track(wallProbe.translate([0, 0, 10.5]));
        const plainWall = arena.track(plain.intersect(bodyProbe)).boundingBox();
        expect(plainWall.max[1] - plainWall.min[1]).toBeCloseTo(wallThicknessMm, 6);
        const contact = arena.track(body.intersect(arena.track(lid.translate([0, 0, 14]))));
        if (s.lidFit === "friction" && !s.lidMagnetHoles) {
          expect(contact.volume()).toBeGreaterThan(0.01);
          const ribBand = arena.track(arena.track(kernel.Manifold.cube([100, 100, 1.6], true)).translate([0, 0, 10.8]));
          expect(arena.track(contact.subtract(ribBand)).volume()).toBeLessThan(1e-5);
        } else expect(contact.volume()).toBeLessThan(1e-5);
        const pieces = magneticLidForPrint(kernel, lid, s).decompose();
        pieces.forEach(piece => arena.track(piece));
        expect(pieces).toHaveLength(1);
      }
    }
  });

  it.each([
    { label: "21", magneticLidTop: "flat", lidMagnetHoles: false },
    { label: "25", magneticLidTop: "stacking", lidMagnetHoles: false },
    { label: "26", magneticLidTop: "flat", lidMagnetHoles: true, lidMagnetCrushRibs: false },
    { label: "27", magneticLidTop: "flat", lidMagnetHoles: true, lidMagnetCrushRibs: true },
  ] as const)(`keeps inset lid $label close to the existing shared base rim (${quality.circularSegments})`, patch => {
    const baseSpec = spec({ gridX: 1, gridY: 1, heightUnits: 2, wallThicknessMm: 0.95, magneticLidStyle: "inset", lidMagnetHoles: true, lidMagnetCrushRibs: true });
    const body = buildBin(kernel, baseSpec, quality).solid;
    const s = { ...baseSpec, ...patch };
    const lid = buildMagneticLid(kernel, s, quality.circularSegments);
    const closed = arena.track(lid.translate([0, 0, 14]));
    expect(arena.track(body.intersect(closed)).volume()).toBeLessThan(1e-5);
    const band = arena.track(arena.track(kernel.Manifold.cube([1, 0.04, 20], true)).translate([0, 20.4, 20]));
    const edgeBottom = arena.track(closed.intersect(band)).boundingBox().min[2];
    expect(edgeBottom - body.boundingBox().max[2]).toBeCloseTo(0.2, 6);
    expect(lid.boundingBox().min[2]).toBeCloseTo(0, 6);
    expect(lid.boundingBox().max[2]).toBeCloseTo(patch.magneticLidTop === "flat" ? 6.75 : 8 + STACKING_LIP_HEIGHT_ACTUAL, 6);
  });

  for (const magneticLidStyle of ["overlap", "inset"] as const) {
    for (const magneticLidTop of ["flat", "stacking"] as const) {
      it(`tunes only the lid, with clearance or limited ridge contact (${magneticLidStyle}, ${magneticLidTop}, ${quality.circularSegments})`, () => {
        const s = spec({ gridX: 1, gridY: 1, heightUnits: 2, magneticLidStyle, magneticLidTop, lidMagnetHoles: false });
        const body = buildBin(kernel, s, quality).solid;
        for (const lidFit of ["lift-off", "friction"] as const) {
          const contacts: number[] = [];
          const volumes: number[] = [];
          for (const lidFitAdjustmentMm of [-0.1, 0, 0.1]) {
            const adjusted = { ...s, lidFit, lidFitAdjustmentMm };
            const lid = buildMagneticLid(kernel, adjusted, quality.circularSegments);
            expect(lid.status()).toBe("NoError");
            const pieces = lid.decompose();
            pieces.forEach(piece => arena.track(piece));
            expect(pieces).toHaveLength(1);
            expect(lid.boundingBox().min[2]).toBeCloseTo(magneticLidStyle === "inset" ? 0 : -4.8, 6);
            expect(lid.boundingBox().max[2]).toBeCloseTo(lidTopMm(adjusted), 6);
            expect(magneticLidForPrint(kernel, lid, adjusted).boundingBox().min[2]).toBeCloseTo(0, 6);
            const closed = arena.track(lid.translate([0, 0, 14]));
            if (magneticLidStyle === "inset") {
              const clearance = lidFit === "friction" ? 0.3 : 0.3 - lidFitAdjustmentMm;
              const edgeProbe = arena.track(arena.track(kernel.Manifold.cube([1, 0.04, 20], true)).translate([
                0, binFootprintMm(s.gridY, s.gridPitch) / 2 - clearance - 0.05, 20,
              ]));
              const edgeBottom = arena.track(closed.intersect(edgeProbe)).boundingBox().min[2];
              expect(edgeBottom - body.boundingBox().max[2]).toBeCloseTo(0.2, 6);
            }
            const contact = arena.track(body.intersect(closed));
            contacts.push(contact.volume());
            volumes.push(lid.volume());
            if (lidFit === "lift-off" || lidFitAdjustmentMm === -0.1) {
              expect(contact.volume()).toBeLessThan(1e-5);
            } else {
              expect(contact.volume()).toBeGreaterThan(0.01);
              const bottom = 14 + (magneticLidStyle === "overlap" ? -4 : 0.7);
              const band = arena.track(arena.track(kernel.Manifold.cube([100, 100, 1.6], true)).translate([0, 0, bottom + 0.8]));
              // Seating faces can leave zero-volume coplanar triangles in the
              // intersection; only the ridge may have positive contact volume.
              expect(arena.track(contact.subtract(band)).volume()).toBeLessThan(1e-5);
            }
            if (magneticLidTop === "stacking") {
              const upper = buildBin(kernel, { ...adjusted, magneticLid: false }, quality).solid;
              const stacked = arena.track(upper.translate([0, 0, lidCapTopMm(adjusted)]));
              expect(arena.track(lid.intersect(stacked)).volume()).toBeLessThan(1e-5);
            }
          }
          if (lidFit === "friction") {
            expect(contacts[2]).toBeGreaterThan(contacts[1]);
            expect(contacts[1]).toBeGreaterThan(contacts[0]);
          } else {
            expect(volumes[2]).toBeGreaterThan(volumes[1]);
            expect(volumes[1]).toBeGreaterThan(volumes[0]);
          }
        }
        const tunedBody = buildBin(kernel, { ...s, lidFit: "friction", lidFitAdjustmentMm: 0.1 }, quality).solid;
        expect(arena.track(body.subtract(tunedBody)).isEmpty()).toBe(true);
        expect(arena.track(tunedBody.subtract(body)).isEmpty()).toBe(true);
      });
    }
  }
}

it.each(["overlap", "inset"] as const)("ignores saved fit choices when closure magnets are enabled (%s)", magneticLidStyle => {
  const s = spec({ magneticLidStyle });
  const original = buildMagneticLid(kernel, s, 24);
  const tuned = buildMagneticLid(kernel, { ...s, lidFit: "friction", lidFitAdjustmentMm: 0.1 }, 24);
  expect(arena.track(original.subtract(tuned)).isEmpty()).toBe(true);
  expect(arena.track(tuned.subtract(original)).isEmpty()).toBe(true);
});

it("keeps legacy overlap wall preferences out of inset geometry", () => {
  const s = spec({ magneticLidStyle: "inset" });
  for (const lidMagnetHoles of [false, true]) {
    const thin = { ...s, lidMagnetHoles, lidWallThicknessMm: 0.8 };
    const thick = { ...s, lidMagnetHoles, lidWallThicknessMm: 2 };
    for (const build of [
      (s: typeof thin) => buildBin(kernel, s, PREVIEW_QUALITY).solid,
      (s: typeof thin) => buildMagneticLid(kernel, s, 24),
    ]) {
      const a = build(thin);
      const b = build(thick);
      expect(arena.track(a.subtract(b)).isEmpty()).toBe(true);
      expect(arena.track(b.subtract(a)).isEmpty()).toBe(true);
    }
  }
});

it("reserves the thicker overlapping rim against finger-access cuts", () => {
  const s = spec({ magneticLidStyle: "overlap", lidMagnetHoles: false, wallThicknessMm: 0.8, fill: "solid" });
  const hole = fingerHoleSchema.parse({ id: "rim", center: { x: 35.9, y: 0 }, diameterMm: 6, depthMm: 8, topFilletMm: 0 });
  expect(validateLayout(s, [], new Map(), [hole]).some(issue => issue.code === "lid-rim-collision")).toBe(false);
  const thick = { ...s, wallThicknessMm: 2 };
  expect(validateLayout(thick, [], new Map(), [hole]).some(issue => issue.code === "lid-rim-collision")).toBe(true);
  expect(() => buildBinWithCutouts(kernel, thick, { shapesById: new Map(), cutouts: [], fingerHoles: [hole] }, PREVIEW_QUALITY)).toThrow(/inset lid rim/);
});

it.each(["overlap", "inset"] as const)("limits friction contact to ribs, leaving room between them and an intact outer edge (%s)", magneticLidStyle => {
  const s = spec({ gridX: 1, gridY: 1, heightUnits: 2, magneticLidStyle, lidMagnetHoles: false, lidFit: "friction" });
  const body = buildBin(kernel, s, EXPORT_QUALITY).solid;
  const lid = buildMagneticLid(kernel, s, 64);
  const contact = arena.track(body.intersect(arena.track(lid.translate([0, 0, 14]))));
  const bandZ = magneticLidStyle === "overlap" ? 10.5 : 15.2;
  const band = arena.track(arena.track(kernel.Manifold.cube([1, 5, 1], true)).translate([0, 19, bandZ]));
  const outerEdge = arena.track(arena.track(kernel.Manifold.cube([1, 0.1, 0.5], true)).translate([
    0, magneticLidStyle === "overlap" ? 20.65 : 20.35, lidCapTopMm(s) - 1,
  ]));
  for (const angle of [0, 90, 180, 270]) {
    const atRib = arena.track(band.rotate([0, 0, angle]));
    const between = arena.track(arena.track(band.translate([8, 0, 0])).rotate([0, 0, angle]));
    expect(arena.track(contact.intersect(atRib)).volume()).toBeGreaterThan(0.001);
    expect(arena.track(contact.intersect(between)).volume()).toBeLessThan(1e-6);
    expect(arena.track(lid.intersect(arena.track(outerEdge.rotate([0, 0, angle])))).volume()).toBeCloseTo(0.05, 5);
  }
});

for (const quality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
  it.each((["overlap", "inset"] as const).flatMap(magneticLidStyle => (["flat", "stacking"] as const).map(magneticLidTop => ({ magneticLidStyle, magneticLidTop }))))(
    `keeps custom magnet bores paired and closed ($magneticLidStyle, $magneticLidTop, ${quality.circularSegments})`, style => {
      for (const [magnetDiameterMm, magnetThicknessMm] of [[3, 1], [7, 3], [12, 5]]) {
        for (const lidMagnetCrushRibs of [false, true]) {
          const s = spec({ ...style, gridX: 2, gridY: 2, heightUnits: 2, wallThicknessMm: 4,
            magnetDiameterMm, magnetThicknessMm, lidMagnetCrushRibs,
            magnetHoles: true, magnetCrushRibs: !lidMagnetCrushRibs });
          const body = buildBin(kernel, s, quality).solid;
          const lid = buildMagneticLid(kernel, s, quality.circularSegments);
          const depth = magnetHoleDepthMm(s);
          // A fine cylinder must fit inside the preview bore's polygon flats.
          const clearRadius = (ribs: boolean) => (ribs ? magnetCrushRadiusMm(s)
            : magnetHoleRadiusMm(s) * Math.cos(Math.PI / quality.circularSegments)) - 0.05;
          const radius = clearRadius(lidMagnetCrushRibs);
          const probe = arena.track(kernel.Manifold.cylinder(depth - 0.02, radius, radius, 64));
          const floor = arena.track(kernel.Manifold.cube([0.5, 0.5, 0.5], true));
          for (const { x, y } of lidMagnetCenters(s)) {
            expect(arena.track(body.intersect(arena.track(probe.translate([x, y, 14 - depth + 0.01])))).volume()).toBeLessThan(1e-5);
            expect(arena.track(lid.intersect(arena.track(probe.translate([x, y, 0.01])))).volume()).toBeLessThan(1e-5);
            expect(arena.track(body.intersect(arena.track(floor.translate([x, y, 14 - depth - 0.6])))).volume()).toBeCloseTo(0.125, 6);
            expect(arena.track(lid.intersect(arena.track(floor.translate([x, y, depth + 0.6])))).volume()).toBeCloseTo(0.125, 6);
          }
          const baseProbe = arena.track(kernel.Manifold.cylinder(depth - 0.02,
            clearRadius(s.magnetCrushRibs), clearRadius(s.magnetCrushRibs), 64));
          // The 12 mm magnet moves 2.25 mm inward per axis from the outer hole.
          const baseCenter = magnetDiameterMm === 12 ? 31.75 : 34;
          expect(arena.track(body.intersect(arena.track(baseProbe.translate([baseCenter, baseCenter, 0.01])))).volume()).toBeLessThan(1e-5);
          expect(arena.track(body.intersect(arena.track(lid.translate([0, 0, 14])))).volume()).toBeLessThan(1e-5);
          const printed = magneticLidForPrint(kernel, lid, s);
          expect(printed.boundingBox().min[2]).toBeCloseTo(0, 6);
          const pieces = printed.decompose();
          pieces.forEach(piece => arena.track(piece));
          expect(pieces).toHaveLength(1);
        }
      }
    });
}

it.each(["overlap", "inset"] as const)("keeps dormant magnet size out of nonmagnetic lids (%s)", magneticLidStyle => {
  const s = spec({ magneticLidStyle, lidMagnetHoles: false });
  const changed = { ...s, magnetDiameterMm: 12, magnetThicknessMm: 5 };
  for (const build of [(s: typeof changed) => buildBin(kernel, s, PREVIEW_QUALITY).solid,
    (s: typeof changed) => buildMagneticLid(kernel, s, 24)]) {
    const a = build(s), b = build(changed);
    expect(arena.track(a.subtract(b)).isEmpty()).toBe(true);
    expect(arena.track(b.subtract(a)).isEmpty()).toBe(true);
  }
});
