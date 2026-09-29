import { expect, it } from "vitest";
import { parseCutoutPlacement, fingerHoleSchema } from "@shared/gridfinity/cutout";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";
import { projectUsesExperimentalFeatures } from "./experimental-features";

const ordinary: ProjectDoc = {
  schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [], spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }),
  cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: "shape", position: { x: 12, y: -5 }, rotationDeg: 45 })],
  fingerHoles: [],
};

it("does not enable experimental tools for ordinary positions, heading or zero tilt", () => {
  expect(projectUsesExperimentalFeatures(ordinary)).toBe(false);
  expect(projectUsesExperimentalFeatures({ ...ordinary, cutouts: [
    { ...ordinary.cutouts[0], tilt: { xDeg: 0, yDeg: 0 }, zOffsetMm: 0 },
  ] })).toBe(false);
});

it.each([
  { tilt: { xDeg: 45, yDeg: 0 } },
  { tilt: { xDeg: 0, yDeg: -30 } },
  { zOffsetMm: -2 },
  { designLink: { id: "linked-pockets" } },
])("detects an experimental pocket design: %j", features => {
  expect(projectUsesExperimentalFeatures({ ...ordinary, cutouts: [
    parseCutoutPlacement({ ...ordinary.cutouts[0], ...features }),
  ] })).toBe(true);
});

it.each([0, 2])("detects linked thumb access only in undo/redo history at index %s", index => {
  const plain = { spec: ordinary.spec, cutouts: ordinary.cutouts, fingerHoles: [] };
  const experimental = { ...plain, fingerHoles: [fingerHoleSchema.parse({
    id: "access", center: { x: 0, y: 0 }, designLink: { id: "access-design" },
  })] };
  expect(projectUsesExperimentalFeatures({ ...ordinary, history: {
    index, stack: [
      { label: "Before", doc: plain }, { label: "Linked access", doc: experimental }, { label: "Removed", doc: plain },
    ],
  } })).toBe(true);
});

const modelShape: ProjectDoc["shapes"][number] = {id:"shape",name:"Imported model",source:"model",sourceMmPerPx:null,
  outlineMm:[{outer:[{x:-10,y:-5},{x:10,y:-5},{x:10,y:5},{x:-10,y:5}],holes:[]}],
  pointCount:4,bboxMm:{minX:-10,maxX:10,minY:-5,maxY:5},
  model:{format:"stl",units:"mm",positions:[-10,-5,-3,10,-5,-3,0,5,-3,0,0,3],indices:[0,2,1,0,1,3,1,2,3,2,0,3]}};
it("recognizes imported-model pockets without tilt or links, but ignores unused model assets", () => {
  expect(projectUsesExperimentalFeatures({...ordinary,shapes:[modelShape]})).toBe(true);
  expect(projectUsesExperimentalFeatures({...ordinary,shapes:[modelShape],cutouts:[]})).toBe(false);
});
it.each([0,2])("recognizes model pockets kept only in undo/redo history at index %s", index => {
  const plain={spec:ordinary.spec,cutouts:[],fingerHoles:[]};
  expect(projectUsesExperimentalFeatures({...ordinary,shapes:[modelShape],cutouts:[],history:{index,stack:[
    {label:"Before",doc:plain}, {label:"Imported model",doc:{...plain,cutouts:ordinary.cutouts}}, {label:"Removed",doc:plain},
  ]}})).toBe(true);
});
