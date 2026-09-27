import { describe, expect, it } from "vitest";
import { photoPerspectiveLayout } from "./photo-perspective-layout";
import { perspectiveLayout, type PerspectiveQuad } from "./perspective";

const points: PerspectiveQuad = [{ x: 50, y: 80 }, { x: 260, y: 80 }, { x: 260, y: 377 }, { x: 50, y: 377 }];
const paper = perspectiveLayout({ source: "manual", points }, "a4");
const max = { width: 1200, height: 1200 };

function project(h: number[], x: number, y: number) {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

describe("full photo perspective bounds", () => {
  it("keeps pixels on every side of the paper and preserves physical distances when bounded", () => {
    const result = photoPerspectiveLayout([4, 0, -200, 0, 4, -320, 0, 0, 1], { width: 801, height: 601 }, paper, max);
    expect(result.layout.width).toBe(1200);
    expect(result.layout.height).toBeLessThanOrEqual(1200);
    expect(project(result.transform, 0, 0)).toEqual({ x: 0, y: 0 });
    const last = project(result.transform, 800, 600);
    expect(last.x).toBeCloseTo(1199, 9);
    expect(last.y).toBeLessThan(result.layout.height);
    const start = project(result.transform, 10, 400);
    const end = project(result.transform, 510, 400);
    expect((end.x - start.x) / result.layout.pxPerMm).toBeCloseTo(500, 9);
    expect(result.layout.destination[0]).toEqual(project(result.transform, 50, 80));
  });

  it("keeps a photo already bounded by the paper at its existing resolution", () => {
    const result = photoPerspectiveLayout([2, 0, 0, 0, 2, 0, 0, 0, 1], { width: 421, height: 595 }, paper, max);
    expect(result.layout.width).toBe(841);
    expect(result.layout.height).toBe(1189);
    expect(result.layout.pxPerMm).toBe(4);
  });

  it("rejects a horizon crossing instead of cropping away unbounded photo content", () => {
    expect(() => photoPerspectiveLayout([1, 0, 0, 0, 1, 0, 0, -0.01, 1], { width: 300, height: 300 }, paper, max)).toThrow(/too tilted/);
  });

  it("rejects nonfinite transforms and degenerate bounds", () => {
    expect(() => photoPerspectiveLayout([NaN, 0, 0, 0, 1, 0, 0, 0, 1], { width: 300, height: 300 }, paper, max)).toThrow(/stable correction/);
    expect(() => photoPerspectiveLayout([0, 0, 0, 0, 1, 0, 0, 0, 1], { width: 300, height: 300 }, paper, max)).toThrow(/stable correction/);
  });
});
