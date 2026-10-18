import { expect, it } from "vitest";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { validateLayout } from "@shared/gridfinity/validate";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { withKernel } from "@/lib/manifold/runtime";
import { normalizeTracedShape } from "./traced-shape";
import { buildBinWithCutouts, PREVIEW_QUALITY, EXPORT_QUALITY } from "./bin";
import { buildCutoutCutters } from "./cutouts";
import { layoutRingsMm, generateLayoutSVG, generateLayoutDXF } from "@/lib/export/layout";
import { autoArrangeLayout } from "./autoplace";
import { rectRing } from "@/lib/geometry/fixtures";
import { ringArea } from "@shared/geometry/rings";

const pocketShape = { ...normalizeTracedShape([{ outer: rectRing(0, 0, 30, 20), holes: [] }], { mmPerPx: 1, imageHeight: 100 }, "Tool")!, id: "tool" };
const holeShape = { ...normalizeTracedShape([{ outer: rectRing(0, 0, 8, 6), holes: [] }], { mmPerPx: 1, imageHeight: 100 }, "Hole 1")!, id: "hole" };
const shapes = [pocketShape, holeShape];
const byId = new Map(shapes.map(shape => [shape.id, shape]));
const pocket = parseCutoutPlacement({ id: "pocket", shapeId: "tool", position: { x: 0, y: 0 }, depth: { mode: "mm", value: 10 }, cornerRoundMm: 0, bottomFilletMm: 0 });
const hole = parseCutoutPlacement({ id: "retained", shapeId: "hole", role: "hole", position: { x: 2, y: 1 }, depth: { mode: "through" }, cornerRoundMm: 0, bottomFilletMm: 0 });
const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid", lip: "none" });

it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("keeps hole objects editable without baking or adding material at $circularSegments quality", async quality => {
  await withKernel(kernel => {
    const build = (cutouts: typeof pocket[]) => buildBinWithCutouts(kernel, spec, { shapesById: byId, cutouts, fingerHoles: [] }, quality).solid;
    const plain = build([pocket]);
    const kept = build([pocket, hole]);
    expect(kept.status()).toBe("NoError");
    expect(kept.volume() - plain.volume()).toBeCloseTo(8 * 6 * 10, 4);
    expect(build([pocket, { ...hole, depth: { mode: "mm", value: 5 } }]).volume() - plain.volume()).toBeCloseTo(8 * 6 * 5, 4);
    const moved = { ...hole, position: { x: 15, y: 0 }, scaleX: 2 };
    expect(build([pocket, moved]).volume() - plain.volume()).toBeCloseTo(8 * 6 * 10, 4);
    expect(build([pocket, { ...hole, position: { x: 200, y: 0 } }]).volume()).toBeCloseTo(plain.volume(), 4);
    expect(build([hole]).volume()).toBeCloseTo(build([]).volume(), 4);
    expect(build([pocket]).volume()).toBeCloseTo(plain.volume(), 4);
    const overlapped = { ...pocket, id: "second", position: { x: 4, y: 0 } };
    expect(build([pocket, overlapped, hole]).volume() - build([pocket, overlapped]).volume()).toBeCloseTo(480, 4);
    const built = buildCutoutCutters(kernel, byId, [pocket, hole], spec, quality, { floorInsertThicknessMm: 1 });
    expect(built.cutterGroups!.map(g => g.id)).toEqual([pocket.id]);
    expect(validateLayout(spec, [pocket, hole], byId).some(issue => issue.cutoutIds?.includes(hole.id))).toBe(false);
  });
});

it("exports clipped openings and notches, with no stray exclusion outline", async () => {
  await withKernel(kernel => {
    const interior = layoutRingsMm(spec, [pocket, hole], byId, [], kernel);
    expect(interior).toHaveLength(3);
    expect(ringArea(interior[1]) - ringArea(interior[2])).toBeCloseTo(600 - 48);
    const notch = layoutRingsMm(spec, [pocket, { ...hole, position: { x: 15, y: 0 } }], byId, [], kernel);
    expect(notch).toHaveLength(2);
    expect(ringArea(notch[1])).toBeCloseTo(600 - 24);
  });
  expect((await generateLayoutSVG(spec, [pocket, hole], byId)).match(/<path /g)).toHaveLength(3);
  expect((await generateLayoutDXF(spec, [pocket, hole], byId)).match(/LWPOLYLINE/g)).toHaveLength(3);
});

