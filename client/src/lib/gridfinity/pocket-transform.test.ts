import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { parseCutoutPlacement, resolvePlacedPocketDepth, transformPointPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { rotatePocketVector } from "@shared/gridfinity/pocket-orientation";
import { pickPocketAtTop, pocketQuaternion, pocketTransformPatch, pocketTransformWires, surfaceAnchoredPocket, pocketTransformChanged, pocketVerticalDepthMm } from "./pocket-transform";

const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6, lip: "none", fill: "solid" });
const shape: TracedShape = { id: "s", name: "Slot", source: "basic-shape", sourceMmPerPx: null, pointCount: 4,
  bboxMm: { minX: -3, maxX: 3, minY: -10, maxY: 10 }, outlineMm: [{ outer: [{ x: -3, y: -10 }, { x: 3, y: -10 }, { x: 3, y: 10 }, { x: -3, y: 10 }], holes: [] }] };
const pocket = parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 5, y: -4 }, rotationDeg: 32,
  tilt: { xDeg: 15, yDeg: -25 }, depth: { mode: "remaining", floorThicknessMm: 9 } });
const origin = new Vector3(5, -4, 42);
const identity = new Quaternion();

describe("surface-anchored pocket controls", () => {
  it("draws only boundary rings and sparse struts for a concave, holed rigid drag preview", () => {
    const outlineMm = [{ outer: [[0,0],[30,0],[30,10],[20,10],[20,20],[0,20]].map(([x,y]) => ({x,y})),
      holes: [[[5,5],[5,10],[10,10],[10,5]].map(([x,y]) => ({x,y}))] }];
    const source = { ...shape, outlineMm };
    const cutout = { ...pocket, position: {x:0,y:0}, rotationDeg:0, tilt:undefined,
      elevationMm:7, depth:{mode:"mm" as const,value:6} };
    const wires = pocketTransformWires({ cutout, shape: source }, spec);
    const contours = wires.filter(w => w.length > 2);
    expect(contours).toHaveLength(4);
    expect(contours.map(w => w.length)).toEqual([7,7,5,5]);
    expect(wires).toHaveLength(14);
    for (const [a,b] of wires.filter(w => w.length === 2)) {
      expect(a.slice(0,2)).toEqual(b.slice(0,2));
      expect(b[2] - a[2]).toBe(6);
    }
    const moved = pocketTransformWires({ cutout: {...cutout, tilt:{xDeg:90,yDeg:37}, mirrored:true}, shape:source }, spec);
    expect(moved.map(w => w.length)).toEqual(wires.map(w => w.length));
    expect(Math.min(...moved.flat().map(v => v[2]))).toBeCloseTo(7);
  });
  it("moves bottom profiles through the top surface without changing thickness or dormant settings", () => {
    const p = { ...pocket, profileBottom: { edge: "bottom" as const, widthMm: 10, elevationMm: 12 }, zOffsetMm: 2 };
    const patch = pocketTransformPatch(p,shape,spec,new Vector3(8,-2,92),identity,"translate")!;
    expect(patch.profileBottom).toEqual({edge:"bottom",widthMm:10,elevationMm:62});
    expect(patch.depth).toEqual(p.depth); expect(patch.tilt).toEqual(p.tilt); expect(patch.zOffsetMm).toBe(2);
    expect(pocketTransformChanged(p,patch,"translate")).toBe(true);
    expect(pocketVerticalDepthMm({cutout:{...p,...patch},shape},spec)).toBe(0);
    expect(pocketTransformWires({cutout:{...p,...patch},shape},spec).flat().some(v=>v[2]>42)).toBe(true);
    const low = pocketTransformPatch(p,shape,spec,new Vector3(5,-4,-500),identity,"translate")!;
    expect(low.profileBottom?.elevationMm).toBe(7);
  });
  it("previews the finite profile height without extending its edges to the surface", () => {
    const p={...pocket,profileBottom:{edge:"bottom" as const,widthMm:10,elevationMm:8}};
    const vertices=pocketTransformWires({cutout:p,shape},spec).flat();
    expect(Math.min(...vertices.map(p=>p[2]))).toBeCloseTo(8);
    expect(Math.max(...vertices.map(p=>p[2]))).toBeCloseTo(28);
  });
  it("freely rotates bottom profiles while retaining elevation, thickness and dormant tilt", () => {
    const p={...pocket,profileBottom:{edge:"right" as const,widthMm:10,elevationMm:12}};
    const x=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/4);
    const z=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/2);
    const xPatch = pocketTransformPatch(p,shape,spec,origin,x,"rotate")!;
    expect(xPatch).not.toBeNull();
    expect(Math.abs(pocketQuaternion({...p,...xPatch}).dot(x.clone().multiply(pocketQuaternion(p))))).toBeCloseTo(1,12);
    const patch=pocketTransformPatch(p,shape,spec,origin,z,"rotate")!;
    expect(patch.rotationDeg).toBeCloseTo(122);
    expect(patch.profileBottom).toEqual(p.profileBottom);
    expect(patch.tilt).toEqual(p.tilt);
    for (const axis of [new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)]) {
      for (const degrees of [90,180,270,360]) {
        const q=new Quaternion().setFromAxisAngle(axis,degrees*Math.PI/180);
        const pose=pocketTransformPatch(p,shape,spec,origin,q,"rotate")!;
        expect(pose).not.toBeNull();
        expect(Math.abs(pocketQuaternion({...p,...pose}).dot(q.clone().multiply(pocketQuaternion(p))))).toBeCloseTo(1,12);
        expect(pose.profileBottom).toEqual(p.profileBottom);
      }
    }
  });
  it("uses the same combined orientation as the kernel", () => {
    const point = new Vector3(3, 4, 12);
    const actual = point.clone().applyQuaternion(pocketQuaternion(pocket));
    const expected = rotatePocketVector(point, pocket);
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
    expect(actual.z).toBeCloseTo(expected.z, 9);
  });
  it.each([5, -5, 100, -100])("moves the finite pocket rigidly in Z by %s without changing its dimensions", dz => {
    const fixed = { ...pocket, elevationMm: 12, depth: {mode:"mm" as const,value:30} };
    const patch = pocketTransformPatch(fixed,shape,spec,new Vector3(9,-12,42+dz),identity,"translate")!;
    expect(patch.depth).toEqual(fixed.depth);
    expect(patch.elevationMm).toBe(Math.max(0,12+dz));
    expect(patch.position).toEqual({x:9,y:-12});
    const before=pocketTransformWires({cutout:fixed,shape},spec).flat();
    const after=pocketTransformWires({cutout:{...fixed,...patch},shape},spec).flat();
    after.forEach((p,i)=>{
      expect(p[0]-before[i][0]).toBeCloseTo(4,7);
      expect(p[1]-before[i][1]).toBeCloseTo(-8,7);
      expect(p[2]-before[i][2]).toBeCloseTo(patch.elevationMm!-12,7);
    });
  });
  it.each([[1,0,0],[0,1,0],[0,0,1]])("accepts full turns around fixed axis %j", (x,y,z) => {
    const fixed={...pocket,elevationMm:12,depth:{mode:"mm" as const,value:30}};
    for(const degrees of [90,135,180,270,360]) {
      const delta=new Quaternion().setFromAxisAngle(new Vector3(x,y,z),degrees*Math.PI/180);
      const patch=pocketTransformPatch(fixed,shape,spec,origin,delta,"rotate")!;
      expect(patch).not.toBeNull();
      expect(patch.depth).toEqual(fixed.depth);
      expect(patch.elevationMm).toBe(12);
      expect(Math.abs(pocketQuaternion({...fixed,...patch}).dot(delta.clone().multiply(pocketQuaternion(fixed))))).toBeCloseTo(1,10);
      expect(parseCutoutPlacement({...fixed,...patch})).toMatchObject({elevationMm:12});
    }
  });
  it("re-anchors legacy offsets without changing their openings or seats, including a no-op drag", () => {
    const old = { ...pocket, zOffsetMm: 2 };
    const anchored = surfaceAnchoredPocket(old);
    const before = pocketTransformWires({ cutout: old, shape }, spec);
    const after = pocketTransformWires({ cutout: anchored, shape }, spec);
    after.flat().forEach((point, i) => point.forEach((value, axis) => expect(value).toBeCloseTo(before.flat()[i][axis], 8)));
    const patch = pocketTransformPatch(old, shape, spec, { ...anchored.position, z: 42 }, identity, "translate")!;
    expect(pocketTransformChanged(old, patch, "translate")).toBe(false);
  });
  it("freezes split depths independently and preserves them through motion and rotation", () => {
    const split={...pocket,tilt:undefined,split:{boundary:[{x:-3,y:0},{x:3,y:0}],
      depths:[{mode:"remaining" as const,floorThicknessMm:20},{mode:"remaining" as const,floorThicknessMm:8}] as [{mode:"remaining";floorThicknessMm:number},{mode:"remaining";floorThicknessMm:number}]}};
    const moved=pocketTransformPatch(split,shape,spec,new Vector3(5,-4,45),identity,"translate")!;
    expect(moved.split?.depths).toEqual([{mode:"remaining",floorThicknessMm:20,sourceDepthMm:22},{mode:"remaining",floorThicknessMm:8,sourceDepthMm:34}]);
    expect(moved.elevationMm).toBe(11);
    const turned=pocketTransformPatch({...split,...moved},shape,spec,origin,new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2),"rotate")!;
    expect(turned.split).toEqual(moved.split);
    expect(turned.elevationMm).toBe(11);
  });
  it("picks the mouth and excludes holes", () => {
    const centre = transformPointPlacement({ x: 0, y: 0 }, pocket);
    const item = { cutout: pocket, shape };
    expect(pickPocketAtTop([item], centre)).toBe(pocket.id);
    expect(pickPocketAtTop([item], { x: 100, y: 100 })).toBeNull();
    const withHole = { ...shape, outlineMm: [{ ...shape.outlineMm[0], holes: [[{ x: -1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: -1 }]] }] };
    expect(pickPocketAtTop([{ ...item, shape: withHole }], centre)).toBeNull();
  });
  it("persists clamped elevation and split dimensions in history", () => {
    const p={...pocket,elevationMm:12,depth:{mode:"mm" as const,value:20}};
    const patch=pocketTransformPatch(p,shape,spec,new Vector3(5,-4,-1000),identity,"translate")!;
    const next=parseCutoutPlacement({...p,...patch});
    expect(next.elevationMm).toBe(0); expect(next.depth).toEqual(p.depth);
    const doc={spec,cutouts:[next],fingerHoles:[]};
    expect(parseProjectDoc({...doc,schemaVersion:PROJECT_SCHEMA_VERSION,shapes:[shape],history:{stack:[{doc,label:"Move"}],index:0}})).not.toBeNull();
  });
  it.each([-1000, 1000])("allows Z heading changes after clamping depth by %s without crossing either floor limit", dz => {
    const original = { ...pocket, tilt: { xDeg: 15.123456789, yDeg: -25.987654321 } };
    for (const depth of [original.depth, { mode: "mm" as const, value: 25 }]) {
      const start = { ...original, depth };
      const moved = { ...start, ...pocketTransformPatch(start, shape, spec, new Vector3(5, -4, 42 + dz), identity, "translate")! };
      const before = resolvePlacedPocketDepth(spec, moved.depth, shape, moved);
      const patch = pocketTransformPatch(moved, shape, spec, origin, new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 36), "rotate");
      expect(patch).not.toBeNull();
      const after = resolvePlacedPocketDepth(spec, patch!.depth, shape, { ...moved, ...patch! });
      expect(after.floorZ).toBeCloseTo(before.floorZ!, 8);
      expect(after.highestFloorZ).toBeCloseTo(before.highestFloorZ!, 8);
    }
  });
  it("allows world Z turns at the supported ±89 degree tilt boundaries", () => {
    for (const tilt of [{ xDeg: 89, yDeg: 0 }, { xDeg: -89, yDeg: 0 }, { xDeg: 0, yDeg: 89 }, { xDeg: 0, yDeg: -89 }]) {
      for (const degrees of [-180, -90, -5, 5, 90, 180]) {
        const start = { ...pocket, rotationDeg: 0, tilt, depth: { mode: "through" as const } };
        const patch = pocketTransformPatch(start, shape, spec, origin, new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degrees * Math.PI / 180), "rotate");
        expect(patch).not.toBeNull();
        expect(patch!.tilt!.xDeg).toBeCloseTo(tilt.xDeg, 9);
        expect(patch!.tilt!.yDeg).toBeCloseTo(tilt.yDeg, 9);
      }
    }
  });
});


it("moving XY does not silently resize a pocket whose tilted seat needs correction", () => {
  const shallow = { ...pocket, depth: { mode: "mm" as const, value: 1 } };
  const patch = pocketTransformPatch(shallow, shape, spec, new Vector3(10, 0, 42), identity, "translate")!;
  expect(patch.position).toEqual({ x: 10, y: 0 });
  expect(patch.depth).toEqual(shallow.depth);
});
