import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageEndpoint, WorkerMessage } from "../worker/protocol";
import { createDetectionClient } from "./worker-client";
import { createDetectionHandlers } from "./worker-handlers";
import { createWorkerOpenCVLoader } from "./opencv-worker";
import { curvesFromOutline } from "@shared/geometry/curves";

const image = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
function endpoint() {
  const events = new EventTarget();
  const sent: unknown[] = [];
  const terminate = vi.fn();
  const port: MessageEndpoint = {
    postMessage: (message, transfer) => sent.push(structuredClone(message, { transfer })),
    addEventListener: (type, listener) => events.addEventListener(type, listener),
    removeEventListener: (type, listener) => events.removeEventListener(type, listener),
    terminate,
  };
  return { port, terminate, sent, reply: (message: WorkerMessage) =>
    events.dispatchEvent(new MessageEvent("message", { data: message })),
  fail: () => events.dispatchEvent(new Event("error")) };
}
afterEach(() => vi.useRealTimers());

describe("photo worker lifecycle", () => {
  it("runs symmetry and point-only cleanup without loading OpenCV", async () => {
    const dense = [{ outer: [{ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: -10, y: 20 }], holes: [] }];
    const source = curvesFromOutline(dense), load = vi.fn(), handlers = createDetectionHandlers(load), context = { signal: new AbortController().signal, progress: () => {} };
    const result = await handlers.symmetry({ source, shapeIndex: 0, axis: { start: { x: 0, y: 0 }, end: { x: 0, y: 20 } }, side: "right", tolerance: .2 }, context);
    expect(result.anchors).toBeGreaterThanOrEqual(4);
    expect((await handlers.reconstruct({ source, dense, tolerance: .2, editableCurves: false }, context)).cubics).toBe(0);
    expect(load).not.toHaveBeenCalled();
    const e = endpoint(), client = createDetectionClient(() => e.port), controller = new AbortController();
    const pending = client.symmetry({ source, shapeIndex: 0, axis: { start: { x: 0, y: 0 }, end: { x: 0, y: 20 } }, side: "left", tolerance: .2 }, controller.signal);
    expect(e.sent[0]).toMatchObject({ kind: "call", method: "symmetry" });
    const rejected = expect(pending).rejects.toMatchObject({ name: "WorkerCancelledError" }); controller.abort(); await rejected; client.dispose();
  });
  it("runs geometry reconstruction without loading OpenCV and keeps caller geometry intact", async () => {
    const dense = [{ outer: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 0, y: 30 }], holes: [] }];
    const source = curvesFromOutline(dense), payload = { source, dense, tolerance: 0.2 }, before = structuredClone(payload);
    const load = vi.fn();
    const result = await createDetectionHandlers(load).reconstruct(payload, { signal: new AbortController().signal, progress: () => {} });
    expect(result.lines).toBe(4); expect(result.cubics).toBe(0); expect(load).not.toHaveBeenCalled(); expect(payload).toEqual(before);
    const e = endpoint(), client = createDetectionClient(() => e.port), controller = new AbortController();
    const pending = client.reconstruct(payload, controller.signal);
    expect(e.sent[0]).toMatchObject({ kind: "call", method: "reconstruct", payload });
    const rejected = expect(pending).rejects.toMatchObject({ name: "WorkerCancelledError" });
    controller.abort(); await rejected; expect(e.terminate).toHaveBeenCalledOnce(); expect(payload).toEqual(before); client.dispose();
  });
  it("transfers a copy, strips the signal, and reuses a warm worker", async () => {
    const e = endpoint();const spawn = vi.fn(() => e.port);
    const client = createDetectionClient(spawn);
    const first = client.detect(image, { signal: new AbortController().signal });
    expect(image.data.byteLength).toBe(16);
    expect(e.sent[0]).toMatchObject({ kind: "call", payload: { image: { data: image.data }, options: {} } });
    e.reply({ id: 1, kind: "result", payload: "first" });
    await expect(first).resolves.toBe("first");
    const next = client.detect(image);
    e.reply({ id: 2, kind: "result", payload: "second" });
    await expect(next).resolves.toBe("second");
    expect(spawn).toHaveBeenCalledTimes(1);
    client.dispose();expect(e.terminate).toHaveBeenCalledOnce();
  });

  it("terminates synchronous work when superseded and discards its late reply", async () => {
    const first = endpoint(), second = endpoint();
    const spawn = vi.fn().mockReturnValueOnce(first.port).mockReturnValueOnce(second.port);
    const client = createDetectionClient(spawn);
    const old = client.detect(image);
    const rejected = expect(old).rejects.toMatchObject({ name: "WorkerCancelledError" });
    const current = client.detect(image);
    expect(first.terminate).toHaveBeenCalledOnce();
    first.reply({ id: 1, kind: "result", payload: "stale" });
    second.reply({ id: 1, kind: "result", payload: "current" });
    await rejected;await expect(current).resolves.toBe("current");client.dispose();
  });

  it("aborts and then recovers with a new worker", async () => {
    const first = endpoint(), second = endpoint();
    const spawn = vi.fn().mockReturnValueOnce(first.port).mockReturnValueOnce(second.port);
    const client = createDetectionClient(spawn);const controller = new AbortController();
    const call = client.detect(image, { signal: controller.signal });
    const rejected = expect(call).rejects.toMatchObject({ name: "WorkerCancelledError" });
    controller.abort();await rejected;expect(first.terminate).toHaveBeenCalledOnce();
    const next = client.detect(image);second.reply({ id: 1, kind: "result", payload: "ready" });
    await expect(next).resolves.toBe("ready");client.dispose();
  });

  it("reports a stalled initialization and releases its worker", async () => {
    vi.useFakeTimers();const e = endpoint();const client = createDetectionClient(() => e.port);
    const pending = client.detect(image);const rejected = expect(pending).rejects.toThrow("Detection took too long");
    await vi.advanceTimersByTimeAsync(30_000);await rejected;
    expect(e.terminate).toHaveBeenCalledOnce();client.dispose();
  });

  it("releases the idle WASM heap and loads a fresh worker for a later trace", async () => {
    vi.useFakeTimers();const first = endpoint(), second = endpoint();
    const spawn = vi.fn().mockReturnValueOnce(first.port).mockReturnValueOnce(second.port);
    const client = createDetectionClient(spawn);
    const call = client.detect(image);first.reply({ id: 1, kind: "result", payload: "done" });await call;
    await vi.advanceTimersByTimeAsync(30_000);expect(first.terminate).toHaveBeenCalledOnce();
    const later = client.detect(image);second.reply({ id: 1, kind: "result", payload: "again" });
    await later;expect(spawn).toHaveBeenCalledTimes(2);client.dispose();
  });

  it("reports worker failure instead of leaving a processing request pending", async () => {
    const e = endpoint();const client = createDetectionClient(() => e.port);
    const pending = client.detect(image);e.fail();
    await expect(pending).rejects.toThrow("worker stopped unexpectedly");client.dispose();
  });

  it("cleans up a failed image allocation before a retry", async () => {
    const e = endpoint(); const spawn = vi.fn(() => e.port);
    const client = createDetectionClient(spawn);
    const data = image.data.slice();
    vi.spyOn(data, "slice").mockImplementation(() => { throw new RangeError("allocation failed"); });
    const controller = new AbortController();
    const detach = vi.spyOn(controller.signal, "removeEventListener");
    await expect(client.detect({ ...image, data }, { signal: controller.signal })).rejects.toThrow("allocation failed");
    expect(detach).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(spawn).not.toHaveBeenCalled();
    const retry = client.detect(image);
    e.reply({ id: 1, kind: "result", payload: "ready" });
    await expect(retry).resolves.toBe("ready"); client.dispose();
  });

  it("skips a cancelled queued job while allowing its successor to finish", async () => {
    let release!: (value: never) => void;
    const load = vi.fn(() => new Promise<never>(resolve => { release = resolve; }));
    const handlers = createDetectionHandlers(load);
    const controller = new AbortController();
    const first = handlers.detect({ image, options: {} }, { signal: controller.signal, progress: () => {} });
    const rejection = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();controller.abort();release({} as never);
    const next = handlers.detect({ image, options: { engine: "js" } }, { signal: new AbortController().signal, progress: () => {} });
    await rejection;expect((await next).engine).toBe("js");expect(load).toHaveBeenCalledOnce();
  });
});

