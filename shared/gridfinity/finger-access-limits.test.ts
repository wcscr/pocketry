import { describe, expect, it } from "vitest";
import {
  clampFingerHoleToBin, effectiveFingerHoleDepthMm, elongatedFingerHoleEndpoints,
  fingerHoleFootprintRing, fingerHoleSchema, fingerHoleSizeLimits,
  resizeElongatedFingerHoleFromEndpoint, resizeFingerHoleFromWidthHandle,
} from "./cutout";
import { binFootprintMm } from "./standard";
import { parseBinSpec } from "./types";

const small = parseBinSpec({ gridX: 1, gridY: 2, heightUnits: 2 });
const opening = fingerHoleSchema.parse({ id: "access", center: { x: 4, y: -3 }, kind: "straight", diameterMm: 18, depthMm: 12 });

describe("bin-aware finger access limits", () => {
  it("stops at the underside while retaining a 5% mouth-size allowance", () => {
    expect(fingerHoleSizeLimits(opening, small)).toMatchObject({ depthMm: 12.8, diameterMm: 43.57 });
    expect(fingerHoleSizeLimits(opening, { ...small, lip: "none" }).depthMm).toBe(14);
    expect(fingerHoleSizeLimits(opening, { ...small, heightUnits: 1 }).depthMm).toBe(5.8);
  });

  it("rotates slot length and width limits with a rectangular bin", () => {
    const slot = { ...opening, kind: "flat-ended-straight" as const, lengthMm: 30 };
    expect(fingerHoleSizeLimits(slot, small)).toMatchObject({ lengthMm: 43.57, diameterMm: 80 });
    expect(fingerHoleSizeLimits({ ...slot, rotationDeg: 90 }, small)).toMatchObject({ lengthMm: 87.67, diameterMm: 43.57 });
    const diagonal = fingerHoleSizeLimits({ ...slot, rotationDeg: 45 }, small);
    expect(diagonal.lengthMm).toBeLessThan(43.63);
    expect(diagonal.diameterMm).toBeLessThan(31.63);
  });

  it("retains schema ceilings when the bin is larger", () => {
    const large = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 20 });
    expect(fingerHoleSizeLimits({ ...opening, kind: "oblong-straight", lengthMm: 40 }, large))
      .toEqual({ depthMm: 120, diameterMm: 80, lengthMm: 160 });
  });

  it.each(["straight", "scoop", "deep-scoop", "oblong-straight", "flat-ended-straight", "oblong-deep-scoop", "flat-ended-scoop"] as const)(
    "bounds %s across pitches, rotations, shallow bins and oversize requests", (kind) => {
      for (const gridPitch of ["full", "half", "quarter"] as const) {
        const spec = parseBinSpec({ gridX: 1, gridY: 2, gridPitch, heightUnits: 1 });
        for (const rotationDeg of [0, 37, 90, 135]) {
          for (const lengthMm of [6, 40, 160]) {
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
