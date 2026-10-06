import { describe, expect, it, beforeAll } from "vitest";
import { loadCad, type OpenCascadeInstance } from "./runtime";
import { CadContext } from "./adapter";
import { writeCadStep } from "./step";

let oc: OpenCascadeInstance;
beforeAll(async () => { oc = await loadCad(); },60_000);
describe("XCAF STEP assembly", () => {
  it("writes AP214 analytic solids and Unicode names, distinct duplicate names, colors and units", () => {
    const c = new CadContext(oc);
    try {
      const circle = c.extrude({kind:"ellipse",rx:5,ry:5},0,8);
      const bytes = writeCadStep(c,[{id:"first",name:"Clé Ø5",shape:circle,color:"#ffaa00"},
        {id:"second",name:"Clé Ø5",shape:c.move(circle,{x:20,y:0,z:0})}],"Pocketry objects");
      const text = new TextDecoder().decode(bytes);
      expect(text).toContain("AUTOMOTIVE_DESIGN");
      expect(text).toContain("CYLINDRICAL_SURFACE");
      expect(text.match(/MANIFOLD_SOLID_BREP\(/g)).toHaveLength(2);
      expect(text).toContain("NEXT_ASSEMBLY_USAGE_OCCURRENCE");
      expect(text).toContain("COLOUR_RGB");
      expect(text).toContain(".MILLI.,.METRE.");
      expect(text).toContain("Cl");
      expect(()=>oc.FS.stat("/pocketry-export.step")).toThrow();
    } finally { c.dispose(); }
  });
});
