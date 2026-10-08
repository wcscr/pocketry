import { describe, expect, it } from "vitest";
import { signedArea } from "../geometry/rings";
import type { Outline } from "../geometry/types";
import { parseCutoutPlacement, resolvePlacedPocketDepth, resizeCutoutPlacementFromHandle } from "./cutout";
import { parseBinSpec } from "./types";
import { validateLayout } from "./validate";
import { profileBottomSchema, profileFloorSegments, profileFootprint } from "./profile-bottom";

const outline: Outline = [{ outer: [[-20,0],[0,0],[0,8],[20,8],[20,20],[-20,20]].map(([x,y]) => ({x,y})), holes: [] }];
const placement = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 },
  profileBottom: { edge: "bottom", widthMm: 6, elevationMm: 5 } });
const shape = { id: "s", name: "Stepped tool", outlineMm: outline, bboxMm: { minX: -20, maxX: 20, minY: 0, maxY: 20 }, pointCount: 6, sourceMmPerPx: 1 };
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, fill: "solid", lip: "none" });

describe("profile bottom", () => {
  it("reports the lower silhouette and preserves a vertical step", () => {
    expect(profileFloorSegments(outline, placement)).toEqual([
      { a: { x: -20, y: 5 }, b: { x: 0, y: 5 } },
      { a: { x: 0, y: 13 }, b: { x: 20, y: 13 } },
    ]);
  });
  it.each(["bottom", "top", "left", "right"] as const)("places %s down with positive footprint winding and a fixed lowest point", edge => {
    const p = { ...placement, profileBottom: { ...placement.profileBottom!, edge }, rotationDeg: 37, mirrored: true, scaleX: 1.3, scaleY: 0.7 };
    const floor = profileFloorSegments(outline, p);
    expect(Math.min(...floor.flatMap(s => [s.a.y, s.b.y]))).toBeCloseTo(5);
    expect(profileFootprint(outline, p).every(part => signedArea(part.outer) > 0)).toBe(true);
    expect(floor.every(s => s.b.x > s.a.x)).toBe(true);
  });
  it("changes thickness without changing any floor point, and translates the profile rigidly", () => {
    const before = profileFloorSegments(outline, placement);
    expect(profileFloorSegments(outline, { ...placement, profileBottom: { ...placement.profileBottom!, widthMm: 27 } })).toEqual(before);
    const moved = profileFloorSegments(outline, { ...placement, profileBottom: { ...placement.profileBottom!, elevationMm: 25 } });
    moved.forEach((s,i) => {
      expect(s.a).toEqual({ x: before[i].a.x, y: before[i].a.y + 20 });
      expect(s.b).toEqual({ x: before[i].b.x, y: before[i].b.y + 20 });
    });
  });
  it("keeps the lower-envelope measurement separate from the finite section", () => {
    const holed = [{ ...outline[0], holes: [[{x:-15,y:10},{x:-15,y:15},{x:-10,y:15},{x:-10,y:10}]] }];
    expect(profileFloorSegments(holed, placement)).toEqual(profileFloorSegments(outline, placement));
    const hooked: Outline = [{ outer: [[0,0],[10,0],[10,3],[3,3],[3,7],[10,7],[10,10],[0,10]].map(([x,y])=>({x,y})), holes: [] }];
    expect(profileFloorSegments(hooked, placement)).toEqual([{ a: {x:0,y:5}, b:{x:10,y:5} }]);
    expect(profileFootprint(hooked, placement, 10).reduce((area, part) => area + signedArea(part.outer), 0)).toBeCloseTo(3 * 6);
    expect(profileFootprint(outline, placement, 30)).toEqual([]);
  });
  it("resolves crossing components and preserves gaps between separate components", () => {
    const crossing: Outline = [ [[-10,0],[10,20],[-10,20]], [[-10,20],[10,0],[10,20]] ].map(points => ({outer:points.map(([x,y])=>({x,y})),holes:[]}));
    expect(profileFloorSegments(crossing, placement)).toEqual([
      {a:{x:-10,y:5},b:{x:0,y:15}}, {a:{x:0,y:15},b:{x:10,y:5}},
    ]);
    const separate = [outline[0], { outer: outline[0].outer.map(p=>({x:p.x+60,y:p.y})), holes: [] }];
    expect(profileFootprint(separate, placement)).toHaveLength(2);
  });
  it("clips the top opening as high parts rise above the fill, while keeping an editable full footprint", () => {
    expect(profileFootprint(outline, placement, 10)[0].outer).toEqual([{x:-20,y:-3},{x:0,y:-3},{x:0,y:3},{x:-20,y:3}]);
    const raised = { ...placement, profileBottom: { ...placement.profileBottom!, elevationMm: 60 } };
    expect(profileFootprint(outline, raised, 42)).toEqual([]);
    expect(profileFootprint(outline, raised)).toHaveLength(1);
    expect(resolvePlacedPocketDepth(spec, raised.depth, shape, raised).depthMm).toBe(0);
    expect(validateLayout(spec, [raised], new Map([[shape.id, shape]])).filter(i=>i.severity === "error")).toEqual([]);
  });
  it("ignores dormant depth, tilt, split and rounding without mutating them", () => {
    const p = { ...placement, profileBottom: { ...placement.profileBottom!, elevationMm: 8 }, depth: { mode: "through" as const }, tilt: {xDeg:89,yDeg:89}, zOffsetMm:30,
      split:{boundary:[{x:-100,y:100},{x:100,y:100}],depths:[{mode:"through" as const},{mode:"through" as const}] as [{mode:"through"},{mode:"through"}]} };
    expect(resolvePlacedPocketDepth(spec,p.depth,shape,p)).toMatchObject({floorZ:8,highestFloorZ:16,depthMm:34});
    expect(validateLayout(spec,[p],new Map([[shape.id,shape]])).filter(i=>i.severity === "error")).toEqual([]);
    expect(p.tilt).toEqual({xDeg:89,yDeg:89});
  });
  it("resizes slot width through plan handles without scaling the contour", () => {
    const resized = resizeCutoutPlacementFromHandle(placement, {minX:-20,maxX:20,minY:-3,maxY:3}, "n", {x:0,y:9});
    expect(resized.profileBottom?.widthMm).toBe(12);
    expect(resized.position.y).toBe(3);
    expect(resized.scaleX).toBe(1); expect(resized.scaleY).toBe(1);
    expect(profileFloorSegments(outline,resized)).toEqual(profileFloorSegments(outline,placement));
  });
  it("protects the base and treats profiles above the fill as an allowed warning", () => {
    expect(validateLayout(spec,[placement],new Map([[shape.id,shape]])).some(i=>i.code === "too-deep" && i.severity === "error")).toBe(true);
    expect(validateLayout({...spec,flatBottom:true},[placement],new Map([[shape.id,shape]])).filter(i=>i.severity === "error")).toEqual([]);
  });
  it.each([NaN, Infinity, -1, 301])("rejects invalid width or elevation %s", value => {
    expect(profileBottomSchema.safeParse({edge:"bottom",widthMm:value,elevationMm:5}).success).toBe(false);
    expect(profileBottomSchema.safeParse({edge:"bottom",widthMm:5,elevationMm:value}).success).toBe(false);
  });
});
