import { describe, expect, it } from "vitest";
import { defaultLabelTabWall, labelTabProfileMm, labelTabRecessMm, labelTabFrontRimWidthMm, labelTabProfileWithFrontRim } from "./label-tab";
import { compartmentLayout } from "./compartments";
import { parseBinSpec } from "./types";
import { labelTabTopZ, labelTabSurfaces, moveTextsWithLabelTabRecess } from "./label-tab-surfaces";
import { validateBinSpec } from "./validate";
import { ringBounds } from "../geometry/rings";
import { surfaceTextSchema } from "./surface-text";

describe("label tab defaults", () => {
  it("reserves the rim width without changing the support profile or older shelves", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "none", wallThicknessMm: 1.6,
      labelTab: { wall: "north", recessMm: 0.5 } });
    const profile = labelTabProfileMm(spec)!;
    expect(labelTabProfileWithFrontRim(spec, profile)).toEqual(profile.points);
    const rimmed = parseBinSpec({ ...spec, labelTab: { ...spec.labelTab, frontRim: true } });
    expect(labelTabFrontRimWidthMm(rimmed, profile.depthMm)).toBe(1.6);
    expect(labelTabProfileWithFrontRim(rimmed, profile).slice(5)).toEqual(profile.points.slice(3));
    const before = ringBounds(labelTabSurfaces(spec)[0].ring)!, after = ringBounds(labelTabSurfaces(rimmed)[0].ring)!;
    expect(after.minY - before.minY).toBeCloseTo(1.6);
    expect(after.maxY).toBe(before.maxY);
    const flush = parseBinSpec({ ...rimmed, labelTab: { ...rimmed.labelTab, recessMm: 0 } });
    expect(labelTabFrontRimWidthMm(flush, profile.depthMm)).toBe(0);
    expect(labelTabSurfaces(parseBinSpec({ ...rimmed, heightUnits: 2, labelTab: { ...rimmed.labelTab, recessMm: 5.7 } }))).toEqual([]);
  });
  it.each(["outer", "compartments"] as const)("recesses %s shelves from their mounting top", scope => {
    for (const lip of ["none", "standard"] as const) {
      const original = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip, labelTab: { scope } });
      expect(labelTabRecessMm(original)).toBe(0);
      for (const recessMm of [0, 0.4, 1.2, 10]) {
        const next = parseBinSpec({ ...original, labelTab: { ...original.labelTab, recessMm } });
        expect(labelTabTopZ(next)).toBeCloseTo(labelTabTopZ(original) - recessMm);
        expect(validateBinSpec(next).ok).toBe(true);
      }
    }
  });

  it("reduces a shallow recessed profile above the base and rejects floor-level shelves", () => {
    const bin = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 2, fill: "none", lip: "none", labelTab: { recessMm: 0.4 } });
    expect(labelTabProfileMm(bin)!.heightMm).toBeCloseTo(6.6);
    expect(validateBinSpec(bin).issues.map(i => i.code)).toContain("label-tab-clipped");
    const tooLow = parseBinSpec({ ...bin, labelTab: { recessMm: 6 } });
    expect(labelTabProfileMm(tooLow)).toBeNull();
    expect(validateBinSpec(tooLow).issues).toContainEqual(expect.objectContaining({ code: "label-tab-recess", severity: "error" }));
    for (const recessMm of [-0.1, 10.1, Infinity, NaN]) {
      expect(() => parseBinSpec({ ...bin, labelTab: { recessMm } })).toThrow();
    }
  });

  it.each(["both", "positive", "negative"] as const)("keeps labels on their %s-wall shelves during recess edits", side => {
    const previous = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "none",
      wallSlant: { axis: "y", angleDeg: 30, side }, compartments: { rows: 2, columns: 3 },
      labelTab: { wall: "south", scope: "compartments", recessMm: 0 } });
    const surfaces = labelTabSurfaces(previous);
    previous.surfaceTexts = surfaces.map((surface, i) => {
      const b = ringBounds(surface.ring)!;
      return surfaceTextSchema.parse({ id: String(i), text: "M2x8", sizeMm: 3.2, rotationDeg: 180, surface: "label-tab",
        position: { x: (b.minX + b.maxX) / 2 + 0.3, y: (b.minY + b.maxY) / 2 - 0.2 } });
    });
    const next = parseBinSpec({ ...previous, labelTab: { ...previous.labelTab, recessMm: 0.4 } });
    next.surfaceTexts = moveTextsWithLabelTabRecess(previous, next);
    labelTabSurfaces(next).forEach((surface, i) => {
      const b = ringBounds(surface.ring)!, label = next.surfaceTexts[i];
      expect(label.position.x).toBeCloseTo((b.minX + b.maxX) / 2 + 0.3);
      expect(label.position.y).toBeCloseTo((b.minY + b.maxY) / 2 - 0.2);
      expect({ ...label, position: previous.surfaceTexts[i].position }).toEqual(previous.surfaceTexts[i]);
    });
    moveTextsWithLabelTabRecess(next, { ...previous, surfaceTexts: next.surfaceTexts }).forEach((label, i) => {
      expect(label.position.x).toBeCloseTo(previous.surfaceTexts[i].position.x);
      expect(label.position.y).toBeCloseTo(previous.surfaceTexts[i].position.y);
    });
  });
  it.each([
    ["x", 20, "west", "right"], ["x", -20, "east", "left"],
    ["y", 20, "south", "back"], ["y", -20, "north", "front"],
  ] as const)("places tabs opposite scoops for %s/%s", (axis, angleDeg, wall, scoopWall) => {
    for (const side of ["both", "negative", "positive"] as const) {
      const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "none", wallSlant: { axis, angleDeg, side } });
      expect(defaultLabelTabWall(spec)).toBe(wall);
      expect(compartmentLayout(spec).scoopWall).toBe(scoopWall);
    }
  });
  it("uses the back for upright walls", () => {
    expect(defaultLabelTabWall({ wallSlant: null })).toBe("north");
    expect(defaultLabelTabWall({ wallSlant: { axis: "x", angleDeg: 0 } })).toBe("north");
  });
});
