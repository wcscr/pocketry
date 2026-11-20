import type { Point } from "./types";
export const MAX_DETECTION_HINTS = 100;
export const MAX_HINT_POINTS = 4096;

/** User-authored material evidence. Radius and points share the photo's frame. */
export interface DetectionHint { kind: "tool" | "paper"; points: Point[]; radius: number }
