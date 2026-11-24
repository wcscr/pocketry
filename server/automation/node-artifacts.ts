import { Worker } from "node:worker_threads";
import type { NodeLibraryFolder } from "../project-library/node-folder";
import type { ProjectDoc } from "../../shared/gridfinity/project";
import type { ModelFormat } from "../../client/src/lib/project/model-export";
import { EXPORT_TIMEOUT_MS, CommandError, type AutomationArtifacts } from "./service";
import { LibraryError } from "../../shared/project-library/format";

export async function buildNodeModel(project: ProjectDoc, format: ModelFormat, signal: AbortSignal): Promise<Uint8Array> {
  if (signal.aborted) throw new CommandError("cancelled", "Export was cancelled before geometry started.");
  const worker = new Worker(new URL("export-worker.js", import.meta.url), {
    workerData: { project, format },
    resourceLimits: { maxOldGenerationSizeMb: 512 },
    stdout: true,
    stderr: true,
  });
  worker.stdout.pipe(process.stderr, { end: false });
  worker.stderr.pipe(process.stderr, { end: false });
  const result = Promise.withResolvers<Uint8Array>();
  const cancel = () => result.reject(new CommandError("cancelled", "Export stopped before an artifact was published."));
  const timer = setTimeout(() => result.reject(new LibraryError("resource-limit", "Export exceeded its two-minute geometry budget.")), EXPORT_TIMEOUT_MS);
  signal.addEventListener("abort", cancel, { once: true });
  worker.once("message", (reply: { bytes: Uint8Array } | { message: string }) => {
    if ("bytes" in reply) result.resolve(reply.bytes);
    else result.reject(new CommandError("export-failed", reply.message));
  });
  worker.once("error", error => result.reject(new CommandError("export-failed", error.message)));
  worker.once("exit", () => result.reject(new CommandError("export-failed", "The geometry worker stopped without an artifact.")));
  try { return await result.promise; }
  finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    await worker.terminate();
  }
}

export function nodeArtifacts(folder: NodeLibraryFolder): AutomationArtifacts {
  return { model: buildNodeModel, write: (extension, bytes) => folder.publishArtifact(extension, bytes) };
}
