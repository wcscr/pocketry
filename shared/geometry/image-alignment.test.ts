import { describe, expect, it } from "vitest";
import { composeImageMatrices, inverseImageMatrix, rotateImageAlignment, transformImagePoint } from "./image-alignment";

describe("photo alignment", () => {
  it.each([-.7, Math.PI / 2, 2.4])("fits the original photo without clipping or resizing at %s radians", angle => {
    const { alignment } = rotateImageAlignment({ width: 800, height: 600 }, angle);
    for (const p of [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }]) {
      const q = transformImagePoint(p, alignment.matrix);
      expect(q.x).toBeGreaterThanOrEqual(-1e-9); expect(q.y).toBeGreaterThanOrEqual(-1e-9);
      expect(q.x).toBeLessThanOrEqual(alignment.size.width + 1e-9);
      expect(q.y).toBeLessThanOrEqual(alignment.size.height + 1e-9);
      const back = transformImagePoint(q, inverseImageMatrix(alignment.matrix));
      expect(back.x).toBeCloseTo(p.x, 8); expect(back.y).toBeCloseTo(p.y, 8);
    }
    const a = transformImagePoint({ x: 10, y: 15 }, alignment.matrix);
    const b = transformImagePoint({ x: 70, y: 95 }, alignment.matrix);
    expect(Math.hypot(b.x-a.x, b.y-a.y)).toBeCloseTo(100, 8);
  });

  it("composes repeated turns against the original pixels without growing the canvas", () => {
    const size = { width: 800, height: 600 };
    const first = rotateImageAlignment(size, .6);
    const second = rotateImageAlignment(first.alignment.size, -.6, first.alignment);
    expect(second.alignment.size).toEqual(size);
    const composed = composeImageMatrices(second.transform, first.transform);
    for (const [i, value] of composed.entries()) expect(value).toBeCloseTo(second.alignment.matrix[i], 8);
    expect(transformImagePoint({ x: 400, y: 300 }, second.alignment.matrix)).toEqual({ x: 400, y: 300 });
  });
});
