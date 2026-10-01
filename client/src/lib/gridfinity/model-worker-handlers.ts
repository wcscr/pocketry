import type { ManifoldToplevel } from "manifold-3d";
import { z } from "zod";
import { modelUnitsSchema } from "@shared/gridfinity/model-pocket";
import { cutoutPlacementSchema, tracedShapeSchema } from "@shared/gridfinity/cutout";
import { binSpecSchema } from "@shared/gridfinity/types";
import { Arena } from "@/lib/manifold/arena";
import { createKernel } from "@/lib/manifold/runtime";
import type { HandlerMap } from "@/lib/worker/host";
import { WorkerCancelledError } from "@/lib/worker/protocol";
import { importModelShape } from "./model-import";
import { resolvedPocketGeometry } from "./pocket-geometry";

const importSchema = z.object({ buffer: z.instanceof(ArrayBuffer), units: modelUnitsSchema, name: z.string().max(255), id: z.string().min(1) });
const inspectSchema = z.object({ shape: tracedShapeSchema, cutout: cutoutPlacementSchema, spec: binSpecSchema });

/** Separate worker permits hard cancellation of expensive imported geometry. */
export function createModelWorkerHandlers(loadRuntime: () => Promise<ManifoldToplevel>): HandlerMap {
  return {
    async importStl(payload, context) {
      const input = importSchema.parse(payload);
      const wasm = await loadRuntime();
      if (context.signal.aborted) throw new WorkerCancelledError();
      const arena = new Arena();
      try { return { value: importModelShape(createKernel(wasm, arena), input.buffer, input.units, input.name, input.id), transfer: [] }; }
      finally { arena.dispose(); }
    },
    async inspectModel(payload, context) {
      const input = inspectSchema.parse(payload);
      const wasm = await loadRuntime();
      if (context.signal.aborted) throw new WorkerCancelledError();
      const arena = new Arena();
      try { return { value: resolvedPocketGeometry(createKernel(wasm, arena), input.shape, input.cutout, input.spec), transfer: [] }; }
      finally { arena.dispose(); }
    },
  };
}
