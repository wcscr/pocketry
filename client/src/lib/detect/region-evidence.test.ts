import { expect,it } from "vitest";
import { buildRegionEvidence,solveRegionEvidence } from "./region-evidence";
import type { ImageLike,ScoreField } from "./types";
const image:ImageLike={width:40,height:40,data:new Uint8ClampedArray(6400).fill(230)};
const field:ScoreField={width:40,height:40,scale:1,offsetX:0,offsetY:0,iso:128,otsu:128,score:new Uint8Array(1600)};
it("keeps the proposal and source RGB unchanged without corrections",()=>{
  const input=image.data.slice();
  expect(solveRegionEvidence(field,buildRegionEvidence(image,field))).toBe(field);
  expect(image.data).toEqual(input);
});
it("keeps explicit tool and paper strokes and freezes distant pixels",()=>{
  const filled={...field,score:new Uint8Array(1600).fill(255)};
  const e=buildRegionEvidence(image,filled,[{kind:"paper",points:[{x:20,y:20}],radius:1},{kind:"tool",points:[{x:25,y:20}],radius:1}]);
  const result=solveRegionEvidence(filled,e);
  expect(result.score[20*40+20]).toBeLessThan(128);
  expect(result.score[20*40+25]).toBeGreaterThanOrEqual(128);
  expect(result.score[0]).toBe(255);
});
it("reports contradictory marks",()=>{
  expect(()=>buildRegionEvidence(image,field,[{kind:"tool",points:[{x:20,y:20}],radius:2},{kind:"paper",points:[{x:20,y:20}],radius:2}])).toThrow(/overlap/);
});
it("keeps a tiny stroke meaningful after model downsampling", () => {
  const downsampled={...field,scale:.25,scaleY:.25};
  const e=buildRegionEvidence(image,downsampled,[{kind:"tool",points:[{x:20,y:20}],radius:.1}]);
  expect(e.labels.some(v=>v===1)).toBe(true);
});
it("rejects excessive correction work before solving", () => {
  const points=Array.from({length:4096},(_,i)=>({x:i%2?0:40,y:i%2?0:40}));
  expect(()=>buildRegionEvidence(image,field,Array.from({length:4},()=>({kind:"tool" as const,points,radius:2})))).toThrow(/complex/);
});
it("include-only corrections never delete existing material, and exclude-only never add it",()=>{
  const score=Uint8Array.from(field.score,(_,i)=>i%40<20?255:0), original={...field,score};
  for(const kind of ["tool","paper"] as const){
    const solved=solveRegionEvidence(original,buildRegionEvidence(image,original,[{kind,points:[{x:20,y:20}],radius:1}]));
    score.forEach((v,i)=>{if(kind==="tool"&&v>=128)expect(solved.score[i]).toBeGreaterThanOrEqual(128);if(kind==="paper"&&v<128)expect(solved.score[i]).toBeLessThan(128);});
  }
});
