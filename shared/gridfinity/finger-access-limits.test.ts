import { describe, expect, it } from "vitest";
import {
  clampFingerHoleToBin, effectiveFingerHoleDepthMm, elongatedFingerHoleEndpoints,
  fingerHoleFootprintRing, fingerHoleSchema, fingerHoleSizeLimits, hasFlatFingerHoleEnds,
  resizeElongatedFingerHoleFromEndpoint, resizeFingerHoleFromWidthHandle,
} from "./cutout";
import { binFootprintMm } from "./standard";
import { maxGridCells, parseBinSpec } from "./types";

const small = parseBinSpec({ gridX: 1, gridY: 2, heightUnits: 2 });
const opening = fingerHoleSchema.parse({ id: "access", center: { x: 4, y: -3 }, kind: "straight", diameterMm: 18, depthMm: 12 });

describe("bin-aware finger access limits", () => {
  it("stops at the underside and the exact bin width for round openings", () => {
    expect(fingerHoleSizeLimits(opening, small)).toMatchObject({ depthMm: 12.8, diameterMm: 41.5 });
    expect(fingerHoleSizeLimits(opening, { ...small, lip: "none" }).depthMm).toBe(14);
    expect(fingerHoleSizeLimits(opening, { ...small, heightUnits: 1 }).depthMm).toBe(5.8);
  });

  it.each(["straight", "scoop", "deep-scoop"] as const)("allows bin-width %s openings beyond 80 mm across pitches", (kind) => {
    for (const gridPitch of ["full", "half", "quarter"] as const) {
      for (const gridX of [1, 12, maxGridCells(gridPitch)]) {
        // A shorter Y dimension must not reduce the requested Width (X) limit.
        const spec = parseBinSpec({ gridX, gridY: 1, gridPitch, heightUnits: 6 });
        const width = binFootprintMm(gridX, gridPitch);
        const hole = { ...opening, kind, depthMm: 1, lengthMm: 36 };
        expect(fingerHoleSizeLimits(hole, spec).diameterMm).toBe(width);
        expect(clampFingerHoleToBin({ ...hole, diameterMm: width + 10 }, spec))
          .toMatchObject({ diameterMm: width, depthMm: 1, lengthMm: 36 });
        const dragged = resizeFingerHoleFromWidthHandle(hole, { x: 1000, y: -3 }, spec);
        expect(dragged).toMatchObject({ diameterMm: width, depthMm: 1, center: opening.center });
        expect(fingerHoleSchema.parse(dragged)).toEqual(dragged);
        expect(clampFingerHoleToBin(dragged, spec)).toBe(dragged);
      }
    }
  });

  it("accepts the largest supported round opening and rejects invalid diameters", () => {
    expect(fingerHoleSchema.parse({ ...opening, diameterMm: 671.5 }).diameterMm).toBe(671.5);
    for (const diameterMm of [5.9, 672, Infinity, NaN]) {
      expect(fingerHoleSchema.safeParse({ ...opening, diameterMm }).success).toBe(false);
    }
  });

  it.each(["oblong-deep-scoop", "flat-ended-scoop", "oblong-straight", "flat-ended-straight"] as const)(
    "retains the schema width ceiling for %s slots", (kind) => {
      expect(fingerHoleSchema.safeParse({ ...opening, kind, diameterMm: 80 }).success).toBe(true);
      expect(fingerHoleSchema.safeParse({ ...opening, kind, diameterMm: 81 }).success).toBe(false);
    },
  );

  it("rotates slot length and width limits with a rectangular bin", () => {
    const slot = { ...opening, kind: "flat-ended-straight" as const, lengthMm: 30 };
    expect(fingerHoleSizeLimits(slot, small)).toMatchObject({ lengthMm: 43.57, diameterMm: 80 });
    expect(fingerHoleSizeLimits({ ...slot, rotationDeg: 90 }, small)).toMatchObject({ lengthMm: 87.67, diameterMm: 43.57 });
    const diagonal = fingerHoleSizeLimits({ ...slot, rotationDeg: 45 }, small);
    expect(diagonal.lengthMm).toBeLessThan(43.63);
    expect(diagonal.diameterMm).toBeLessThan(31.63);
  });

  it("lets length follow a larger bin while retaining width and depth ceilings", () => {
    const large = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 20 });
    expect(fingerHoleSizeLimits({ ...opening, kind: "oblong-straight", lengthMm: 40 }, large))
      .toEqual({ depthMm: 120, diameterMm: 80, lengthMm: 175.87 });
  });

  it.each(["straight", "scoop", "deep-scoop", "oblong-straight", "flat-ended-straight", "oblong-deep-scoop", "flat-ended-scoop"] as const)(
    "bounds %s across pitches, rotations, shallow bins and oversize requests", (kind) => {
      for (const gridPitch of ["full", "half", "quarter"] as const) {
        const spec = parseBinSpec({ gridX: 1, gridY: 2, gridPitch, heightUnits: 1 });
        for (const rotationDeg of [0, 37, 90, 135]) {
          for (const lengthMm of [6, 40, 160, 193, 900]) {
            const original = { ...opening, kind, diameterMm: 80, depthMm: 120, lengthMm, rotationDeg, topFilletMm: 1 };
            const bounded = clampFingerHoleToBin(original, spec);
            expect(fingerHoleSchema.safeParse(bounded).success).toBe(true);
            expect(clampFingerHoleToBin(bounded, spec)).toEqual(bounded);
            expect(bounded.center).toEqual(original.center);
            expect(bounded.rotationDeg).toBe(rotationDeg);
            expect(bounded.topFilletMm).toBe(1);
            expect(effectiveFingerHoleDepthMm(bounded)).toBeLessThanOrEqual(5.8);
            const ring = fingerHoleFootprintRing(bounded, { position: { x: 0, y: 0 }, rotationDeg: 0, mirrored: false }, 128);
            const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
            expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(binFootprintMm(1, gridPitch) * 1.05 + 1e-6);
            expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(binFootprintMm(2, gridPitch) * 1.05 + 1e-6);
          }
        }
      }
    },
  );

  it.each(["oblong-deep-scoop", "flat-ended-scoop", "oblong-straight", "flat-ended-straight"] as const)(
    "supports long %s slots across pitches, rotation, endpoint and width edits", (kind) => {
      for (const gridPitch of ["full", "half", "quarter"] as const) {
        const cells = { full: 5, half: 10, quarter: 20 }[gridPitch];
        const spec = parseBinSpec({ gridX: cells, gridY: cells, gridPitch, heightUnits: 3 });
        for (const rotationDeg of [0, 37, 90]) {
          const hole = fingerHoleSchema.parse({ ...opening, kind, center: { x: 0, y: 0 },
            diameterMm: 23, lengthMm: 193, depthMm: 10, rotationDeg });
          expect(clampFingerHoleToBin(hole, spec)).toBe(hole);
          expect(fingerHoleSizeLimits(hole, spec).lengthMm).toBeGreaterThan(193);
          expect(elongatedFingerHoleEndpoints(hole).lengthMm).toBe(193);
          const before = elongatedFingerHoleEndpoints(hole);
          const angle = rotationDeg * Math.PI / 180;
          const resized = resizeElongatedFingerHoleFromEndpoint(hole, "end", {
            x: before.end.x + 7 * Math.cos(angle), y: before.end.y + 7 * Math.sin(angle),
          }, spec);
          expect(resized.lengthMm).toBeCloseTo(200, 8);
          const after = elongatedFingerHoleEndpoints(resized);
          expect(after.start.x).toBeCloseTo(before.start.x, 8);
          expect(after.start.y).toBeCloseTo(before.start.y, 8);
          const widened = resizeFingerHoleFromWidthHandle(hole, {
            x: -15 * Math.sin(angle), y: 15 * Math.cos(angle),
          }, spec);
          expect(widened.diameterMm).toBeCloseTo(30, 8);
          expect(widened.lengthMm).toBeCloseTo(hasFlatFingerHoleEnds(hole) ? 193 : 200, 8);
          const wideEnds = elongatedFingerHoleEndpoints(widened);
          for (const end of ["start", "end"] as const) {
            expect(wideEnds[end].x).toBeCloseTo(before[end].x, 8);
            expect(wideEnds[end].y).toBeCloseTo(before[end].y, 8);
          }
        }
      }
    },
  );

  it("allows diagonal slots across the largest supported bin and rejects invalid lengths", () => {
    for (const gridPitch of ["full", "half", "quarter"] as const) {
      const cells = maxGridCells(gridPitch);
      const spec = parseBinSpec({ gridX: cells, gridY: cells, gridPitch, heightUnits: 3 });
      const hole = fingerHoleSchema.parse({ ...opening, kind: "flat-ended-straight", lengthMm: 900, rotationDeg: 45 });
      expect(clampFingerHoleToBin(hole, spec)).toBe(hole);
      const limit = fingerHoleSizeLimits(hole, spec).lengthMm;
      // A rotated rectangle projects (length + width) / sqrt(2) onto each axis.
      const expected = Math.floor((binFootprintMm(cells, gridPitch) * 1.05 * Math.SQRT2 - hole.diameterMm) * 100) / 100;
      expect(limit).toBe(expected);
      expect(fingerHoleSchema.safeParse({ ...hole, lengthMm: limit }).success).toBe(true);
    }
    for (const lengthMm of [5.9, 1000, Infinity, NaN]) {
      expect(fingerHoleSchema.safeParse({ ...opening, lengthMm }).success).toBe(false);
    }
  });

  it("preserves dormant slot length and legacy depth when no change is needed", () => {
    const hole = { ...opening, kind: "scoop" as const, depthMm: 30, lengthMm: 160, slotEnds: "flat" as const };
    expect(clampFingerHoleToBin(hole, small)).toBe(hole);
  });

  it.each(["oblong-straight", "flat-ended-straight"] as const)("keeps the fixed endpoint when %s dragging reaches the limit", (kind) => {
    const hole = { ...opening, kind, lengthMm: 30, rotationDeg: 0 };
    const before = elongatedFingerHoleEndpoints(hole);
    const result = resizeElongatedFingerHoleFromEndpoint(hole, "end", { x: 300, y: 180 }, small);
    const after = elongatedFingerHoleEndpoints(result);
    expect(after.start.x).toBeCloseTo(before.start.x, 8);
    expect(after.start.y).toBeCloseTo(before.start.y, 8);
    expect(clampFingerHoleToBin(result, small)).toEqual(result);
    expect(result.lengthMm).toBeLessThan(60);
  });

  it.each(["oblong-straight", "flat-ended-straight"] as const)("keeps both ends fixed when widening %s to the bin limit", (kind) => {
    const hole = { ...opening, kind, diameterMm: 10, lengthMm: 30, rotationDeg: 90 };
    const before = elongatedFingerHoleEndpoints(hole);
    const result = resizeFingerHoleFromWidthHandle(hole, { x: 200, y: -3 }, small);
    expect(result.diameterMm).toBe(43.57);
    expect(elongatedFingerHoleEndpoints(result).start.x).toBeCloseTo(before.start.x, 8);
    expect(elongatedFingerHoleEndpoints(result).start.y).toBeCloseTo(before.start.y, 8);
    expect(elongatedFingerHoleEndpoints(result).end.x).toBeCloseTo(before.end.x, 8);
    expect(elongatedFingerHoleEndpoints(result).end.y).toBeCloseTo(before.end.y, 8);
    expect(clampFingerHoleToBin(result, small)).toEqual(result);
  });
});
