import type { TracedShape } from "./cutout";

/** Only recognize the original basic-shape construction; never fit trace data. */
export function inferLegacyAnalyticProfile(shape: TracedShape): TracedShape["analyticProfile"] {
  if (shape.source !== "basic-shape" || shape.outlineMm.length !== 1 || shape.outlineMm[0].holes.length) return undefined;
  const ring = shape.outlineMm[0].outer;
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8;
  if (ring.length === 4) {
    const x = -ring[0].x, y = -ring[0].y;
    if (x > 0 && y > 0 && ring.every((p, i) => close(p.x, [-x,x,x,-x][i]) && close(p.y, [-y,-y,y,y][i]))) {
      return { kind: "rectangle", widthMm: x * 2, lengthMm: y * 2 };
    }
  }
  const radius = ring[0]?.x;
  if (!(radius > 0) || ring.length !== Math.max(32, 4 * Math.ceil(Math.PI / Math.acos(1 - 0.02 / radius) / 4))) return undefined;
  if (ring.every((p, i) => close(p.x, radius * Math.cos(i * 2 * Math.PI / ring.length)) && close(p.y, radius * Math.sin(i * 2 * Math.PI / ring.length)))) {
    return { kind: "circle", radiusMm: radius };
  }
  return undefined;
}

/** Migration is best-effort; malformed records are left for the strict schema. */
export function promoteLegacyAnalyticShape(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const shape = input as TracedShape;
  if (shape.analyticProfile || !Array.isArray(shape.outlineMm)) return input;
  try {
    const analyticProfile = inferLegacyAnalyticProfile(shape);
    return analyticProfile ? { ...shape, analyticProfile } : input;
  } catch { return input; }
}

/** Refuse inconsistent metadata instead of silently replacing an edited boundary. */
export function analyticProfileMatchesOutline(shape: TracedShape): boolean {
  if (!shape.analyticProfile) return true;
  const inferred = inferLegacyAnalyticProfile(shape);
  return inferred !== undefined && JSON.stringify(inferred) === JSON.stringify(shape.analyticProfile);
}
