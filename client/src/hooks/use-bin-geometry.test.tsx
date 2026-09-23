import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseBinSpec } from "@shared/gridfinity/types";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { PREVIEW_QUALITY, EXPORT_QUALITY } from "@/lib/gridfinity/bin";
import { useBinGeometry, type BinGeometryState } from "@/lib/gridfinity/use-bin-geometry";
import type { BuildBinRequest, BuildBinResult, BuildFitCheckRequest, BuildSurfaceFitCheckRequest } from "@/lib/gridfinity/worker-api";
import type { ClientMessage, WorkerMessage } from "@/lib/worker/protocol";

type Call = Extract<ClientMessage, { kind: "call" }>;
class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  sent: ClientMessage[] = [];
  constructor() { super(); TestWorker.instances.push(this); }
  postMessage(message: ClientMessage) { this.sent.push(structuredClone(message)); }
  terminate = vi.fn();
  get calls(): Call[] { return this.sent.filter((m): m is Call => m.kind === "call"); }
  reply(message: WorkerMessage) { this.dispatchEvent(new MessageEvent("message", { data: message })); }
  finish(index: number, result = resultFor(index + 1)) {
    this.reply({ kind: "result", id: this.calls[index].id, payload: result });
  }
  fail(index: number) {
    this.reply({ kind: "error", id: this.calls[index].id, error: { name: "Error", message: "Bad geometry" } });
  }
}
function resultFor(id: number): BuildBinResult {
  return {
    mesh: { positions: new Float32Array([id, 0, 0, id + 1, 0, 0, id, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) },
    stats: { triangles: 1, volumeMm3: id, buildMs: 1 }, cutoutReports: [],
  };
}
const shape: TracedShape = { id: "tool", name: "Tool", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
  outlineMm: [{ outer: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }], holes: [] }] };
const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } });
const layout = { shapes: [shape], cutouts: [cutout], fingerHoles: [] };
const spec = (heightUnits: number) => parseBinSpec({ gridX: 1, gridY: 1, heightUnits });

