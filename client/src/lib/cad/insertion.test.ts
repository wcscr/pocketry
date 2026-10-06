import { beforeAll, describe, expect, it } from "vitest";
import { loadCad, type OpenCascadeInstance } from "./runtime";
import { CadContext } from "./adapter";
import { cadInsertionEnvelope } from "./insertion";

let oc: OpenCascadeInstance;
beforeAll(async () => { oc = await loadCad(); },60_000);
describe("continuous B-rep insertion feasibility", () => {
  it("preserves the exact concavity and hole of an upright polygon", () => {
    const c = new CadContext(oc);
    try {
      const source = c.extrude({kind:"polygon",outer:[{x:0,y:0},{x:20,y:0},{x:20,y:10},{x:10,y:10},{x:10,y:20},{x:0,y:20}],holes:[[{x:2,y:2},{x:2,y:4},{x:4,y:4},{x:4,y:2}]]},0,8);
      const swept = cadInsertionEnvelope(c,source,{x:0,y:0,z:20});
      expect(c.valid(swept)).toBe(true);
      expect(c.volume(swept)).toBeCloseTo(296*28,5);
    } finally { c.dispose(); }
  });
  it("sweeps a tilted rounded finite object along its axis and vertically", () => {
    const c = new CadContext(oc);
    try {
      let source = c.extrude({kind:"rounded-rectangle",width:20,length:12,radius:2},0,8);
      const bottom = c.subshapes(source,"edge").filter(edge => { const b=c.bounds(edge); return Math.abs(b.min.z)<1e-7&&Math.abs(b.max.z)<1e-7; });
      // Bottom rounding is exercised separately by the authored axial cap path.
      source = c.rotate(c.rotate(source,{x:1,y:0,z:0},25),{x:0,y:1,z:0},15);
      const axial = cadInsertionEnvelope(c,source,{x:5,y:-9,z:20});
      expect(c.valid(axial)).toBe(true);
      const vertical = cadInsertionEnvelope(c,source,{x:0,y:0,z:20});
      expect(c.valid(vertical)).toBe(true);
      // An interior translation is contained by the continuous envelope.
      const moved = c.move(source,{x:0,y:0,z:8.173});
      const outside = c.boolean("cut",moved,vertical,"interior translation containment",true);
      expect(Math.abs(c.volume(outside))).toBeLessThan(1e-6);
    } finally { c.dispose(); }
  });
});
