import { afterEach, beforeEach, expect, it } from "vitest";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { parseBinSpec, type BinSpec } from "@shared/gridfinity/types";
import { BASE_TOP_RADIUS, STACKING_LIP_HEIGHT_ACTUAL, binFootprintMm } from "@shared/gridfinity/standard";
import { INSET_LID_CAP_BOTTOM_MM, lidBottomMm, lidCapTopMm, overlapLidRimInsetMm, overlapRimWallMm } from "@shared/gridfinity/magnetic-lid";
import { lidInterfaceFrames } from "@shared/gridfinity/lid-interface";
import { buildBin, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { buildMagneticLid, magneticLidForPrint } from "./magnetic-lid";
import { roundedRectPolygon } from "./profiles";

let arena: Arena, kernel: Kernel;
beforeEach(async () => { arena = new Arena(); kernel = createKernel(await loadManifold(), arena); });
afterEach(() => arena.dispose());
const spec = (patch: Partial<BinSpec> = {}) => parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 2,
  magneticLid: true, wallThicknessMm: 2, fill: "none", lidMagnetHoles: false, ...patch });

for (const quality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
  it.each((["inset", "overlap"] as const).flatMap(magneticLidStyle =>
    (["flat", "stacking"] as const).map(magneticLidTop => ({ magneticLidStyle, magneticLidTop }))
  ))(`keeps the entire cap outline aligned at every fit setting ($magneticLidStyle, $magneticLidTop, ${quality.circularSegments})`, ({ magneticLidStyle, magneticLidTop }) => {
    for (const closure of [{ lidMagnetHoles: true }, { lidFit: "lift-off" as const },
      { lidFit: "friction" as const }, { lidFit: "friction" as const, lidInterface: "angled-fins" as const }]) {
      for (const lidFitAdjustmentMm of [-0.1, 0.1]) {
        const s = spec({ gridX: 2, magneticLidStyle, magneticLidTop, ...closure, lidFitAdjustmentMm });
        const lid = buildMagneticLid(kernel, s, quality.circularSegments);
        const capBottom = magneticLidStyle === "inset" ? INSET_LID_CAP_BOTTOM_MM : 0;
        const expected = arena.track(new kernel.CrossSection([roundedRectPolygon(
          binFootprintMm(s.gridX), binFootprintMm(s.gridY), BASE_TOP_RADIUS, quality.circularSegments)]));
        for (const z of [capBottom + 0.1, lidCapTopMm(s) - 0.1]) {
          const slice = arena.track(arena.track(lid.slice(z)).hull());
          expect(arena.track(expected.subtract(slice)).area()).toBeLessThan(1e-5);
          expect(arena.track(slice.subtract(expected)).area()).toBeLessThan(1e-5);
        }
        if (magneticLidStyle === "inset" && magneticLidTop === "flat") {
          expect(lidCapTopMm(s) - capBottom).toBeCloseTo(5, 6);
        }
      }
    }
  });

  // Give each expensive pair its own arena and timeout budget on shared CI runners.
  it.each((["inset", "overlap"] as const).flatMap(magneticLidStyle =>
    [1, 2].flatMap(gridX => [0.8, 4].flatMap(wallThicknessMm =>
      [false, true].map(lidMagnetHoles => ({ magneticLidStyle, gridX, wallThicknessMm, lidMagnetHoles }))))
  ))(`adds finger access while retaining the wall and mating contacts ($magneticLidStyle, $gridX cells, $wallThicknessMm mm, magnets $lidMagnetHoles, ${quality.circularSegments})`, ({ magneticLidStyle, gridX, wallThicknessMm, lidMagnetHoles }) => {
    const s = spec({ gridX, magneticLidStyle, wallThicknessMm, lidMagnetHoles, lidFit: "friction" });
    const original = buildBin(kernel, s, quality).solid;
    const withRecess = { ...s, lidGripRecess: true };
    const body = buildBin(kernel, withRecess, quality).solid;
    const removed = arena.track(original.subtract(body));
    expect(removed.volume()).toBeGreaterThan(1);
    expect(body.status()).toBe("NoError");
    const pieces = body.decompose(); pieces.forEach(p => arena.track(p));
    expect(pieces).toHaveLength(1);
    const bounds = removed.boundingBox();
    // Recesses stay above/below the working contact band and away from corners.
    if (magneticLidStyle === "inset") expect(bounds.min[2]).toBeGreaterThanOrEqual(16.49);
    else expect(bounds.max[2]).toBeLessThanOrEqual(9.011);
    const accessBand = arena.track(arena.track(kernel.Manifold.cube([14.002, 100, 100], true)).translate([0, 0, 20]));
    expect(arena.track(removed.subtract(accessBand)).volume()).toBeLessThan(1e-6);
    // The original selected wall thickness remains underneath each scoop.
    const probeZ = magneticLidStyle === "inset" ? 16.7 : 8.7;
    const probeY = 20.75 - (magneticLidStyle === "inset" ? 1.5 : overlapLidRimInsetMm(s) + wallThicknessMm / 2);
    const probe = arena.track(arena.track(kernel.Manifold.cube([1, 0.1, 0.1], true)).translate([0, probeY, probeZ]));
    expect(arena.track(body.intersect(probe)).volume()).toBeCloseTo(0.01, 6);
    const lid = buildMagneticLid(kernel, s, quality.circularSegments);
    const changedLid = buildMagneticLid(kernel, withRecess, quality.circularSegments);
    expect(arena.track(lid.subtract(changedLid)).volume()).toBeLessThan(1e-6);
    expect(arena.track(changedLid.subtract(lid)).volume()).toBeLessThan(1e-6);
    const closed = arena.track(lid.translate([0, 0, 14]));
    expect(arena.track(original.intersect(closed)).volume()).toBeCloseTo(arena.track(body.intersect(closed)).volume(), 6);
  });
}

