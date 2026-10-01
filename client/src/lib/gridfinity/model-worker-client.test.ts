import { afterEach, expect, it, vi } from "vitest";
import { createWorkerClient } from "@/lib/worker/client";
import { serveWorker } from "@/lib/worker/host";
import type { MessageEndpoint } from "@/lib/worker/protocol";
import { loadManifold } from "@/lib/manifold/runtime";
import { createModelWorkerHandlers } from "./model-worker-handlers";
import { inspectModel, readModelFile } from "./model-worker-client";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";

const workers: FakeWorker[] = [];
class FakeWorker extends EventTarget implements MessageEndpoint {
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { super(); workers.push(this); }
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();workers.length=0;});
const cutout=parseCutoutPlacement({id:"c",shapeId:"s",position:{x:0,y:0}});
const shape={id:"s"} as TracedShape;
const spec=parseBinSpec({gridX:2,gridY:2,heightUnits:6});
it("shares inspection work and terminates it only after the last consumer leaves", async()=>{
  vi.stubGlobal("Worker",FakeWorker);
  const a=inspectModel(shape,cutout,spec), b=inspectModel(shape,cutout,spec);
  const rejected=expect(a.promise).rejects.toThrow(/disposed/);
  expect(a.promise).toBe(b.promise);expect(workers).toHaveLength(1);
  a.release();expect(workers[0].terminate).not.toHaveBeenCalled();
  b.release();await rejected;expect(workers[0].terminate).toHaveBeenCalledOnce();
});
it("aborts a file import and makes import timeouts actionable",async()=>{
  vi.stubGlobal("Worker",FakeWorker);vi.useFakeTimers();
  const file={name:"tool.stl",arrayBuffer:async()=>new ArrayBuffer(84)} as File;
  const controller=new AbortController();
  const cancelled=readModelFile(file,"mm",controller.signal);
  const rejected=expect(cancelled).rejects.toThrow(/cancel|disposed/);
  await Promise.resolve();controller.abort();await rejected;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  const expired=readModelFile(file,"mm",new AbortController().signal);
  const expiredCheck=expect(expired).rejects.toThrow(/Simplify/);
  await vi.advanceTimersByTimeAsync(60_000);await expiredCheck;
  expect(workers[1].terminate).toHaveBeenCalledOnce();
});
it("passes model errors through the real RPC envelope",async()=>{
  const endpoints=[new EventTarget(),new EventTarget()];
  const endpoint=(index:number):MessageEndpoint=>({
    postMessage(data){queueMicrotask(()=>endpoints[1-index].dispatchEvent(new MessageEvent("message",{data:structuredClone(data)})));},
    addEventListener(type,fn){endpoints[index].addEventListener(type,fn);},
    removeEventListener(type,fn){endpoints[index].removeEventListener(type,fn);},
  });
  const stop=serveWorker(createModelWorkerHandlers(loadManifold),endpoint(1));
  const client=createWorkerClient(()=>endpoint(0));
  try {await expect(client.call("importStl",{buffer:new ArrayBuffer(3),units:"mm",name:"bad",id:"bad"})).rejects.toThrow(/complete/);}
  finally {client.dispose();stop();}
});

it("reuses completed inspection geometry after closing and reopening, but invalidates changed inputs", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const placement = { ...cutout };
  const first = inspectModel(shape, placement, spec);
  const request = workers[0].postMessage.mock.calls[0][0] as { id: number };
  workers[0].dispatchEvent(new MessageEvent("message", { data: { kind: "result", id: request.id, payload: { marker: "finished" } } }));
  await first.promise;
  first.release(); first.release();
  const reopened = inspectModel(shape, placement, spec);
  expect(reopened.promise).toBe(first.promise);
  expect(workers).toHaveLength(1);
  reopened.release();
  const changed = inspectModel(shape, placement, { ...spec, heightUnits: 7 });
  const rejected = expect(changed.promise).rejects.toThrow(/disposed/);
  expect(workers).toHaveLength(2);
  changed.release(); await rejected;
});
