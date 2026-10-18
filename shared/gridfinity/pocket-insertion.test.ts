import { expect, it } from "vitest";
import { parseCutoutPlacement, pocketOccupiedOutline, resolvePocketDepth } from "./cutout";
import { defaultPocketInsertion, pocketInsertionAxis, pocketInsertionError } from "./pocket-insertion";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "./project";
import { parseBinSpec } from "./types";
import { applyLinkedEdits, designLinkErrors } from "./design-links";
import { rigidPocketFootprint, resetPocketPlane } from "./rigid-pocket";
import { validateLayout } from "./validate";

const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 4 });
const shape = { id: "s", name: "Tool", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -5, maxX: 5, minY: -8, maxY: 8 },
  outlineMm: [{ outer: [[-5,-8],[5,-8],[5,8],[-5,8]].map(([x,y]) => ({x,y})), holes: [] }] };
const p = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 },
  elevationMm: 7, tilt: { xDeg: 35, yDeg: 20 }, depth: { mode: "mm", value: 10 }, insertionMode: "axis" });

it.each(["axis", "vertical"] as const)("round trips %s through projects, history, and transform references", insertionMode => {
  const cutout = { ...p, insertionMode };
  const doc = { spec, cutouts: [cutout], fingerHoles: [] };
  const project = { schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [shape], ...doc,
    history: { stack: [{ doc, label: "Insertion path" }], index: 0 },
    transformOrigins: { pockets: [{ cutout, spec }], fingerHoles: [] } };
  expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toMatchObject(project);
  expect(parseProjectDoc({ ...project, cutouts: [{ ...p, insertionMode: "diagonal" }] })).toBeNull();
  expect(parseProjectDoc({ ...project, cutouts: [{ ...p, elevationMm: undefined }] })).toBeNull();
});

