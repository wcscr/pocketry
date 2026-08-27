import Module, { type ManifoldToplevel } from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";

import { Arena } from "./arena";

export type { ManifoldToplevel };

/**
 * manifold-3d is the single geometry kernel for the app: Clipper2-backed 2D
 * offsetting and triangulation for outlines, and robust CSG for the bin
 * generator. It ships as proper ESM, so it is loaded with a plain dynamic
 * import — deliberately NOT with the `<script>` injection + `window.Module`
 * dance in `lib/opencv.ts`, which only exists because OpenCV.js is a UMD
 * bundle.
 *
 * `?url` makes Vite emit `manifold.wasm` as a hashed asset that resolves in
 * both dev and `dist/public`. Under Node it yields a web path instead, which
 * `fs` cannot open, so Node resolves the file through the package exports map
 * — see {@link resolveWasmLocation}.
 */
let loadPromise: Promise<ManifoldToplevel> | null = null;

const isNodeRuntime =
  typeof process !== "undefined" &&
  process.versions?.node != null &&
  typeof window === "undefined";

/**
 * Locates `manifold.wasm` for the current runtime. Browsers and workers use
 * the Vite-emitted asset URL; Node (Vitest) resolves a real filesystem path.
 */
async function resolveWasmLocation(): Promise<string> {
  if (!isNodeRuntime) return wasmUrl;

  // Held in a variable so bundlers cannot statically follow the specifier
  // into the browser build.
  const nodeModule = "node:module";
  const { createRequire } = (await import(
    /* @vite-ignore */ nodeModule
  )) as typeof import("node:module");
  return createRequire(import.meta.url).resolve("manifold-3d/manifold.wasm");
}

/**
 * Resolves the shared manifold runtime, initialising it on first call.
 * Concurrent callers share one instance; `setup()` is run exactly once.
 */
export function loadManifold(): Promise<ManifoldToplevel> {
  loadPromise ??= resolveWasmLocation()
    .then((location) => Module({ locateFile: () => location }))
    .then((wasm) => {
      wasm.setup();
      return wasm;
    });
  return loadPromise;
}

/** Fire-and-forget warm-up, so the first real call is not paying for the wasm. */
export function preloadManifold(): void {
  void loadManifold().catch((error: unknown) => {
    console.error("[manifold] preload failed:", error);
  });
}

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

/**
 * Runs `fn` with a kernel whose arena is disposed afterwards, whether `fn`
 * returns or throws. Handles that must outlive the call have to be handed to
 * `kernel.arena.release()` first.
 */
export async function withKernel<T>(fn: (kernel: Kernel) => T): Promise<T> {
  const wasm = await loadManifold();
  const arena = new Arena();
  try {
    return fn(createKernel(wasm, arena));
  } finally {
    arena.dispose();
  }
}
