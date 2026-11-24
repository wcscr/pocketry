import Module from "manifold-3d";
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import { createBinWorkerHandlers } from "../../client/src/lib/gridfinity/bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "../../client/src/lib/gridfinity/worker-api";
import type { HandlerContext, TransferableResult } from "../../client/src/lib/worker/host";
import { prepareModelExport, type ModelFormat } from "../../client/src/lib/project/model-export";
import type { ProjectDoc } from "../../shared/gridfinity/project";

const data = workerData as { project: ProjectDoc; format: ModelFormat };
const require = createRequire(import.meta.url);
const port = parentPort!;

try {
  const handlers = createBinWorkerHandlers(async () => {
    const wasm = await Module({ locateFile: () => require.resolve("manifold-3d/manifold.wasm") });
    wasm.setup();
    return wasm;
  });
  const model = prepareModelExport(data.project, data.format);
  const build = handlers[BUILD_BIN_METHOD] as (
    request: BuildBinRequest, context: HandlerContext,
  ) => Promise<TransferableResult<BuildBinResult>>;
  const result = await build(model.buildRequest, { signal: new AbortController().signal, progress: () => {} });
  const bytes = model.serialize(result.value);
  port.postMessage({ bytes }, [bytes.buffer as ArrayBuffer]);
} catch (cause) {
  port.postMessage({ message: cause instanceof Error ? cause.message.slice(0, 800) : "The geometry worker failed." });
}
