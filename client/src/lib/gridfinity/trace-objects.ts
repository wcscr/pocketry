import type { Outline, Ring } from "@shared/geometry/types";

import { traceRingKey } from "@/lib/geometry/ring-key";

/** Keep original pocket shells and promote their holes to independent exclusions. */
export function traceObjects(outline: Outline, separate: boolean): { outline: Outline; role?: "hole" }[] {
  const shells = outline.map(part => ({ outer: part.outer, holes: [] }));
  const holes = new Map<string, Ring>();
  for (const part of outline) for (const hole of part.holes) holes.set(traceRingKey(hole), hole);
  return [...(separate ? shells.map(part => ({ outline: [part] })) : [{ outline: shells }]),
    ...[...holes.values()].map(outer => ({ outline: [{ outer, holes: [] }], role: "hole" as const }))];
}
