import type { Point } from "./types";
/** User-authored material evidence. Radius and points share the photo's frame. */
export interface DetectionHint { kind: "tool" | "paper"; points: Point[]; radius: number }