describe("bin preview worker lifecycle", () => {
  let root: Root;
  let host: HTMLDivElement;
  let state: BinGeometryState;
  const Probe = ({ args }: { args: Parameters<typeof useBinGeometry> }) => {
    state = useBinGeometry(...args); return null;
  };
  const render = async (height: number, strict = false, extra: { 3?: Parameters<typeof useBinGeometry>[3]; 4?: Parameters<typeof useBinGeometry>[4] } = {}) => {
    const args: Parameters<typeof useBinGeometry> = [spec(height), PREVIEW_QUALITY, layout, extra[3], extra[4]];
    await React.act(async () => root.render(strict ? <React.StrictMode><Probe args={args} /></React.StrictMode> : <Probe args={args} />));
  };
  const tick = async (ms = 120) => { await React.act(async () => vi.advanceTimersByTimeAsync(ms)); };
  const worker = () => TestWorker.instances.at(-1)!;
  const reply = async (action: () => void) => { await React.act(async () => action()); };
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("Worker", TestWorker);
    vi.useFakeTimers(); TestWorker.instances = [];
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => {
    React.act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
  });

  it("debounces initial edits and keeps only the newest pending preview without cancellation", async () => {
    await render(2); await tick(60); await render(3); await tick();
    expect(worker().calls).toHaveLength(1);
    expect((worker().calls[0].payload as BuildBinRequest).spec.heightUnits).toBe(3);
    await render(4); await tick(); await render(5); await tick();
    expect(worker().calls).toHaveLength(1);
    expect(worker().sent.some(m => m.kind === "cancel")).toBe(false);
    await reply(() => worker().finish(0));
    expect(state!.geometry).toBeNull(); expect(state!.building).toBe(true);
    expect(worker().calls).toHaveLength(2);
    expect((worker().calls[1].payload as BuildBinRequest).spec.heightUnits).toBe(5);
    await reply(() => worker().finish(1));
    expect(state!.builtSpec?.heightUnits).toBe(5); expect(state!.building).toBe(false);
  });

  it("ignores stale results and progress even before the new debounce is ready", async () => {
    await render(2); await tick(); await render(3); await tick(60);
    await reply(() => {
      worker().reply({ kind: "progress", id: worker().calls[0].id, value: 0.9 });
      worker().finish(0);
    });
    expect(state!.progress).toBe(0); expect(state!.building).toBe(true); expect(state!.geometry).toBeNull();
    expect(worker().calls).toHaveLength(1);
    await tick(60); expect(worker().calls).toHaveLength(2);
  });

  it("drops a previously queued job immediately when a new edit is still debouncing", async () => {
    await render(2); await tick(); await render(3); await tick(); await render(4);
    await reply(() => worker().finish(0));
    expect(worker().calls).toHaveLength(1);
    await tick(); expect((worker().calls[1].payload as BuildBinRequest).spec.heightUnits).toBe(4);
  });

  it("handles A to B to A undo without publishing the older A job", async () => {
    await render(2); await tick(); await render(3); await tick(); await render(2); await tick();
    await reply(() => worker().finish(0, resultFor(99)));
    expect(state!.geometry).toBeNull();
    expect(worker().calls).toHaveLength(2);
    await reply(() => worker().finish(1, resultFor(2)));
    expect(state!.stats?.volumeMm3).toBe(2); expect(state!.builtSpec?.heightUnits).toBe(2);
  });

  it("recovers after current and stale handler errors without stranding pending work", async () => {
    await render(2); await tick(); await reply(() => worker().fail(0));
    expect(state!.error).toBe("Bad geometry"); expect(state!.building).toBe(false);
    await render(3); await tick(); await render(4); await tick();
    await reply(() => worker().fail(1));
    expect(worker().calls).toHaveLength(3); expect(state!.building).toBe(true);
    await reply(() => worker().finish(2));
    expect(state!.error).toBeNull(); expect(state!.builtSpec?.heightUnits).toBe(4);
  });

  it("keeps the previous geometry until a current replacement is ready and disposes it once", async () => {
    await render(2); await tick(); await reply(() => worker().finish(0));
    const first = state!.geometry!; const dispose = vi.spyOn(first, "dispose");
    await render(3); await tick(); await render(4); await tick();
    await reply(() => worker().finish(1)); expect(state!.geometry).toBe(first); expect(dispose).not.toHaveBeenCalled();
    await reply(() => worker().finish(2)); expect(dispose).toHaveBeenCalledTimes(1); expect(state!.geometry).not.toBe(first);
  });

  it("keeps each export payload while previews and project state change", async () => {
    await render(2, false, { 3: { axis: "x", offsetMm: 0 } }); await tick();
    let normal!: ReturnType<BinGeometryState["buildOnce"]>;
    let fit!: ReturnType<BinGeometryState["buildFitCheck"]>;
    let surface!: ReturnType<BinGeometryState["buildSurfaceFitCheck"]>;
    await React.act(async () => {
      normal = state!.buildOnce(EXPORT_QUALITY, { pocketFloorMaterialThicknessMm: 0.8 });
      fit = state!.buildFitCheck(shape, cutout, 8, EXPORT_QUALITY);
      surface = state!.buildSurfaceFitCheck(0.8, EXPORT_QUALITY, "full");
    });
    await render(3); await tick(); await render(4); await tick();
    expect(worker().calls).toHaveLength(4);
    const [preview, exported, fitCall, surfaceCall] = worker().calls;
    expect(preview.method).toBe("buildBin");
    expect(exported.payload as BuildBinRequest).toMatchObject({ spec: { heightUnits: 2 }, quality: EXPORT_QUALITY, exportTopology: true, pocketFloorMaterialThicknessMm: 0.8 });
    expect((exported.payload as BuildBinRequest).section).toBeUndefined();
    expect(fitCall.method).toBe("buildFitCheck");
    expect(fitCall.payload as BuildFitCheckRequest).toMatchObject({ shape, cutout, depthMm: 8 });
    expect(surfaceCall.method).toBe("buildSurfaceFitCheck");
    expect(surfaceCall.payload as BuildSurfaceFitCheckRequest).toMatchObject({ spec: { heightUnits: 2 }, thicknessMm: 0.8, style: "full" });
    await reply(() => worker().finish(0)); expect(worker().calls).toHaveLength(5);
    await reply(() => { worker().finish(1, resultFor(11)); worker().finish(2, resultFor(12)); worker().finish(3, resultFor(13)); worker().finish(4); });
    expect((await normal).stats.volumeMm3).toBe(11); expect((await fit).stats.volumeMm3).toBe(12); expect((await surface).stats.volumeMm3).toBe(13);
    expect(state!.builtSpec?.heightUnits).toBe(4);
  });

  it("captures the newest section and material settings", async () => {
    await render(2); await tick();
    await render(2, false, { 3: { axis: "y", offsetMm: 4 }, 4: { pocketFloorThicknessMm: 0.8 } }); await tick();
    await render(2, false, { 3: { axis: "x", offsetMm: -5 }, 4: { pocketFloorThicknessMm: 1.2 } }); await tick();
    await reply(() => worker().finish(0));
    expect(worker().calls[1].payload).toMatchObject({ section: { axis: "x", offsetMm: -5 }, pocketFloorMaterialThicknessMm: 1.2 });
  });

  it("does not restart pending work after unmount or an old worker reply", async () => {
    await render(2); await tick(); await render(3); await tick(); const old = worker();
    await React.act(async () => root.render(null));
    expect(old.terminate).toHaveBeenCalledTimes(1);
    await render(4); await tick(); const current = worker(); expect(current).not.toBe(old);
    await reply(() => old.finish(0)); expect(current.calls).toHaveLength(1); expect(state!.geometry).toBeNull();
    await reply(() => current.finish(0)); expect(state!.builtSpec?.heightUnits).toBe(4);
    expect(old.calls).toHaveLength(1);
  });

  it("creates one debounced worker after StrictMode effect replay", async () => {
    await render(2, true); await tick(); expect(TestWorker.instances).toHaveLength(1); expect(worker().calls).toHaveLength(1);
    await render(3, true); await tick(); await reply(() => worker().finish(0)); await reply(() => worker().finish(1));
    expect(state!.builtSpec?.heightUnits).toBe(3);
  });

  it.each(["error", "messageerror"])("releases a failed worker on %s and drains the latest preview on a new worker", async type => {
    await render(2); await tick(); await render(3); await tick(); const old = worker();
    let exportError!: Promise<unknown>;
    await React.act(async () => { exportError = state!.buildOnce(EXPORT_QUALITY).catch(error => error); });
    await reply(() => old.dispatchEvent(new Event(type)));
    expect(await exportError).toBeInstanceOf(Error); expect(old.terminate).toHaveBeenCalledTimes(1);
    expect(worker()).not.toBe(old); expect(worker().calls).toHaveLength(1);
    await reply(() => worker().finish(0)); expect(state!.builtSpec?.heightUnits).toBe(3); expect(state!.error).toBeNull();
  });

  it("surfaces worker failure for the current request and retries only on a later edit", async () => {
    await render(2); await tick(); await reply(() => worker().dispatchEvent(new Event("error")));
    expect(state!.building).toBe(false); expect(state!.error).toContain("stopped unexpectedly");
    expect(TestWorker.instances).toHaveLength(1);
    await render(3); await tick(); expect(TestWorker.instances).toHaveLength(2);
    await reply(() => worker().finish(0)); expect(state!.error).toBeNull();
  });
});
