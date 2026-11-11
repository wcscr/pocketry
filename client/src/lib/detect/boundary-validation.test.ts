import { expect,it } from "vitest";
import { validDetectionGeometry } from "./boundary-validation";
const box=(x:number,y:number,w:number,h:number)=>({outer:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],holes:[]});
it("bounds outward slack independently of missing material",()=>{
  expect(validDetectionGeometry([box(0,0,10,10)],[box(-.1,-.1,10.2,10.2)],.1,.2)).toBe(true);
  expect(validDetectionGeometry([box(0,0,10,10)],[box(-2,-2,14,14)],.1,.2)).toBe(false);
});
it("rejects simultaneous growth that closes the gap between tools",()=>{
  const before=[box(0,0,10,10),box(10.2,0,10,10)],after=[box(0,0,10.15,10),box(10.05,0,10.15,10)];
  expect(validDetectionGeometry(before,after,.1,.3)).toBe(false);
});

it("measures added material across a narrow recess instead of along its depth", () => {
  const before = [{ outer: [{ x: 0, y: 0 }, { x: 49.8, y: 0 }, { x: 49.8, y: 8 },
    { x: 50.2, y: 8 }, { x: 50.2, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], holes: [] }];
  const after = [box(0, 0, 100, 100)];
  expect(validDetectionGeometry(before, after, .1, .3)).toBe(true);
  expect(validDetectionGeometry(before, after, .1, .1)).toBe(false);
});
