/** Node 22 reproducible artifacts/benchmarks, same corpus for both worktrees.
 * node scripts/export-cad-investigation.mjs OUTPUT dedicated|unified */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";
import { unzipSync } from "fflate";
import initCad from "replicad-opencascadejs";
import initManifold from "manifold-3d";

const output=resolve(process.argv[2]??"outputs/cad-investigation"),approach=process.argv[3]??"dedicated";
mkdirSync(output,{recursive:true});
const require=createRequire(import.meta.url),server=await createServer({server:{middlewareMode:true,watch:null},logLevel:"error"});
try{
  const {cadInvestigationFixtures}=await server.ssrLoadModule(resolve("client/src/lib/cad/fixtures.ts"));
  const {exportStepPackage}=await server.ssrLoadModule(resolve("client/src/lib/cad/package.ts"));
  const {buildCadBinMesh}=await server.ssrLoadModule(resolve("client/src/lib/cad/mesh-build.ts"));
  const {createBinWorkerHandlers}=await server.ssrLoadModule(resolve("client/src/lib/gridfinity/bin-worker-handlers.ts"));
  const {EXPORT_QUALITY,PREVIEW_QUALITY}=await server.ssrLoadModule(resolve("client/src/lib/gridfinity/bin.ts"));
  const {writeBinarySTL}=await server.ssrLoadModule(resolve("client/src/lib/export/stl-writer.ts"));
  const {writeThreeMf}=await server.ssrLoadModule(resolve("client/src/lib/mesh/threemf.ts"));
  const createRuntime=()=>initCad({locateFile:()=>require.resolve("replicad-opencascadejs/wasm"),print:()=>{},printErr:()=>{}});
  const cold=performance.now();let oc=await createRuntime();const cadLoadMs=performance.now()-cold;
  const manifoldCold=performance.now();const manifold=await initManifold({locateFile:()=>require.resolve("manifold-3d/manifold.wasm")});manifold.setup();
  const manifoldLoadMs=performance.now()-manifoldCold,handlers=createBinWorkerHandlers(async()=>manifold);
  const fixtures=cadInvestigationFixtures(),results=[];
  const build=async(request)=>approach==="unified"?buildCadBinMesh(request,oc):
    (await handlers.buildBin(request,{signal:new AbortController().signal,progress:()=>{}})).value;
  for(const [name,project]of Object.entries(fixtures)){
    const directory=join(output,name);mkdirSync(directory,{recursive:true});writeFileSync(join(directory,"input.pocketry.json"),JSON.stringify(project,null,2));
    // A new CAD worker per dedicated export; B recycles before a 256 MiB heap.
    if(approach==="dedicated"||oc.wasmMemory.buffer.byteLength>=256*1024*1024)oc=await createRuntime();
    const start=performance.now(),cad=await exportStepPackage(project,oc),stepMs=performance.now()-start;
    writeFileSync(join(directory,"cad.zip"),cad.bytes);for(const [file,bytes]of Object.entries(unzipSync(cad.bytes)))writeFileSync(join(directory,file),bytes);
    if(oc.wasmMemory.buffer.byteLength>=256*1024*1024)oc=await createRuntime();
    const request={spec:project.spec,layout:project,quality:PREVIEW_QUALITY};
    const previewStart=performance.now(),preview=await build(request),previewMs=performance.now()-previewStart;
    const warmStart=performance.now();await build(request);const warmPreviewMs=performance.now()-warmStart;
    if(oc.wasmMemory.buffer.byteLength>=256*1024*1024)oc=await createRuntime();
    const printStart=performance.now(),print=await build({...request,quality:EXPORT_QUALITY,exportTopology:true,
      pocketFloorMaterialThicknessMm:name==="irregular"?0.6:undefined,stackingRimMaterialThicknessMm:name==="irregular"?1.25:undefined}),printMs=performance.now()-printStart;
    const stl=writeBinarySTL(print.mesh);writeFileSync(join(directory,"bin.stl"),new Uint8Array(stl));
    const parts=print.materialMeshes??{body:print.bodyMesh??print.mesh};
    const objects=[{name:"Bin body",mesh:parts.body,material:{name:"Bin body",displayColor:"#999999"}},
      ...["pocketFloors","stackingRim"].filter(key=>parts[key]).map(key=>({name:key==="pocketFloors"?"Pocket floors":"Stacking rim",mesh:parts[key],material:{name:key,displayColor:key==="pocketFloors"?"#0088ff":"#ff6600"}})),
      ...(print.textMeshes??[]).map(part=>({name:part.label.name??part.label.text,mesh:part.mesh,material:{name:"Text",displayColor:"#ffffff"}}))];
    const threeMf=writeThreeMf(objects,{title:`CAD investigation ${name}`,assemble:true});writeFileSync(join(directory,"bin.3mf"),threeMf);
    let meshVolume=0;const {positions:p,indices:t}=print.mesh;
    for(let i=0;i<t.length;i+=3){const a=t[i]*3,b=t[i+1]*3,c=t[i+2]*3;meshVolume+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])+p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;}
    results.push({name,approach,stepMs,previewMs,warmPreviewMs,printMs,cadVolumeMm3:cad.report.objects[0].volumeMm3,
      finishedCadSolidCount:cad.report.solidCounts.bin,printVolumeMm3:print.stats.volumeMm3,meshVolumeMm3:meshVolume,
      stepReport:cad.report,triangles:print.stats.triangles,meshBytes:stl.byteLength,threeMfBytes:threeMf.length,processMemory:process.memoryUsage()});
    console.log(`${name}: STEP ${stepMs.toFixed(0)} ms; preview ${previewMs.toFixed(0)} ms; print ${printMs.toFixed(0)} ms`);
  }
  const repeated=[];let recycled=0;oc=await createRuntime();
  for(let i=0;i<20;i++){
    const start=performance.now();if(approach==="dedicated"||oc.wasmMemory.buffer.byteLength>=256*1024*1024||i%8===0){oc=await createRuntime();recycled++;}
    const result=await exportStepPackage(fixtures.mixed,oc);repeated.push({job:i+1,totalMs:performance.now()-start,peakWasmMemoryBytes:result.report.peakWasmMemoryBytes,processMemory:process.memoryUsage()});
  }
  writeFileSync(join(output,"benchmark.json"),JSON.stringify({node:process.version,platform:process.platform,approach,cadLoadMs,manifoldLoadMs,results,repeated,recycled},null,2));
}finally{await server.close();}