it.each(["inset", "overlap"] as const)("uses 0.15 mm actual locating clearance for easy-lift and empty magnetic lids (%s)", magneticLidStyle => {
  for (const lidMagnetHoles of [false, true]) for (const adjustment of [-0.1, 0, 0.1]) {
    const s = spec({ magneticLidStyle, lidMagnetHoles, lidFitAdjustmentMm: adjustment });
    const lid = buildMagneticLid(kernel, s, 64);
    const face = 20.75 - (magneticLidStyle === "inset" ? 1.9 : overlapLidRimInsetMm(s));
    const gap = 0.15 - (lidMagnetHoles ? 0 : adjustment);
    const z = magneticLidStyle === "inset" ? 1.5 : -2;
    const direction = magneticLidStyle === "inset" ? -1 : 1;
    const probe = (offset: number) => arena.track(arena.track(kernel.Manifold.cube([1, 0.002, 0.1], true))
      .translate([0, face + direction * offset, z]));
    expect(arena.track(lid.intersect(probe(gap - 0.005))).volume()).toBeLessThan(1e-7);
    expect(arena.track(lid.intersect(probe(gap + 0.005))).volume()).toBeCloseTo(0.0002, 6);
  }
});

it.each((["ribs", "angled-fins"] as const).flatMap(lidInterface =>
  [0.8, 2, 4].flatMap(wallThicknessMm => [false, true].map(lidMagnetHoles =>
    ({ lidInterface, wallThicknessMm, lidMagnetHoles })))
))("supports the overlapping stacking cap while retaining a short rim channel ($lidInterface, $wallThicknessMm mm, magnets $lidMagnetHoles)", ({ lidInterface, wallThicknessMm, lidMagnetHoles }) => {
  const s = spec({ gridX: 2, gridY: 2, fill: "solid", magneticLidStyle: "overlap", magneticLidTop: "stacking",
    lidFit: "friction", lidInterface, lidMagnetHoles, wallThicknessMm });
  const body = buildBin(kernel, s, EXPORT_QUALITY).solid;
  const lid = buildMagneticLid(kernel, s, 64);
  const printed = magneticLidForPrint(kernel, lid, s);
  const firstLayer = arena.track(printed.slice(0.2));
  const center = arena.track(kernel.CrossSection.square([10, 10], true));
  expect(arena.track(center.subtract(firstLayer)).area()).toBeLessThan(1e-6);
  const inset = overlapLidRimInsetMm(s) + overlapRimWallMm(s) + 0.3;
  const topSection = arena.track(lid.slice(-0.1));
  const channel = arena.track(arena.track(kernel.CrossSection.square([1, overlapRimWallMm(s)], true))
    .translate([0, 83.5 / 2 - inset + 0.3 + overlapRimWallMm(s) / 2]));
  expect(arena.track(topSection.intersect(channel)).area()).toBeLessThan(1e-6);
  // No body/pad contact in the added center, including solid-fill bins.
  const addedCore = arena.track(arena.track(kernel.Manifold.cube([60, 60, -lidBottomMm(s)], true))
    .translate([0, 0, 14 + lidBottomMm(s) / 2]));
  expect(arena.track(arena.track(body.intersect(arena.track(lid.translate([0, 0, 14])))).intersect(addedCore)).volume()).toBeLessThan(1e-5);
});

