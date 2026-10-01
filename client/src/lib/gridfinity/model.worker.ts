import { loadManifold } from "@/lib/manifold/runtime";
import { serveWorker } from "@/lib/worker/host";
import { createModelWorkerHandlers } from "./model-worker-handlers";
serveWorker(createModelWorkerHandlers(loadManifold));
