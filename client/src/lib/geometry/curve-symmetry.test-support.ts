import type { CurveOutline } from "@shared/geometry/curves";
export const asymmetricHandle: CurveOutline = [{ outer: [
  { point: { x: -10, y: 0 } }, { point: { x: 15, y: 0 } },
  { point: { x: 15, y: 80 }, out: { x: 15, y: 91.045695 } },
  { point: { x: 0, y: 100 }, in: { x: 8.284271, y: 100 }, out: { x: -5.522847, y: 100 }, smooth: true },
  { point: { x: -10, y: 80 }, in: { x: -10, y: 91.045695 } },
], holes: [] }];
