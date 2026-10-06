import { describe, expect, it, vi } from "vitest";
import type { MessageEndpoint } from "@/lib/worker/protocol";
import { createCadJobClient } from "./client";

class Endpoint extends EventTarget implements MessageEndpoint {
  calls:{id:number;payload:unknown}[]=[];
  terminate=vi.fn();
  postMessage(message:unknown){this.calls.push(message as {id:number;payload:unknown});}
  reply(value:unknown){this.dispatchEvent(new MessageEvent("message",{data:{id:this.calls.at(-1)!.id,kind:"result",value,recycle:false}}));}
}
describe("physical CAD job lifecycle",()=>{
  it("serializes jobs, captures queued snapshots, and releases dedicated workers",async()=>{
    const workers:Endpoint[]=[];const client=createCadJobClient(()=>{const w=new Endpoint();workers.push(w);return w;});
    const source={name:"original"},first=client.call("step",source,{releaseAfterJob:true});
    const second=client.call("step",source,{releaseAfterJob:true});source.name="edited";
    expect(workers).toHaveLength(1);expect(workers[0].calls).toHaveLength(1);
    workers[0].reply("one");expect(await first).toBe("one");expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[1].calls[0].payload).toEqual({name:"original"});workers[1].reply("two");expect(await second).toBe("two");client.dispose();
  });
  it("terminates synchronous work on cancellation and recreates for the next job",async()=>{
    const workers:Endpoint[]=[];const client=createCadJobClient(()=>{const w=new Endpoint();workers.push(w);return w;});const abort=new AbortController();
    const cancelled=client.call("step",{}, {signal:abort.signal});const result=expect(cancelled).rejects.toMatchObject({name:"WorkerCancelledError"});
    const next=client.call("step",{});abort.abort();await result;
    expect(workers[0].terminate).toHaveBeenCalledOnce();expect(workers).toHaveLength(2);workers[1].reply("recovered");expect(await next).toBe("recovered");client.dispose();
  });
  it("recovers after a crash, load/geometry error, and timeout",async()=>{
    vi.useFakeTimers();
    try{
      const workers:Endpoint[]=[];const client=createCadJobClient(()=>{const w=new Endpoint();workers.push(w);return w;},100);
      const crashed=client.call("step",{});const crashCheck=expect(crashed).rejects.toThrow("stopped unexpectedly");workers[0].dispatchEvent(new Event("error"));await crashCheck;
      const failed=client.call("step",{});const failureCheck=expect(failed).rejects.toThrow("WASM load failed");workers[1].dispatchEvent(new MessageEvent("message",{data:{id:workers[1].calls[0].id,kind:"error",error:{name:"Error",message:"WASM load failed"}}}));await failureCheck;
      const slow=client.call("step",{});const timeoutCheck=expect(slow).rejects.toThrow("time limit");await vi.advanceTimersByTimeAsync(100);await timeoutCheck;
      const retry=client.call("step",{});workers[3].reply("OK");expect(await retry).toBe("OK");client.dispose();
    }finally{vi.useRealTimers();}
  });
});
