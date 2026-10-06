import type { ProjectDoc } from "@shared/gridfinity/project";
import { WorkerCancelledError, deserializeError, type MessageEndpoint, type SerializedError } from "@/lib/worker/protocol";
import type { WorkerClient, CallOptions } from "@/lib/worker/client";
import { getStepExportStatus, CadDesignError } from "./model";
import type { StepPackageResult } from "./package";
import { CAD_INVESTIGATION } from "./investigation";

export interface CadCallOptions extends CallOptions {
  onPhase?: (phase:string)=>void;
  releaseAfterJob?: boolean;
}
type Reply = {id:number;kind:"phase";phase:string} | {id:number;kind:"result";value:unknown;recycle:boolean} | {id:number;kind:"error";error:SerializedError};
interface Job {id:number;method:string;payload:unknown;options:CadCallOptions;resolve:(value:unknown)=>void;reject:(error:unknown)=>void;detach:()=>void}
export interface CadJobClient extends WorkerClient {
  call<T>(method:string,payload?:unknown,options?:CadCallOptions):Promise<T>;
}

/** One physical CAD job, including across preview and export callers.
 * Explicit cancellation/timeout destroys synchronous native work. Pending jobs
 * and all project/preview data live outside that worker and remain retryable.
 */
export function createCadJobClient(spawn:()=>MessageEndpoint, timeoutMs=180_000):CadJobClient {
  let endpoint:MessageEndpoint|undefined,active:Job|undefined,timer:ReturnType<typeof setTimeout>|undefined,id=0,jobs=0;
  const queue:Job[]=[];
  const destroy=()=>{
    if(endpoint){endpoint.removeEventListener("message",message);endpoint.removeEventListener("error",failure);endpoint.removeEventListener("messageerror",failure);endpoint.terminate?.();}
    endpoint=undefined;jobs=0;
  };
  const finish=(error:unknown,value?:unknown,recycle=false)=>{
    const job=active;if(!job)return;active=undefined;clearTimeout(timer);job.detach();
    if(error||recycle||job.options.releaseAfterJob||++jobs>=8)destroy();
    if(error)job.reject(error);else job.resolve(value);
    drain();
  };
  const message=(event:Event)=>{
    const reply=(event as MessageEvent).data as Reply;if(reply.id!==active?.id)return;
    if(reply.kind==="phase"){active.options.onPhase?.(reply.phase);active.options.onProgress?.(0.5);}
    else if(reply.kind==="error")finish(deserializeError(reply.error));
    else finish(undefined,reply.value,reply.recycle);
  };
  const failure=()=>finish(new Error("The CAD worker stopped unexpectedly. The project is safe; try the operation again."));
  const drain=()=>{
    if(active||!queue.length)return;active=queue.shift()!;
    try{
      if(!endpoint){endpoint=spawn();endpoint.addEventListener("message",message);endpoint.addEventListener("error",failure);endpoint.addEventListener("messageerror",failure);}
      timer=setTimeout(()=>finish(new Error("The CAD job exceeded its time limit. Try fewer objects or a smaller design.")),timeoutMs);
      endpoint.postMessage({id:active.id,method:active.method,payload:active.payload});
    }catch(error){finish(error);}
  };
  return {
    call<T>(method:string,payload:unknown,options:CadCallOptions={}):Promise<T>{
      if(options.signal?.aborted)return Promise.reject(new WorkerCancelledError());
      // Supersede only waiting previews: an in-flight native job must finish
      // before its replacement begins. Explicit cancellation terminates it.
      if(options.channel)for(const job of [...queue])if(job.options.channel===options.channel){queue.splice(queue.indexOf(job),1);job.detach();job.reject(new WorkerCancelledError());}
      return new Promise<T>((resolve,reject)=>{
        const job:Job={id:++id,method,payload:structuredClone(payload),options,resolve:v=>resolve(v as T),reject,detach:()=>{}};
        const abort=()=>{if(active===job)finish(new WorkerCancelledError());else{const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);job.detach();reject(new WorkerCancelledError());}};
        options.signal?.addEventListener("abort",abort,{once:true});job.detach=()=>options.signal?.removeEventListener("abort",abort);
        queue.push(job);drain();
      });
    },
    dispose(){const pending=queue.splice(0);for(const job of pending){job.detach();job.reject(new WorkerCancelledError());}if(active)finish(new WorkerCancelledError());destroy();},
  };
}

export const cadJobs=createCadJobClient(()=>new Worker(new URL("./cad.worker.ts",import.meta.url),{type:"module",name:"pocketry-cad"}));

/** Capture committed design data before entering the queue or loading WASM. */
export function exportStepInBrowser(project:ProjectDoc,options:CadCallOptions={}):Promise<StepPackageResult>{
  const snapshot=structuredClone(project),status=getStepExportStatus(snapshot);
  if(!status.supported)return Promise.reject(new CadDesignError(status.issues));
  return cadJobs.call<StepPackageResult>("step",snapshot,{...options,releaseAfterJob:CAD_INVESTIGATION==="dedicated"});
}
