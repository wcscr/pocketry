import { describe, expect, it } from "vitest";

import { minAreaObb } from "../geometry/obb";
import { distanceToSegment, ensureOrientation, ringBounds } from "../geometry/rings";
import type { Outline, Point } from "../geometry/types";
import { transformOutlinePlacement, type TracedShape } from "./cutout";
import { parseProjectDoc } from "./project";
import { BASE_HEIGHT, BASE_PROFILE_HEIGHT, STACKING_LIP_DEPTH, D_WALL } from "./standard";
import { planSvgBin, svgBinOptionsSchema } from "./svg-bin";
import { validateLayout } from "./validate";

function shape(outline: Outline): TracedShape {
  const outerPoints = outline.flatMap(part => part.outer);
  return { id: "fixture", name: "SVG fixture", outlineMm: outline, bboxMm: ringBounds(outerPoints)!,
    pointCount: outline.flatMap(part => [part.outer, ...part.holes]).reduce((count, ring) => count + ring.length, 0),
    sourceMmPerPx: 1 };
}

function rectangle(width: number, length: number, rotation = 0): TracedShape {
  const radians = rotation * Math.PI / 180;
  const outer = [{ x: -width / 2, y: -length / 2 }, { x: width / 2, y: -length / 2 },
    { x: width / 2, y: length / 2 }, { x: -width / 2, y: length / 2 }].map(({ x, y }) => ({
      x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians),
    }));
  return shape([{ outer, holes: [] }]);
}

