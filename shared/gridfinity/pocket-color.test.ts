import { expect, it } from "vitest";
import { parseCutoutPlacement } from "./cutout";
import { pocketColorAxis } from "./pocket-color";
import { pocketInsertionAxis } from "./pocket-insertion";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, serializeProjectDoc } from "./project";
import { parseBinSpec } from "./types";

const p = parseCutoutPlacement({ id:"p", shapeId:"s", position:{x:0,y:0}, elevationMm:7, depth:{mode:"mm",value:10}, tilt:{xDeg:30,yDeg:20}, rotationDeg:15, insertionMode:"axis", insertionAxis:"x" });
const spec = parseBinSpec({gridX:2,gridY:2,heightUnits:6});
const shape = {id:"s",name:"Tool",sourceMmPerPx:1,pointCount:4,
  bboxMm:{minX:-5,maxX:5,minY:-8,maxY:8},
  outlineMm:[{outer:[[-5,-8],[5,-8],[5,8],[-5,8]].map(([x,y])=>({x,y})),holes:[]}]};
const project = (cutout = p) => {
  const doc = {spec,cutouts:[cutout],fingerHoles:[]};
  return {schemaVersion:PROJECT_SCHEMA_VERSION,shapes:[shape],...doc,
    history:{stack:[{doc,label:"Color choice"}],index:0},
    transformOrigins:{pockets:[{cutout,spec}],fingerHoles:[]}};
};
it("keeps legacy vertical color independent of insertion", () => {
  expect(pocketColorAxis(p)).toEqual({x:0,y:0,z:1});
  expect(pocketColorAxis({...p,colorFloorAxis:"insertion"})).toEqual(pocketInsertionAxis(p));
  expect(pocketColorAxis({...p,colorFloorAxis:"insertion",insertionMode:"vertical"})).toEqual({x:0,y:0,z:1});
  expect(pocketColorAxis({...p,colorFloorAxis:"insertion",insertionMode:undefined}))
    .toEqual(pocketInsertionAxis({...p,insertionMode:"axis",insertionAxis:"z"}));
});
it("rotates explicit local references independently and permits horizontal color axes", () => {
  expect(pocketColorAxis({...p,colorFloorAxis:"y",insertionMode:"vertical"})).toEqual(pocketInsertionAxis({...p,insertionMode:"axis",insertionAxis:"y"}));
  expect(pocketColorAxis({...p,tilt:undefined,rotationDeg:0,colorFloorAxis:"x"})).toEqual({x:1,y:0,z:0});
});
it.each(["insertion","vertical","x","y","z"] as const)("round trips %s through all snapshots", colorFloorAxis => {
  const original = project({...p,colorCoverage:"interior",colorFloorAxis});
  const opened = parseProjectDoc(original)!;
  expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(opened))))).toEqual(opened);
  expect(opened).toMatchObject(original);
});
it("migrates version 39 without changing color coverage or geometry", () => {
  const original = project(), before = JSON.stringify(original);
  const opened = parseProjectDoc({...original,schemaVersion:39})!;
  expect(opened).toEqual(original);
  expect(JSON.stringify(original)).toBe(before);
  for (const c of [opened.cutouts[0],opened.history!.stack[0].doc.cutouts[0],opened.transformOrigins!.pockets[0].cutout]) {
    expect(c.colorCoverage).toBeUndefined(); expect(c.colorFloorAxis).toBeUndefined();
  }
});
it.each([
  { version: 40, colored: true, jig: false },
  { version: 43, colored: false, jig: true },
  { version: PROJECT_SCHEMA_VERSION, colored: true, jig: true },
])("preserves colors and jig settings from project version $version", ({version,colored,jig}) => {
  const cutout = colored ? {...p,colorCoverage:"interior" as const,colorFloorAxis:"y" as const} : p;
  const original = project(cutout);
  const savedSpec = parseBinSpec({...spec,...(jig ? {pegBottom:{diameterMm:4.8,lengthMm:4}} : {})});
  original.spec = savedSpec;
  original.history.stack[0].doc.spec = savedSpec;
  original.transformOrigins.pockets[0].spec = savedSpec;
  const stored = {...original,schemaVersion:version}, before = JSON.stringify(stored);
  const opened = parseProjectDoc(stored)!;
  expect(opened).toEqual(original);
  expect(parseProjectDoc(JSON.parse(JSON.stringify(serializeProjectDoc(opened))))).toEqual(opened);
  expect(JSON.stringify(stored)).toBe(before);
});
it.each([{colorCoverage:"all"},{colorFloorAxis:"world-x"}])("rejects invalid color data in every snapshot: %j", bad => {
  const doc = project();
  expect(parseProjectDoc({...doc,cutouts:[{...p,...bad}]})).toBeNull();
  expect(parseProjectDoc({...doc,history:{index:0,stack:[{label:"Bad",doc:{...doc.history.stack[0].doc,cutouts:[{...p,...bad}]}}]}})).toBeNull();
  expect(parseProjectDoc({...doc,transformOrigins:{...doc.transformOrigins,pockets:[{cutout:{...p,...bad},spec}]}})).toBeNull();
});
