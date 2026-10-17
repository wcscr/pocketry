import { expect, it } from "vitest";
import { signedArea } from "@shared/geometry/rings";
import type { Shape } from "@shared/geometry/types";
import { withKernel } from "@/lib/manifold/runtime";
import { normalizeTracedShape } from "@/lib/gridfinity/traced-shape";
import { changeContourRole } from "./contour-role";
import { rectRing } from "./fixtures";
import { normalizeOutline, pointInOutline } from "./outline";
import { toCrossSection } from "./offset";

const rect = (x: number, y: number, w: number, h: number): Shape => ({ outer: rectRing(x, y, w, h), holes: [] });

it("turns an inner pocket into retained material through calibrated solid export", async () => {
  await withKernel(kernel => {
    const outline = [rect(0, 0, 100, 80), rect(30, 20, 20, 20)];
    const result = changeContourRole(kernel, outline, { shapeIndex: 1, ringIndex: -1 }, "hole");
    expect(result).toHaveLength(1);
    expect(result[0].holes).toHaveLength(1);
    expect(signedArea(result[0].outer)).toBeGreaterThan(0);
    expect(signedArea(result[0].holes[0])).toBeLessThan(0);
    expect(pointInOutline(result, { x: 40, y: 30 })).toBe(false);
    const shape = normalizeTracedShape(result, { mmPerPx: 0.5, imageHeight: 100 }, "tool")!;
    const section = toCrossSection(kernel, shape.outlineMm);
    const cutter = kernel.arena.track(section.extrude(10));
    expect(cutter.volume()).toBeCloseTo((100 * 80 - 20 * 20) * 0.5 ** 2 * 10, 5);
    const restored = changeContourRole(kernel, result, { shapeIndex: 0, ringIndex: 0 }, "pocket");
    expect(restored).toHaveLength(2);
    expect(pointInOutline(restored, { x: 40, y: 30 })).toBe(true);
    expect(outline[0].holes).toHaveLength(0);
  });
});

it("excludes a hole from every overlapping pocket while preserving unrelated holes and objects", async () => {
  await withKernel(kernel => {
    const outline = normalizeOutline([
      { ...rect(0, 0, 100, 80), holes: [rectRing(5, 5, 10, 10)] },
      rect(20, 0, 90, 80), rect(35, 20, 20, 20), rect(200, 0, 10, 10),
    ]);
    const result = changeContourRole(kernel, outline, { shapeIndex: 2, ringIndex: -1 }, "hole");
    expect(result).toHaveLength(3);
    expect(result[0].holes).toHaveLength(2);
    expect(result[1].holes).toHaveLength(1);
    expect(pointInOutline(result, { x: 45, y: 30 })).toBe(false);
    expect(pointInOutline(result, { x: 10, y: 10 })).toBe(false);
    expect(pointInOutline(result, { x: 205, y: 5 })).toBe(true);
  });
});

it("clips a crossing exclusion into a notch rather than emitting an invalid hole", async () => {
  await withKernel(kernel => {
    const result = changeContourRole(kernel, [rect(0, 0, 100, 80), rect(80, 20, 40, 20)], { shapeIndex: 1, ringIndex: -1 }, "hole");
    expect(result).toHaveLength(1);
    expect(result[0].holes).toHaveLength(0);
    expect(pointInOutline(result, { x: 90, y: 30 })).toBe(false);
    expect(toCrossSection(kernel, result).area()).toBeCloseTo(7600, 5);
  });
});

it("rejects detached or all-covering holes without silently deleting contours", async () => {
  await withKernel(kernel => {
    expect(() => changeContourRole(kernel, [rect(0, 0, 10, 10), rect(20, 20, 10, 10)], { shapeIndex: 1, ringIndex: -1 }, "hole")).toThrow("must overlap");
    expect(() => changeContourRole(kernel, [rect(0, 0, 10, 10), rect(-10, -10, 30, 30)], { shapeIndex: 1, ringIndex: -1 }, "hole")).toThrow("every pocket");
  });
});
