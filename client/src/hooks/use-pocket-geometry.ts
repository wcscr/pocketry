import { useEffect, useMemo, useState } from "react";
import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import { hasRigidPocket } from "@shared/gridfinity/rigid-pocket";
import type { BinSpec } from "@shared/gridfinity/types";
import { requestPocketGeometry, retainPocketGeometryWorker } from "@/lib/gridfinity/pocket-geometry-client";
import type { PocketGeometry } from "@/lib/gridfinity/worker-api";

type Footprints = Map<string, PocketGeometry>;
const EMPTY: Footprints = new Map();

/** Mesh, boundaries and surface sections of the generated solid. Source-cell projection stays
 * available synchronously for picking/bounds while these outlines resolve.
 * Never display a previous pose's boundaries or publish an obsolete result.
 * Active 3D gestures use kernel-free wires instead of blocking pointer input. */
export function usePocketGeometry(cutouts: readonly CutoutPlacement[], shapesById: ReadonlyMap<string, TracedShape>, spec: BinSpec, enabled = true): Footprints {
  return usePocketGeometryPreview(cutouts, shapesById, spec, enabled).outlines;
}

/** Layout can distinguish a pending opening from an empty or failed one. */
export function usePocketGeometryPreview(cutouts: readonly CutoutPlacement[], shapesById: ReadonlyMap<string, TracedShape>, spec: BinSpec, enabled = true): {
  outlines: Footprints; status: "ready" | "pending" | "error";
} {
  const request = useMemo(() => ({ cutouts: cutouts.filter(c => (c.profileBottom || hasRigidPocket(c)) && shapesById.has(c.shapeId)), shapesById, spec, enabled }), [cutouts, shapesById, spec, enabled]);
  const [result, setResult] = useState<{ request: typeof request; outlines: Footprints; status: "ready" | "error" }>();
  useEffect(retainPocketGeometryWorker, []);
  useEffect(() => {
    if (!request.enabled || !request.cutouts.length) return;
    let current = true;
    void Promise.all(request.cutouts.flatMap(cutout => {
      const shape = request.shapesById.get(cutout.shapeId);
      if (!shape) return [];
      return [requestPocketGeometry(shape, cutout, request.spec).then(geometry => [cutout.id, geometry] as const)];
    })).then(outlines => { if (current) setResult({ request, outlines: new Map(outlines), status: "ready" }); }).catch(() => {
      // The geometry worker reports model errors. Retain the synchronous
      // footprint for selection if the optional outline preview cannot build.
      if (current) setResult({ request, outlines: EMPTY, status: "error" });
    });
    return () => { current = false; };
  }, [request]);
  if (!enabled || !request.cutouts.length) return { outlines: EMPTY, status: "ready" };
  return result?.request === request ? result : { outlines: EMPTY, status: "pending" };
}
