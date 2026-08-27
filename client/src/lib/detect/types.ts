import type { Outline, Rect } from "@shared/geometry/types";

/**
 * The pixel input the pipeline accepts.
 *
 * Structurally satisfied by the DOM's `ImageData`, but declared here so Node
 * tests can pass a plain object without a canvas.
 */
export interface ImageLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Which segmentation backend ran. */
export type DetectEngine = "opencv" | "js";

export interface DetectOptions {
  /** Restrict detection to this region of the image. */
  roi?: Rect | null;
  /**
   * Threshold bias, 0-255, where 128 means "use Otsu's answer unchanged".
   * Below 128 admits more foreground, above 128 less.
   */
  sensitivity?: number;
  /** Ramer-Douglas-Peucker tolerance in source pixels. */
  tolerancePx?: number;
  /** Taubin smoothing passes; 0 disables smoothing. */
  smoothing?: number;
  /**
   * Segmentation pixel budget. Larger inputs are area-averaged down to this
   * many pixels and the result is scaled back up, so a 48MP phone photo costs
   * the same as a 6MP one.
   */
  maxPixels?: number;
  /** Drop shells smaller than this fraction of the largest shell. */
  minShellAreaFrac?: number;
  /** Drop holes smaller than this fraction of their parent shell. */
  minHoleAreaFrac?: number;
  /**
   * Use the alpha channel directly when the source has real transparency.
   * "auto" detects it; "always" forces it; "never" ignores alpha.
   */
  useAlpha?: "auto" | "always" | "never";
  /** Optional GrabCut refinement seeded from the Otsu mask. Off by default. */
  refine?: "none" | "grabcut";
  /** Force a backend. "auto" prefers OpenCV and falls back to the JS path. */
  engine?: "auto" | DetectEngine;
  /** Emit debug rasters on the result. */
  debug?: boolean;
  /** Cancels a long-running detection. */
  signal?: AbortSignal;
}

export interface DetectResult {
  /** Simplified and smoothed, in the coordinate space of the input image. */
  outline: Outline;
  /**
   * The dense, pre-simplification outline.
   *
   * Kept so the Detail and Smoothing controls can re-derive instantly instead
   * of re-segmenting: without it, every slider tick re-runs the whole pipeline.
   */
  rawOutline: Outline;
  /** The iso level actually used, after the sensitivity bias. */
  threshold: number;
  /** The Otsu level before any bias was applied. */
  otsuThreshold: number;
  engine: DetectEngine;
  /** Per-stage wall-clock milliseconds. */
  timings: Record<string, number>;
  debug?: DetectDebug;
}

export interface DetectDebug {
  /** The score field, as a greyscale raster in segmentation space. */
  score: ImageLike;
  /** The binarised mask after morphology. */
  mask: ImageLike;
}

/**
 * A continuous "how unlike the background is this pixel" field, plus the
 * mapping back to source-image coordinates.
 *
 * Keeping a continuous score rather than only a binary mask is what lets the
 * tracer interpolate sub-pixel boundaries.
 */
export interface ScoreField {
  score: Uint8Array;
  width: number;
  height: number;
  /** Segmentation-space pixels per source pixel (<= 1 when downscaled). */
  scale: number;
  /** Source-space origin of the segmented region. */
  offsetX: number;
  offsetY: number;
  /** Iso level for the tracer. */
  iso: number;
  /** The unbiased Otsu level, for reporting. */
  otsu: number;
}

export const DETECT_DEFAULTS = {
  sensitivity: 128,
  tolerancePx: 1.2,
  smoothing: 1,
  maxPixels: 6_000_000,
  minShellAreaFrac: 0.01,
  minHoleAreaFrac: 0.001,
  useAlpha: "auto",
  refine: "none",
  engine: "auto",
} as const satisfies Partial<DetectOptions>;
