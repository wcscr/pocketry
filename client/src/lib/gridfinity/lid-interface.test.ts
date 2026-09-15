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
const styles = (lidInterface: BinSpec["lidInterface"]): BinSpec["magneticLidStyle"][] =>
  lidInterface === "spring-latch" ? ["inset"] : ["inset", "overlap"];

describe("compliant interfaces", () => {
  for (const quality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
    it.each(interfaces.flatMap(lidInterface => styles(lidInterface).flatMap(magneticLidStyle =>
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
              kernel.Manifold.cube([frame.width + 2, depth + 0.02, 20]))
              .translate([-frame.width / 2 - 1, -depth - 0.01, -5]))
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
    for (const magneticLidStyle of styles(lidInterface)) for (const magneticLidTop of ["flat", "stacking"] as const) {
      const s = spec({ lidInterface, magneticLidStyle, magneticLidTop });
      const lid = buildMagneticLid(kernel, s, 64);
      const frame = lidInterfaceFrames(s)[0];
      const probeAt = (x: number, v: number, z: number) => arena.track(arena.track(kernel.Manifold.cube([0.2, 0.2, 0.2], true))
        .translate([frame.along + x, frame.face + frame.direction * v, z]));
      const capBottom = magneticLidStyle === "overlap" ? 0 : INSET_LID_CAP_BOTTOM_MM;
      const gap = lidInterface === "spring-latch" ? [0, 5] : [6.5, 1.8];
      if (lidInterface !== "angled-fins") {
        expect(arena.track(lid.intersect(probeAt(gap[0], gap[1], frame.bottom + 1.3))).volume()).toBeLessThan(1e-6);
        const root = lidInterface === "spring-latch" ? [0, 10.2] : [-10.5, 0.75];
        expect(arena.track(lid.intersect(probeAt(root[0], root[1], frame.bottom + 1.3))).volume()).toBeCloseTo(0.008, 6);
      }
      const clearance = arena.track(arena.track(kernel.Manifold.cube([frame.width - 2, 0.8, 0.2], true))
        .translate([frame.along, frame.face + frame.direction * 1.4, capBottom - 0.15]));
      expect(arena.track(lid.intersect(clearance)).volume()).toBeLessThan(1e-6);
      // The entire cap and optional stacking rim stay solid and match the
      // original top, rather than just covering a sampled point.
      const original = buildMagneticLid(kernel, { ...s, lidInterface: "ribs" }, 64);
      const topMask = arena.track(arena.track(kernel.Manifold.cube([60, 60, 20], true)).translate([0, 0, capBottom + 10.01]));
      expect(arena.track(arena.track(original.subtract(lid)).intersect(topMask)).volume()).toBeLessThan(1e-6);
      expect(arena.track(arena.track(lid.subtract(original)).intersect(topMask)).volume()).toBeLessThan(1e-6);
    }
  });

  it("mates the inset spring latch to real recesses and retains it until lifted", () => {
    const s = spec({ lidInterface: "spring-latch", magneticLidStyle: "inset" });
    const body = buildBin(kernel, s, EXPORT_QUALITY).solid;
    const frame = lidInterfaceFrames(s)[0];
    const probe = arena.track(kernel.Manifold.cube([0.1, 0.1, 0.1], true));
    const atDepth = (depth: number) => arena.track(probe.translate([frame.along,
      frame.face - frame.direction * depth, 14 + frame.contactZ]));
    expect(arena.track(body.intersect(atDepth(0.2))).volume()).toBeLessThan(1e-6);
    expect(arena.track(body.intersect(atDepth(0.7))).volume()).toBeCloseTo(0.001, 6);
    const lid = buildMagneticLid(kernel, s, 64);
    expect(arena.track(body.intersect(arena.track(lid.translate([0, 0, binHeightMm(s.heightUnits)])))).volume()).toBeLessThan(1e-5);
    expect(arena.track(body.intersect(arena.track(lid.translate([0, 0, 14.8])))).volume()).toBeGreaterThan(0.001);
    const tuned = buildBin(kernel, { ...s, lidFitAdjustmentMm: 0.1 }, EXPORT_QUALITY).solid;
    expect(arena.track(body.subtract(tuned)).isEmpty()).toBe(true);
    expect(arena.track(tuned.subtract(body)).isEmpty()).toBe(true);
  });

  it("anchors the perpendicular inset latch only at its back and protects its recess", () => {
    const s = spec({ lidInterface: "spring-latch", magneticLidStyle: "inset" });
    const frame = lidInterfaceFrames(s)[0];
    const lid = buildMagneticLid(kernel, s, 64);
    const capBottom = INSET_LID_CAP_BOTTOM_MM;
    const rootCut = arena.track(arena.track(kernel.Manifold.cube([1.2, 0.2, capBottom - frame.bottom]))
      .translate([frame.along - 0.6, frame.face + frame.direction * 9.2 - 0.1, frame.bottom - 0.1]));
    const cut = arena.track(lid.subtract(rootCut));
    const pieces = cut.decompose();
    pieces.forEach(piece => arena.track(piece));
    // Cutting the rear root releases a whole head and spring; neither is
    // bonded to the roof or the surrounding walls.
    expect(pieces).toHaveLength(2);
    const latched = { ...s, lidInterface: "spring-latch" as const, fill: "solid" as const };
    const hole = fingerHoleSchema.parse({ id: "latch", center: { x: frame.along, y: frame.face },
      diameterMm: 6, depthMm: 8, topFilletMm: 0 });
    expect(() => buildBinWithCutouts(kernel, latched, { shapesById: new Map(), cutouts: [], fingerHoles: [hole] }, PREVIEW_QUALITY))
      .toThrow(/spring-latch recess/);
    const central = { ...hole, center: { x: 0, y: 0 } };
    expect(buildBinWithCutouts(kernel, latched, { shapesById: new Map(), cutouts: [], fingerHoles: [central] }, PREVIEW_QUALITY)
      .solid.status()).toBe("NoError");
  });

  it.each(["inset", "overlap"] as const)("runs fins across a long side without solid center blocks (%s)", magneticLidStyle => {
    const s = spec({ gridX: 3, gridY: 2, lidInterface: "angled-fins", magneticLidStyle });
    const frame = lidInterfaceFrames(s)[0];
    const lid = buildMagneticLid(kernel, s, 24);
    const strip = arena.track(arena.track(kernel.Manifold.cube([frame.width - 4, 0.1, 0.1], true))
      .translate([0, frame.face + frame.direction * 1.6, frame.bottom + 1.3]));
    const fingers = arena.track(lid.intersect(strip)).decompose();
    fingers.forEach(finger => arena.track(finger));
    const spans = fingers.map(finger => finger.boundingBox()).sort((a, b) => a.min[0] - b.min[0]);
    expect(spans.length).toBeGreaterThan(35);
    for (const span of spans) expect(span.max[0] - span.min[0]).toBeLessThan(1.5);
    for (let i = 1; i < spans.length; i++) expect(spans[i].min[0] - spans[i - 1].max[0]).toBeLessThan(2.4);
    expect(spans[0].min[0]).toBeLessThan(-frame.width / 2 + 4);
    expect(spans.at(-1)!.max[0]).toBeGreaterThan(frame.width / 2 - 4);
  });

  it.each(interfaces.flatMap(lidInterface => [
      { gridX: 2, gridY: 3, wallThicknessMm: 4 },
      { gridPitch: "half" as const, gridX: 2, gridY: 3, wallThicknessMm: 1.2 },
      { gridPitch: "quarter" as const, gridX: 4, gridY: 4, wallThicknessMm: 1.2 },
    ].flatMap(patch => styles(lidInterface).map(magneticLidStyle => ({ lidInterface, magneticLidStyle, patch })))))
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

  it("rejects undersized interfaces and overlapping spring latches", () => {
    expect(validateBinSpec(spec({ gridPitch: "quarter", gridX: 3, gridY: 3, lidInterface: "side-springs" })).ok).toBe(false);
    const overlap = spec({ magneticLidStyle: "overlap", lidInterface: "spring-latch" });
    expect(validateBinSpec(overlap).ok).toBe(false);
    expect(() => buildMagneticLid(kernel, overlap, 24)).toThrow(/only available for inset/);
  });
});
