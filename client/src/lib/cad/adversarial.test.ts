import { beforeAll, describe, expect, it } from "vitest";
import { loadCad, type OpenCascadeInstance } from "./runtime";
import { CadContext } from "./adapter";
import { buildCadDesign } from "./build";
import { buildCadPocket, clipBelow } from "./construction";
import { cadInvestigationFixtures } from "./fixtures";
import { resolveCadDesign } from "./model";

let oc:OpenCascadeInstance;
beforeAll(async()=>{oc=await loadCad();},60_000);
describe("CAD acceptance at difficult boundaries",()=>{
  it("contains an interior translation of the tilted rounded split source",()=>{
    const c=new CadContext(oc);
    try{
      const model=resolveCadDesign(cadInvestigationFixtures().tilted),p=model.pockets[0];
      const built=buildCadPocket(c,p,model.dimensions.fillZ,model.dimensions.topZ);
      const d=17.141,axis=p.insertion!;
      const translated=clipBelow(c,c.move(built.source,{x:axis.x*d,y:axis.y*d,z:axis.z*d}),model.dimensions.topZ,"test surface clipping");
      const outside=c.boolean("cut",translated,built.cutter!,"continuous axial path containment",true);
      expect(Math.abs(c.volume(outside))).toBeLessThan(1e-6);
    }finally{c.dispose();}
  });
  it("rejects a bin completely consumed by an authored cut",()=>{
    const c=new CadContext(oc);
    try{
      const doc=cadInvestigationFixtures().mixed;doc.cutouts=[{...doc.cutouts[1],position:{x:0,y:0},scaleX:30,scaleY:30}];
      expect(()=>buildCadDesign(c,resolveCadDesign(doc))).toThrow("finished bin is empty");
    }finally{c.dispose();}
  });
  it("rejects a collapsed corner offset instead of dropping its requested rounding",()=>{
    const c=new CadContext(oc);
    try{
      const doc=cadInvestigationFixtures().mixed;doc.cutouts=[{...doc.cutouts[0],cornerRoundMm:20}];
      expect(()=>buildCadDesign(c,resolveCadDesign(doc))).toThrow(/offset.*(collapsed|failed)/);
    }finally{c.dispose();}
  });
});
