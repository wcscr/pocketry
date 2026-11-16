import { describe, expect, it } from "vitest";
import { parseBinSpec, type BinSpec } from "@shared/gridfinity/types";
import { labelTabSurfaces, pointOnLabelTab, textsAfterLabelTabEdit } from "@shared/gridfinity/label-tab-surfaces";
import { withKernel } from "@/lib/manifold/runtime";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY, type BuildQuality } from "./bin";
import { fillLabelTabs, TAB_SCOPES, TAB_WALLS, tabBin } from "./label-tab-lip.test-support";

/** Index of the shelf each label stands on, or -1. */
const shelvesOf = (spec: BinSpec) => {
  const surfaces = labelTabSurfaces(spec);
  return spec.surfaceTexts.map(label => surfaces.findIndex(surface => pointOnLabelTab(label.position, surface)));
};

/** Every label becomes its own part, with no build or validation complaint about text. */
async function expectAllLabelsBuild(spec: BinSpec, quality: BuildQuality = PREVIEW_QUALITY) {
  await withKernel(kernel => {
    const result = buildBinWithCutouts(kernel, spec, null, quality);
    expect(result.textParts.map(part => part.label.id)).toEqual(spec.surfaceTexts.map(label => label.id));
    expect(result.validationIssues.filter(issue => issue.code.startsWith("surface-text"))).toEqual([]);
  });
}

const cases = (["standard", "none"] as const).flatMap(lip =>
  TAB_WALLS.flatMap(wall => TAB_SCOPES.map(scope => [lip, wall, scope] as const)));

describe("new label-tab text beside a stacking lip", () => {
  it.each(cases)("builds lip %s, %s-wall %s tabs filled with new labels", async (lip, wall, scope) => {
    const spec = fillLabelTabs(tabBin(lip, wall, scope));
    expect(shelvesOf(spec)).toEqual(labelTabSurfaces(spec).map((_, i) => i));
    await expectAllLabelsBuild(spec);
  });

  it.each(TAB_WALLS)("builds oversized %s-wall labels shrunk to the space beside the lip", async wall => {
    for (const scope of TAB_SCOPES) await expectAllLabelsBuild(fillLabelTabs(tabBin("standard", wall, scope), { sizeMm: 20 }));
  });

  it("builds the reported lipped 2×4 sub-bin labels at export quality", async () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "standard",
      compartments: { enabled: true, rows: 2, columns: 4 }, labelTab: { scope: "compartments" } });
    await expectAllLabelsBuild(fillLabelTabs(spec), EXPORT_QUALITY);
  });

  it("builds tall lettering that rises from a deep recess into the lip", async () => {
    const spec = tabBin("standard", "north", "compartments");
    const deep = { ...spec, labelTab: { ...spec.labelTab!, recessMm: 4 } };
    await expectAllLabelsBuild(fillLabelTabs(deep, { heightMm: 5 }));
  });

  it("builds sub-bin labels beside the lip on a custom footprint", async () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "standard",
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      compartments: { enabled: true, rows: 2, columns: 4 },
      labelTab: { wall: "north", scope: "compartments", width: "full", recessMm: 0.5, frontRim: true } });
    const filled = fillLabelTabs(spec);
    // Shelves cut away by the L's missing corner get no new text.
    const placed = { ...filled, surfaceTexts: filled.surfaceTexts.filter((_, i) => shelvesOf(filled)[i] >= 0) };
    expect(new Set(shelvesOf(placed)).size).toBe(placed.surfaceTexts.length);
    expect(placed.surfaceTexts.length).toBeGreaterThanOrEqual(6);
    await expectAllLabelsBuild(placed);
  });

  it.each([[3, 4], [4, 3], [3, 2], [2, 3]])("keeps moved labels clear of the lip when %i columns become %i (issue #210)", async (from, to) => {
    const grid = (columns: number, base: BinSpec) => parseBinSpec({ ...base, compartments: { ...base.compartments, columns } });
    const before = fillLabelTabs(parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "standard",
      compartments: { enabled: true, rows: 2, columns: from }, labelTab: { scope: "compartments" } }));
    const after = grid(to, before);
    after.surfaceTexts = textsAfterLabelTabEdit(before, before, after);
    // Labels whose sub-bin no longer exists stay put; everything that moved must still build.
    const keys = new Set(labelTabSurfaces(after).map(surface => surface.key));
    const surfacesBefore = labelTabSurfaces(before);
    const kept = after.surfaceTexts.filter((_, i) => keys.has(surfacesBefore.find(surface => pointOnLabelTab(before.surfaceTexts[i].position, surface))!.key));
    expect(kept.length).toBe(Math.min(from, to) * 2);
    await expectAllLabelsBuild({ ...after, surfaceTexts: kept });
  });
});
