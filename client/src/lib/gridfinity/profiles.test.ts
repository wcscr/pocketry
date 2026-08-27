import {
  BASE_TOP_RADIUS,
  STACKING_LIP_DEPTH,
  STACKING_LIP_FILLET_RADIUS,
  STACKING_LIP_HEIGHT,
  STACKING_LIP_HEIGHT_ACTUAL,
  STACKING_LIP_LINE,
  STACKING_LIP_SUPPORT_HEIGHT,
  STACKING_LIP_SUPPORT_HEIGHT_MM,
} from "@shared/gridfinity/standard";
import { describe, expect, it } from "vitest";

import {
  assertCircularSegments,
  baseProfilePolygon,
  polygonArea,
  polygonCentroid,
  roundedRectPolygon,
  roundedRectPolygonArea,
  stackingLipProfilePolygon,
  type ProfilePoint,
  type ProfilePolygon,
} from "./profiles";

function bounds(polygon: ProfilePolygon) {
  return {
    minX: Math.min(...polygon.map(([x]) => x)),
    maxX: Math.max(...polygon.map(([x]) => x)),
    minY: Math.min(...polygon.map(([, y]) => y)),
    maxY: Math.max(...polygon.map(([, y]) => y)),
  };
}

describe("baseProfilePolygon", () => {
  it("is the upstream _base_polygon, closed to the sweep axis", () => {
    const polygon = baseProfilePolygon();
    const expected = [
      [0.8, 0],
      [1.6, 0.8],
      [1.6, 2.6],
      [3.75, 4.75],
      [0, 4.75],
      [0, 0],
    ];
    expect(polygon).toHaveLength(expected.length);
    for (const [index, [x, y]] of expected.entries()) {
      expect(polygon[index][0]).toBeCloseTo(x, 12);
      expect(polygon[index][1]).toBeCloseTo(y, 12);
    }
  });

  it("is CCW with the analytic area ∫X(y)dy = 9.59125", () => {
    const polygon = baseProfilePolygon();
    expect(polygonArea(polygon)).toBeCloseTo(9.59125, 9);
  });
});

describe("stackingLipProfilePolygon", () => {
  const circularSegments = 32;

  /** The sharp (unfilleted) profile, transformed the same way, for area math. */
  function sharpLocal(wallHeightMm: number): ProfilePolygon {
    const radialOffset = BASE_TOP_RADIUS - STACKING_LIP_DEPTH;
    const local: ProfilePoint[] = [
      ...STACKING_LIP_LINE.map(([x, y]): ProfilePoint => [x, y]),
      [STACKING_LIP_DEPTH, -STACKING_LIP_SUPPORT_HEIGHT_MM],
      [0, -STACKING_LIP_SUPPORT_HEIGHT],
    ];
    return local
      .map(([x, y]): ProfilePoint => [x + radialOffset, Math.max(y + wallHeightMm, 0)])
      .reverse();
  }

  it("spans exactly from the inner tip to the outer wall face", () => {
    const polygon = stackingLipProfilePolygon({ wallHeightMm: 35, circularSegments });
    const box = bounds(polygon);
    expect(box.minX).toBeCloseTo(BASE_TOP_RADIUS - STACKING_LIP_DEPTH, 9); // 1.15
    expect(box.maxX).toBeCloseTo(BASE_TOP_RADIUS, 9); // 3.75, the outer face
    expect(box.minY).toBeCloseTo(35 - STACKING_LIP_SUPPORT_HEIGHT_MM, 9); // 31.2
    // The fillet caps the summit below the sharp 4.4: 35 + 4.4 − 0.6·√2.
    expect(box.maxY).toBeCloseTo(35 + STACKING_LIP_HEIGHT_ACTUAL, 9);
  });

  it("is CCW and loses exactly the fillet cut relative to the sharp profile", () => {
    const polygon = stackingLipProfilePolygon({ wallHeightMm: 35, circularSegments });
    const area = polygonArea(polygon);
    expect(area).toBeGreaterThan(0);

    const sharpArea = polygonArea(sharpLocal(35));
    // Tangent–tangent–radius cut at a 45° corner: kite r²·cot(22.5°) minus the
    // polygonised 135° fan (k chords of step 135°/k) around the fillet centre.
    const r = STACKING_LIP_FILLET_RADIUS;
    const k = (135 / 360) * circularSegments; // 12 chords at 32 segments
    const kite = r ** 2 * (1 + Math.SQRT2); // cot(22.5°) = 1 + √2
    const fan = (k / 2) * r ** 2 * Math.sin((135 / k) * (Math.PI / 180));
    expect(area).toBeCloseTo(sharpArea - (kite - fan), 9);
  });

  it("keeps the arc on the step grid so the summit vertex is exact", () => {
    const polygon = stackingLipProfilePolygon({ wallHeightMm: 10, circularSegments });
    const summitY = 10 + STACKING_LIP_HEIGHT - STACKING_LIP_FILLET_RADIUS * Math.SQRT2;
    const summit = polygon.find(([, y]) => Math.abs(y - summitY) < 1e-9);
    expect(summit).toBeDefined();
    // The summit sits directly above the fillet centre x = 2.6 − r (+ offset).
    expect(summit![0]).toBeCloseTo(
      STACKING_LIP_DEPTH - STACKING_LIP_FILLET_RADIUS + (BASE_TOP_RADIUS - STACKING_LIP_DEPTH),
      9,
    );
  });

  it("clamps below-wall support points at zero height without degenerating", () => {
    const polygon = stackingLipProfilePolygon({ wallHeightMm: 0, circularSegments });
    const box = bounds(polygon);
    expect(box.minY).toBe(0);
    expect(polygonArea(polygon)).toBeGreaterThan(0);
    // The clamp collapses the support to the wall bottom; no duplicate points.
    const unique = new Set(polygon.map(([x, y]) => `${x.toFixed(9)},${y.toFixed(9)}`));
    expect(unique.size).toBe(polygon.length);
  });

  it("rejects invalid inputs", () => {
    expect(() => stackingLipProfilePolygon({ wallHeightMm: -1, circularSegments })).toThrow();
    expect(() => stackingLipProfilePolygon({ wallHeightMm: 5, circularSegments: 12 })).toThrow();
  });
});

