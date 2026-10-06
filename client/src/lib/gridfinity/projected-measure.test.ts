import { expect, it } from "vitest";
import { snapToProjectedContours } from "./projected-measure";
import type { Outline } from "@shared/geometry/types";
const outline: Outline = [{ outer: [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}], holes: [] }];
it.each([0.5, 2, 10])("uses a constant pixel target at zoom %s", zoom => {
  const project = (p: {x:number;y:number}) => ({x:p.x*zoom,y:p.y*zoom,w:1,visible:true});
  expect(snapToProjectedContours({x:50*zoom,y:-27}, [outline], [], project, 28)?.point).toEqual({x:50,y:0});
  expect(snapToProjectedContours({x:50*zoom,y:-29}, [outline], [], project, 28)).toBeNull();
});
it("returns the perspective-correct point rather than linearly interpolating world coordinates", () => {
  const project = (p: {x:number;y:number}) => ({x:p.x/(1+p.x/100),y:p.y,w:1+p.x/100,visible:true});
  const result = snapToProjectedContours({x:25,y:2}, [], [[{x:0,y:0},{x:100,y:0}]], project, 28)!;
  expect(result.point.x).toBeCloseTo(100/3);
  expect(project(result.point).x).toBeCloseTo(25);
});
it("keeps split paths open and skips clipped geometry", () => {
  const project = (p: {x:number;y:number}) => ({...p,w:1,visible:true});
  const path = [{x:0,y:0},{x:100,y:0},{x:100,y:100}];
  expect(snapToProjectedContours({x:40,y:40}, [], [path], project, 10)).toBeNull();
  expect(snapToProjectedContours({x:40,y:0}, [], [path], p => ({...project(p), visible:false}), 28)).toBeNull();
});
it("chooses a hole edge when it is closer than the outer contour", () => {
  const shape = [{...outline[0], holes: [[{x:40,y:40},{x:60,y:40},{x:60,y:60},{x:40,y:60}]]}];
  const result = snapToProjectedContours({x:50,y:42}, [shape], [], p=>({...p,w:1,visible:true}),28);
  expect(result?.point).toEqual({x:50,y:40});
});
