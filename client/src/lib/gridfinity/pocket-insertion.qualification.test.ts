import { arena, kernel, shape, spec, pocket, map, cutter } from "./pocket-insertion.test-support";
import { expect, it } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth } from "@shared/gridfinity/cutout";
import { buildCutoutCutters, buildRigidPocket } from "./cutouts";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";

it.each(["axis", "vertical"] as const)("keeps %s openings rounded at the surface and split floor colors nonoverlapping", insertionMode => {
  const s = { ...shape, outlineMm: [{ ...shape.outlineMm[0], holes: [[[-3,-3],[-3,3],[3,3],[3,-3]].map(([x,y]) => ({x,y}))] }] };
  const p = parseCutoutPlacement({ ...pocket, insertionMode, topFilletMm: 2, bottomFilletMm: 1,
    split: { boundary: [{ x: -15, y: 5 }, { x: 15, y: 5 }], depths: [{mode:"mm",value:10},{mode:"mm",value:16}] } });
  const rounded = cutter(p, s), sharp = cutter({ ...p, topFilletMm: 0 }, s);
  const top = resolvePocketDepth(spec, p.depth).infillTopZ;
  expect(arena.track(rounded.slice(top-1e-6)).area()).toBeGreaterThan(arena.track(sharp.slice(top-1e-6)).area());
  const layout = { shapesById: new Map([[s.id,s]]), cutouts: [p], fingerHoles: [] };
  const built = buildBinWithCutouts(kernel, { ...spec,heightUnits:4 }, layout, EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
  expect(built.validationIssues).toEqual([]);
  expect(built.solid.status()).toBe("NoError");
  expect(arena.track(built.materialParts!.body.intersect(built.materialParts!.pocketFloors!)).volume()).toBeLessThan(1e-5);
  expect(built.materialParts!.body.volume() + built.materialParts!.pocketFloors!.volume()).toBeCloseTo(built.solid.volume(), 4);
}, 30_000);

it("isolates an invalid axial pocket in preview while retaining the other cavity", () => {
  const invalid = { ...pocket, insertionMode: "axis" as const, tilt: { xDeg: 90, yDeg: 0 } };
  const other = { ...pocket, id: "other", position: {x:25,y:0}, tilt: undefined };
  const built = buildBinWithCutouts(kernel, spec, { shapesById: map, cutouts: [invalid,other], fingerHoles: [] }, EXPORT_QUALITY);
  const reference = buildBinWithCutouts(kernel, spec, { shapesById: map, cutouts: [other], fingerHoles: [] }, EXPORT_QUALITY);
  expect(built.validationIssues).toContainEqual(expect.objectContaining({ code: "invalid-pocket-insertion", severity: "error" }));
  expect(built.solid.volume()).toBeCloseTo(reference.solid.volume(), 5);
});

it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("allows a tilted seat to protrude without a full-footprint opening at quality=$cutoutVertexBudget", quality => {
  const p = {...pocket,elevationMm:12,tilt:{xDeg:20,yDeg:25},insertionMode:"vertical" as const};
  const built = buildBinWithCutouts(kernel,spec,{shapesById:map,cutouts:[p],fingerHoles:[]},quality);
  expect(built.validationIssues.filter(issue => issue.severity === "error")).toEqual([]);
  const source = buildRigidPocket(kernel,shape,{...p,insertionMode:undefined},spec,quality).cutters[0];
  const swept = buildCutoutCutters(kernel,map,[p],spec,quality).cutters[0];
  const top = resolvePocketDepth(spec,p.depth).infillTopZ;
  const footprint = arena.track(source.project()), mouth = arena.track(swept.slice(top-1e-7));
  // The former check rejected this missing area even though the corresponding
  // parts of the object stay above the bin during the entire insertion.
  expect(arena.track(footprint.subtract(mouth)).area()).toBeGreaterThan(10);
  for (const travel of [0,.1,1,4,10,30]) {
    const moved = arena.track(source.translate([0,0,travel]));
    expect(arena.track(moved.intersect(built.solid)).volume()).toBeLessThan(.01);
  }
  const above = buildBinWithCutouts(kernel,spec,{shapesById:map,cutouts:[{...p,elevationMm:80}],fingerHoles:[]},quality);
  expect(above.validationIssues.filter(issue => issue.severity === "error")).toEqual([]);
});

it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("reports actual floor interference and clears it when the pocket is raised at quality=$cutoutVertexBudget", quality => {
  const p = {...pocket,elevationMm:7,insertionMode:"vertical" as const,
    depth:{mode:"remaining" as const,floorThicknessMm:9,sourceDepthMm:16}};
  const build = (cutouts: typeof p[]) => buildBinWithCutouts(kernel,spec,{shapesById:map,cutouts,fingerHoles:[]},quality);
  const blocked = build([p]);
  expect(blocked.validationIssues).toContainEqual(expect.objectContaining({code:"pocket-insertion-collision",severity:"error",cutoutIds:[p.id]}));
  const source = buildRigidPocket(kernel,shape,{...p,insertionMode:undefined,depth:{mode:"mm",value:16}},spec,quality).cutters[0];
  expect(arena.track(source.intersect(blocked.solid)).volume()).toBeGreaterThan(1);
  expect(build([{...p,elevationMm:9}]).validationIssues.filter(issue => issue.severity === "error")).toEqual([]);
  // Judge the finished bin: an overlapping cut can remove the obstruction.
  const extra = {...p,id:"extra",depth:{...p.depth,floorThicknessMm:7}};
  expect(build([p,extra]).validationIssues.some(issue => issue.code === "pocket-insertion-collision")).toBe(false);
});

it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("detects a retained bridge only crossed during insertion at quality=$cutoutVertexBudget", quality => {
  const p = {...pocket,tilt:undefined,depth:{mode:"mm" as const,value:2},insertionMode:"vertical" as const};
  const bridge = {...p,id:"bridge",role:"hole" as const,insertionMode:undefined,elevationMm:14,scaleX:2,scaleY:.2};
  const built = buildBinWithCutouts(kernel,spec,{shapesById:map,cutouts:[p,bridge],fingerHoles:[]},quality);
  const source = buildRigidPocket(kernel,shape,{...p,insertionMode:undefined},spec,quality).cutters[0];
  expect(arena.track(source.intersect(built.solid)).volume()).toBeLessThan(.01);
  expect(arena.track(arena.track(source.translate([0,0,7])).intersect(built.solid)).volume()).toBeGreaterThan(1);
  expect(built.validationIssues).toContainEqual(expect.objectContaining({code:"pocket-insertion-collision",cutoutIds:[p.id]}));
  expect(built.validationIssues.some(issue => issue.cutoutIds?.includes(bridge.id))).toBe(false);
  const removed = buildBinWithCutouts(kernel,spec,{shapesById:map,cutouts:[p],fingerHoles:[]},quality);
  expect(removed.validationIssues.filter(issue => issue.severity === "error")).toEqual([]);
});
