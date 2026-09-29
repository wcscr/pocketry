import { inspectModel } from "@/lib/gridfinity/model-worker-client";
import { useEffect, useMemo, useState } from "react";
import type { Outline } from "@shared/geometry/types";
import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import { resolvedProfileFootprint } from "@/lib/gridfinity/profile-bottom";
import { withKernel } from "@/lib/manifold/runtime";
import { hasRigidPocket } from "@shared/gridfinity/rigid-pocket";
import { resolvePocketDepth } from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";
import { resolvedPocketGeometry } from "@/lib/gridfinity/pocket-geometry";
import type { MeshData } from "@/lib/mesh/mesh-data";

type PocketGeometry = { full: Outline; opening: Outline; mesh?: MeshData };
type Footprints = Map<string, PocketGeometry>;
const EMPTY: Footprints = new Map();
// All consumers share plain, detached geometry. Never retain arena-owned WASM
// handles. Weak placement keys release obsolete edits and deleted projects.
const cache = new WeakMap<CutoutPlacement, { shape: TracedShape; spec: BinSpec; geometry: PocketGeometry }>();

/** Mesh, boundaries and surface sections of the generated solid. Source-cell projection stays
 * available synchronously for picking/bounds while these outlines resolve.
 * Never display a previous pose's boundaries or publish an obsolete result. */
export function usePocketGeometry(cutouts: readonly CutoutPlacement[], shapesById: ReadonlyMap<string, TracedShape>, spec: BinSpec): Footprints {
  const request = useMemo(() => ({ cutouts: cutouts.filter(c => c.profileBottom || hasRigidPocket(c)), shapesById, spec }), [cutouts, shapesById, spec]);
  const [result, setResult] = useState<{ request: typeof request; outlines: Footprints }>();
  useEffect(() => {
    if (!request.cutouts.length) return;
    let current = true;
    const models = request.cutouts.flatMap(cutout => {
      const shape = request.shapesById.get(cutout.shapeId);
      if (!shape?.model) return [];
      const inspection = inspectModel(shape, cutout, request.spec);
      void inspection.promise.catch(() => {});
      return [{ id: cutout.id, ...inspection }];
    });
    void withKernel(kernel => new Map(request.cutouts.flatMap(cutout => {
      const shape = request.shapesById.get(cutout.shapeId);
      if (!shape || shape.model) return [];
      const cached = cache.get(cutout);
      if (cached?.shape === shape && cached.spec === request.spec) return [[cutout.id, cached.geometry] as const];
      const geometry = hasRigidPocket(cutout) ? resolvedPocketGeometry(kernel, shape, cutout, request.spec)
        : { full: resolvedProfileFootprint(kernel, shape.outlineMm, cutout),
          opening: resolvedProfileFootprint(kernel, shape.outlineMm, cutout, resolvePocketDepth(request.spec, cutout.depth).infillTopZ) };
      cache.set(cutout, { shape, spec: request.spec, geometry });
      return [[cutout.id, geometry] as const];
    }))).then(async outlines => {
      const imported = await Promise.all(models.map(async item => [item.id, await item.promise] as const));
      if (current) setResult({ request, outlines: new Map([...outlines, ...imported]) });
    }).catch(() => {
      // The geometry worker reports model errors. Retain the synchronous
      // footprint for selection if the optional outline preview cannot build.
    });
    return () => { current = false; models.forEach(item => item.release()); };
  }, [request]);
  return result?.request === request ? result.outlines : EMPTY;
}
