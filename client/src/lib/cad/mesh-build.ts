import { pocketName } from "@shared/gridfinity/cutout";
import { pocketColorLocalAxis } from "@shared/gridfinity/pocket-color";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import type { BuildBinRequest, BuildBinResult } from "@/lib/gridfinity/worker-api";
import { MULTICOLOR_MIN_THICKNESS_MM, MULTICOLOR_FLOOR_MAX_THICKNESS_MM, MULTICOLOR_RIM_MAX_THICKNESS_MM, MULTICOLOR_BORDER_MAX_WIDTH_MM } from "@/lib/gridfinity/bin";
import { CadContext, type CadShape } from "./adapter";
import { resolveCadDesign, CAD_LIMITS } from "./model";
import { buildCadDesign } from "./build";
import { halfSpace } from "./construction";
import { tessellateCad } from "./mesh";

/** Investigation B's only bin construction path. Quality changes tessellation
 * alone; the B-rep used for modeling is identical to the STEP path. */
export function buildCadBinMesh(request:BuildBinRequest,oc:OpenCascadeInstance,progress:(phase:string)=>void=()=>{}):BuildBinResult {
  const started=performance.now();
  const project=parseProjectDoc({schemaVersion:PROJECT_SCHEMA_VERSION,spec:request.spec,shapes:request.layout?.shapes??[],cutouts:request.layout?.cutouts??[],fingerHoles:request.layout?.fingerHoles??[]});
  if(!project)throw new Error("Invalid CAD bin request");
  for(const [value,maximum,name] of [[request.pocketFloorMaterialThicknessMm,MULTICOLOR_FLOOR_MAX_THICKNESS_MM,"Floor material"],[request.stackingRimMaterialThicknessMm,MULTICOLOR_RIM_MAX_THICKNESS_MM,"Rim material"],[request.borderWidthMm,MULTICOLOR_BORDER_MAX_WIDTH_MM,"Border width"]] as const) {
    if(value!==undefined&&(!Number.isFinite(value)||value<MULTICOLOR_MIN_THICKNESS_MM||value>maximum))throw new Error(`${name}: choose a thickness from ${MULTICOLOR_MIN_THICKNESS_MM} to ${maximum} mm`);
  }
  if (request.pocketFloorMaterialThicknessMm !== undefined) {
    const shapes = new Map(project.shapes.map(shape => [shape.id, shape]));
    for (const pocket of project.cutouts) {
      if (pocket.colorCoverage === "interior" || pocketColorLocalAxis(pocket) !== null) {
        throw new Error(`${pocketName(pocket, shapes.get(pocket.shapeId))} (${pocket.id}): pocket material coverage: interior and object-axis colors are not implemented in this CAD investigation`);
      }
    }
  }
  const design=resolveCadDesign(project);
  const c=new CadContext(oc,operation=>{if(performance.now()-started>CAD_LIMITS.modelingMs)throw new Error(`${operation}: modeling exceeded 120 seconds`);});
  try{
    const built=buildCadDesign(c,design,{floorThicknessMm:request.pocketFloorMaterialThicknessMm,rimThicknessMm:request.stackingRimMaterialThicknessMm,borderWidthMm:request.borderWidthMm},progress);
    const volumeMm3=c.volume(built.solid);
    let plane:CadShape|undefined;
    if(request.section)plane=halfSpace(c,request.section.axis==="x"?{x:-1,y:0,z:0}:{x:0,y:-1,z:0},request.section.axis==="x"?{x:request.section.offsetMm,y:0,z:0}:{x:0,y:request.section.offsetMm,z:0});
    const mesh=(shape:CadShape)=>tessellateCad(c,plane?c.boolean("common",shape,plane,"preview section",true):shape,Boolean(request.exportTopology),request.quality.circularSegments);
    progress("Tessellating CAD boundary surfaces");
    const result:BuildBinResult={mesh:mesh(built.solid),bodyMesh:mesh(built.body),textMeshes:built.textParts.map(part=>({label:part.label,z:part.z,mesh:mesh(part.shape)})),
      stats:{triangles:0,volumeMm3,buildMs:0},cutoutReports:design.pockets.map(p=>({id:p.id,emptied:false})),validationIssues:[]};
    if(built.materials)result.materialMeshes={body:mesh(built.materials.body),pocketFloors:built.materials.pocketFloors?mesh(built.materials.pocketFloors):undefined,stackingRim:built.materials.stackingRim?mesh(built.materials.stackingRim):undefined};
    result.stats.triangles=result.mesh.indices.length/3;result.stats.buildMs=performance.now()-started;
    return result;
  }finally{c.dispose();}
}
