import type { ManifoldToplevel } from "manifold-3d";
import type { Arena } from "./arena";

/**
 * The subset of the runtime that geometry code is allowed to touch, handed in
 * by the caller rather than imported. Injection is what lets the same modules
 * run on the main thread, inside the geometry worker, and under Vitest in
 * Node.
 */
export interface Kernel {
  readonly CrossSection: ManifoldToplevel["CrossSection"];
  readonly Manifold: ManifoldToplevel["Manifold"];
  readonly triangulate: ManifoldToplevel["triangulate"];
  readonly arena: Arena;
}

/** Builds a {@link Kernel} view over a runtime, backed by a fresh arena. */
export function createKernel(wasm: ManifoldToplevel, arena: Arena): Kernel {
  return {
    CrossSection: wasm.CrossSection,
    Manifold: wasm.Manifold,
    triangulate: wasm.triangulate,
    arena,
  };
}
