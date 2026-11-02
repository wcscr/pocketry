import { describe, expect, it } from "vitest";
import { defaultLabelTabWall, labelTabProfileMm, labelTabRecessMm, labelTabFrontRimWidthMm, labelTabProfileWithFrontRim,
  labelTabDepthMm, labelTabWidthMm } from "./label-tab";
import { compartmentLayout, compartmentLabelTabPlacements } from "./compartments";
import { parseBinSpec } from "./types";
import { labelTabTopZ, labelTabSurfaces, moveTextsWithLabelTabRecess } from "./label-tab-surfaces";
import { validateBinSpec, labelTabStripMm } from "./validate";
import { ringBounds } from "../geometry/rings";
import { surfaceTextSchema } from "./surface-text";
import { TAB_DEPTH_MM, TAB_WIDTH_NOMINAL_MM, TAB_SUPPORT_HEIGHT_MM, TAB_SUPPORT_ANGLE_DEG } from "./standard";

describe("label tab sizing", () => {
  const bin = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "none",
    compartments: { rows: 2, columns: 3 }, labelTab: { width: "center", recessMm: 0.5, frontRim: true } });

  it("preserves omitted dimensions and explicit standard profiles exactly", () => {
    expect(bin.labelTab!.depthMm).toBeUndefined();
    expect(bin.labelTab!.widthMm).toBeUndefined();
    expect(labelTabDepthMm(bin)).toBe(TAB_DEPTH_MM);
    expect(labelTabWidthMm(bin)).toBe(TAB_WIDTH_NOMINAL_MM);
    for (const heightUnits of [1.5, 2, 6]) for (const recessMm of [0, 0.5]) {
      for (const wallSlant of [null, { axis: "y" as const, angleDeg: 30 }]) {
        const old = parseBinSpec({ ...bin, heightUnits, wallSlant, labelTab: { ...bin.labelTab, recessMm } });
        const explicit = parseBinSpec({ ...old, labelTab: { ...old.labelTab, depthMm: TAB_DEPTH_MM, widthMm: TAB_WIDTH_NOMINAL_MM } });
        expect(labelTabProfileMm(explicit)).toEqual(labelTabProfileMm(old));
        expect(labelTabSurfaces(explicit)).toEqual(labelTabSurfaces(old));
        expect(labelTabStripMm(explicit)).toEqual(labelTabStripMm(old));
      }
    }
  });

  it("keeps requested dimensions while respecting compartment and height limits", () => {
    const small = parseBinSpec({ ...bin, labelTab: { ...bin.labelTab, scope: "compartments", depthMm: 5, widthMm: 12 } });
    const tabs = compartmentLabelTabPlacements(small);
    expect(tabs).toHaveLength(6);
    for (const tab of tabs) {
      expect(tab.depth).toBe(5);
      expect(tab.length).toBe(12);
      expect((tab.profile.heightMm - TAB_SUPPORT_HEIGHT_MM) / tab.depth)
        .toBeCloseTo(Math.tan(TAB_SUPPORT_ANGLE_DEG * Math.PI / 180), 12);
    }
    const tight = parseBinSpec({ ...small, compartments: { rows: 8, columns: 8 },
      labelTab: { ...small.labelTab, depthMm: 10, widthMm: 20 } });
    const layout = compartmentLayout(tight);
    for (const tab of compartmentLabelTabPlacements(tight)) {
      expect(tab.length).toBeCloseTo(layout.cellWidth);
      expect(tab.depth).toBeCloseTo(layout.cellLength / 2);
    }
    expect(tight.labelTab).toMatchObject({ depthMm: 10, widthMm: 20 });
    const shallow = parseBinSpec({ ...small, heightUnits: 2 });
    expect(validateBinSpec(shallow).issues.map(i => i.code)).not.toContain("label-tab-clipped");
    const deep = parseBinSpec({ ...shallow, labelTab: { ...shallow.labelTab, depthMm: 15 } });
    expect(validateBinSpec(deep).issues.map(i => i.code)).toContain("label-tab-clipped");
    expect(labelTabProfileMm(deep)!.depthMm).toBeLessThan(15);
    expect(deep.labelTab!.depthMm).toBe(15);
  });

  it.each(["north", "east", "south", "west"] as const)("matches %s style bounds and retains a custom width in full-width mode", wall => {
    for (const width of ["center", "left", "right"] as const) {
      const small = parseBinSpec({ ...bin, labelTab: { wall, width, depthMm: 5, widthMm: 12 } });
      const bounds = ringBounds(labelTabSurfaces(small)[0].ring)!;
      expect(labelTabStripMm(small)).toEqual(bounds);
      const horizontal = wall === "north" || wall === "south";
      expect(horizontal ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY).toBeCloseTo(12);
      expect(horizontal ? bounds.maxY - bounds.minY : bounds.maxX - bounds.minX).toBeCloseTo(5);
      const full = parseBinSpec({ ...small, labelTab: { ...small.labelTab, width: "full" } });
      const standard = parseBinSpec({ ...full, labelTab: { ...full.labelTab, widthMm: undefined } });
      expect(full.labelTab!.widthMm).toBe(12);
      expect(labelTabSurfaces(full)).toEqual(labelTabSurfaces(standard));
    }
  });

  it("never resizes or moves authored lettering when shrinking a tab", () => {
    const label = surfaceTextSchema.parse({ id: "saved", text: "M1 4x6.5", symbol: "pan-screw", symbolSizeMm: 3.5,
      symbolRotationDeg: 45, sizeMm: 2, rotationDeg: -180, surface: "label-tab", position: { x: 5, y: 30 } });
    const before = parseBinSpec({ ...bin, wallThicknessMm: 1.6, wallSlant: { axis: "y", angleDeg: 30 }, surfaceTexts: [label] });
    const after = parseBinSpec({ ...before, labelTab: { ...before.labelTab, depthMm: 1, widthMm: 1 } });
    expect(after.surfaceTexts).toEqual(before.surfaceTexts);
    expect(moveTextsWithLabelTabRecess(before, after)).toBe(after.surfaceTexts);
    expect(labelTabSurfaces(after)).toEqual([]);
  });

  it("rejects non-finite and out-of-range requests without replacing defaults", () => {
    for (const field of ["depthMm", "widthMm"] as const) {
      const max = field === "depthMm" ? TAB_DEPTH_MM : TAB_WIDTH_NOMINAL_MM;
      for (const value of [0, 0.99, max + 0.01, Infinity, NaN]) {
        expect(() => parseBinSpec({ ...bin, labelTab: { ...bin.labelTab, [field]: value } })).toThrow();
      }
      expect(parseBinSpec({ ...bin, labelTab: { ...bin.labelTab, [field]: 1 } }).labelTab![field]).toBe(1);
    }
  });
});

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
