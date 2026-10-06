import init, { type OpenCascadeInstance } from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";

export type { OpenCascadeInstance };
export const CAD_ENGINE_VERSION = "replicad-opencascadejs@1.1.0/OCCT-8.0.1";

/** Imported only by the CAD module worker. Failed loads remain retryable. */
let pending: Promise<OpenCascadeInstance> | undefined;
export function loadCad(): Promise<OpenCascadeInstance> {
  pending ??= (async () => {
    let location = wasmUrl;
    if (typeof process !== "undefined" && process.versions?.node && typeof window === "undefined") {
      const specifier = "node:module";
      const { createRequire } = await import(/* @vite-ignore */ specifier) as typeof import("node:module");
      location = createRequire(import.meta.url).resolve("replicad-opencascadejs/wasm");
    }
    return init({ locateFile: () => location, print: () => {}, printErr: () => {} });
  })().catch(error => { pending = undefined; throw error; });
  return pending;
}
