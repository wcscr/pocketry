import { beforeAll, describe, expect, it } from "vitest";
import { loadCad, type OpenCascadeInstance } from "./runtime";
import { buildCadBinMesh } from "./mesh-build";
import { cadInvestigationFixtures } from "./fixtures";
import { EXPORT_QUALITY, PREVIEW_QUALITY } from "@/lib/gridfinity/bin";
let oc:OpenCascadeInstance;
beforeAll(async()=>{oc=await loadCad();},60_000);
describe("CAD tessellation for the existing printing interfaces",()=>{
  it.each(Object.entries(cadInvestigationFixtures()))("stitches valid printable topology for %s",(name,project)=>{
    const result=buildCadBinMesh({spec:project.spec,layout:project,quality:EXPORT_QUALITY,exportTopology:true,
      pocketFloorMaterialThicknessMm:name==="irregular"?0.6:undefined,stackingRimMaterialThicknessMm:name==="irregular"?1.25:undefined},oc);
    expect(result.mesh.indices.length).toBeGreaterThan(0);expect(result.mesh.normals).toBeNull();expect(result.stats.volumeMm3).toBeGreaterThan(0);
    if(name==="irregular"){expect(result.materialMeshes?.pocketFloors).toBeDefined();expect(result.materialMeshes?.stackingRim).toBeDefined();expect(result.textMeshes).toHaveLength(1);}
  },120_000);
  it("keeps exact model volume independent of preview tessellation quality",()=>{
    const project=cadInvestigationFixtures().tilted;
    const coarse=buildCadBinMesh({spec:project.spec,layout:project,quality:PREVIEW_QUALITY},oc);
    const fine=buildCadBinMesh({spec:project.spec,layout:project,quality:EXPORT_QUALITY},oc);
    expect(fine.stats.volumeMm3).toBeCloseTo(coarse.stats.volumeMm3,8);expect(coarse.mesh.normals).toBeInstanceOf(Float32Array);
    expect(fine.stats.triangles).toBeGreaterThan(coarse.stats.triangles);
  },120_000);
});
