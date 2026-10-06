import { strToU8, zipSync } from "fflate";
import { parseProjectDoc, serializeProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { CadContext, CAD_TOLERANCE_MM, CAD_BOOLEAN_RETRY_MM } from "./adapter";
import { CAD_ENGINE_VERSION, type OpenCascadeInstance } from "./runtime";
import { resolveCadDesign, CAD_LIMITS } from "./model";
import { buildCadDesign } from "./build";
import { writeCadStep } from "./step";

export const CAD_EXPORTER_VERSION = "pocketry-cad-investigation-1";
export interface StepExportReport {
  snapshotSha256:string;exporterVersion:string;engineVersion:string;units:"mm";
  modelingToleranceMm:number;booleanRetryToleranceMm:number;booleanRetries:number;
  maxNativeBoundaryToleranceMm:number;maxTopologyOccurrences:number;
  peakWasmMemoryBytes:number;modelingMs:number;totalMs:number;dimensions:ReturnType<typeof resolveCadDesign>["dimensions"];
  solidCounts:{bin:number;designObjects:number};objects:Record<string,unknown>[];warnings:string[];
}
export interface StepPackageResult {bytes:Uint8Array;report:StepExportReport}

/** Runtime is injected so the same package path runs in a worker and acceptance tests. */
export async function exportStepPackage(snapshot:ProjectDoc,oc:OpenCascadeInstance,progress:(phase:string)=>void=()=>{}):Promise<StepPackageResult> {
  const started=performance.now();
  const project=parseProjectDoc(structuredClone(snapshot));if(!project)throw new Error("The export snapshot is not a valid Pocketry project");
  const json=JSON.stringify(serializeProjectDoc(project));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",strToU8(json))),b=>b.toString(16).padStart(2,"0")).join("");
  const design=resolveCadDesign(project),modelStarted=performance.now();
  const c=new CadContext(oc,operation=>{if(performance.now()-modelStarted>CAD_LIMITS.modelingMs)throw new Error(`${operation}: modeling exceeded 120 seconds`);});
  try {
    const built=buildCadDesign(c,design,{},progress),modelingMs=performance.now()-modelStarted;
    progress("Writing finished-bin STEP");const bin=writeCadStep(c,built.finished,project.name??"Pocketry bin");
    progress("Writing named design objects");const bodies=built.objects.filter((o):o is typeof o&{shape:NonNullable<typeof o.shape>}=>Boolean(o.shape));
    const objectsStep=writeCadStep(c,bodies,"Pocketry design objects");
    const objects=built.objects.map(({shape,...object})=>({...object,stepInstanceName:`${object.name} [${object.id}]`,assemblyPath:["Pocketry design objects",`${object.name} [${object.id}]`],
      coordinates:"world-mm",boundsMm:shape?c.bounds(shape):undefined,volumeMm3:shape?c.volume(shape):0,sourceProject:"design.pocketry.json",solidCount:shape?c.subshapes(shape,"solid").length:0}));
    const report:StepExportReport={snapshotSha256:hash,exporterVersion:CAD_EXPORTER_VERSION,engineVersion:CAD_ENGINE_VERSION,units:"mm",
      modelingToleranceMm:CAD_TOLERANCE_MM,booleanRetryToleranceMm:CAD_BOOLEAN_RETRY_MM,booleanRetries:c.retries,
      maxNativeBoundaryToleranceMm:c.maxNativeToleranceMm,maxTopologyOccurrences:c.maxTopologyOccurrences,
      peakWasmMemoryBytes:c.peakMemoryBytes,modelingMs,totalMs:performance.now()-started,dimensions:design.dimensions,
      solidCounts:{bin:built.finished.reduce((n,b)=>n+c.subshapes(b.shape,"solid").length,0),designObjects:bodies.reduce((n,b)=>n+c.subshapes(b.shape,"solid").length,0)},objects,
      warnings:["Experimental CAD investigation; native feature history is not included.","The 512 MiB between-operation memory guard cannot prevent a browser from terminating a native allocation."]};
    progress("Packaging project and reports");
    const bytes=zipSync({"bin.step":bin,"design-objects.step":objectsStep,"design.pocketry.json":strToU8(json),
      "objects.json":strToU8(JSON.stringify({version:1,snapshotSha256:hash,objects,reconstructionOrder:objects.filter(o=>o.role!=="pocket-source").map(o=>o.id)},null,2)),
      "export-report.json":strToU8(JSON.stringify(report,null,2)),
      "README.txt":strToU8("Pocketry CAD investigation\n\nImport bin.step for finished solids, or design-objects.step for named construction bodies. Units are millimetres.\nDesign objects intentionally overlap. Begin with Bin blank; subtract active pocket and finger-access cutters in objects.json order; add text bodies last.\nMove or edit an original pocket-source body independently from its derived cutter. Insertion cutters must be rebuilt if the source changes. Inactive cutters have no STEP solid.\nDuplicate names remain distinct by stable IDs. All geometry is in world coordinates; transforms describe placement provenance.\nNative FreeCAD or Fusion sketches, constraints and feature history are not preserved. Import design.pocketry.json into Pocketry for the editable source and retained history.\nThe snapshot hash and engine versions are in export-report.json.\n")});
    return {bytes,report};
  }finally{c.dispose();}
}
