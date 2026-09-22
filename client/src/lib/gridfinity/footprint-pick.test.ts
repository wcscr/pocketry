import { expect, it } from "vitest";
import { pickFootprintCell } from "./footprint-pick";
it("keeps containment unambiguous even when touch tolerances overlap", () => {
  const cells = [{x:0,y:0},{x:1,y:0}];
  expect(pickFootprintCell({x:0.1,y:0}, cells, 2,1,10.5,12)).toEqual(cells[1]);
});
it("accepts a nearby exposed halo cell but rejects a distant miss", () => {
  const cells = [{x:-1,y:0}];
  expect(pickFootprintCell({x:-17,y:0}, cells,1,1,10.5,2)).toEqual(cells[0]);
  expect(pickFootprintCell({x:-30,y:0}, cells,1,1,10.5,2)).toBeNull();
});
it("does not guess between equally close cells", () => {
  expect(pickFootprintCell({x:0,y:20}, [{x:0,y:0},{x:1,y:0}],2,1,10.5,20)).toBeNull();
});
