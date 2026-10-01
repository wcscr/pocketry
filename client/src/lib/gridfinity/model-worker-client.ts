import { createWorkerClient } from "@/lib/worker/client";
import type { ModelUnits } from "@shared/gridfinity/model-pocket";
import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";
import type { ObjectGeometry } from "./object-geometry";

export function createModelWorkerClient() {
  return createWorkerClient(() => new Worker(new URL("./model.worker.ts", import.meta.url), { type: "module" }));
}
export async function readModelFile(file: File, units: ModelUnits, signal: AbortSignal): Promise<TracedShape> {
  const client = createModelWorkerClient();
  const cancel = () => client.dispose();
  signal.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; cancel(); }, 60_000);
  try {
    const buffer = await file.arrayBuffer();
    return await client.call<TracedShape>("importStl", { buffer, units, name: file.name.replace(/\.stl$/i, ""), id: crypto.randomUUID() }, { signal, transfer: [buffer] });
  } catch (error) {
    if (timedOut) throw new Error("Model processing exceeded one minute. Simplify the mesh and try again.");
    throw error;
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", cancel); client.dispose(); }
}

/** Share a worker and pending result between layout, viewport, and inspector.
 * Pending work stops when its last viewer leaves; completed geometry survives
 * reopening the inspector. Weak keys let obsolete placements be collected. */
const inspections = new WeakMap<CutoutPlacement, { shape: TracedShape; spec: BinSpec; promise: Promise<ObjectGeometry>; refs: number; settled: boolean; dispose: () => void }>();
export function inspectModel(shape: TracedShape, cutout: CutoutPlacement, spec: BinSpec) {
  let entry = inspections.get(cutout);
  if (!entry || entry.shape !== shape || entry.spec !== spec) {
    const client = createModelWorkerClient();
    const timeout = setTimeout(() => client.dispose(), 60_000);
    const promise = client.call<ObjectGeometry>("inspectModel", { shape, cutout, spec }).then(value => {
      if (entry) entry.settled = true;
      return value;
    }, error => {
      if (inspections.get(cutout) === entry) inspections.delete(cutout);
      throw error;
    }).finally(() => {
      clearTimeout(timeout); client.dispose();
    });
    entry = { shape, spec, promise, refs: 0, settled: false, dispose: () => client.dispose() };
    inspections.set(cutout, entry);
  }
  entry.refs++;
  const current = entry;
  let released = false;
  return { promise: current.promise, release: () => {
    if (released) return;
    released = true;
    if (--current.refs === 0 && !current.settled) {
      current.dispose(); if (inspections.get(cutout) === current) inspections.delete(cutout);
    }
  } };
}
