import { describe, expect, it } from "vitest";
import { parseCutoutPlacement, fingerHoleSchema, clampFingerHoleToBin } from "./cutout";
import { applyLinkedEdits, clampLinkedFingerHoles, designLinkErrors, pocketDesign } from "./design-links";
import { parseBinSpec } from "./types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "./project";

const a = parseCutoutPlacement({ id: "a", shapeId: "s", name: "Alpha", position: { x: -20, y: 0 }, designLink: { id: "g" } });
const b = { ...a, id: "b", name: "Beta", position: { x: 20, y: 0 }, rotationDeg: 90, mirrored: true };
const independent = { ...a, id: "independent", designLink: undefined };
const before = { cutouts: [a, b, independent], fingerHoles: [] };
const f = fingerHoleSchema.parse({ id: "f", kind: "oblong-deep-scoop", center: { x: -15, y: 0 }, diameterMm: 12, lengthMm: 50, depthMm: 10, designLink: { id: "fg" } });
const g = { ...f, id: "g", center: { x: 15, y: 0 }, rotationDeg: 90 };

describe("explicit linked designs", () => {
  it("shares contour revisions and dimensions while retaining each placement and name", () => {
    const result = applyLinkedEdits(before, { cutouts: [{ ...a, shapeId: "revision", scaleX: 1.5, topFilletMm: 2 }], fingerHoles: [] })!;
    expect(result.cutouts.slice(0, 2).map(c => c.shapeId)).toEqual(["revision", "revision"]);
    expect(result.cutouts[1]).toMatchObject({ name: "Beta", position: b.position, rotationDeg: 90, mirrored: true, scaleX: 1.5, topFilletMm: 2 });
    expect(result.cutouts[2]).toEqual(independent);
    expect(before.cutouts[0]).toEqual(a);
    expect(designLinkErrors(result)).toEqual([]);
  });
  it("shares split creation, editing and removal, including optional-field deletion", () => {
    const split = { boundary: [{ x: -2, y: 0 }, { x: 2, y: 0 }], depths: [{ mode: "mm" as const, value: 4 }, { mode: "mm" as const, value: 8 }] as const };
    const splitPocket = parseCutoutPlacement({ ...a, split });
    const result = applyLinkedEdits(before, { cutouts: [splitPocket], fingerHoles: [] })!;
    expect(result.cutouts[1].split).toEqual(splitPocket.split);
    const removed = applyLinkedEdits(result, { cutouts: [{ ...result.cutouts[1], split: undefined }], fingerHoles: [] })!;
    expect(removed.cutouts.slice(0, 2).every(c => c.split === undefined)).toBe(true);
  });
  it("keeps tilt independent unless the entire group's tilt option is enabled", () => {
    const tilt = { xDeg: 10, yDeg: 25 };
    const result = applyLinkedEdits(before, { cutouts: [{ ...a, tilt, rotationDeg: 35 }], fingerHoles: [] })!;
    expect(result.cutouts[1].tilt).toBeUndefined(); expect(result.cutouts[1].rotationDeg).toBe(90);
    const linked = { ...before, cutouts: [a, b].map(c => ({ ...c, designLink: { id: "g", tilt: true } })) };
    const tilted = applyLinkedEdits(linked, { cutouts: [{ ...linked.cutouts[0], tilt }], fingerHoles: [] })!;
    expect(tilted.cutouts[1].tilt).toEqual(tilt); expect(tilted.cutouts[1].rotationDeg).toBe(90);
  });
  it("applies matching batch edits once and rejects conflicting values atomically", () => {
    expect(applyLinkedEdits(before, { cutouts: [{ ...a, scaleX: 2 }, { ...b, scaleX: 3 }], fingerHoles: [] })).toBeNull();
    const both = applyLinkedEdits(before, { cutouts: [{ ...a, scaleX: 2 }, { ...b, scaleX: 2 }], fingerHoles: [] })!;
    expect(both.cutouts.slice(0, 2).every(c => c.scaleX === 2)).toBe(true);
    const combined = applyLinkedEdits(before, { cutouts: [{ ...a, scaleX: 2 }, { ...b, scaleY: 3 }], fingerHoles: [] })!;
    expect(combined.cutouts.slice(0, 2).every(c => c.scaleX === 2 && c.scaleY === 3)).toBe(true);
  });
  it("rejects divergent link settings and dimensions in saved groups", () => {
    expect(designLinkErrors({ ...before, cutouts: [a, { ...b, scaleX: 2 }] })).toHaveLength(1);
    expect(designLinkErrors({ ...before, cutouts: [a, { ...b, designLink: { id: "g", tilt: true } }] })).toHaveLength(1);
    expect(designLinkErrors(before)).toEqual([]);
  });
  it("shares thumb shape and dimensions while retaining center and heading", () => {
    const result = applyLinkedEdits({ cutouts: [], fingerHoles: [f, g] }, { cutouts: [], fingerHoles: [{ ...f, kind: "oblong-straight", diameterMm: 20, depthMm: 6 }] })!;
    expect(result.fingerHoles[1]).toMatchObject({ kind: "oblong-straight", diameterMm: 20, depthMm: 6, center: g.center, rotationDeg: 90 });
  });
  it("uses common clamping across differently oriented thumb slots", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 1, heightUnits: 2 });
    const holes = [f, g].map(h => ({ ...h, diameterMm: 60, lengthMm: 100, depthMm: 40 }));
    const result = clampLinkedFingerHoles(holes, spec);
    expect(designLinkErrors({ cutouts: [], fingerHoles: result })).toEqual([]);
    result.forEach(h => expect(clampFingerHoleToBin(h, spec)).toEqual(h));
    expect(result.map(h => h.center)).toEqual(holes.map(h => h.center));
  });
  it("persists links in current state and history and rejects corrupt historical groups", () => {
    const shape = { id: "s", name: "slot", sourceMmPerPx: 1, pointCount: 4, bboxMm: { minX: -2, minY: -4, maxX: 2, maxY: 4 }, outlineMm: [{ outer: [{ x: -2, y: -4 }, { x: 2, y: -4 }, { x: 2, y: 4 }, { x: -2, y: 4 }], holes: [] }] };
    const doc = { spec: parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6 }), cutouts: [a, b], fingerHoles: [f, g] };
    const input = { schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [shape], ...doc, history: { stack: [{ doc, label: "Linked" }], index: 0 } };
    const project = parseProjectDoc(input)!;
    expect(project).not.toBeNull(); expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toEqual(project);
    const corrupt = { ...doc, cutouts: [a, { ...b, scaleX: 2 }] };
    expect(parseProjectDoc({ ...input, history: { stack: [{ doc, label: "Linked" }, { doc: corrupt, label: "Corrupt redo" }], index: 0 } })).toBeNull();
    expect(parseProjectDoc({ ...input, ...corrupt, history: undefined })).toBeNull();
    const legacy = parseProjectDoc({ ...input, schemaVersion: 22, history: undefined, cutouts: [independent, { ...b, designLink: undefined }] })!;
    expect(legacy.cutouts.every(c => !c.designLink)).toBe(true);
    expect(pocketDesign(project.cutouts[0])).toEqual(pocketDesign(project.cutouts[1]));
  });
});
