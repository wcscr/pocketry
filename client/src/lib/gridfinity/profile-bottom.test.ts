import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { buildProfileBottomCutout, resolvedProfileFootprint } from "./profile-bottom";
import { buildBinWithCutouts, PREVIEW_QUALITY, EXPORT_QUALITY } from "./bin";
import { buildCutoutCutters } from "./cutouts";
import { layoutRingsMm, generateLayoutDXF, generateLayoutSVG } from "@/lib/export/layout";
import { toCrossSection } from "@/lib/geometry/offset";
import { signedArea } from "@shared/geometry/rings";
import { profilePrisms } from "@shared/gridfinity/profile-bottom";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm,arena); });
afterEach(() => arena.dispose());
const shape: TracedShape = { id:"s", name:"Step", sourceMmPerPx:1, pointCount:6,
  bboxMm:{minX:-20,maxX:20,minY:0,maxY:20},
  outlineMm:[{outer:[[-20,0],[0,0],[0,8],[20,8],[20,20],[-20,20]].map(([x,y])=>({x,y})),holes:[]}] };
const cutout = parseCutoutPlacement({id:"p",shapeId:shape.id,position:{x:0,y:0},
  profileBottom:{edge:"bottom",widthMm:6,elevationMm:8}});
const spec = parseBinSpec({gridX:2,gridY:2,heightUnits:6,fill:"solid",lip:"none"});
const shapes = new Map([[shape.id,shape]]);

