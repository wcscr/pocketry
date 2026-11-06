import { describe, expect, it } from "vitest";
import { defaultLabelTabWall, labelTabProfileMm, labelTabRecessMm, labelTabFrontRimWidthMm, labelTabProfileWithFrontRim,
  labelTabDepthMm, labelTabWidthMm } from "./label-tab";
import { compartmentLayout, compartmentLabelTabPlacements } from "./compartments";
import { parseBinSpec } from "./types";
import { labelTabTopZ, labelTabSurfaces, moveTextsWithLabelTabs, pointOnLabelTab, textsAfterLabelTabEdit } from "./label-tab-surfaces";
import { validateBinSpec, labelTabStripMm } from "./validate";
import { ringBounds } from "../geometry/rings";
import { surfaceTextSchema } from "./surface-text";
import { TAB_DEPTH_MM, TAB_WIDTH_NOMINAL_MM, TAB_SUPPORT_HEIGHT_MM, TAB_SUPPORT_ANGLE_DEG } from "./standard";
import { labelledTabGrid } from "./label-tab.test-support";

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
    expect(moveTextsWithLabelTabs(before, after)).toBe(after.surfaceTexts);
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
    next.surfaceTexts = moveTextsWithLabelTabs(previous, next);
    labelTabSurfaces(next).forEach((surface, i) => {
      const b = ringBounds(surface.ring)!, label = next.surfaceTexts[i];
      expect(label.position.x).toBeCloseTo((b.minX + b.maxX) / 2 + 0.3);
      expect(label.position.y).toBeCloseTo((b.minY + b.maxY) / 2 - 0.2);
      expect({ ...label, position: previous.surfaceTexts[i].position }).toEqual(previous.surfaceTexts[i]);
    });
    moveTextsWithLabelTabs(next, { ...previous, surfaceTexts: next.surfaceTexts }).forEach((label, i) => {
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

describe("labels follow their sub-bin when the grid changes", () => {
  const grid = (rows: number, columns: number, base = slanted) => parseBinSpec({ ...base, compartments: { ...base.compartments, rows, columns } });
  const slanted = parseBinSpec({ gridPitch: "half", gridX: 4, gridY: 4, heightUnits: 5.5, fill: "none", lip: "none",
    wallSlant: { axis: "y", angleDeg: 30 }, compartments: { rows: 2, columns: 3 },
    labelTab: { wall: "south", scope: "compartments", recessMm: 0.5, frontRim: true } });
  /** One label per shelf, nudged off-centre so the preserved offset is visible. */
  const labelled = (spec: typeof slanted) => ({ ...spec, surfaceTexts: labelTabSurfaces(spec).map(surface => {
    const b = ringBounds(surface.ring)!;
    return surfaceTextSchema.parse({ id: surface.key, text: "M2x8", sizeMm: 3.2, rotationDeg: 180, surface: "label-tab",
      position: { x: (b.minX + b.maxX) / 2 + 0.4, y: (b.minY + b.maxY) / 2 - 0.1 } });
  }) });
  const shelfOf = (spec: typeof slanted, id: string) => {
    const label = spec.surfaceTexts.find(item => item.id === id)!;
    return labelTabSurfaces(spec).find(surface => pointOnLabelTab(label.position, surface))?.key;
  };

  it("keys sub-bin shelves by row and column, front row and left column first", () => {
    expect(labelTabSurfaces(slanted).map(surface => surface.key)).toEqual(["r0c0", "r0c1", "r0c2", "r1c0", "r1c1", "r1c2"]);
    expect(labelTabSurfaces(parseBinSpec({ ...slanted, compartments: { ...slanted.compartments, enabled: false },
      labelTab: { ...slanted.labelTab, scope: "outer" } })).map(surface => surface.key)).toEqual(["outer"]);
  });

  it.each([[2, 4], [3, 3], [2, 2], [1, 3], [3, 4]])("keeps every surviving label on its own shelf at %i × %i", (rows, columns) => {
    const before = labelled(slanted);
    const after = { ...grid(rows, columns), surfaceTexts: before.surfaceTexts };
    after.surfaceTexts = moveTextsWithLabelTabs(before, after);
    for (const label of before.surfaceTexts) {
      const [row, column] = label.id.slice(1).split("c").map(Number);
      const moved = after.surfaceTexts.find(item => item.id === label.id)!;
      const { orphanedTab, ...design } = moved;
      expect({ ...design, position: label.position }).toEqual(label);
      if (row < rows && column < columns) {
        expect(orphanedTab).toBeUndefined();
        expect(shelfOf(after, label.id)).toBe(label.id);
        const b = ringBounds(labelTabSurfaces(after).find(surface => surface.key === label.id)!.ring)!;
        expect(moved.position.x).toBeCloseTo((b.minX + b.maxX) / 2 + 0.4);
        expect(moved.position.y).toBeCloseTo((b.minY + b.maxY) / 2 - 0.1);
      } else {
        // Its sub-bin is gone: the label stays put and the build reports it.
        expect(moved.position).toEqual(label.position);
        expect(orphanedTab?.key).toBe(label.id);
      }
    }
  });

  it.each(["none", "standard"] as const)("remembers removed rows and columns across committed edits with %s lip", lip => {
    for (const [rows, columns, nextRows, nextColumns] of [[1, 3, 1, 2], [3, 1, 2, 1]]) {
      const before = labelledTabGrid(rows, columns, lip);
      let after = parseBinSpec({ ...before, compartments: { ...before.compartments, rows: nextRows, columns: nextColumns } });
      after.surfaceTexts = textsAfterLabelTabEdit(before, before, after);
      expect(after.surfaceTexts[0].position).toEqual(before.surfaceTexts[0].position);
      expect(after.surfaceTexts[0].orphanedTab?.key).toBe(`r${rows - 1}c${columns - 1}`);
      // Other committed edits must not infer ownership from the unchanged coordinates.
      const resized = parseBinSpec({ ...after, gridX: 3, gridY: 3 });
      resized.surfaceTexts = textsAfterLabelTabEdit(after, after, resized);
      expect(resized.surfaceTexts).toEqual(after.surfaceTexts);
      const restored = parseBinSpec({ ...resized, gridX: before.gridX, gridY: before.gridY, compartments: before.compartments });
      restored.surfaceTexts = textsAfterLabelTabEdit(resized, resized, restored);
      expect(restored.surfaceTexts[0].orphanedTab).toBeUndefined();
      expect(restored.surfaceTexts[0].position.x).toBeCloseTo(before.surfaceTexts[0].position.x, 9);
      expect(restored.surfaceTexts[0].position.y).toBeCloseTo(before.surfaceTexts[0].position.y, 9);
    }
  });

  it("restores the original layout when a typed grid edit passes through other sizes", () => {
    const committed = labelled(slanted);
    let current = committed;
    for (const columns of [1, 12, 4, 3]) {
      const next = grid(2, columns, { ...current, surfaceTexts: current.surfaceTexts });
      current = { ...next, surfaceTexts: textsAfterLabelTabEdit(committed, current, next) };
    }
    current.surfaceTexts.forEach((label, i) => {
      expect(label.position.x).toBeCloseTo(committed.surfaceTexts[i].position.x, 9);
      expect(label.position.y).toBeCloseTo(committed.surfaceTexts[i].position.y, 9);
    });
    const unchanged = { ...committed };
    expect(textsAfterLabelTabEdit(committed, committed, unchanged)).toBe(unchanged.surfaceTexts);
  });

  it("does not undo a label edit that is still in progress", () => {
    const committed = labelled(slanted);
    const dragged = { ...committed, surfaceTexts: committed.surfaceTexts.map((label, i) => i ? label
      : { ...label, position: { x: label.position.x + 1, y: label.position.y } }) };
    const next = { ...grid(2, 4, dragged), surfaceTexts: dragged.surfaceTexts };
    const texts = textsAfterLabelTabEdit(committed, dragged, next);
    const b = ringBounds(labelTabSurfaces(next).find(surface => surface.key === "r0c0")!.ring)!;
    expect(texts[0].position.x).toBeCloseTo((b.minX + b.maxX) / 2 + 1.4);
  });

  it("keeps parse-time retargeting while moving labels", () => {
    const committed = labelled(slanted);
    const next = { ...grid(2, 4), surfaceTexts: committed.surfaceTexts.map(label => ({ ...label, name: "renamed" })) };
    expect(textsAfterLabelTabEdit(committed, committed, next).every(label => label.name === "renamed")).toBe(true);
  });
});

describe("tab size edits keep text in place", () => {
  it("does not move labels when only the tab depth, width style or front rim changes", () => {
    const committed = parseBinSpec({ gridPitch: "half", gridX: 4, gridY: 4, heightUnits: 5.5, fill: "none", lip: "none",
      compartments: { rows: 2, columns: 3 }, labelTab: { wall: "south", scope: "compartments", recessMm: 0.5, frontRim: true } });
    committed.surfaceTexts = labelTabSurfaces(committed).map(surface => {
      const b = ringBounds(surface.ring)!;
      return surfaceTextSchema.parse({ id: surface.key, text: "M3", sizeMm: 3, surface: "label-tab",
        position: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } });
    });
    for (const labelTab of [{ depthMm: 8 }, { width: "left" as const, widthMm: 15 }, { frontRim: false }]) {
      const next = parseBinSpec({ ...committed, labelTab: { ...committed.labelTab, ...labelTab } });
      expect(textsAfterLabelTabEdit(committed, committed, next)).toBe(next.surfaceTexts);
    }
    // A combined grid edit still moves labels with their sub-bin, ignoring the size change.
    const both = parseBinSpec({ ...committed, compartments: { ...committed.compartments, columns: 4 }, labelTab: { ...committed.labelTab, depthMm: 8 } });
    const moved = textsAfterLabelTabEdit(committed, committed, both);
    expect(moved[0].position.x).not.toBeCloseTo(committed.surfaceTexts[0].position.x);
    const cols4 = parseBinSpec({ ...committed, compartments: { ...committed.compartments, columns: 4 } });
    expect(moved[0].position.x).toBeCloseTo(textsAfterLabelTabEdit(committed, committed, cols4)[0].position.x);
  });
});
