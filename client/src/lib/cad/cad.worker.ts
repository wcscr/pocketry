import { parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { serializeError } from "@/lib/worker/protocol";
import { loadCad } from "./runtime";
import { exportStepPackage } from "./package";
import { buildCadBinMesh } from "./mesh-build";
import type { BuildBinRequest } from "@/lib/gridfinity/worker-api";

/** The client serializes jobs; this chain also defends the native runtime
 * against overlapping asynchronous snapshot hashing/loading messages. */
let pending:Promise<void>=Promise.resolve();
self.addEventListener("message",(event:MessageEvent<{id:number;method:string;payload:unknown}>)=>{
  const request=event.data;
  pending=pending.then(async()=>{
    const phase=(phase:string)=>self.postMessage({id:request.id,kind:"phase",phase});
    try{
      phase("Loading CAD engine");const oc=await loadCad();
      let value:unknown;
      if(request.method==="step"){
        phase("Validating export snapshot");const project=parseProjectDoc(request.payload);
        if(!project)throw new Error("Invalid export snapshot");
        value=await exportStepPackage(project as ProjectDoc,oc,phase);
      }else if(request.method==="buildBin")value=buildCadBinMesh(request.payload as BuildBinRequest,oc,phase);
      else throw new Error(`${request.method} is not available in the unified CAD investigation yet`);
      phase("Complete");
      self.postMessage({id:request.id,kind:"result",value,recycle:oc.wasmMemory.buffer.byteLength>=256*1024*1024});
    }catch(error){self.postMessage({id:request.id,kind:"error",error:serializeError(error)});}
  });
});
