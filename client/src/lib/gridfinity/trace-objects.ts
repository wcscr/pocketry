import type { Outline, Ring } from "@shared/geometry/types";

import { traceRingKey } from "@/lib/geometry/ring-key";

/** Keep each pocket independent and promote shared holes to one editable exclusion. */
export function traceObjects(outline: Outline): { outline: Outline; role?: "hole" }[] {
  const shells = outline.map(part => ({ outer: part.outer, holes: [] }));
  const holes = new Map<string, Ring>();
  for (const part of outline) for (const hole of part.holes) holes.set(traceRingKey(hole), hole);
  return [...shells.map(part => ({ outline: [part] })),
    ...[...holes.values()].map(outer => ({ outline: [{ outer, holes: [] }], role: "hole" as const }))];
}
