import { describe, expect, it } from "vitest";
import { cadInvestigationFixtures } from "./fixtures";
import { CAD_LIMITS, getStepExportStatus, resolveCadDesign } from "./model";

describe("CAD construction model and inexpensive preflight",()=>{
  it("keeps authored polygon points and holes after placement scaling and mirroring",()=>{
    const doc=cadInvestigationFixtures().concave;
    doc.cutouts[0].scaleX=1.3;doc.cutouts[0].scaleY=0.8;doc.cutouts[0].mirrored=true;
    const before=JSON.stringify(doc),model=resolveCadDesign(doc),profile=model.pockets[0].profiles[0];
    expect(profile.kind).toBe("polygon");
    expect(model.pockets[0]).toMatchObject({scaleX:1.3,scaleY:0.8,mirrored:true});
    if(profile.kind!=="polygon")throw new Error("Expected authored polygon");
    const expected=doc.shapes[0].outlineMm[0].outer.map(p=>({x:-p.x*1.3,y:p.y*0.8}));
    expect(profile.outer).toHaveLength(expected.length);expect(profile.outer).toEqual([...expected].reverse());
    expect(profile.holes[0]).toHaveLength(4);expect(JSON.stringify(doc)).toBe(before);
    expect(structuredClone(model)).toEqual(model);expect(JSON.stringify(model)).not.toContain('"mesh"');
  });
  it("preserves analytic provenance and resolves a nonuniformly scaled circle as an ellipse",()=>{
    const model=resolveCadDesign(cadInvestigationFixtures().concave);
    expect(model.pockets[1].profiles).toEqual([{kind:"ellipse",rx:7*1.4,ry:7*0.7}]);
    const doc=cadInvestigationFixtures().mixed;doc.shapes[1].outlineMm[0].outer[1].x+=0.1;
    expect(getStepExportStatus(doc).issues[0].operation).toBe("primitive provenance");
  });
  it("rejects object and boundary budgets without fitting or simplifying",()=>{
    const doc=cadInvestigationFixtures().mixed;
    doc.cutouts=Array.from({length:CAD_LIMITS.authoredObjects+1},(_,i)=>({...doc.cutouts[0],id:`p-${i}`}));
    expect(getStepExportStatus(doc).issues.some(i=>i.message.includes("objects"))).toBe(true);
    const traced=cadInvestigationFixtures().concave;traced.cutouts=[traced.cutouts[0]];
    traced.shapes[0].outlineMm[0].outer=Array.from({length:CAD_LIMITS.profileSegments+1},(_,i)=>({x:i,y:i%2}));
    const status=getStepExportStatus(traced);expect(status.supported).toBe(false);expect(status.issues.some(i=>i.message.includes("will not be simplified"))).toBe(true);
  });
  it("identifies unsupported authored operations before loading CAD",()=>{
    const doc=cadInvestigationFixtures().tilted;doc.cutouts[0].topFilletMm=0.5;
    expect(getStepExportStatus(doc).issues[0]).toMatchObject({objectId:doc.cutouts[0].id,operation:"pocket mouth rounding"});
    doc.spec.magnetHoles=true;doc.spec.labelTab={wall:"north",edge:null,width:"full"};
    expect(getStepExportStatus(doc).issues.map(i=>i.operation)).toContain("hardware");
    expect(getStepExportStatus(doc).issues.map(i=>i.operation)).toContain("label tab");
  });
});