describe("SVG pocket bin planning", () => {
  it("uses generic stackable defaults, a native base and an editable current project", () => {
    const { project, summary } = planSvgBin(rectangle(25, 12), { objectDepthMm: 9 });
    expect(project.spec).toMatchObject({ gridX: 1, gridY: 1, heightUnits: 3, fill: "solid", lip: "standard",
      labelTab: null, surfaceTexts: [], magnetHoles: false, screwHoles: false, flatBottom: false });
    expect(project.fingerHoles).toHaveLength(2);
    expect(project.cutouts[0]).toMatchObject({ topFilletMm: 0, bottomFilletMm: 0, cornerRoundMm: 0 });
    expect(summary.floorZMm).toBeCloseTo(BASE_HEIGHT);
    expect(summary.deckZMm).toBeCloseTo(16.2);
    expect(summary.objectTopZMm).toBeCloseTo(16);
    expect(summary.stackingClearanceMm).toBeCloseTo(5);
    expect(summary.fingerPlacement).toBe("sides");
    expect(summary.warnings).toEqual([]);
    expect(parseProjectDoc(project)).toEqual(project);
  });

  it("sizes side access into a wider bin and keeps end access in the narrow footprint", () => {
    const source = rectangle(65.8, 34.6);
    const options = { objectDepthMm: 12.45, objectHeightMm: 18.92 };
    const side = planSvgBin(source, options);
    const ends = planSvgBin(source, { ...options, fingerAccess: { placement: "ends" } });
    const noAccess = planSvgBin(source, { ...options, fingerAccess: { placement: "none" } });
    expect([side.summary.gridX, side.summary.gridY]).toEqual([2, 2]);
    expect([ends.summary.gridX, ends.summary.gridY]).toEqual([2, 1]);
    expect([noAccess.summary.gridX, noAccess.summary.gridY]).toEqual([2, 1]);
    expect(side.summary.heightUnits).toBe(4);
    expect(side.summary.floorZMm).toBeCloseTo(7);
    expect(side.summary.deckZMm).toBeCloseTo(19.65);
    expect(side.summary.objectTopZMm).toBeCloseTo(25.92);
    expect(side.summary.stackingClearanceMm).toBeCloseTo(2.08);
    expect(side.project.spec.fillHeightPercent).toBeLessThan(100);
    expect(side.project.fingerHoles.every(hole => hole.depthMm < side.summary.pocketDepthMm)).toBe(true);
  });

  it("places both grips using the actual concave silhouette rather than empty bounding-box space", () => {
    const source = shape([{ outer: [{ x: -30, y: -15 }, { x: 30, y: -15 }, { x: 30, y: 15 },
      { x: 15, y: 15 }, { x: 15, y: -3 }, { x: -15, y: -3 }, { x: -15, y: 15 }, { x: -30, y: 15 }], holes: [] }]);
    const { project } = planSvgBin(source, { objectDepthMm: 8, rotationDeg: 0 });
    const outer = transformOutlinePlacement(source.outlineMm, project.cutouts[0])[0].outer;
    for (const hole of project.fingerHoles) {
      const nearest = Math.min(...outer.map((point, index) => distanceToSegment(hole.center, point, outer[(index + 1) % outer.length])));
      expect(nearest).toBeLessThan(hole.diameterMm / 2);
    }
  });

  it("finds a smaller footprint for a rotated shape and preserves explicit rotation", () => {
    const source = rectangle(55, 14, 35);
    const auto = planSvgBin(source, { objectDepthMm: 10, fingerAccess: { placement: "none" } });
    const fixed = planSvgBin(source, { objectDepthMm: 10, rotationDeg: 0, fingerAccess: { placement: "none" } });
    expect(auto.summary.gridX * auto.summary.gridY).toBe(2);
    expect(fixed.summary.gridX * fixed.summary.gridY).toBe(4);
    expect(Math.abs(auto.summary.rotationDeg)).toBeCloseTo(35);
    expect(fixed.summary.rotationDeg).toBe(0);
    expect(auto.summary.objectDimensionsMm).toMatchObject({ widthMm: expect.closeTo(55), lengthMm: expect.closeTo(14) });
  });

  it("supports asymmetric silhouettes and centers the placed envelope", () => {
    const source = shape([{ outer: [{ x: -26, y: -9 }, { x: 26, y: -9 }, { x: 7, y: 13 }, { x: -26, y: 13 }], holes: [] }]);
    const { project, summary } = planSvgBin(source, { objectDepthMm: 17, fingerAccess: { placement: "both" } });
    expect(project.fingerHoles).toHaveLength(4);
    expect(Number.isInteger(summary.heightUnits)).toBe(true);
    expect(validateLayout(project.spec, project.cutouts, new Map([[source.id, source]]), project.fingerHoles)
      .filter(issue => issue.severity === "error" || issue.code.includes("lip-collision"))).toEqual([]);
  });

  it("retains exact bin-local custom finger centers", () => {
    const centers: Point[] = [{ x: 0, y: 12 }, { x: 10, y: -10 }];
    const { project, summary } = planSvgBin(rectangle(48, 18), { objectDepthMm: 8, rotationDeg: 0,
      fingerAccess: { placement: "custom", centers, diameterMm: 16, depthMm: 6 } });
    expect(summary.fingerCentersMm).toEqual(centers);
    expect(project.fingerHoles.map(hole => hole.center)).toEqual(centers);
    expect(project.fingerHoles.map(hole => hole.depthMm)).toEqual([6, 6]);
  });

  it("searches both rotation halves for asymmetric shapes with fixed custom grips", () => {
    const source = shape([{ outer: [{ x: -20, y: -5 }, { x: 20, y: 0 }, { x: -20, y: 5 }], holes: [] }]);
    const options = { objectDepthMm: 4, fingerAccess: { placement: "custom" as const, diameterMm: 6,
      centers: [{ x: -7, y: 15 }, { x: 7, y: 15 }] } };
    // Both grips meet the triangle's wide end only when it faces downward.
    // Recentring its bbox cannot make the upward-facing narrow tip wide enough.
    for (let rotationDeg = 0; rotationDeg < 180; rotationDeg += 0.5) {
      expect(() => planSvgBin(source, { ...options, rotationDeg })).toThrow("No full-grid bin");
    }
    const obbAngle = minAreaObb(source.outlineMm[0].outer).angleDeg;
    expect(() => planSvgBin(source, { ...options, rotationDeg: obbAngle })).toThrow("No full-grid bin");
    const { project, summary } = planSvgBin(source, options);
    expect(summary.rotationDeg).toBeLessThan(0);
    expect([summary.gridX, summary.gridY]).toEqual([1, 2]);
    expect(summary.fingerCentersMm).toEqual(options.fingerAccess.centers);
    expect(summary.warnings).toEqual([]);
    expect(() => planSvgBin(source, { ...options, gridX: 1, gridY: 1 })).toThrow("No full-grid bin");
    expect(validateLayout(project.spec, project.cutouts, new Map([[source.id, source]]), project.fingerHoles)
      .filter(issue => issue.severity === "error" || issue.code.includes("lip-collision"))).toEqual([]);
  });

  it("rejects disconnected custom access and circles entirely inside a preserved SVG hole", () => {
    const source = rectangle(50, 30);
    source.outlineMm[0].holes = [ensureOrientation(rectangle(20, 20).outlineMm[0].outer, -1)];
    expect(() => planSvgBin(source, { objectDepthMm: 8, rotationDeg: 0,
      fingerAccess: { placement: "custom", diameterMm: 18, centers: [{ x: 0, y: 0 }] } })).toThrow("No full-grid bin");
    expect(() => planSvgBin(rectangle(20, 10), { objectDepthMm: 8, rotationDeg: 0,
      fingerAccess: { placement: "custom", centers: [{ x: 90, y: 90 }] } })).toThrow("No full-grid bin");
  });

  it("checks the stacking aperture, including rounded corners and complete circular arcs", () => {
    const source = rectangle(35.4, 35.4);
    // Raw dimensions fit the square 36.3 mm lip aperture, but its corners do not.
    const { project, summary } = planSvgBin(source, { objectDepthMm: 5, rotationDeg: 0,
      fingerAccess: { placement: "custom", diameterMm: 6, centers: [{ x: 14, y: 14 }] } });
    expect(summary.gridX * summary.gridY).toBeGreaterThan(1);
    expect(validateLayout(project.spec, project.cutouts, new Map([[source.id, source]]), project.fingerHoles)
      .some(issue => issue.code.includes("lip-collision"))).toBe(false);
    expect(STACKING_LIP_DEPTH - D_WALL).toBeCloseTo(1.65);
  });

  it("uses whole heights with full top-feature clearance and rejects undersized explicit bins", () => {
    const source = rectangle(22, 12);
    const options = { objectDepthMm: 4, objectHeightMm: 27, stackingClearanceMm: 1,
      fingerAccess: { placement: "none" as const } };
    const plan = planSvgBin(source, options);
    expect(plan.summary.heightUnits).toBe(5);
    expect(plan.summary.stackingClearanceMm).toBeCloseTo(1);
    expect(() => planSvgBin(source, { ...options, heightUnits: 4 })).toThrow("requested whole-unit height");
    expect(() => planSvgBin(source, { ...options, heightUnits: 4.5 })).toThrow();
    expect(() => planSvgBin(rectangle(80, 40), { objectDepthMm: 4, gridX: 1, gridY: 1 })).toThrow("No full-grid bin");
  });

  it("permits a reduced floor while protecting the ordinary socket profile", () => {
    const plan = planSvgBin(rectangle(20, 10), { objectDepthMm: 6, minimumFloorMm: BASE_PROFILE_HEIGHT + 1.2,
      fingerAccess: { placement: "none" } });
    expect(plan.summary.floorZMm).toBeCloseTo(5.95);
    expect(() => planSvgBin(rectangle(20, 10), { objectDepthMm: 6, minimumFloorMm: 0.7 })).toThrow();
  });

  it("supports an explicitly unstackable shallow 1u bin without exposing the socket", () => {
    const { project, summary } = planSvgBin(rectangle(12, 8), { objectDepthMm: 0.5, lip: "none", minimumFloorMm: 5.95,
      stackingClearanceMm: 0, fingerAccess: { placement: "none" } });
    expect(project.spec.heightUnits).toBe(1);
    expect(summary.deckZMm).toBe(7);
    expect(summary.floorZMm).toBeCloseTo(6.3);
    expect(summary.stackingClearanceMm).toBeCloseTo(0.2);
  });

  it("finds actual shells when a disconnected silhouette has no material at its center line", () => {
    const translated = (offset: number) => rectangle(12, 8).outlineMm[0].outer.map(point => ({ x: point.x + offset, y: point.y }));
    const source = shape([{ outer: translated(-20), holes: [] }, { outer: translated(20), holes: [] }]);
    const { project } = planSvgBin(source, { objectDepthMm: 6, rotationDeg: 0 });
    expect(project.fingerHoles).toHaveLength(2);
    const outline = transformOutlinePlacement(source.outlineMm, project.cutouts[0]);
    for (const hole of project.fingerHoles) {
      const nearest = Math.min(...outline.flatMap(part => part.outer.map((point, index) => distanceToSegment(hole.center, point, part.outer[(index + 1) % part.outer.length]))));
      expect(nearest).toBeLessThan(hole.diameterMm / 2);
    }
  });

  it("rejects invalid or ambiguous request data instead of silently changing it", () => {
    expect(svgBinOptionsSchema.safeParse({ objectDepthMm: 12, objectHeightMm: 9 }).success).toBe(false);
    expect(svgBinOptionsSchema.safeParse({ objectDepthMm: 12, floorMm: 0.7 }).success).toBe(false);
    expect(svgBinOptionsSchema.safeParse({ objectDepthMm: Infinity }).success).toBe(false);
    expect(svgBinOptionsSchema.safeParse({ objectDepthMm: 12, fingerAccess: { placement: "custom" } }).success).toBe(false);
    expect(svgBinOptionsSchema.safeParse({ objectDepthMm: 12, fingerAccess: { placement: "ends", centers: [{ x: 0, y: 0 }] } }).success).toBe(false);
    expect(svgBinOptionsSchema.safeParse({ objectDepthMm: 12, fingerAccess: { extensionMm: 18 } }).success).toBe(false);
    expect(() => planSvgBin(rectangle(20, 10), { objectDepthMm: 4, fingerAccess: { depthMm: 5 } })).toThrow("below the pocket floor");
    expect(() => planSvgBin(rectangle(20, 10), { objectDepthMm: 280, objectHeightMm: 280, minimumFloorMm: 100, heightUnits: 40 })).toThrow("requested whole-unit height");
    const uncalibrated = { ...rectangle(20, 10), sourceMmPerPx: null };
    expect(() => planSvgBin(uncalibrated, { objectDepthMm: 4 })).toThrow("calibrated");
    const clockwise = rectangle(20, 10);
    clockwise.outlineMm[0].outer.reverse();
    expect(() => planSvgBin(clockwise, { objectDepthMm: 4 })).toThrow("outer winding");
  });
});
