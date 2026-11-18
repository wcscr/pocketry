import { pointInOutline } from "@shared/geometry/contour-metrics";
import { pointInRing } from "@shared/geometry/rings";
import type { DetectionHint } from "@shared/geometry/detection-hints";
import type { Outline } from "@shared/geometry/types";

/** Check each brush centreline and filled Add loop after cleanup, before pocket clearance. */
export function validateDetectionHints(outline: Outline, hints: readonly DetectionHint[]): void {
  let remaining = 100_000;
  for (const hint of hints) {
    const segments = hint.fill ? hint.points.length : Math.max(1, hint.points.length - 1);
    for (let i = 0; i < segments; i++) {
      const a = hint.points[i], b = hint.points[(i + 1) % hint.points.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(.5, hint.radius / 2)));
      remaining -= steps + 1;
      if (remaining < 0) throw new Error("Correction marks are too complex. Remove some marks and try again.");
      for (let j = 0; j <= steps; j++) {
        const t = j / steps, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (pointInOutline(outline, p) !== (hint.kind === "tool")) {
          throw new Error("The correction could not preserve this mark. Extend a paper stroke to the outside, or widen the tool stroke.");
        }
      }
    }
    // Even with the entire perimeter included, cleanup could leave an excluded island inside.
    if (hint.fill && outline.some(shape => shape.holes.some(hole => hole.length && pointInRing(hint.points, hole[0])))) {
      throw new Error("The correction could not fill the entire loop.");
    }
  }
}