it("loads the UMD entry once in module workers and restores temporary configuration", async () => {
  const root = globalThis as typeof globalThis & { cv?: unknown; Module?: unknown };
  const before = { cv: root.cv, Module: root.Module };
  const runtime = { Mat: class {} };
  const importBundle = vi.fn(async () => {
    expect(root.Module).toEqual({});root.cv = Promise.resolve(runtime);
  });
  const load = createWorkerOpenCVLoader(importBundle);
  expect(await load()).toBe(runtime);expect(await load()).toBe(runtime);
  expect(importBundle).toHaveBeenCalledOnce();expect(root.Module).toBe(before.Module);
  if (before.cv === undefined) delete root.cv; else root.cv = before.cv;
});

it("restores UMD configuration on initialization failure", async () => {
  const root = globalThis as typeof globalThis & { Module?: unknown };
  const before = root.Module;
  const load = createWorkerOpenCVLoader(async () => { throw new Error("offline"); });
  await expect(load()).rejects.toThrow("offline");expect(root.Module).toBe(before);
});

it("cancels source reprojection and never initializes OpenCV for it", async () => {
  const load=vi.fn(), handlers=createDetectionHandlers(load), payload={image:{...image,data:image.data.slice()},width:2,height:2,toSource:[1,0,0,0,1,0,0,0,1] as import("@shared/geometry/projective").Homography};
  expect(await handlers.reproject(payload,{signal:new AbortController().signal,progress:()=>{}})).toEqual(image);
  expect(load).not.toHaveBeenCalled();
  const e=endpoint(),client=createDetectionClient(()=>e.port),controller=new AbortController();
  const pending=client.reproject(payload,controller.signal);
  const rejected=expect(pending).rejects.toMatchObject({name:"WorkerCancelledError"});
  controller.abort();await rejected;expect(e.terminate).toHaveBeenCalledOnce();client.dispose();
});
