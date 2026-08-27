import { ensureOrientation, isValidRing } from "@shared/geometry/rings";
import {
  HOLE_ORIENTATION,
  OUTER_ORIENTATION,
  type Outline,
  type Ring,
} from "@shared/geometry/types";
// Type-only, so no manifold code is pulled into this module: the kernel is
// injected by the caller (see `Kernel` in ../manifold/runtime).
import type { CrossSection, JoinType } from "manifold-3d";

import { withKernel, type Kernel } from "@/lib/manifold/runtime";

import { buildOutline, normalizeOutline } from "./outline";

/**
 * Polygon offsetting — the "margin" operation — for the ring model, backed by
 * manifold-3d's Clipper2.
 *
 * ## Why the whole set is offset at once
 *
 * The correctness of this module rests entirely on the orientation convention
 * stated in `@shared/geometry/types`: **shells have positive signed area, holes
 * negative**. Clipper2 walks every contour in its own winding direction and
 * pushes each edge to its left, so one `offset(+d)` call over the whole
 * correctly-wound polygon set grows shells and shrinks holes simultaneously,
 * with no special-casing of holes anywhere in this file.
 *
 * Offsetting ring by ring cannot reproduce that. It loses the shell/hole
 * relationship, and any per-ring "which way is out?" heuristic — for instance a
 * normal taken from the ring centroid, as the legacy `applyMargin` in
 * `lib/image-processor.ts` does — points the wrong way inside a concave bay,
 * where the centroid can lie outside the ring altogether. Handing the set to
 * Clipper2 makes both cases fall out for free.
 *
 * ## Two entry points
 *
 * {@link offsetOutlineWithKernel} takes an already-resolved {@link Kernel} and
 * is what the geometry worker and the tests call. {@link offsetOutline} is the
 * convenience wrapper for the main thread: it owns a kernel for the duration of
 * one call, so nothing leaks between calls.
 */

export interface OffsetOptions {
  /** Corner treatment. Round is the safe default for a physical margin. */
  joinType?: "Round" | "Miter" | "Square";
  /** Miter cut-off in multiples of delta. Only read when `joinType` is Miter. */
  miterLimit?: number;
  /** Segments per full circle for round joins. Defaults to {@link defaultCircularSegments}. */
  circularSegments?: number;
}

/** Clipper2's minimum, and manifold's own default. */
const DEFAULT_MITER_LIMIT = 2;

/** Round joins get a segment every 10°, matching manifold's quality default. */
const MIN_CIRCULAR_ANGLE_DEG = 10;

/** …but never segments shorter than this, in pixels. */
const MIN_SEGMENT_PX = 1;

/** Floor on segments per circle, so a sub-pixel delta still reads as a curve. */
const MIN_CIRCULAR_SEGMENTS = 8;

/**
 * Cleanup epsilon applied after an offset. The manifold docs recommend
 * `simplify()` straight after `offset()` so the hair-thin segments Clipper2
 * leaves along joins cannot compound through a later offset. This is manifold's
 * own default epsilon; at pixel scale it removes only true duplicates and
 * collinear points, and measures below one part in 10⁹ of a typical ring area.
 */
const CLEANUP_EPSILON = 1e-6;

/**
 * Segments per full circle for round joins at the given delta.
 *
 * Reproduces manifold's `Quality::GetCircularSegments` rule rather than leaving
 * `circularSegments` undefined, so the vertex budget of an offset is a property
 * of this module and can be asserted: take the smaller of "a segment every 10°"
 * (36 per circle, which also bounds the result) and "segments about a pixel
 * long" (2πr), then round up to a multiple of four so the cardinal points land
 * on vertices. A 5 px margin therefore costs 32 segments per corner circle and
 * a 1 px margin only 8 — enough, because at that radius a segment spans well
 * under a pixel.
 */
export function defaultCircularSegments(deltaPx: number): number {
  const radius = Math.abs(deltaPx);
  const byAngle = 360 / MIN_CIRCULAR_ANGLE_DEG;
  const byEdgeLength = (2 * Math.PI * radius) / MIN_SEGMENT_PX;
  const segments = Math.ceil(Math.min(byAngle, byEdgeLength) / 4) * 4;
  return Math.max(MIN_CIRCULAR_SEGMENTS, segments);
}

/**
 * Flattens an outline into Clipper2 contours: every shell followed by its own
 * holes, as `[x, y]` pairs.
 *
 * Winding is *forced* here rather than assumed. manifold's default `Positive`
 * fill rule reads winding to decide what is solid, so a hole handed over with
 * shell winding is unioned into the shell instead of subtracted from it — it
 * silently vanishes rather than erroring.
 *
 * A shape whose shell is degenerate is dropped whole: holes with no enclosing
 * shell have no meaning, matching `removeRing`/`normalizeOutline`.
 */
