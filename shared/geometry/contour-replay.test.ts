import { expect, it } from "vitest";
import { missingMaterialFailure, outlineToInput, replayMatches } from "./contour-replay";
import type { Outline } from "./types";
const a:Outline=[{outer:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],holes:[]}];
it("fails replay for a short deep notch and for translation",()=>{
  const b=structuredClone(a); b[0].outer.splice(1,0,{x:48,y:0},{x:48,y:4},{x:52,y:4},{x:52,y:0});
  expect(replayMatches(a,b)).toBe(false);
  expect(replayMatches(a,a.map(s=>({...s,outer:s.outer.map(p=>({x:p.x+1,y:p.y}))})))).toBe(false);
  expect(replayMatches(a,structuredClone(a))).toBe(true);
});
it("counts empty results as failures and uses the recorded raster transform",()=>{
  expect(missingMaterialFailure([],null)).toBe(true);
  expect(missingMaterialFailure(a,0)).toBe(false);
  expect(outlineToInput(a,{origin:{x:10,y:20},scale:{x:2,y:4}})[0].outer[0]).toEqual({x:-5,y:-5});
});
