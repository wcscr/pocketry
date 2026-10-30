import { beforeAll, describe, expect, it } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { binTotalHeightMm } from "@shared/gridfinity/standard";
import { loadCad, type OpenCascadeInstance } from "./runtime";
import { CadContext } from "./adapter";
import { buildCadBinBlank } from "./bin";
import { pocketSection, extrudeSection, roundPocketBottom } from "./profile-operations";

let oc:OpenCascadeInstance;
beforeAll(async()=>{oc=await loadCad();},60_000);
describe("analytic CAD bin construction",()=>{
  it.each(["full","half","quarter"] as const)("builds %s Gridfinity feet and a true-curve stacking rim",gridPitch=>{
    const c=new CadContext(oc);
    try {
      const spec=parseBinSpec({gridX:1,gridY:1,heightUnits:3,gridPitch});
      const {blank}=buildCadBinBlank(c,spec);
      expect(c.valid(blank)).toBe(true);
      const bounds=c.bounds(blank);expect(bounds.min.z).toBeCloseTo(0,6);
      expect(bounds.max.z).toBeCloseTo(binTotalHeightMm(3,true),6);
      expect(bounds.max.x-bounds.min.x).toBeCloseTo(gridPitch==="full"?41.5:gridPitch==="half"?20.5:10,6);
    }finally{c.dispose();}
  },60_000);
  it("constructs hollow and partial-fill bins, preserving an irregular footprint",()=>{
    const c=new CadContext(oc);
    try {
      const spec=parseBinSpec({gridX:2,gridY:2,heightUnits:3,fill:"none",flatBottom:true,lip:"none",footprint:{kind:"custom",cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]}});
      const hollow=buildCadBinBlank(c,spec).blank;
      const filled=buildCadBinBlank(c,{...spec,fill:"solid",fillHeightPercent:50}).blank;
      expect(c.valid(hollow)).toBe(true);expect(c.valid(filled)).toBe(true);
      expect(c.volume(filled)).toBeGreaterThan(c.volume(hollow));
      const corner=c.move(c.extrude({kind:"ellipse",rx:3,ry:3},0,22),{x:21,y:21,z:0});
      expect(c.volume(c.boolean("common",filled,corner,"missing custom corner",true))).toBeCloseTo(0,6);
    }finally{c.dispose();}
  },60_000);
  it("retains holes during exact offsets and rounds the actual source bottom",()=>{
    const c=new CadContext(oc);
    try {
      const section=pocketSection(c,[{kind:"polygon",outer:[{x:0,y:0},{x:20,y:0},{x:20,y:10},{x:10,y:10},{x:10,y:20},{x:0,y:20}],holes:[[{x:2,y:2},{x:2,y:4},{x:4,y:4},{x:4,y:2}]]}],0.2,0);
      expect(c.volume(section)).toBeCloseTo(316.1170796326794-2.56,5);
      const source=roundPocketBottom(c,extrudeSection(c,section,-8,0),-8,0.4);
      expect(c.valid(source)).toBe(true);
      expect(c.volume(source)).toBeLessThan(c.volume(section)*8);
    }finally{c.dispose();}
  },60_000);
});
