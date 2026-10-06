import { beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { loadCad, type OpenCascadeInstance } from "./runtime";
import { CadContext } from "./adapter";
import { resolveCadDesign } from "./model";
import { buildCadDesign } from "./build";
import { cadInvestigationFixtures } from "./fixtures";
import { exportStepPackage } from "./package";

let oc:OpenCascadeInstance;
beforeAll(async()=>{oc=await loadCad();},60_000);
describe("shared CAD investigation fixtures",()=>{
  it.each(Object.entries(cadInvestigationFixtures()))("constructs %s with all requested authored features",(_name,project)=>{
    const c=new CadContext(oc);
    try {
      const model=resolveCadDesign(project);
      const built=buildCadDesign(c,model,_name==="irregular"?{floorThicknessMm:0.6,rimThicknessMm:1.25}:{});
      expect(c.valid(built.solid)).toBe(true);
      expect(built.objects.filter(o=>o.role==="pocket-source")).toHaveLength(project.cutouts.length);
      if(_name==="tilted") {
        const inactive=built.objects.find(o=>o.id==="cutter:cutout-raised")!;
        expect(inactive.status).toBe("inactive");expect(inactive.shape).toBeUndefined();
      }
      if(_name==="irregular") {
        expect(built.materials?.pocketFloors).toBeDefined();expect(built.materials?.stackingRim).toBeDefined();
        expect(built.textParts).toHaveLength(1);
        const volumes=built.materials!;
        expect(Math.abs(c.volume(c.boolean("common",volumes.body,volumes.pocketFloors!,"material overlap test",true)))).toBeLessThan(1e-6);
      }
    }finally{c.dispose();}
  },120_000);
  it("packages one complete immutable snapshot, all six files and the inactive source object",async()=>{
    const project=cadInvestigationFixtures().tilted;
    const original=JSON.stringify(project);
    const result=await exportStepPackage(project,oc);
    expect(JSON.stringify(project)).toBe(original);
    const files=unzipSync(result.bytes);
    expect(Object.keys(files).sort()).toEqual(["README.txt","bin.step","design-objects.step","design.pocketry.json","export-report.json","objects.json"].sort());
    const report=JSON.parse(strFromU8(files["export-report.json"]));
    expect(report.snapshotSha256).toBe(result.report.snapshotSha256);
    expect(strFromU8(files["bin.step"])).toContain("AUTOMOTIVE_DESIGN");
    expect(report.objects.find((o:{id:string})=>o.id==="cutter:cutout-raised")).toMatchObject({status:"inactive",solidCount:0});
  },120_000);
  it("rejects the unresolved tilted mouth fillet without an incomplete package", async()=>{
    const project=cadInvestigationFixtures().tilted;
    project.cutouts[0].topFilletMm=0.5;
    await expect(exportStepPackage(project,oc)).rejects.toThrow(/Tilted split source.*pocket mouth rounding/);
  },120_000);
});