describe("roundedRectPolygon", () => {
  it("has an exact bounding box regardless of segment count", () => {
    for (const segments of [16, 32, 64]) {
      const polygon = roundedRectPolygon(83.5, 125.5, 3.75, segments);
      const box = bounds(polygon);
      expect(box.minX).toBeCloseTo(-41.75, 12);
      expect(box.maxX).toBeCloseTo(41.75, 12);
      expect(box.minY).toBeCloseTo(-62.75, 12);
      expect(box.maxY).toBeCloseTo(62.75, 12);
    }
  });

  it("matches the closed-form polygonised area exactly", () => {
    for (const segments of [16, 32, 64]) {
      const polygon = roundedRectPolygon(41.5, 41.5, 3.75, segments);
      expect(polygonArea(polygon)).toBeCloseTo(
        roundedRectPolygonArea(41.5, 41.5, 3.75, segments),
        9,
      );
    }
  });

  it("approaches the smooth area from below as segments increase", () => {
    const smooth = 41.5 * 41.5 - (4 - Math.PI) * 3.75 ** 2;
    const coarse = roundedRectPolygonArea(41.5, 41.5, 3.75, 16);
    const fine = roundedRectPolygonArea(41.5, 41.5, 3.75, 64);
    expect(coarse).toBeLessThan(fine);
    expect(fine).toBeLessThan(smooth);
    expect(smooth - fine).toBeLessThan(smooth * 1e-3);
  });

  it("degrades to a plain rectangle at radius zero", () => {
    const polygon = roundedRectPolygon(10, 20, 0, 32);
    expect(polygon).toHaveLength(4);
    expect(polygonArea(polygon)).toBeCloseTo(200, 12);
  });

  it("is centred: centroid at the origin", () => {
    const [cx, cy] = polygonCentroid(roundedRectPolygon(83.5, 125.5, 3.75, 32));
    expect(cx).toBeCloseTo(0, 9);
    expect(cy).toBeCloseTo(0, 9);
  });

  it("dedupes the stadium case where straight edges vanish", () => {
    const polygon = roundedRectPolygon(10, 20, 5, 32);
    const unique = new Set(polygon.map(([x, y]) => `${x.toFixed(9)},${y.toFixed(9)}`));
    expect(unique.size).toBe(polygon.length);
    expect(polygonArea(polygon)).toBeGreaterThan(0);
  });

  it("rejects oversized radii and bad segment counts", () => {
    expect(() => roundedRectPolygon(10, 20, 5.1, 32)).toThrow();
    expect(() => roundedRectPolygon(10, 20, 2, 15)).toThrow();
    expect(() => assertCircularSegments(20)).toThrow();
    expect(() => assertCircularSegments(8)).toThrow();
    expect(() => assertCircularSegments(32)).not.toThrow();
  });
});