it("places inset fin contact on every edge with relieved rigid corners", () => {
  const s = spec({ magneticLidStyle: "inset", lidFit: "friction", lidInterface: "angled-fins" });
  const lid = buildMagneticLid(kernel, s, 64);
  const body = buildBin(kernel, s, EXPORT_QUALITY).solid;
  const contact = arena.track(body.intersect(arena.track(lid.translate([0, 0, 14]))));
  const windows = lidInterfaceFrames(s).map(frame => arena.track(arena.track(
    arena.track(kernel.Manifold.cube([frame.width + 0.1, 2, 4], true))
      .translate([0, frame.face, 15.5])).rotate([0, 0, frame.angle])));
  expect(arena.track(contact.subtract(arena.track(kernel.Manifold.union(windows)))).volume()).toBeLessThan(1e-6);
  for (const window of windows) {
    const parts = arena.track(contact.intersect(window)).decompose(); parts.forEach(p => arena.track(p));
    expect(parts.filter(p => p.volume() > 1e-6).length).toBeGreaterThan(10);
  }
  expect(lidCapTopMm(s) - INSET_LID_CAP_BOTTOM_MM).toBeCloseTo(5, 6);
  expect(INSET_LID_CAP_BOTTOM_MM - STACKING_LIP_HEIGHT_ACTUAL).toBeCloseTo(0.2, 6);
});

for (const quality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
  it.each([
    { lidFit: "lift-off" as const, lidInterface: "ribs" as const },
    { lidFit: "friction" as const, lidInterface: "ribs" as const },
    { lidFit: "friction" as const, lidInterface: "angled-fins" as const },
  ])(`keeps nonmagnetic stacking centers filled through every rounded corner ($lidFit, $lidInterface, ${quality.circularSegments})`, closure => {
    for (const wallThicknessMm of [0.8, 2, 4]) for (const magnetHoles of [false, true]) {
      const s = spec({ ...closure, magneticLidStyle: "overlap", magneticLidTop: "stacking",
        wallThicknessMm, magnetHoles });
      const lid = buildMagneticLid(kernel, s, quality.circularSegments);
      const printed = magneticLidForPrint(kernel, lid, s);
      const section = arena.track(printed.slice(0.4));
      // Probe just inside each rounded corner of the center, where the old
      // unconditional magnet-pad pockets removed material above the bed.
      const corner = binFootprintMm(s.gridX) / 2 - overlapLidRimInsetMm(s) - overlapRimWallMm(s) - 1.8;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const probe = arena.track(arena.track(kernel.CrossSection.square([0.4, 0.4], true))
          .translate([sx * corner, sy * corner]));
        expect(arena.track(probe.subtract(section)).area()).toBeLessThan(1e-6);
      }
    }
  });
}

it("retains corner clearances for matching magnetic stacking lids", () => {
  for (const lidMagnetCrushRibs of [false, true]) for (const magnetDiameterMm of [6, 10]) {
    const s = spec({ gridX: 2, gridY: 2, magneticLidStyle: "overlap", magneticLidTop: "stacking",
      lidMagnetHoles: true, lidMagnetCrushRibs, magnetDiameterMm });
    const body = buildBin(kernel, s, EXPORT_QUALITY).solid;
    const lid = buildMagneticLid(kernel, s, 64);
    const seated = arena.track(lid.translate([0, 0, 14]));
    expect(arena.track(body.intersect(seated)).volume()).toBeLessThan(1e-5);
  }
});