export function outlineToPolygons(outline: Outline): [number, number][][] {
  const polygons: [number, number][][] = [];
  for (const shape of outline) {
    if (!isValidRing(shape.outer)) continue;
    polygons.push(ringToPolygon(ensureOrientation(shape.outer, OUTER_ORIENTATION)));
    for (const hole of shape.holes) {
      if (!isValidRing(hole)) continue;
      polygons.push(ringToPolygon(ensureOrientation(hole, HOLE_ORIENTATION)));
    }
  }
  return polygons;
}

function ringToPolygon(ring: Ring): [number, number][] {
  return ring.map((point): [number, number] => [point.x, point.y]);
}

/**
 * Rebuilds an outline from a flat list of Clipper2 contours.
 *
 * The nesting is recovered by containment in {@link buildOutline} rather than
 * carried over from the input, because an offset is free to restructure the
 * set: a shell can split into several, two shells can merge into one, a hole
 * can be deleted by collapsing, and a shell can even acquire a hole where a
 * concave bay closes over on itself. Pairing rings up by index would be wrong
 * in all four cases. `buildOutline` also re-imposes the winding convention, so
 * whatever Clipper2 emits is normalised on the way in.
 */
export function polygonsToOutline(
  polygons: readonly (readonly [number, number])[][],
): Outline {
  const rings: Ring[] = polygons.map((polygon) =>
    polygon.map(([x, y]) => ({ x, y })),
  );
  return buildOutline(rings);
}

/**
 * Builds a `CrossSection` over the whole outline, tracked in `kernel.arena`.
 *
 * The handle lives in the WASM heap and is not garbage collected, so it is
 * registered with the arena immediately; the caller disposes the arena (or
 * `release`s the handle) when done.
 */
export function toCrossSection(kernel: Kernel, outline: Outline): CrossSection {
  const polygons = outlineToPolygons(outline);
  // `new CrossSection([])` throws inside the emscripten glue — it reads the
  // empty array as a single empty contour and dereferences its first point. An
  // empty square is the documented way to spell "no geometry".
  const section =
    polygons.length === 0
      ? kernel.CrossSection.square(0)
      : new kernel.CrossSection(polygons);
  return kernel.arena.track(section);
}

/**
 * Offsets an outline using a caller-supplied kernel, tracking every handle in
 * `kernel.arena`.
 *
 * Positive `deltaPx` grows shells and shrinks holes; negative does the reverse.
 * Rings that collapse — a hole narrower than `2·delta`, a shell thinner than
 * `2·|delta|` — disappear, which is the intended behaviour, not an error.
 */
export function offsetOutlineWithKernel(
  kernel: Kernel,
  outline: Outline,
  deltaPx: number,
  options: OffsetOptions = {},
): Outline {
  assertFiniteDelta(deltaPx);

  const normalized = normalizeOutline(outline);
  if (normalized.length === 0) return [];
  // Fast path: an offset of nothing is a no-op, so skip the round trip through
  // the kernel and its floating-point noise entirely.
  if (deltaPx === 0) return normalized;

  const joinType: JoinType = options.joinType ?? "Round";
  const miterLimit = options.miterLimit ?? DEFAULT_MITER_LIMIT;
  const circularSegments =
    options.circularSegments ?? defaultCircularSegments(deltaPx);

  // One CrossSection over the entire polygon set, offset once. See the module
  // docstring for why this must not be done ring by ring.
  const source = toCrossSection(kernel, normalized);
  const offset = kernel.arena.track(
    source.offset(deltaPx, joinType, miterLimit, circularSegments),
  );
  const cleaned = kernel.arena.track(offset.simplify(CLEANUP_EPSILON));

  // `toPolygons()` on a collapsed section returns [], and `buildOutline([])`
  // returns [] — the empty case needs no special handling.
  return polygonsToOutline(cleaned.toPolygons());
}

/**
 * Offsets an outline, resolving the manifold runtime on demand.
 *
 * The kernel's arena is disposed when the call finishes, whether it returns or
 * throws, so repeated calls cannot accumulate WASM handles.
 */
export async function offsetOutline(
  outline: Outline,
  deltaPx: number,
  options?: OffsetOptions,
): Promise<Outline> {
  assertFiniteDelta(deltaPx);

  const normalized = normalizeOutline(outline);
  // Fast path, hoisted ahead of `withKernel` so a zero margin never pays for
  // loading the wasm.
  if (normalized.length === 0 || deltaPx === 0) return normalized;

  // `offsetOutlineWithKernel` normalises again; `normalizeOutline` is
  // idempotent and O(points), which is noise beside the Clipper2 call, and
  // repeating it keeps that function safe to call directly from the worker.
  return withKernel((kernel) =>
    offsetOutlineWithKernel(kernel, normalized, deltaPx, options),
  );
}

function assertFiniteDelta(deltaPx: number): void {
  if (!Number.isFinite(deltaPx)) {
    // Clipper2 does not reject a NaN delta; it silently emits garbage
    // contours, which is far harder to diagnose downstream.
    throw new Error(`offsetOutline: deltaPx must be finite, got ${deltaPx}`);
  }
}
