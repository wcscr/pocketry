import type { ProjectDoc } from "@shared/gridfinity/project";
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
  it("applies the shared calibration and solid-fill rules before CAD construction",()=>{
    const doc=cadInvestigationFixtures().concave;doc.shapes[0].sourceMmPerPx=null;
    expect(getStepExportStatus(doc).issues[0]).toMatchObject({objectId:"concave",operation:"source units"});
    doc.shapes[0].sourceMmPerPx=1;doc.spec.fill="none";
    expect(getStepExportStatus(doc).issues[0].operation).toBe("bin construction");
    const basic=cadInvestigationFixtures().mixed;basic.shapes.forEach(s=>s.sourceMmPerPx=null);
    expect(getStepExportStatus(basic).supported).toBe(true);
  });
  it("identifies unsupported authored operations before loading CAD",()=>{
    const doc=cadInvestigationFixtures().tilted;doc.cutouts[0].topFilletMm=0.5;
    expect(getStepExportStatus(doc).issues[0]).toMatchObject({objectId:doc.cutouts[0].id,operation:"pocket mouth rounding"});
    doc.spec.magnetHoles=true;doc.spec.labelTab={wall:"north",edge:null,width:"full"};
    expect(getStepExportStatus(doc).issues.map(i=>i.operation)).toContain("hardware");
    expect(getStepExportStatus(doc).issues.map(i=>i.operation)).toContain("label tab");
  });
});

// These are valid current-main designs, not malformed input. Unsupported CAD
// operations must be surfaced before either backend can return altered solids.
describe("current-main CAD compatibility", () => {
  it.each<[string, (doc: ProjectDoc) => void]>([
    ["arbitrary bin size", doc => { doc.spec.arbitrarySizeMm = { width: 90, length: 70 }; }],
    ["peg bottom", doc => { doc.spec.pegBottom = { diameterMm: 6, lengthMm: 5, underside: "flat", density: "corners" }; }],
    ["wall slant", doc => { doc.spec.wallSlant = { axis: "x", angleDeg: 15 }; }],
    ["compartments", doc => { doc.spec.fill = "none"; doc.cutouts = []; doc.spec.compartments.rows = 2; }],
    ["compartments", doc => { doc.spec.fill = "none"; doc.cutouts = []; doc.spec.compartments.scoop = true; }],
    ["hollow floor rounding", doc => { doc.spec.fill = "none"; doc.cutouts = []; doc.spec.bottomFilletRadiusMm = 2.8; }],
    ["legacy depth offset", doc => { doc.cutouts[0].zOffsetMm = 3; }],
    ["insertion anchor", doc => { doc.cutouts[0].insertionMode = "axis"; }],
    ["protected insertion floor", doc => { doc.cutouts[0].insertionMode = "vertical"; doc.cutouts[0].elevationMm = 2; doc.cutouts[0].depth = {mode: "remaining", floorThicknessMm: 5}; }],
    ["retained material", doc => { doc.cutouts[0].role = "hole"; }],
    ["pocket depth", doc => { doc.cutouts[0].depthPending = true; }],
    ["insertion", doc => { doc.cutouts[0].insertionMode = "axis"; doc.cutouts[0].insertionAxis = "x"; doc.cutouts[0].tilt = {xDeg: 0, yDeg: -45}; doc.cutouts[0].topFilletMm = 0; }],
    ["insertion", doc => { doc.cutouts[0].insertionMode = "axis"; doc.cutouts[0].insertionAxis = "y"; doc.cutouts[0].tilt = {xDeg: 45, yDeg: 0}; doc.cutouts[0].topFilletMm = 0; }],
  ])("rejects unsupported %s without changing the snapshot", (operation, configure) => {
    const doc = cadInvestigationFixtures().mixed;
    configure(doc);
    const snapshot = structuredClone(doc);
    expect(getStepExportStatus(doc).issues.map(issue => issue.operation)).toContain(operation);
    expect(() => resolveCadDesign(doc)).toThrow();
    expect(doc).toEqual(snapshot);
  });
  it("identifies the label whose hardware symbol cannot be exported", () => {
    const doc = cadInvestigationFixtures().irregular;
    doc.spec.surfaceTexts[0].symbol = "hex-nut";
    expect(getStepExportStatus(doc).issues).toContainEqual(expect.objectContaining({objectId: "text", objectName: "CAD label", operation: "hardware symbol"}));
  });
  it("accepts inactive retained settings and the ordinary local Z insertion path", () => {
    const doc = cadInvestigationFixtures().mixed;
    doc.spec.bottomFilletRadiusMm = 2.8;
    doc.spec.compartments.rows = 3;
    doc.spec.wallSlant = {axis: "x", angleDeg: 0};
    doc.cutouts[0].insertionAxis = "x"; // Inactive without axial insertion mode.
    expect(getStepExportStatus(doc).supported).toBe(true);
    const hollow = cadInvestigationFixtures()["standard-hollow"];
    hollow.spec.compartments = {rows: 3, columns: 2, enabled: false, scoop: false, dividerThicknessMm: 1.2};
    expect(getStepExportStatus(hollow).supported).toBe(true);
    expect(getStepExportStatus(cadInvestigationFixtures().tilted).supported).toBe(true);
  });
});
