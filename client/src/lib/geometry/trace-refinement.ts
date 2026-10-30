import type { Outline } from "@shared/geometry/types";
import type { DetectOptions } from "@/lib/detect/types";
import { refineOutline } from "@/lib/detect/pipeline";
import { withKernel } from "@/lib/manifold/runtime";
import { offsetOutlineWithKernel, toCrossSection } from "./offset";
import { mapTraceRings } from "./ring-key";

/** Refine authored rings independently: small pockets and shared holes are objects,
 * not detection specks, and must not disappear or acquire different geometry. */
export function refineTraceOutline(outline: Outline, options: DetectOptions): Outline {
  return mapTraceRings(outline, ring => {
    const refined = refineOutline([{ outer: ring, holes: [] }], {
      ...options, minShellAreaFrac: 0, minHoleAreaFrac: 0,
    });
    if (!refined[0]) throw new Error("This refinement would remove a contour. Try a smaller adjustment.");
    return refined[0].outer;
  });
}

/** Grow pocket shells and shrink exclusion objects without merging either into
 * their neighbours. Resolve overlaps only when building material/export geometry. */
export async function offsetTraceOutline(outline: Outline, deltaPx: number): Promise<Outline> {
  if (deltaPx === 0 || !outline.length) return outline;
  return withKernel(kernel => mapTraceRings(outline, (ring, role) => {
    const offset = offsetOutlineWithKernel(kernel, [{ outer: ring, holes: [] }], role === "hole" ? -deltaPx : deltaPx);
    if (offset.length !== 1) {
      throw new Error(`This margin would ${offset.length ? "split" : "remove"} a ${role}. Use a smaller margin to keep it editable.`);
    }
    // New enclosed bays are not newly authored hole objects.
    return offset[0].outer;
  }));
}

/** Initial detection may change a ring's topology, but separate detected tools
 * must remain separate even when their clearance regions begin to overlap. */
export async function offsetDetectedOutline(outline: Outline, deltaPx: number): Promise<Outline> {
  if (deltaPx === 0 || !outline.length) return outline;
  return withKernel(kernel => outline.flatMap(part => offsetOutlineWithKernel(kernel, [part], deltaPx)));
}

/** Natural holes already collapsed by the initial margin are not editable
 * objects in the detection result. Remove those invisible holes from its dense
 * refinement baseline too, so changing detail cannot resurrect and re-collapse
 * them. Authored outlines never pass through this reconciliation. */
export async function retainSurvivingDetectionHoles(raw: Outline, detected: Outline): Promise<Outline> {
  if (!raw.some(part => part.holes.length)) return raw;
  const surviving = detected.flatMap(part => part.holes.map(outer => ({ outer, holes: [] })));
  if (!surviving.length) return raw.map(part => ({ ...part, holes: [] }));
  return withKernel(kernel => {
    const mask = toCrossSection(kernel, surviving);
    return raw.map(part => ({ ...part, holes: part.holes.filter(outer => {
      const candidate = toCrossSection(kernel, [{ outer, holes: [] }]);
      return kernel.arena.track(candidate.intersect(mask)).area() > 1e-6;
    }) }));
  });
}
