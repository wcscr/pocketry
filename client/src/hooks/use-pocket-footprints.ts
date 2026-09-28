import { useEffect, useMemo, useState } from "react";
import type { Outline } from "@shared/geometry/types";
import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import { resolvedProfileFootprint } from "@/lib/gridfinity/profile-bottom";
import { withKernel } from "@/lib/manifold/runtime";
import { hasRigidPocket } from "@shared/gridfinity/rigid-pocket";
import { resolvePocketDepth } from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";
import { resolvedPocketFootprints } from "@/lib/gridfinity/pocket-footprint";

type Footprints = Map<string, { full: Outline; opening: Outline }>;
const EMPTY: Footprints = new Map();

/** Boundaries and surface sections of the generated solid. Source-cell projection stays
 * available synchronously for picking/bounds while these outlines resolve.
 * Never display a previous pose's boundaries or publish an obsolete result. */
export function usePocketFootprints(cutouts: readonly CutoutPlacement[], shapesById: ReadonlyMap<string, TracedShape>, spec: BinSpec): Footprints {
  const request = useMemo(() => ({ cutouts: cutouts.filter(c => c.profileBottom || hasRigidPocket(c)), shapesById, spec }), [cutouts, shapesById, spec]);
  const [result, setResult] = useState<{ request: typeof request; outlines: Footprints }>();
  useEffect(() => {
    if (!request.cutouts.length) return;
    let current = true;
    void withKernel(kernel => new Map(request.cutouts.flatMap(cutout => {
      const shape = request.shapesById.get(cutout.shapeId);
      if (shape && hasRigidPocket(cutout)) return [[cutout.id, resolvedPocketFootprints(kernel, shape, cutout, request.spec)] as const];
      return shape ? [[cutout.id, { full: resolvedProfileFootprint(kernel, shape.outlineMm, cutout),
        opening: resolvedProfileFootprint(kernel, shape.outlineMm, cutout, resolvePocketDepth(request.spec, cutout.depth).infillTopZ) }] as const] : [];
    }))).then(outlines => { if (current) setResult({ request, outlines }); }).catch(() => {
      // The geometry worker reports model errors. Retain the synchronous
      // footprint for selection if the optional outline preview cannot build.
    });
    return () => { current = false; };
  }, [request]);
  return result?.request === request ? result.outlines : EMPTY;
}
