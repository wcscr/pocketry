import { arena, k, spec, shape, pocket, make, sample } from "./pocket-color.test-support";
import { expect, it } from "vitest";
import { resolvePocketDepth } from "@shared/gridfinity/cutout";
import { buildBinWithCutouts, PREVIEW_QUALITY, EXPORT_QUALITY } from "./bin";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { expectPrintableTopology } from "@/lib/mesh/mesh-contract.test-helpers";

it("colors all walls and the floor while preserving the exact cavity and material partition", () => {
  const before = make([pocket]), after = make([{...pocket,colorCoverage:"interior"}]), parts = after.materialParts!;
  expect(arena.track(before.solid.subtract(after.solid)).volume()).toBeLessThan(1e-8);
  expect(arena.track(after.solid.subtract(before.solid)).volume()).toBeLessThan(1e-8);
  for (const point of [[-10.3,0,12],[10.3,0,12],[0,-15.3,12],[0,15.3,12],[0,0,6.7],[10.3,0,30]] as const)
    expect(sample(parts.pocketFloors!,point[0],point[1],point[2])).toBeCloseTo(.001,6);
  expect(sample(parts.pocketFloors!,0,0,6)).toBe(0);
  expect(arena.track(parts.body.intersect(parts.pocketFloors!)).volume()).toBeLessThan(1e-8);
  expect(parts.body.volume()+parts.pocketFloors!.volume()).toBeCloseTo(after.solid.volume(),5);
  for (const solid of [after.solid,parts.body,parts.pocketFloors!]) expectPrintableTopology(extractPrintableMeshData(k,solid));
});
it.each([
  {axis:"x" as const,x:-10.3,y:0},
  {axis:"y" as const,x:0,y:-15.3},
])("colors only the finite supporting local $axis wall without changing vertical insertion", ({axis,x,y}) => {
  const p = {...pocket,colorFloorAxis:axis}, before = make([pocket]), after = make([p]);
  expect(after.solid.volume()).toBeCloseTo(before.solid.volume(),6);
  expect(sample(after.materialParts!.pocketFloors!,x,y,12)).toBeCloseTo(.001,6);
  expect(sample(after.materialParts!.pocketFloors!,-x,-y,12)).toBe(0);
  expect(sample(after.solid,x,y,30)).toBeCloseTo(.001,6);
  expect(sample(after.materialParts!.pocketFloors!,x,y,30)).toBe(0);
  expect(sample(after.materialParts!.pocketFloors!,0,0,6.7)).toBe(0);
  expect(p.insertionMode).toBe("vertical");
});
it("keeps the color band against a shallow pocket instead of jumping below it", () => {
  const p = {...pocket,depth:{mode:"mm" as const,value:.1},insertionMode:undefined,colorFloorAxis:"insertion" as const};
  const built = make([p]);
  for (const z of [6.95,6.7,6.45]) expect(sample(built.materialParts!.pocketFloors!,0,0,z)).toBeCloseTo(.001,5);
});
it("does not coat a parallel floor from rounding noise after compound rotation", () => {
  const p = {...pocket,insertionMode:undefined,colorFloorAxis:"x" as const,tilt:{xDeg:30,yDeg:0},rotationDeg:17};
  const built = make([p]), heading=17*Math.PI/180;
  // Original bottom centre: local (0,0,-12), anchored by the lowest corner.
  const normal=[.5*Math.sin(heading),-.5*Math.cos(heading),Math.cos(Math.PI/6)];
  const centre=[-6*Math.sin(heading),6*Math.cos(heading),14.5];
  const point=centre.map((v,i)=>v-.3*normal[i]);
  expect(sample(built.materialParts!.pocketFloors!,point[0],point[1],point[2])).toBe(0);
});
it("keeps object-Z floor color on the tilted seat, not the vertical clearance wall above it", () => {
  const p = {...pocket,tilt:{xDeg:30,yDeg:0},colorFloorAxis:"z" as const};
  const built = make([p]);
  const floor = built.materialParts!.pocketFloors!;
  // The finite object's low face is tilted. Vertical drop-in clearance adds
  // a tall wall above its far edge; that wall is not the object's Z floor.
  expect(sample(floor,0,6.15,14.5-.3*Math.cos(Math.PI/6))).toBeCloseTo(.001,6);
  expect(sample(built.solid,0,15*Math.cos(Math.PI/6)+6+.1,30)).toBeCloseTo(.001,6);
  expect(sample(floor,0,15*Math.cos(Math.PI/6)+6+.1,30)).toBe(0);
});
it("keeps retained holes and through openings intact with interior lining", () => {
  const p = {...pocket,depth:{mode:"through" as const,sourceDepthMm:19},elevationMm:0,colorCoverage:"interior" as const};
  const hole = {...pocket,id:"hole",role:"hole" as const,scaleX:.2,scaleY:.2};
  const after = make([p,hole]), plain = make([{...p,colorCoverage:undefined},hole]);
  expect(after.solid.volume()).toBeCloseTo(plain.solid.volume(),5);
  expect(sample(after.materialParts!.pocketFloors!,10.3,0,12)).toBeCloseTo(.001,6);
  expect(sample(after.materialParts!.pocketFloors!,0,0,12)).toBe(0);
  expect(sample(after.solid,5,0,1)).toBe(0);
});

