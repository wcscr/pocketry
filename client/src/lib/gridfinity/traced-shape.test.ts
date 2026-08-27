import { signedArea } from "@shared/geometry/rings";
import type { Outline } from "@shared/geometry/types";
import { describe, expect, it } from "vitest";

import { exportScale } from "@/lib/export/scale";

import { normalizeTracedShape } from "./traced-shape";

/**
 * The numeric handoff test at the trace → bin seam: a known pixel outline
 * with a known calibration must land at exactly the right millimetre
 * coordinates, y-up, centred — this is the mirrored-STL class of regression.
 */
describe("normalizeTracedShape", () => {
  // 200 px ruler = 100 mm → 0.5 mm/px, in a 600 px-tall image.
  const calibration = { startX: 0, startY: 0, endX: 200, endY: 0, lengthMm: 100 };
  const scale = exportScale(calibration, 600);

  // A right triangle in image px (y-down): apex at the TOP of the image.
  const trianglePx: Outline = [
    {
      outer: [
        { x: 100, y: 100 }, // top of the image (small y)
        { x: 100, y: 300 },
        { x: 300, y: 300 },
      ],
      holes: [],
    },
  ];

  it("maps px → mm with the y-flip and centres the bbox", () => {
    const shape = normalizeTracedShape(trianglePx, scale, "tri")!;
    expect(shape).not.toBeNull();
    expect(shape.sourceMmPerPx).toBeCloseTo(0.5, 9);

    // 200×200 px → 100×100 mm, centred: bbox ±50.
    expect(shape.bboxMm).toEqual({ minX: -50, minY: -50, maxX: 50, maxY: 50 });

    // The image-top apex (y = 100 px) must be the mm-frame TOP (y = +50):
    // that is the y-flip doing its one job.
    const apex = shape.outlineMm[0].outer.find(
      (p) => Math.abs(p.x - -50) < 1e-9 && Math.abs(p.y - 50) < 1e-9,
    );
    expect(apex).toBeDefined();

    // Orientation invariant survives the flip.
    expect(signedArea(shape.outlineMm[0].outer)).toBeGreaterThan(0);
    expect(shape.pointCount).toBe(3);
  });

  it("refuses an uncalibrated trace", () => {
    const uncalibrated = exportScale(null, 600);
    expect(normalizeTracedShape(trianglePx, uncalibrated, "tri")).toBeNull();
  });

  it("refuses an empty outline", () => {
    expect(normalizeTracedShape([], scale, "empty")).toBeNull();
  });

  it("assigns unique ids", () => {
    const a = normalizeTracedShape(trianglePx, scale, "a")!;
    const b = normalizeTracedShape(trianglePx, scale, "b")!;
    expect(a.id).not.toBe(b.id);
  });
});