describe("profile-bottom solid", () => {
  it("lays the entire source flat at X 90 degrees, and turns it upside down at 180", () => {
    const flat = {...cutout,profileRotation:{xDeg:90,yDeg:0}};
    const cutter=buildProfileBottomCutout(kernel,shape,flat,spec).cutters[0];
    expect(cutter.boundingBox().min[2]).toBeCloseTo(8);
    expect(arena.track(cutter.slice(9)).area()).toBeCloseTo(640,5);
    expect(arena.track(cutter.slice(41)).area()).toBe(0);
    expect(cutter.volume()).toBeCloseTo(640 * 6, 5);
    const flipped=buildProfileBottomCutout(kernel,shape,{...flat,profileRotation:{xDeg:180,yDeg:0}},spec).cutters[0];
    expect(arena.track(flipped.slice(9)).area()).toBeCloseTo(240,5);
  });
  it.each([[35,-42,23],[90,0,0],[0,90,0],[180,0,0],[-90,180,43],[0,360,0]])(
    "keeps finite rotated cavities and layout/export sections exact at %s/%s/%s", async (xDeg,yDeg,rotationDeg) => {
      const p={...cutout,profileRotation:{xDeg,yDeg},rotationDeg};
      const cutter=buildProfileBottomCutout(kernel,shape,p,spec,0.6).cutters[0];
      expect(cutter.status()).toBe("NoError");
      expect(cutter.boundingBox().min[2]).toBeCloseTo(8,5);
      const tallSpec = {...spec, heightUnits:30};
      const complete = buildProfileBottomCutout(kernel,shape,p,tallSpec).cutters[0];
      expect(complete.volume()).toBeCloseTo(640 * 6, 4);
      const objectTop = Math.max(...profilePrisms(shape.outlineMm,p).flatMap(c => c.vertices.map(v => v.z)));
      expect(complete.boundingBox().max[2]).toBeCloseTo(objectTop, 5);
      for(const z of [8.1,12.1,20.1,30.1,41,42]) {
        const section = resolvedProfileFootprint(kernel,shape.outlineMm,p,z);
        const displayed = toCrossSection(kernel,section), actual = arena.track(cutter.slice(z));
        expect(arena.track(displayed.subtract(actual)).area()).toBeCloseTo(0,4);
        expect(arena.track(actual.subtract(displayed)).area()).toBeCloseTo(0,4);
      }
      const rings=layoutRingsMm(spec,[p],shapes,[],kernel);
      expect(rings.slice(1).reduce((a,r)=>a+signedArea(r),0)).toBeCloseTo(arena.track(cutter.slice(42)).area(),4);
      const svg=await generateLayoutSVG(spec,[p],shapes),dxf=await generateLayoutDXF(spec,[p],shapes);
      expect(svg.match(/<path /g)).toHaveLength(rings.length);
      expect(dxf.match(/LWPOLYLINE/g)).toHaveLength(rings.length);
      const exported=buildCutoutCutters(kernel,shapes,[p],spec,EXPORT_QUALITY).cutters[0];
      expect(cutter.volume()).toBeCloseTo(exported.volume(),5);
      const built=buildBinWithCutouts(kernel,spec,{shapesById:shapes,cutouts:[p],fingerHoles:[]},EXPORT_QUALITY,{floorInsertThicknessMm:0.6});
      expect(built.solid.status()).toBe("NoError");
      expect(built.solid.volume()).toBeGreaterThan(0);
    });
  it("moves a rotated object rigidly and retains the extrusion thickness", () => {
    const p={...cutout,profileRotation:{xDeg:38,yDeg:125},rotationDeg:72};
    const before=profilePrisms(shape.outlineMm,p);
    const after=profilePrisms(shape.outlineMm,{...p,profileBottom:{...p.profileBottom!,elevationMm:70}});
    before.forEach((cell,i)=>{
      cell.vertices.forEach((v,j)=>{
        expect(after[i].vertices[j].x).toBeCloseTo(v.x); expect(after[i].vertices[j].y).toBeCloseTo(v.y);
        expect(after[i].vertices[j].z-v.z).toBeCloseTo(62);
      });
      const a=cell.vertices[0],b=cell.vertices[cell.capSize];
      expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeCloseTo(6,10);
    });
  });
  it("cuts the finite profile and retains material above a submerged object", () => {
    const cutter = buildProfileBottomCutout(kernel,shape,cutout,spec).cutters[0];
    expect(cutter.status()).toBe("NoError");
    expect(arena.track(cutter.slice(7)).area()).toBeCloseTo(0);
    expect(arena.track(cutter.slice(10)).area()).toBeCloseTo(20*6);
    expect(arena.track(cutter.slice(20)).area()).toBeCloseTo(40*6);
    expect(arena.track(cutter.slice(41)).area()).toBe(0);
    expect(cutter.boundingBox().max[2]).toBeCloseTo(28);
    expect(cutter.boundingBox().min[2]).toBeCloseTo(8);
  });
  it.each(["bottom","top","left","right"] as const)("builds %s-down orientation with independent straight width", edge => {
    const p={...cutout,profileBottom:{...cutout.profileBottom!,edge,widthMm:11}};
    const cutter=buildProfileBottomCutout(kernel,shape,p,spec).cutters[0];
    const bounds=cutter.boundingBox();
    expect(bounds.min[2]).toBeCloseTo(8);
    const axis=edge === "bottom" || edge === "top" ? 1 : 0;
    expect(bounds.max[axis]-bounds.min[axis]).toBeCloseTo(11);
    expect(cutter.status()).toBe("NoError");
  });
  it.each(["bottom","top","left","right"] as const)("matches the positioned surface section with %s down after scaling, mirroring and XYZ rotation", edge => {
    const p={...cutout,position:{x:13,y:-7},rotationDeg:27,mirrored:true,scaleX:1.2,scaleY:0.7,
      profileRotation:{xDeg:37,yDeg:-28},profileBottom:{...cutout.profileBottom!,edge}};
    const cutter=buildProfileBottomCutout(kernel,shape,p,{...spec,heightUnits:20}).cutters[0];
    for(const z of [9,14,23,32]) {
      const section=toCrossSection(kernel,resolvedProfileFootprint(kernel,shape.outlineMm,p,z));
      const actual=arena.track(cutter.slice(z));
      expect(arena.track(section.subtract(actual)).area()).toBeCloseTo(0,4);
      expect(arena.track(actual.subtract(section)).area()).toBeCloseTo(0,4);
    }
  });
  it("builds a watertight bin with an enclosed cavity and a floor-color band following both steps", () => {
    const built=buildBinWithCutouts(kernel,spec,{shapesById:shapes,cutouts:[cutout],fingerHoles:[]},PREVIEW_QUALITY,{floorInsertThicknessMm:0.6});
    expect(built.solid.status()).toBe("NoError");
    const base=buildBinWithCutouts(kernel,spec,null,PREVIEW_QUALITY);
    expect(base.solid.volume()-built.solid.volume()).toBeCloseTo(640 * 6,4);
    expect(arena.track(arena.track(base.solid.slice(41)).subtract(arena.track(built.solid.slice(41)))).area()).toBeCloseTo(0,5);
    expect(resolvedProfileFootprint(kernel,shape.outlineMm,cutout,42)).toEqual([]);
    const insert=built.materialParts!.pocketFloors!;
    expect(insert).not.toBeNull();
    expect(insert.volume()).toBeCloseTo(40*6*0.6,4);
    expect(arena.track(insert.slice(7.7)).area()).toBeCloseTo(20*6);
    expect(arena.track(insert.slice(15.7)).area()).toBeCloseTo(20*6);
    expect(arena.track(insert.slice(10)).area()).toBeCloseTo(0);
  });
  it("matches preview/export and clips layout openings at the actual lowered fill surface", () => {
    const p={...cutout,profileBottom:{...cutout.profileBottom!,elevationMm:38}};
    const preview=buildCutoutCutters(kernel,shapes,[p],spec,PREVIEW_QUALITY).cutters[0];
    const exported=buildCutoutCutters(kernel,shapes,[p],spec,EXPORT_QUALITY).cutters[0];
    expect(preview.volume()).toBeCloseTo(exported.volume(),6);
    expect(arena.track(preview.slice(42)).area()).toBeCloseTo(20*6);
    const rings=layoutRingsMm(spec,[p],shapes,[],kernel);
    expect(rings).toHaveLength(2);
    expect(Math.max(...rings[1].map(p=>p.x))).toBe(0);
    expect(layoutRingsMm({...spec,fillHeightPercent:30},[p],shapes)).toHaveLength(1);
  });
  it("opens only the narrowing profile section at the surface, retaining the overhanging fill", async () => {
    const diamond: TracedShape = {...shape, pointCount:4, bboxMm:{minX:-20,maxX:20,minY:0,maxY:40},
      outlineMm:[{outer:[[0,0],[20,20],[0,40],[-20,20]].map(([x,y])=>({x,y})),holes:[]}]};
    const p={...cutout,profileBottom:{...cutout.profileBottom!,elevationMm:12}};
    const map=new Map([[diamond.id,diamond]]);
    const cutter=buildProfileBottomCutout(kernel,diamond,p,spec).cutters[0];
    expect(arena.track(cutter.slice(32)).area()).toBeCloseTo(40*6,5);
    expect(arena.track(cutter.slice(42)).area()).toBeCloseTo(20*6,5);
    const section=resolvedProfileFootprint(kernel,diamond.outlineMm,p,42);
    expect(section).toHaveLength(1);
    expect(Math.min(...section[0].outer.map(v=>v.x))).toBeCloseTo(-10);
    expect(Math.max(...section[0].outer.map(v=>v.x))).toBeCloseTo(10);
    const base=buildBinWithCutouts(kernel,spec,null,EXPORT_QUALITY);
    const bin=buildBinWithCutouts(kernel,spec,{cutouts:[p],shapesById:map,fingerHoles:[]},EXPORT_QUALITY);
    const removed=arena.track(arena.track(base.solid.slice(42-1e-6)).subtract(arena.track(bin.solid.slice(42-1e-6))));
    expect(removed.area()).toBeCloseTo(20*6,4);
    const lowered={...spec,fillHeightPercent:75};
    const top=resolvePocketDepth(lowered,{mode:"through"}).infillTopZ;
    expect(layoutRingsMm(lowered,[p],map,[],kernel).slice(1).reduce((a,r)=>a+signedArea(r),0))
      .toBeCloseTo(arena.track(cutter.slice(top)).area(),5);
    expect((await generateLayoutSVG(spec,[p],map)).match(/<path /g)).toHaveLength(2);
  });
  it("preserves an interior hole through the finite profile extrusion and surface section", () => {
    const holed: TracedShape={...shape,outlineMm:[{
      outer:[[-20,0],[20,0],[20,20],[-20,20]].map(([x,y])=>({x,y})),
      holes:[[[-5,5],[-5,15],[5,15],[5,5]].map(([x,y])=>({x,y}))],
    }]};
    const p={...cutout,profileBottom:{...cutout.profileBottom!,elevationMm:30}};
    const section=resolvedProfileFootprint(kernel,holed.outlineMm,p,42);
    expect(section).toHaveLength(2);
    expect(section.reduce((a,s)=>a+signedArea(s.outer),0)).toBeCloseTo(30*6,5);
    const cutter=buildProfileBottomCutout(kernel,holed,p,{...spec,heightUnits:10}).cutters[0];
    expect(cutter.volume()).toBeCloseTo((40*20-10*10)*6,5);
  });
  it("has no surface opening while fully submerged or raised clear, including a flat pose", () => {
    for (const elevationMm of [8,60]) {
      const p={...cutout,profileRotation:{xDeg:90,yDeg:0},profileBottom:{...cutout.profileBottom!,elevationMm}};
      expect(resolvedProfileFootprint(kernel,shape.outlineMm,p,42)).toEqual([]);
      expect(resolvedProfileFootprint(kernel,shape.outlineMm,p)).not.toEqual([]);
    }
    const crossing={...cutout,profileRotation:{xDeg:90,yDeg:0},profileBottom:{...cutout.profileBottom!,elevationMm:40}};
    expect(resolvedProfileFootprint(kernel,shape.outlineMm,crossing,42).reduce((a,s)=>a+signedArea(s.outer),0)).toBeCloseTo(640,5);
  });
  it("uses the material side of a coplanar face at the fill surface", () => {
    expect(resolvedProfileFootprint(kernel,shape.outlineMm,cutout,8)).toEqual([]);
    expect(resolvedProfileFootprint(kernel,shape.outlineMm,cutout,28).reduce((a,s)=>a+signedArea(s.outer),0)).toBeCloseTo(240,5);
    expect(resolvedProfileFootprint(kernel,shape.outlineMm,cutout,29)).toEqual([]);
  });
  it("can lift entirely clear, producing an unchanged solid and no floor material", () => {
    const raised={...cutout,profileBottom:{...cutout.profileBottom!,elevationMm:80}};
    const empty=buildProfileBottomCutout(kernel,shape,raised,spec,0.6);
    expect(empty.cutters).toEqual([]); expect(empty.floorInserts).toEqual([]);
    expect(empty.reports[0].emptied).toBe(false);
    const base=buildBinWithCutouts(kernel,spec,null,PREVIEW_QUALITY);
    const built=buildBinWithCutouts(kernel,spec,{shapesById:shapes,cutouts:[raised],fingerHoles:[]},PREVIEW_QUALITY);
    expect(built.solid.volume()).toBeCloseTo(base.solid.volume(),5);
  });
});
