import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { parseBinSpec, type BinSpec } from "@shared/gridfinity/types";
import { binHeightMm } from "@shared/gridfinity/standard";
import { lidCapTopMm, INSET_LID_CAP_BOTTOM_MM } from "@shared/gridfinity/magnetic-lid";
import { fingerHoleSchema } from "@shared/gridfinity/cutout";
import { lidInterfaceFrames } from "@shared/gridfinity/lid-interface";
import { validateBinSpec } from "@shared/gridfinity/validate";
import { buildBin, buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { buildMagneticLid, magneticLidForPrint } from "./magnetic-lid";

let arena: Arena, kernel: Kernel;
beforeEach(async () => { arena = new Arena(); kernel = createKernel(await loadManifold(), arena); });
afterEach(() => arena.dispose());
const spec = (patch: Partial<BinSpec> = {}) => parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 2,
  fill: "none", magneticLid: true, lidMagnetHoles: false, lidFit: "friction", ...patch });
const interfaces = ["side-springs", "angled-fins", "spring-latch"] as const;

describe("compliant interfaces", () => {
  for (const quality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
    it.each(interfaces.flatMap(lidInterface => (["inset", "overlap"] as const).flatMap(magneticLidStyle =>
      (["flat", "stacking"] as const).map(magneticLidTop => ({ lidInterface, magneticLidStyle, magneticLidTop }))))) (
      `builds connected paired parts: $lidInterface / $magneticLidStyle / $magneticLidTop (${quality.circularSegments})`, options => {
        const s = spec(options);
        expect(validateBinSpec(s).ok).toBe(true);
        const body = buildBin(kernel, s, quality).solid;
        for (const lidFitAdjustmentMm of [-0.1, 0, 0.1]) {
          const tuned = { ...s, lidFitAdjustmentMm };
          const lid = buildMagneticLid(kernel, tuned, quality.circularSegments);
          expect(lid.status()).toBe("NoError");
          const pieces = lid.decompose();
          pieces.forEach(piece => arena.track(piece));
          expect(pieces).toHaveLength(1);
          const contact = arena.track(body.intersect(arena.track(lid.translate([0, 0, 14]))));
          if (s.lidInterface === "spring-latch" || lidFitAdjustmentMm === -0.1) expect(contact.volume()).toBeLessThan(1e-5);
          else {
            // Only the chosen contact tips may overlap the bin, by at most
            // the requested per-side interference. Everything else clears.
            const depth = 0.05 + lidFitAdjustmentMm;
            const masks = lidInterfaceFrames(s).map(frame => arena.track(arena.track(arena.track(
              kernel.Manifold.cube([22, depth + 0.02, 20]))
              .translate([-11, -depth - 0.01, -5]))
              .scale([1, frame.direction, 1])));
            const placed = masks.map((mask, i) => {
              const f = lidInterfaceFrames(s)[i];
              return arena.track(arena.track(mask.translate([f.along, f.face, 14])).rotate([0, 0, f.angle]));
            });
            const allowed = arena.track(kernel.Manifold.union(placed));
            expect(arena.track(contact.subtract(allowed)).volume()).toBeLessThan(1e-5);
            expect(contact.volume()).toBeGreaterThan(0.001);
          }
          const printed = magneticLidForPrint(kernel, lid, tuned);
          expect(printed.boundingBox().min[2]).toBeCloseTo(0, 6);
          if (s.magneticLidTop === "stacking") {
            const above = buildBin(kernel, parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 2 }), quality).solid;
            expect(arena.track(lid.intersect(arena.track(above.translate([0, 0, lidCapTopMm(s)])))).volume()).toBeLessThan(1e-5);
          }
        }
      });
  }

  it.each(interfaces)("keeps %s dormant while magnets are on or the lid lifts off", lidInterface => {
    for (const patch of [{ lidMagnetHoles: true }, { lidFit: "lift-off" as const }, { magneticLid: false }]) {
      const original = spec({ ...patch, lidInterface: "ribs", magneticLidStyle: "overlap" });
      const changed = { ...original, lidInterface };
      const a = buildBin(kernel, original, PREVIEW_QUALITY).solid;
      const b = buildBin(kernel, changed, PREVIEW_QUALITY).solid;
      expect(arena.track(a.subtract(b)).isEmpty()).toBe(true);
      expect(arena.track(b.subtract(a)).isEmpty()).toBe(true);
      if (changed.magneticLid) {
        const c = buildMagneticLid(kernel, original, 24), d = buildMagneticLid(kernel, changed, 24);
        expect(arena.track(c.subtract(d)).isEmpty()).toBe(true);
        expect(arena.track(d.subtract(c)).isEmpty()).toBe(true);
      }
    }
  });

  it.each(interfaces)("leaves working gaps in %s instead of fusing it to the frame", lidInterface => {
    for (const magneticLidStyle of ["overlap", "inset"] as const) {
      const s = spec({ lidInterface, magneticLidStyle });
      const lid = buildMagneticLid(kernel, s, 64);
      const frame = lidInterfaceFrames(s)[0];
      const probeAt = (x: number, v: number, z: number) => arena.track(arena.track(kernel.Manifold.cube([0.2, 0.2, 0.2], true))
        .translate([frame.along + x, frame.face + frame.direction * v, z]));
      const z = lidInterface === "angled-fins" ? frame.bottom + 1.3 : lidCapTopMm(s) - 0.5;
      const gap = lidInterface === "angled-fins" ? [0, 0.5] : lidInterface === "side-springs" ? [6.5, 1.8] : [6.5, 2.5];
      expect(arena.track(lid.intersect(probeAt(gap[0], gap[1], z))).volume()).toBeLessThan(1e-6);
      expect(arena.track(lid.intersect(probeAt(-10.5, 0.75, z))).volume()).toBeCloseTo(0.008, 6);
    }
  });

  it.each(["inset", "overlap"] as const)("mates the spring latch to real recesses and retains it until lifted (%s)", magneticLidStyle => {
    const s = spec({ lidInterface: "spring-latch", magneticLidStyle });
    const body = buildBin(kernel, s, EXPORT_QUALITY).solid;
    const noRecess = buildBin(kernel, { ...s, lidInterface: "side-springs" }, EXPORT_QUALITY).solid;
    const removed = arena.track(noRecess.subtract(body));
    expect(removed.volume()).toBeGreaterThan(0.1);
    const lid = buildMagneticLid(kernel, s, 64);
    expect(arena.track(body.intersect(arena.track(lid.translate([0, 0, binHeightMm(s.heightUnits)])))).volume()).toBeLessThan(1e-5);
    expect(arena.track(body.intersect(arena.track(lid.translate([0, 0, 14.8])))).volume()).toBeGreaterThan(0.001);
    const tuned = buildBin(kernel, { ...s, lidFitAdjustmentMm: 0.1 }, EXPORT_QUALITY).solid;
    expect(arena.track(body.subtract(tuned)).isEmpty()).toBe(true);
    expect(arena.track(tuned.subtract(body)).isEmpty()).toBe(true);
  });

  it.each(["inset", "overlap"] as const)("keeps fingers clear of the cap and protects latch recesses (%s)", magneticLidStyle => {
    const s = spec({ lidInterface: "angled-fins", magneticLidStyle });
    const frame = lidInterfaceFrames(s)[0];
    const lid = buildMagneticLid(kernel, s, 64);
    const capBottom = magneticLidStyle === "overlap" ? 0 : INSET_LID_CAP_BOTTOM_MM;
    const gap = arena.track(arena.track(kernel.Manifold.cube([0.2, 0.2, 0.2], true))
      .translate([frame.along, frame.face + frame.direction * 1.6, capBottom - 0.15]));
    expect(arena.track(lid.intersect(gap)).volume()).toBeLessThan(1e-6);
    const finger = arena.track(gap.translate([0, 0, -0.3]));
    expect(arena.track(lid.intersect(finger)).volume()).toBeGreaterThan(0.001);
    const latched = { ...s, lidInterface: "spring-latch" as const, fill: "solid" as const };
    const hole = fingerHoleSchema.parse({ id: "latch", center: { x: frame.along + 6.5, y: frame.face },
      diameterMm: 6, depthMm: 8, topFilletMm: 0 });
    expect(() => buildBinWithCutouts(kernel, latched, { shapesById: new Map(), cutouts: [], fingerHoles: [hole] }, PREVIEW_QUALITY))
      .toThrow(/spring-latch recess/);
    const central = { ...hole, center: { x: 0, y: 0 } };
    expect(buildBinWithCutouts(kernel, latched, { shapesById: new Map(), cutouts: [], fingerHoles: [central] }, PREVIEW_QUALITY)
      .solid.status()).toBe("NoError");
  });

  it.each(interfaces.flatMap(lidInterface => [
      { gridX: 2, gridY: 3, wallThicknessMm: 4 },
      { gridPitch: "half" as const, gridX: 2, gridY: 3, wallThicknessMm: 1.2 },
      { gridPitch: "quarter" as const, gridX: 4, gridY: 4, wallThicknessMm: 1.2 },
    ].flatMap(patch => (["inset", "overlap"] as const).map(magneticLidStyle => ({ lidInterface, magneticLidStyle, patch })))))
    ("scales $lidInterface / $magneticLidStyle with $patch without loose pieces", ({ lidInterface, magneticLidStyle, patch }) => {
      const s = spec({ ...patch, magneticLidStyle, lidInterface, lidFitAdjustmentMm: -0.1 });
      expect(validateBinSpec(s).ok).toBe(true);
      const body = buildBin(kernel, s, EXPORT_QUALITY).solid;
      const lid = buildMagneticLid(kernel, s, 64);
      for (const solid of [body, lid]) {
        expect(solid.status()).toBe("NoError");
        const pieces = solid.decompose();
        pieces.forEach(piece => arena.track(piece));
        expect(pieces).toHaveLength(1);
      }
      expect(arena.track(body.intersect(arena.track(lid.translate([0, 0, 14])))).volume()).toBeLessThan(1e-5);
  });

  it("rejects interfaces without enough room or recess backing", () => {
    expect(validateBinSpec(spec({ gridPitch: "quarter", gridX: 3, gridY: 3, lidInterface: "side-springs" })).ok).toBe(false);
    expect(validateBinSpec(spec({ magneticLidStyle: "overlap", wallThicknessMm: 0.8, lidInterface: "spring-latch" })).ok).toBe(false);
  });
});