it("migrates version 32 without adding clearance to any saved snapshot", () => {
  const cutout = { ...p, insertionMode: undefined };
  const doc = { spec, cutouts: [cutout], fingerHoles: [] };
  const input = { schemaVersion: 32, shapes: [shape], ...doc,
    history: { stack: [{ doc, label: "Original" }], index: 0 },
    transformOrigins: { pockets: [{ cutout, spec }], fingerHoles: [] } };
  const parsed = parseProjectDoc(JSON.parse(JSON.stringify(input)))!;
  expect(parsed.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  expect(parsed.cutouts[0].insertionMode).toBeUndefined();
  expect(parsed.history!.stack[0].doc.cutouts[0].insertionMode).toBeUndefined();
  expect(parsed.transformOrigins!.pockets[0].cutout.insertionMode).toBeUndefined();
});

it.each([90, -90])("reports horizontal %s° axial paths and keeps bounds finite", xDeg => {
  const horizontal = { ...p, tilt: { xDeg, yDeg: 0 } };
  expect(pocketInsertionError(horizontal)).toContain("vertical drop-in");
  expect(pocketOccupiedOutline(shape, horizontal, spec).flatMap(s => s.outer).every(v => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true);
  expect(pocketInsertionError({ ...horizontal, insertionMode: "vertical" })).toBeNull();
  expect(pocketInsertionError({ ...horizontal, insertionMode: undefined })).toBeNull();
});

it("directs inverted axes upward and keeps vertical insertion independent of pose", () => {
  const inverted = { ...p, tilt: { xDeg: 180, yDeg: 25 } };
  expect(pocketInsertionAxis(inverted).z).toBeGreaterThan(0);
  expect(pocketInsertionAxis({ ...inverted, insertionMode: "vertical" })).toEqual({ x: 0, y: 0, z: 1 });
});

it("uses the entire top-down footprint even for source vertices above the fill", () => {
  const raised = { ...p, elevationMm:23, rotationDeg:17, insertionMode:"vertical" as const };
  const full = rigidPocketFootprint(shape.outlineMm,raised,Infinity,28);
  expect(rigidPocketFootprint(shape.outlineMm,raised,28,28)).toEqual(full);
});

it("reserves the original through object independently of bin height and Z movement", () => {
  const through = {...p,elevationMm:0,tilt:{xDeg:30,yDeg:0},rotationDeg:0,
    depth:{mode:"through" as const,sourceDepthMm:16},insertionMode:"vertical" as const};
  for (const heightUnits of [2,4]) {
    const bin = {...spec,heightUnits};
    const points = pocketOccupiedOutline(shape,through,bin).flatMap(s=>s.outer);
    expect(pocketOccupiedOutline(shape,{...through,elevationMm:50},bin)).toEqual(pocketOccupiedOutline(shape,through,bin));
    expect(Math.max(...points.map(v=>v.x))-Math.min(...points.map(v=>v.x))).toBeCloseTo(10,6);
    expect(Math.max(...points.map(v=>v.y))-Math.min(...points.map(v=>v.y)))
      .toBeCloseTo(16*Math.cos(Math.PI/6)+16*Math.sin(Math.PI/6),6);
    const neighbor = {...through,id:"neighbor",position:{x:40,y:0},tilt:undefined};
    expect(validateLayout(bin,[through,neighbor],new Map([[shape.id,shape]]))).toEqual([]);
  }
});

it("shares insertion choices in linked designs while preserving each pose", () => {
  const a = { ...p, designLink: { id: "link", tilt: false } };
  const b = { ...a, id: "copy", position: { x: 20, y: 0 }, tilt: { xDeg: 25, yDeg: 0 } };
  const result = applyLinkedEdits({ cutouts: [a,b], fingerHoles: [] },
    { cutouts: [{ ...a, insertionMode: "vertical" }], fingerHoles: [] })!;
  expect(result.cutouts[1]).toEqual({ ...b, insertionMode: "vertical" });
  expect(designLinkErrors(result)).toEqual([]);
});


it.each(["x", "y", "z"] as const)("retains the %s axis in current, undo/redo, and creation snapshots", insertionAxis => {
  const original = { ...p, insertionAxis };
  const current = { ...original, insertionMode: "vertical" as const };
  const later = { ...original, insertionMode: undefined };
  const snapshot = (cutout: typeof p) => ({ spec, cutouts: [cutout], fingerHoles: [] });
  const input = { schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [shape], ...snapshot(current),
    history: { index: 1, stack: [{ doc: snapshot(original), label: "Choose axis" },
      { doc: snapshot(current), label: "Vertical drop-in" }, { doc: snapshot(later), label: "Disable clearance" }] },
    transformOrigins: { pockets: [{ cutout: original, spec }], fingerHoles: [] } };
  expect(parseProjectDoc(JSON.parse(JSON.stringify(input)))).toEqual(input);
});

it("migrates version 38 with unchanged Z direction and all saved snapshots", () => {
  const original = { ...p, designLink: { id: "old-link", tilt: false } };
  const copy = { ...original, id: "copy", position: { x: 20, y: 0 } };
  const snapshot = (elevationMm: number) => ({ spec, cutouts: [original, copy].map(c => ({ ...c, elevationMm })), fingerHoles: [] });
  const input = { schemaVersion: 38, shapes: [shape], ...snapshot(12), history: { index: 1,
    stack: [{ doc: snapshot(7), label: "Original" }, { doc: snapshot(12), label: "Raise" }, { doc: snapshot(15), label: "Raise again" }] },
    transformOrigins: { pockets: [{ cutout: original, spec }, { cutout: copy, spec }], fingerHoles: [] } };
  const serialized = JSON.stringify(input);
  const parsed = parseProjectDoc(JSON.parse(serialized))!;
  expect(parsed).toEqual({ ...input, schemaVersion: PROJECT_SCHEMA_VERSION });
  expect(pocketInsertionAxis(parsed.cutouts[0])).toEqual(pocketInsertionAxis({ ...original, insertionAxis: "z" }));
  expect(JSON.stringify(input)).toBe(serialized);
});

it.each(["w", "X", "", null, 1])("rejects invalid saved axis %s in every snapshot location", insertionAxis => {
  const doc = { spec, cutouts: [p], fingerHoles: [] };
  const invalid = { ...p, insertionAxis };
  const project = { schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [shape], ...doc };
  expect(parseProjectDoc({ ...project, cutouts: [invalid] })).toBeNull();
  expect(parseProjectDoc({ ...project, history: { index: 0, stack: [
    { doc, label: "Current" }, { doc: { ...doc, cutouts: [invalid] }, label: "Invalid redo" }] } })).toBeNull();
  expect(parseProjectDoc({ ...project, transformOrigins: { pockets: [{ cutout: invalid, spec }], fingerHoles: [] } })).toBeNull();
});

it.each([false, true])("follows all local axes through compound rotation (mirrored=%s)", mirrored => {
  const rotated = { ...p, mirrored, scaleX: 2, scaleY: 0.5, tilt: { xDeg: 30, yDeg: 45 }, rotationDeg: 90 };
  const expected = {
    x: { x: 0, y: -Math.SQRT1_2, z: Math.SQRT1_2 },
    y: { x: -Math.sqrt(3) / 2, y: Math.SQRT1_2 / 2, z: Math.SQRT1_2 / 2 },
    z: { x: 0.5, y: Math.sqrt(3 / 8), z: Math.sqrt(3 / 8) },
  };
  for (const insertionAxis of ["x", "y", "z"] as const) {
    const actual = pocketInsertionAxis({ ...rotated, insertionAxis });
    for (const component of ["x", "y", "z"] as const) expect(actual[component]).toBeCloseTo(expected[insertionAxis][component], 10);
    expect(Math.hypot(actual.x, actual.y, actual.z)).toBeCloseTo(1, 10);
    expect(pocketInsertionAxis({ ...rotated, insertionAxis, insertionMode: "vertical" })).toEqual({ x: 0, y: 0, z: 1 });
  }
});

it.each([
  { insertionAxis: "x" as const, tilt: { xDeg: 20, yDeg: 0 } },
  { insertionAxis: "y" as const, tilt: { xDeg: 0, yDeg: 20 } },
  { insertionAxis: "z" as const, tilt: { xDeg: 90, yDeg: 0 } },
])("identifies a horizontal $insertionAxis path without corrupting layout bounds", choice => {
  const horizontal = { ...p, ...choice };
  expect(pocketInsertionError(horizontal)).toContain(`selected ${choice.insertionAxis.toUpperCase()} axis`);
  expect(pocketOccupiedOutline(shape, horizontal, spec).flatMap(s => s.outer).every(v => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true);
  expect(pocketInsertionError({ ...horizontal, insertionMode: "vertical" })).toBeNull();
  expect(pocketInsertionError({ ...horizontal, insertionMode: undefined })).toBeNull();
});

it("projects the selected local axis in layout bounds independently of the depth axis", () => {
  const top = resolvePocketDepth(spec, p.depth).infillTopZ;
  const rotated = { ...p, tilt: { xDeg: 0, yDeg: 60 } };
  const spanX = (insertionAxis: "x" | "z") => {
    const points = rigidPocketFootprint(shape.outlineMm, { ...rotated, insertionAxis }, top).flatMap(s => s.outer);
    return Math.max(...points.map(v => v.x)) - Math.min(...points.map(v => v.x));
  };
  expect(spanX("x")).toBeCloseTo(10 / Math.sin(Math.PI / 3), 6);
  expect(spanX("z")).toBeCloseTo(10 / Math.cos(Math.PI / 3), 6);
});

it("keeps a selected axis on plane reset so its horizontal-path error remains actionable", () => {
  const reset = resetPocketPlane({ ...p, insertionAxis: "x" }, shape, spec);
  expect(reset).toMatchObject({ insertionAxis: "x", insertionMode: "axis", tilt: { xDeg: 0, yDeg: 0 } });
  expect(pocketInsertionError(reset)).toContain("selected X axis");
});

it("shares a local axis without changing linked copies' independent poses", () => {
  const a = { ...p, designLink: { id: "link", tilt: false } };
  const b = { ...a, id: "copy", position: { x: 20, y: 0 }, rotationDeg: 65, mirrored: true, tilt: { xDeg: 25, yDeg: 0 } };
  const before = { cutouts: [a, b], fingerHoles: [] };
  const edited = { ...a, insertionAxis: "y" as const };
  const result = applyLinkedEdits(before, { cutouts: [edited], fingerHoles: [] })!;
  expect(result.cutouts).toEqual([edited, { ...b, insertionAxis: "y" }]);
  expect(designLinkErrors(result)).toEqual([]);
  expect(pocketInsertionAxis(result.cutouts[0])).not.toEqual(pocketInsertionAxis(result.cutouts[1]));
  expect(applyLinkedEdits(before, { cutouts: [edited, { ...b, insertionAxis: "x" }], fingerHoles: [] })).toBeNull();
  expect(designLinkErrors({ ...before, cutouts: [edited, b] })).toHaveLength(1);
  expect(designLinkErrors({ ...before, cutouts: [a, { ...b, insertionAxis: "z" }] })).toEqual([]);
});


it("offers vertical projection when a retained hole's selected axis is horizontal", () => {
  const hole = { ...p, role: "hole" as const, insertionAxis: "x" as const, tilt: { xDeg: 0, yDeg: 0 } };
  expect(pocketInsertionError(hole)).toContain("selected X axis");
  expect(pocketInsertionError(hole)).toContain("vertical projection");
  expect(pocketInsertionError(hole)).not.toContain("drop-in");
});


it("defaults fresh pockets to axial clearance without overriding established finite objects", () => {
  const fresh = { ...p, elevationMm: undefined, tilt: undefined, insertionMode: undefined };
  expect(defaultPocketInsertion(fresh, { ...fresh, elevationMm: 7, tilt: { xDeg: 30, yDeg: 0 } })).toBe("axis");
  expect(defaultPocketInsertion(fresh, { ...fresh, rotationDeg: 45 })).toBeUndefined();
  const established = { ...fresh, elevationMm: 7 };
  expect(defaultPocketInsertion(established, { ...established, tilt: { xDeg: 30, yDeg: 0 } })).toBeUndefined();
});

it.each([undefined, "axis", "vertical"] as const)("preserves %s clearance through upright reset and retilt", insertionMode => {
  const chosen = { ...p, insertionMode, insertionAxis: "x" as const };
  const reset = resetPocketPlane(chosen, shape, spec);
  const tilted = { ...reset, tilt: { xDeg: 15, yDeg: 40 } };
  expect(defaultPocketInsertion(reset, tilted)).toBe(insertionMode);
  expect(tilted.insertionAxis).toBe("x");
});
