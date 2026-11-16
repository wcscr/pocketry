import { expect,it } from "vitest";
import { composeHomography, inverseHomography, projectPoint, workingToPhoto, transformPhotoProjection, type Homography } from "./projective";
it("round trips perspective coordinates and composes a later photo transform",()=>{
  const m:Homography=[2,.1,10,.2,3,20,.001,.002,1],p={x:21,y:33};
  const q=projectPoint(inverseHomography(m),projectPoint(m,p));
  expect(q.x).toBeCloseTo(p.x,9);expect(q.y).toBeCloseTo(p.y,9);
  const rotated=transformPhotoProjection(m,[0,1,-1,0,100,0]);
  const r=projectPoint(rotated,{x:100-p.y,y:p.x});
  expect(r.x).toBeCloseTo(projectPoint(m,p).x,9);
  expect(()=>inverseHomography([0,0,0,0,0,0,0,0,0])).toThrow();
  expect(composeHomography(m,inverseHomography(m))[0]).toBeCloseTo(1);
});
it("maps rotated working coordinates back to the original photo",()=>{
  expect(projectPoint(workingToPhoto({width:200,height:100},1,null),{x:50,y:40})).toEqual({x:.4,y:.75});
});
