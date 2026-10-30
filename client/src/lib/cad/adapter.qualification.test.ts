import { describe, expect, it, beforeAll } from "vitest";
import type { OpenCascadeInstance } from "./runtime";
import { loadCad } from "./runtime";
import { CadContext } from "./adapter";

let oc: OpenCascadeInstance;
beforeAll(async () => { oc = await loadCad(); }, 60_000);
describe("pinned single-threaded CAD adapter", () => {
  it("constructs analytic rounded profiles, ellipses, concavities and holes without mesh inputs", () => {
    const c = new CadContext(oc);
    try {
      const rounded = c.extrude({kind:"rounded-rectangle",width:40,length:30,radius:4},0,10);
      expect(c.valid(rounded)).toBe(true);
      expect(c.volume(rounded)).toBeCloseTo((1200-(4-Math.PI)*16)*10,5);
      const ellipse = c.extrude({kind:"ellipse",rx:8,ry:4},0,12);
      expect(c.valid(ellipse)).toBe(true);
      expect(c.volume(ellipse)).toBeCloseTo(Math.PI*8*4*12,5);
      const polygon = c.extrude({kind:"polygon",outer:[{x:0,y:0},{x:20,y:0},{x:20,y:10},{x:10,y:10},{x:10,y:20},{x:0,y:20}],holes:[[{x:2,y:2},{x:2,y:4},{x:4,y:4},{x:4,y:2}]]},0,10);
      expect(c.volume(polygon)).toBeCloseTo(2960,5);
      expect(c.valid(c.boolean("cut",rounded,ellipse,"ellipse pocket"))).toBe(true);
      expect(c.valid(c.boolean("fuse",rounded,c.move(polygon,{x:0,y:0,z:0}),"concave overlap"))).toBe(true);
    } finally { c.dispose(); }
  });
});