it("preserves hole roles through saved history, migration, and automatic arrangement", () => {
  const cutouts = [pocket, hole];
  const doc = { spec, cutouts, fingerHoles: [] };
  const project = { ...doc, shapes, schemaVersion: PROJECT_SCHEMA_VERSION,
    history: { index: 0, stack: [{ doc, label: "Add traced objects" }] } };
  expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toEqual(project);
  const old = { ...doc, shapes, cutouts: [pocket], schemaVersion: 37 };
  expect(parseProjectDoc(old)?.cutouts).toEqual([pocket]);
  const arranged = autoArrangeLayout(cutouts, byId, spec.lip, spec.gridPitch, [], spec)!;
  const a = arranged.cutouts.find(c => c.id === pocket.id)!, b = arranged.cutouts.find(c => c.id === hole.id)!;
  expect(b.role).toBe("hole");
  expect({ x: b.position.x - a.position.x, y: b.position.y - a.position.y }).toEqual(hole.position);
  expect([a.rotationDeg, b.rotationDeg]).toEqual([0, 0]);
});

it("blocks invalid or pending hole volumes instead of silently omitting their protection", () => {
  expect(validateLayout(spec, [pocket, { ...hole, depthPending: true }], byId).some(issue => issue.code === "pocket-depth-needed")).toBe(true);
  expect(validateLayout(spec, [pocket, { ...hole, tilt: { xDeg: 90, yDeg: 0 } }], byId).some(issue => issue.code === "invalid-pocket-tilt")).toBe(true);
});

it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("reports loose retained islands and floating caps at $circularSegments quality", async quality => {
  await withKernel(kernel => {
    for (const cutouts of [
      [{ ...pocket, depth: { mode: "through" as const } }, hole],
      [pocket, { ...hole, depth: { mode: "mm" as const, value: 5 } }],
      [pocket, { ...hole, depth: { mode: "mm" as const, value: 5 }, tilt: { xDeg: 10, yDeg: 0 } }],
    ]) {
      const built = buildBinWithCutouts(kernel, spec, { shapesById: byId, cutouts, fingerHoles: [] }, quality);
      expect(built.solid.decompose().map(part => kernel.arena.track(part))).toHaveLength(2);
      expect(built.validationIssues).toContainEqual(expect.objectContaining({
        code: "disconnected-retained-material", severity: "error", cutoutIds: [hole.id],
        message: expect.stringContaining("pocket floor or wall"),
      }));
    }
  });
});

it("allows retained caps and overlapping holes connected to a floor or wall", async () => {
  await withKernel(kernel => {
    const shallow = { ...hole, depth: { mode: "mm" as const, value: 5 } };
    const deep = { ...hole, id: "deep", position: { x: 8, y: 1 }, depth: { mode: "mm" as const, value: 10 } };
    const bridge = { ...hole, id: "bridge", position: { x: 10, y: 1 }, scaleX: 2 };
    const split = { ...hole, split: { boundary: [{ x: 0, y: -3 }, { x: 0, y: 3 }],
      depths: [{ mode: "mm" as const, value: 5 }, { mode: "mm" as const, value: 10 }] as [typeof shallow.depth, typeof deep.depth] } };
    for (const cutouts of [
      [pocket, { ...shallow, position: { x: 15, y: 0 } }],
      [pocket, shallow, deep],
      [{ ...pocket, depth: { mode: "through" as const } }, hole, bridge],
      [pocket, split],
      [pocket, { ...hole, tilt: { xDeg: 10, yDeg: 0 } }],
    ]) {
      const built = buildBinWithCutouts(kernel, spec, { shapesById: byId, cutouts, fingerHoles: [] }, EXPORT_QUALITY);
      expect(built.solid.decompose().map(part => kernel.arena.track(part))).toHaveLength(1);
      expect(built.validationIssues.filter(issue => issue.code === "disconnected-retained-material")).toEqual([]);
    }
  });
});

it("does not blame a remote hole for an existing embedded through island", async () => {
  const embedded = { ...pocketShape, outlineMm: [{ outer: pocketShape.outlineMm[0].outer,
    holes: [holeShape.outlineMm[0].outer.slice().reverse()] }] };
  const localShapes = new Map([[embedded.id, embedded], [holeShape.id, holeShape]]);
  const cutouts = [{ ...pocket, depth: { mode: "through" as const } }, { ...hole, position: { x: 100, y: 0 } }];
  expect(validateLayout(spec, cutouts, localShapes)).toContainEqual(expect.objectContaining({ code: "through-island", severity: "error" }));
  await withKernel(kernel => {
    const built = buildBinWithCutouts(kernel, spec, { shapesById: localShapes, cutouts, fingerHoles: [] }, EXPORT_QUALITY);
    expect(built.solid.decompose().map(part => kernel.arena.track(part))).toHaveLength(2);
    expect(built.validationIssues.filter(issue => issue.code === "disconnected-retained-material")).toEqual([]);
  });
});
