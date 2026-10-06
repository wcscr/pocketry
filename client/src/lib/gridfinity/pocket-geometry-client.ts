import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";
import { createWorkerClient, type WorkerClient } from "@/lib/worker/client";
import { WorkerCancelledError } from "@/lib/worker/protocol";
import { RESOLVE_POCKET_GEOMETRY_METHOD, type PocketGeometry, type ResolvePocketGeometryRequest } from "./worker-api";

type Entry = {
  shape: TracedShape; spec: BinSpec; cutout: CutoutPlacement;
  resolve: (geometry: PocketGeometry) => void; reject: (error: unknown) => void;
};
type Cached = { shape: TracedShape; spec: BinSpec; promise: Promise<PocketGeometry> };
let cache = new WeakMap<CutoutPlacement, Cached>();
let client: WorkerClient | null = null;
let consumers = 0;
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<string, Entry>();

/** One shared lazy worker, one physical batch, and only the latest pending pose
 * per pocket. Cancelling a promise cannot interrupt synchronous CSG. */
async function drain(): Promise<void> {
  if (running || !pending.size) return;
  const jobs = [...pending.values()];
  pending.clear();
  running = true;
  const lane = client ??= createWorkerClient(() => new Worker(new URL("./bin.worker.ts", import.meta.url), { type: "module", name: "pocketry-selection" }));
  try {
    // Batch only matching bin specs; other documents retain their own snapshot.
    const groups = new Map<BinSpec, Entry[]>();
    for (const job of jobs) groups.set(job.spec, [...(groups.get(job.spec) ?? []), job]);
    for (const [spec, batch] of groups) {
      if (lane !== client) throw new WorkerCancelledError();
      const request: ResolvePocketGeometryRequest = { spec, pockets: batch.map(({ shape, cutout }) => ({ shape, cutout })) };
      const results = await lane.call<PocketGeometry[]>(RESOLVE_POCKET_GEOMETRY_METHOD, request);
      if (results.length !== batch.length) throw new Error("Incomplete pocket geometry response");
      batch.forEach((job, i) => job.resolve(results[i]));
    }
  } catch (error) {
    jobs.forEach(job => job.reject(error));
  } finally {
    if (lane === client) { running = false; void drain(); }
  }
}

/** Share detached meshes and in-flight requests between picking and outlines. */
export function requestPocketGeometry(shape: TracedShape, cutout: CutoutPlacement, spec: BinSpec): Promise<PocketGeometry> {
  const cached = cache.get(cutout);
  if (cached?.shape === shape && cached.spec === spec) return cached.promise;
  const promise = new Promise<PocketGeometry>((resolve, reject) => {
    pending.get(cutout.id)?.reject(new WorkerCancelledError("Replaced pending pocket pose"));
    pending.set(cutout.id, { shape, cutout, spec, resolve, reject });
    if (!running && timer === undefined) timer = setTimeout(() => {
      timer = undefined; void drain();
    }, 0);
  });
  cache.set(cutout, { shape, spec, promise });
  void promise.catch(() => { if (cache.get(cutout)?.promise === promise) cache.delete(cutout); });
  return promise;
}

/** Release the worker and rejected pending requests when its last view leaves. */
export function retainPocketGeometryWorker(): () => void {
  consumers++;
  return () => {
    if (--consumers !== 0) return;
    client?.dispose();
    client = null;
    running = false;
    clearTimeout(timer);
    timer = undefined;
    pending.forEach(job => job.reject(new WorkerCancelledError("Selection view closed")));
    pending.clear();
    cache = new WeakMap();
  };
}