it.each([
  { name: "vertical floor", color: { colorFloorAxis: "insertion" as const } },
  { name: "object floor", color: { colorFloorAxis: "z" as const } },
  { name: "entire interior", color: { colorCoverage: "interior" as const } },
])("keeps the rounded tilted entry bin-colored with $name coverage", ({color}) => {
  const p = {...pocket, ...color, elevationMm:31, tilt:{xDeg:30,yDeg:0}, topFilletMm:1};
  const top = resolvePocketDepth(spec,p.depth).infillTopZ;
  for (const quality of [PREVIEW_QUALITY,EXPORT_QUALITY]) {
    const layout = {shapesById:new Map([[shape.id,shape]]),cutouts:[p],fingerHoles:[]};
    const built = buildBinWithCutouts(k,spec,layout,quality,{floorInsertThicknessMm:.6});
    const plain = buildBinWithCutouts(k,spec,layout,quality);
    const parts = built.materialParts!, colorPart = parts.pocketFloors!;
    expect(colorPart.volume()).toBeGreaterThan(1);
    expect(colorPart.boundingBox().max[2]).toBeCloseTo(top-1,5);
    expect(arena.track(plain.solid.subtract(built.solid)).volume()).toBeLessThan(1e-6);
    expect(arena.track(built.solid.subtract(plain.solid)).volume()).toBeLessThan(1e-6);
    const joined = arena.track(parts.body.add(colorPart));
    expect(arena.track(built.solid.subtract(joined)).volume()).toBeLessThan(.001);
    expect(arena.track(joined.subtract(built.solid)).volume()).toBeLessThan(.001);
    expect(arena.track(parts.body.intersect(colorPart)).volume()).toBeLessThan(.001);
    for (const solid of [parts.body,colorPart]) expectPrintableTopology(extractPrintableMeshData(k,solid));
  }
});
it.each([false,true])("starts interior color below clamped shallow rounding with a rigid pose=%s", rigid => {
  // The 2 mm request is limited to half the 1 mm pocket depth.
  const top = resolvePocketDepth(spec,pocket.depth).infillTopZ;
  const p = {...pocket,elevationMm:rigid ? top-1 : undefined,
    insertionMode:rigid ? pocket.insertionMode : undefined,depth:{mode:"mm" as const,value:1},
    topFilletMm:2,colorCoverage:"interior" as const};
  const built = make([p]);
  expect(built.materialParts!.pocketFloors!.boundingBox().max[2]).toBeCloseTo(top-.5,5);
});
