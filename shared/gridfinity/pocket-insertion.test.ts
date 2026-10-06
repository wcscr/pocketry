import { expect, it } from "vitest";
import { parseCutoutPlacement, pocketOccupiedOutline, resolvePocketDepth } from "./cutout";
import { pocketInsertionAxis, pocketInsertionError } from "./pocket-insertion";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "./project";
import { parseBinSpec } from "./types";
import { applyLinkedEdits, designLinkErrors } from "./design-links";
import { rigidPocketFootprint } from "./rigid-pocket";
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

it("reserves only the through shaft between the underside and fill for drop-in placement", () => {
  const through = {...p,elevationMm:0,tilt:{xDeg:30,yDeg:0},rotationDeg:0,
    depth:{mode:"through" as const},insertionMode:"vertical" as const};
  for (const heightUnits of [2,4]) {
    const bin = {...spec,heightUnits};
    const points = pocketOccupiedOutline(shape,through,bin).flatMap(s=>s.outer);
    const top = resolvePocketDepth(bin,through.depth).infillTopZ;
    expect(Math.max(...points.map(v=>v.x))-Math.min(...points.map(v=>v.x))).toBeCloseTo(10,6);
    expect(Math.max(...points.map(v=>v.y))-Math.min(...points.map(v=>v.y)))
      .toBeCloseTo(16/Math.cos(Math.PI/6)+top*Math.tan(Math.PI/6),6);
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
