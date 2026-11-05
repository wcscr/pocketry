import type { OpenCV } from "./segment-opencv";

const bundleUrl = "/opencv/opencv.js";

/** Load the existing self-hosted UMD bundle in a module worker without eval. */
export function createWorkerOpenCVLoader(importBundle: () => Promise<unknown> =
  // Absolute URL bypasses Vite's source-module `?import` rewrite of public files.
  () => import(/* @vite-ignore */ new URL(bundleUrl, globalThis.location.href).href)) {
  let pending: Promise<OpenCV> | undefined;
  return (): Promise<OpenCV> => {
    if (pending) return pending;
    pending = (async () => {
      const root = globalThis as typeof globalThis & { cv?: OpenCV; Module?: unknown };
      const previous = root.Module;
      // Predeclare the UMD's Module global for ES module strict mode. The
      // bundle's outer wrapper uses globalThis (see patch-opencv-worker.cjs).
      root.Module = {};
      try {
        await importBundle();
        const cv = await root.cv;
        if (!cv?.Mat) throw new Error("OpenCV worker runtime unavailable");
        return cv;
      } finally {
        if (previous === undefined) delete root.Module;
        else root.Module = previous;
      }
    })();
    return pending;
  };
}
