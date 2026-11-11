import type { CurveOutline, CurveRing } from "@shared/geometry/curves";
import type { Outline, Ring } from "@shared/geometry/types";

import { traceRingKey } from "@/lib/geometry/ring-key";

/** Keep each pocket independent and promote shared holes to one editable exclusion. */
export function traceObjects(outline: Outline, curves?: CurveOutline): { outline: Outline; curves?: CurveOutline; role?: "hole" }[] {
  const shells = outline.map(part => ({ outer: part.outer, holes: [] }));
  const holes = new Map<string, Ring>();
  for (const part of outline) for (const hole of part.holes) holes.set(traceRingKey(hole), hole);
  const curveHoles = new Map<string, CurveRing>();
  outline.forEach((part, i) => part.holes.forEach((hole, j) => { if (curves?.[i]?.holes[j]) curveHoles.set(traceRingKey(hole), curves[i].holes[j]); }));
  return [...shells.map((part, i) => ({ outline: [part], ...(curves?.[i] ? { curves: [{ outer: curves[i].outer, holes: [] }] } : {}) })),
    ...[...holes.values()].map(outer => ({ outline: [{ outer, holes: [] }], ...(curveHoles.has(traceRingKey(outer)) ? { curves: [{ outer: curveHoles.get(traceRingKey(outer))!, holes: [] }] } : {}), role: "hole" as const }))];
}
