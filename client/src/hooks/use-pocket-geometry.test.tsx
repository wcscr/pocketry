// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import type { PocketGeometry, ResolvePocketGeometryRequest } from "@/lib/gridfinity/worker-api";
import { usePocketGeometry } from "./use-pocket-geometry";

const build = vi.hoisted(() => ({ calls: [] as { request: ResolvePocketGeometryRequest; finish: () => void; fail: () => void }[], dispose: vi.fn() }));
vi.mock("@/lib/worker/client", () => ({ createWorkerClient: () => ({
  call: (_method: string, request: ResolvePocketGeometryRequest) => new Promise((resolve, reject) => {
    build.calls.push({ request, finish: () => resolve(request.pockets.map(p => ({ full: [], opening: [],
      mesh: { positions: new Float32Array(), indices: new Uint32Array(), normals: null },
      edges: [], elevation: p.cutout.elevationMm }))), fail: () => reject(new Error("Worker stopped")) });
  }), dispose: build.dispose,
}) }));
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); build.calls = []; vi.clearAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, fill: "solid" });
const shape: TracedShape = { id: "s", name: "Tool", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, outlineMm: [{ outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], holes: [] }] };
const pocket = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 }, elevationMm: 7 });
const shapes = new Map([[shape.id, shape]]), cutouts = [pocket];
function mount() {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container);
  let current: Map<string, PocketGeometry>[] = [];
  function View({ items = cutouts, sources = shapes, bin = spec, enabled = true }) {
    current = [usePocketGeometry(items, sources, bin, enabled), usePocketGeometry(items, sources, bin, enabled)];
    return null;
  }
  const render = (props: React.ComponentProps<typeof View> = {}) => React.act(() => root.render(<View {...props} />));
  const unmount = () => React.act(() => root.unmount());
  cleanups.push(unmount);
  render();
  return { render, current: () => current, unmount };
}
const tick = () => React.act(async () => { await vi.advanceTimersByTimeAsync(0); });
const finish = (index: number) => React.act(async () => { build.calls[index].finish(); });

it("shares detached geometry, coalesces pending poses, and rejects stale publication", async () => {
  const view = mount(); await tick();
  expect(build.calls).toHaveLength(1); await finish(0);
  expect(view.current()[0].get("p")).toBe(view.current()[1].get("p"));
  const first = view.current()[0].get("p");
  view.render({ items: [{ ...pocket, elevationMm: 12 }] }); await tick();
  expect(view.current()[0].size).toBe(0);
  for (let elevationMm = 13; elevationMm <= 30; elevationMm++) view.render({ items: [{ ...pocket, elevationMm }] });
  expect(build.calls).toHaveLength(2);
  await finish(1);
  expect(view.current()[0].size).toBe(0);
  expect(build.calls).toHaveLength(3);
  expect(build.calls[2].request.pockets[0].cutout.elevationMm).toBe(30);
  await finish(2);
  expect(view.current()[0].get("p")).not.toBe(first);
  expect(view.current()[0].get("p")).toHaveProperty("elevation", 30);
  expect(view.current()[0].get("p")).toBe(view.current()[1].get("p"));
});

it.each([undefined, "axis", "vertical"] as const)("does not request solid geometry during 120 drag frames with insertion=%s, then resolves once", async insertionMode => {
  const view = mount(); await tick(); await finish(0);
  const posed = { ...pocket, insertionMode };
  for (let x = 1; x <= 120; x++) {
    view.render({ items: [{ ...posed, position: { x, y: 0 } }], enabled: false });
    await tick();
    expect(view.current()[0].size).toBe(0);
  }
  expect(build.calls).toHaveLength(1);
  view.render({ items: [{ ...posed, position: { x: 120, y: 0 } }] }); await tick();
  expect(build.calls).toHaveLength(2);
  expect(build.calls[1].request.pockets[0].cutout.position.x).toBe(120);
  expect(build.calls[1].request.pockets[0].cutout.insertionMode).toBe(insertionMode);
  await finish(1); expect(view.current()[0].get("p")).toBeDefined();
});

it("invalidates shape and fill edits, ignores replies during a gesture, and releases its shared worker", async () => {
  const view = mount(); await tick();
  view.render({ enabled: false }); await finish(0);
  expect(view.current()[0].size).toBe(0);
  view.render(); await tick();
  expect(build.calls).toHaveLength(1);
  expect(view.current()[0].get("p")).toBeDefined();
  const changedShapes = new Map([[shape.id, { ...shape, outlineMm: [] }]]);
  view.render({ sources: changedShapes }); await tick(); await finish(1);
  expect(build.calls[1].request.pockets[0].shape.outlineMm).toEqual([]);
  view.render({ sources: changedShapes, bin: { ...spec, fillHeightPercent: 50 } }); await tick();
  expect(build.calls[2].request.spec.fillHeightPercent).toBe(50);
  view.unmount();
  expect(build.dispose).toHaveBeenCalledOnce();
  await finish(2);
});

it("batches multiple pockets once and can recover an optional outline after a failed worker", async () => {
  const view = mount();
  const items = [pocket, { ...pocket, id: "other", elevationMm: 10 }];
  view.render({ items }); await tick();
  expect(build.calls).toHaveLength(1);
  expect(build.calls[0].request.pockets).toHaveLength(2);
  await React.act(async () => build.calls[0].fail());
  expect(view.current()[0].size).toBe(0);
  view.render({ items: [...items] }); await tick();
  expect(build.calls).toHaveLength(2);
  await finish(1);
  expect(view.current()[0].get("p")).toHaveProperty("elevation", 7);
  expect(view.current()[0].get("other")).toHaveProperty("elevation", 10);
});
