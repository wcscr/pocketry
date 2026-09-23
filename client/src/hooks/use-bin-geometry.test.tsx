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
  constructor(_url: URL, readonly options: WorkerOptions) { super(); TestWorker.instances.push(this); }
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
const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, bottomFilletMm: 0 });
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
  const tick = async (ms = 32) => { await React.act(async () => vi.advanceTimersByTimeAsync(ms)); };
  const worker = () => TestWorker.instances.filter(w => w.options.name === "pocketry-interactive").at(-1)!;
  const detailWorker = () => TestWorker.instances.filter(w => w.options.name === "pocketry-detail").at(-1)!;
  const roundedLayout = { ...layout, cutouts: [{ ...cutout, topFilletMm: 1, bottomFilletMm: 2 }] };
  const renderRounded = async (height: number, strict = false) => {
    const args: Parameters<typeof useBinGeometry> = [spec(height), PREVIEW_QUALITY, roundedLayout];
    await React.act(async () => root.render(strict ? <React.StrictMode><Probe args={args} /></React.StrictMode> : <Probe args={args} />));
  };
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

  it("batches initial edits and keeps only the newest pending preview without cancellation", async () => {
    await render(2); await tick(16); await render(3); await tick();
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

  it("ignores stale results and progress while immediately starting the newest queued edit", async () => {
    await render(2); await tick(); await render(3); await tick(16);
    await reply(() => {
      worker().reply({ kind: "progress", id: worker().calls[0].id, value: 0.9 });
      worker().finish(0);
    });
    expect(state!.progress).toBe(0); expect(state!.building).toBe(true); expect(state!.geometry).toBeNull();
    expect(worker().calls).toHaveLength(2);
    expect((worker().calls[1].payload as BuildBinRequest).spec.heightUnits).toBe(3);
  });

  it("drops a previously queued job immediately when a newer edit arrives", async () => {
    await render(2); await tick(); await render(3); await tick(); await render(4);
    await reply(() => worker().finish(0));
    expect(worker().calls).toHaveLength(2);
    expect((worker().calls[1].payload as BuildBinRequest).spec.heightUnits).toBe(4);
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
    expect(worker().calls).toHaveLength(1);
    expect(detailWorker().calls).toHaveLength(3);
    const preview = worker().calls[0];
    const [exported, fitCall, surfaceCall] = detailWorker().calls;
    expect(preview.method).toBe("buildBin");
    expect(exported.payload as BuildBinRequest).toMatchObject({ spec: { heightUnits: 2 }, quality: EXPORT_QUALITY, exportTopology: true, pocketFloorMaterialThicknessMm: 0.8 });
    expect((exported.payload as BuildBinRequest).section).toBeUndefined();
    expect(fitCall.method).toBe("buildFitCheck");
    expect(fitCall.payload as BuildFitCheckRequest).toMatchObject({ shape, cutout, depthMm: 8 });
    expect(surfaceCall.method).toBe("buildSurfaceFitCheck");
    expect(surfaceCall.payload as BuildSurfaceFitCheckRequest).toMatchObject({ spec: { heightUnits: 2 }, thicknessMm: 0.8, style: "full" });
    await reply(() => worker().finish(0)); expect(worker().calls).toHaveLength(2);
    await reply(() => { detailWorker().finish(0, resultFor(11)); detailWorker().finish(1, resultFor(12)); detailWorker().finish(2, resultFor(13)); worker().finish(1); });
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

  it("creates one scheduled worker after StrictMode effect replay", async () => {
    await render(2, true); await tick(); expect(TestWorker.instances).toHaveLength(1); expect(worker().calls).toHaveLength(1);
    await render(3, true); await tick(); await reply(() => worker().finish(0)); await reply(() => worker().finish(1));
    expect(state!.builtSpec?.heightUnits).toBe(3);
  });

  it.each(["error", "messageerror"])("releases a failed worker on %s and drains the latest preview on a new worker", async type => {
    await render(2); await tick(); await render(3); await tick(); const old = worker();
    let exported!: Promise<BuildBinResult>;
    await React.act(async () => { exported = state!.buildOnce(EXPORT_QUALITY); });
    const exportWorker = detailWorker();
    await reply(() => old.dispatchEvent(new Event(type)));
    expect(old.terminate).toHaveBeenCalledTimes(1);
    expect(exportWorker.terminate).not.toHaveBeenCalled();
    await reply(() => exportWorker.finish(0, resultFor(42)));
    expect((await exported).stats.volumeMm3).toBe(42);
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

  it("publishes a draft promptly, then the authored detail after input settles", async () => {
    await renderRounded(3); await tick();
    expect(worker().calls[0].payload).toMatchObject({ previewDraft: true, quality: PREVIEW_QUALITY,
      layout: { cutouts: [{ topFilletMm: 1, bottomFilletMm: 2 }] } });
    const draft = resultFor(10);
    draft.cutoutReports = [{ id: cutout.id, emptied: true }];
    await reply(() => worker().finish(0, draft));
    expect(state!.geometry).not.toBeNull();
    expect(state!.previewIsDraft).toBe(true);
    expect(state!.stats).toBeNull();
    expect(state!.cutoutReports).toEqual([]);
    expect(state!.building).toBe(true);
    const dispose = vi.spyOn(state!.geometry!, "dispose");
    await tick(267); expect(detailWorker()).toBeUndefined();
    await tick(1); expect(detailWorker().calls).toHaveLength(1);
    expect((detailWorker().calls[0].payload as BuildBinRequest).previewDraft).toBeUndefined();
    expect(detailWorker().calls[0].payload).toMatchObject({ layout: roundedLayout });
    await reply(() => detailWorker().finish(0, resultFor(20)));
    expect(state!.previewIsDraft).toBe(false); expect(state!.building).toBe(false);
    expect(state!.stats?.volumeMm3).toBe(20); expect(dispose).toHaveBeenCalledOnce();
    // Editing invalidates detailed statistics before the next draft is ready.
    await renderRounded(4); expect(state!.stats).toBeNull();
  });

  it("waits for a slow draft to finish before spending CPU on its refinement", async () => {
    await renderRounded(3); await tick(500);
    expect(TestWorker.instances).toHaveLength(1);
    await reply(() => worker().finish(0));
    expect(detailWorker().calls).toHaveLength(1);
  });

  it("keeps drafts responsive during refinement and discards old detailed results", async () => {
    await renderRounded(2); await tick(); await reply(() => worker().finish(0)); await tick(268);
    const detail = detailWorker();
    await renderRounded(3); await tick(); await reply(() => worker().finish(1, resultFor(30))); await tick(268);
    await renderRounded(4); await tick(); await reply(() => worker().finish(2, resultFor(40))); await tick(268);
    expect(worker().calls).toHaveLength(3); expect(detail.calls).toHaveLength(1);
    const currentDraft = state!.geometry;
    await reply(() => {
      detail.reply({ kind: "progress", id: detail.calls[0].id, value: 0.95 });
      detail.finish(0, resultFor(99));
    });
    expect(state!.geometry).toBe(currentDraft); expect(state!.stats).toBeNull(); expect(state!.progress).toBe(0);
    expect(detail.calls).toHaveLength(2);
    expect((detail.calls[1].payload as BuildBinRequest).spec.heightUnits).toBe(4);
    await reply(() => detail.finish(1, resultFor(400)));
    expect(state!.stats?.volumeMm3).toBe(400); expect(state!.previewIsDraft).toBe(false);
    // A duplicate late draft response cannot downgrade detailed geometry.
    await reply(() => worker().finish(2, resultFor(40)));
    expect(state!.stats?.volumeMm3).toBe(400);
    expect(TestWorker.instances).toHaveLength(2);
  });

  it("drops a pending refinement as soon as editing resumes", async () => {
    await renderRounded(2); await tick(); await reply(() => worker().finish(0)); await tick(268);
    await renderRounded(3); await tick(); await reply(() => worker().finish(1)); await tick(268);
    await renderRounded(4);
    await reply(() => detailWorker().finish(0));
    expect(detailWorker().calls).toHaveLength(1);
    await tick(); await reply(() => worker().finish(2)); await tick(267);
    expect(detailWorker().calls).toHaveLength(1);
    await tick(1); expect((detailWorker().calls[1].payload as BuildBinRequest).spec.heightUnits).toBe(4);
  });

  it("does not refine during a continuous burst of edits", async () => {
    for (const height of [2, 3, 4, 5]) {
      await renderRounded(height); await tick(); await reply(() => worker().finish(height - 2)); await tick(150);
      expect(detailWorker()).toBeUndefined();
    }
    await tick(118); expect(detailWorker().calls).toHaveLength(1);
    expect((detailWorker().calls[0].payload as BuildBinRequest).spec.heightUnits).toBe(5);
  });

  it("does not starve drafts when pointer events arrive faster than the initial batching window", async () => {
    for (const height of [2, 3, 4, 5]) {
      await renderRounded(height); await tick(8);
    }
    expect(worker().calls).toHaveLength(1);
    expect((worker().calls[0].payload as BuildBinRequest).spec.heightUnits).toBe(5);
    for (const height of [6, 7, 8, 9]) {
      await renderRounded(height); await tick(8);
    }
    await reply(() => worker().finish(0));
    expect(worker().calls).toHaveLength(2);
    expect((worker().calls[1].payload as BuildBinRequest).spec.heightUnits).toBe(9);
    await reply(() => worker().finish(1));
    expect(state!.builtSpec?.heightUnits).toBe(9);
    expect(state!.previewIsDraft).toBe(true); expect(detailWorker()).toBeUndefined();
  });

  it("removing rounding uses the interactive worker without waiting for old refinement", async () => {
    await renderRounded(2); await tick(); await reply(() => worker().finish(0)); await tick(268);
    await render(3); await tick(); await reply(() => worker().finish(1, resultFor(30)));
    expect((worker().calls[1].payload as BuildBinRequest).previewDraft).toBeUndefined();
    expect(state!.previewIsDraft).toBe(false); expect(state!.stats?.volumeMm3).toBe(30);
    await reply(() => detailWorker().finish(0, resultFor(99)));
    expect(state!.stats?.volumeMm3).toBe(30);
  });

  it("tries detailed geometry after a draft failure and retains the draft label on detail failure", async () => {
    await renderRounded(2); await tick(); await reply(() => worker().fail(0));
    expect(state!.error).toBeNull(); expect(state!.building).toBe(true);
    await tick(268); await reply(() => detailWorker().finish(0));
    expect(state!.previewIsDraft).toBe(false); expect(state!.error).toBeNull();
    await renderRounded(3); await tick(); await reply(() => worker().finish(1)); await tick(268);
    const draft = state!.geometry;
    await reply(() => detailWorker().fail(1));
    expect(state!.geometry).toBe(draft); expect(state!.previewIsDraft).toBe(true);
    expect(state!.stats).toBeNull(); expect(state!.building).toBe(false);
    expect(state!.error).toContain("Detailed preview failed");
  });

  it("exports full authored settings while a draft is displayed", async () => {
    await renderRounded(3); await tick(); await reply(() => worker().finish(0));
    let exported!: Promise<BuildBinResult>;
    await React.act(async () => { exported = state!.buildOnce(EXPORT_QUALITY); });
    expect(detailWorker().calls[0].payload).toMatchObject({ exportTopology: true, quality: EXPORT_QUALITY, layout: roundedLayout });
    expect((detailWorker().calls[0].payload as BuildBinRequest).previewDraft).toBeUndefined();
    await renderRounded(4); await tick(); await reply(() => worker().finish(1));
    await reply(() => detailWorker().finish(0, resultFor(30)));
    expect((await exported).stats.volumeMm3).toBe(30); expect(state!.builtSpec?.heightUnits).toBe(4);
  });

  it("previews live gestures but exports the committed snapshot, including a commit without a preview-key change", async () => {
    const args: Parameters<typeof useBinGeometry> = [spec(2), PREVIEW_QUALITY, roundedLayout,
      undefined, {}, { spec: spec(3), layout: roundedLayout }];
    await React.act(async () => root.render(<Probe args={args} />)); await tick();
    expect((worker().calls[0].payload as BuildBinRequest).spec.heightUnits).toBe(3);
    await reply(() => worker().finish(0)); expect(state!.builtSpec?.heightUnits).toBe(3);
    let first!: Promise<BuildBinResult>;
    await React.act(async () => { first = state!.buildOnce(EXPORT_QUALITY); });
    expect((detailWorker().calls[0].payload as BuildBinRequest).spec.heightUnits).toBe(2);
    await reply(() => detailWorker().finish(0)); await first;
    const committed: Parameters<typeof useBinGeometry> = [...args]; committed[0] = spec(3);
    await React.act(async () => root.render(<Probe args={committed} />));
    let second!: Promise<BuildBinResult>;
    await React.act(async () => { second = state!.buildOnce(EXPORT_QUALITY); });
    expect((detailWorker().calls[1].payload as BuildBinRequest).spec.heightUnits).toBe(3);
    expect(worker().calls).toHaveLength(1);
    await reply(() => detailWorker().finish(1)); await second;
  });

  it.each(["error", "messageerror"])("a refinement worker %s preserves interactive work and recovers pending detail", async type => {
    await renderRounded(2); await tick(); await reply(() => worker().finish(0)); await tick(268);
    const failed = detailWorker();
    await renderRounded(3); await tick(); await reply(() => worker().finish(1)); await tick(268);
    await reply(() => failed.dispatchEvent(new Event(type)));
    expect(worker().terminate).not.toHaveBeenCalled();
    expect(detailWorker()).not.toBe(failed); expect(detailWorker().calls).toHaveLength(1);
    expect(state!.previewIsDraft).toBe(true); expect(state!.error).toBeNull();
    await reply(() => detailWorker().finish(0)); expect(state!.previewIsDraft).toBe(false);
  });

  it("cleans up both lanes and idle timers during unmount and StrictMode replay", async () => {
    await renderRounded(2, true); await tick(); await reply(() => worker().finish(0)); await tick(268);
    await renderRounded(3, true); await tick(); await reply(() => worker().finish(1)); await tick(268);
    const oldWorkers = [...TestWorker.instances];
    await React.act(async () => root.render(null));
    for (const old of oldWorkers) expect(old.terminate).toHaveBeenCalledOnce();
    await renderRounded(4, true); await tick();
    await reply(() => oldWorkers[1].finish(0));
    expect(worker().calls).toHaveLength(1); expect(state!.geometry).toBeNull();
    await reply(() => worker().finish(0)); await tick(268);
    expect(detailWorker().calls).toHaveLength(1);
    expect(oldWorkers[1].calls).toHaveLength(1);
  });
});
