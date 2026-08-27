import { loadManifold } from "@/lib/manifold/runtime";
import { serveWorker } from "@/lib/worker/host";

import { createBinWorkerHandlers } from "./bin-worker-handlers";

/**
 * The geometry worker entry. Spawned by `useBinGeometry` via
 * `new Worker(new URL("./bin.worker.ts", import.meta.url), { type: "module" })`,
 * which Vite bundles for dev and build alike; the manifold WASM resolves in
 * here exactly as on the main thread.
 *
 * Quality presets mutate manifold's global toplevel state only inside this
 * single-threaded worker, which is what makes them safe (plan: "Performance").
 */
serveWorker(createBinWorkerHandlers(loadManifold));
