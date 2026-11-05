import { describe, expect, it } from "vitest";
import { binWidthMm } from "@shared/gridfinity/bin-size";
import { labelTabSurfaces, pointOnLabelTab } from "@shared/gridfinity/label-tab-surfaces";
import { D_WALL, STACKING_LIP_DEPTH } from "@shared/gridfinity/standard";
import { ringBounds } from "@shared/geometry/rings";
import { outlineBounds } from "@/lib/geometry/outline";
import { surfaceTextOutline } from "./surface-text";
import { fillLabelTabs, NEW_LABEL, TAB_SCOPES, TAB_WALLS, tabBin } from "./label-tab-lip.test-support";

const cases = TAB_WALLS.flatMap(wall => TAB_SCOPES.map(scope => [wall, scope] as const));

describe("new label-tab text beside a stacking lip", () => {
  it.each(cases)("clears the lip's overhang on every %s %s shelf by the edge margin", (wall, scope) => {
    const spec = fillLabelTabs(tabBin("standard", wall, scope));
    const surfaces = labelTabSurfaces(spec);
    const limit = binWidthMm(spec) / 2 - STACKING_LIP_DEPTH - 1 + 1e-6;
    spec.surfaceTexts.forEach((label, i) => {
      expect(label.surface).toBe("label-tab");
      expect(pointOnLabelTab(label.position, surfaces[i])).toBe(true);
      const bounds = outlineBounds(surfaceTextOutline(label))!;
      expect(Math.max(-bounds.minX, -bounds.minY, bounds.maxX, bounds.maxY), label.id).toBeLessThanOrEqual(limit);
    });
  });

  it.each(cases)("places %s %s text exactly as before on unlipped bins", (wall, scope) => {
    const spec = fillLabelTabs(tabBin("none", wall, scope));
    const surfaces = labelTabSurfaces(spec);
    spec.surfaceTexts.forEach((label, i) => {
      const shelf = ringBounds(surfaces[i].ring)!;
      expect(label.position.x).toBeCloseTo((shelf.minX + shelf.maxX) / 2, 9);
      expect(label.position.y).toBeCloseTo((shelf.minY + shelf.maxY) / 2, 9);
      expect(label.sizeMm).toBe(NEW_LABEL.sizeMm);
      const bounds = outlineBounds(surfaceTextOutline(label))!;
      expect(Math.max(-bounds.minX, -bounds.minY, bounds.maxX, bounds.maxY)).toBeLessThanOrEqual(binWidthMm(spec) / 2 - D_WALL - 1 + 1e-6);
    });
  });

  it.each(TAB_WALLS)("moves only outer %s shelves' text away from the lip, shrinking it only when the shelf is too short", wall => {
    const lipped = fillLabelTabs(tabBin("standard", wall, "compartments")).surfaceTexts;
    const plain = fillLabelTabs(tabBin("none", wall, "compartments")).surfaceTexts;
    const across = wall === "north" || wall === "south" ? "x" : "y";
    let moved = 0;
    lipped.forEach((label, i) => {
      const before = plain[i].position[across], after = label.position[across];
      // Inner shelves stay centred; outer shelves step toward the middle.
      expect(Math.abs(after)).toBeLessThanOrEqual(Math.abs(before) + 1e-9);
      if (Math.abs(after - before) > 1e-6) {
        moved++;
        expect(Math.abs(before - after)).toBeCloseTo((STACKING_LIP_DEPTH - D_WALL) / 2, 2);
      }
    });
    expect(moved).toBe(4);
    // A shelf shortened by the lip may shrink its text; nothing grows.
    lipped.forEach((label, i) => expect(label.sizeMm).toBeLessThanOrEqual(plain[i].sizeMm));
  });

  it("shrinks oversized text to the space left beside the lip", () => {
    for (const wall of TAB_WALLS) {
      const spec = fillLabelTabs(tabBin("standard", wall, "compartments"), { sizeMm: 20 });
      const plain = fillLabelTabs(tabBin("none", wall, "compartments"), { sizeMm: 20 });
      spec.surfaceTexts.forEach((label, i) => expect(label.sizeMm).toBeLessThanOrEqual(plain.surfaceTexts[i].sizeMm + 1e-9));
      expect(spec.surfaceTexts.some((label, i) => label.sizeMm < plain.surfaceTexts[i].sizeMm - 0.1)).toBe(true);
    }
  });
});
