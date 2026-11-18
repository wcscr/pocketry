import type { Point } from "./types";
import { ringArea } from "./rings";
/** User-authored material evidence. Radius and points share the photo's frame. */
export interface DetectionHint { kind: "tool" | "paper"; points: Point[]; radius: number; fill?: true }

/** Snap a deliberate Add loop in screen space. A tap or a stroke that doubles back stays a brush. */
export function closesAddLoop(hint: DetectionHint, scale: number): boolean {
  if (hint.kind !== "tool" || hint.points.length < 3) return false;
  const first = hint.points[0], last = hint.points[hint.points.length - 1];
  const snap = Math.max(2 * hint.radius, 8 / scale);
  return Math.hypot(last.x - first.x, last.y - first.y) <= snap && ringArea(hint.points) > snap * snap;
}
