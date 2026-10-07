import { ensureOrientation, ringPerimeter } from "@shared/geometry/rings";
import type { Point, Ring, Shape } from "@shared/geometry/types";
import { normalizeOutline } from "./outline";

export interface SymmetryAxis { start: Point; end: Point }
export type SymmetrySide = "left" | "right" | "average";
export type SymmetryResult = { shape: Shape; error?: never } | { shape?: never; error: string };

/** Rigid rotation about the axis midpoint, with its start above its end. */
export function alignShapeUpright(shape: Shape, axis: SymmetryAxis): SymmetryResult {
  const dx = axis.end.x - axis.start.x, dy = axis.end.y - axis.start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) return { error: "Move the axis endpoints farther apart." };
  const cx = (axis.start.x + axis.end.x) / 2, cy = (axis.start.y + axis.end.y) / 2;
  const rotate = (p: Point): Point => ({
    x: cx + (dy * (p.x - cx) - dx * (p.y - cy)) / length,
    y: cy + (dx * (p.x - cx) + dy * (p.y - cy)) / length,
  });
  return { shape: { outer: shape.outer.map(rotate), holes: shape.holes.map(ring => ring.map(rotate)) } };
}

/** Length-weighted perimeter moments avoid bias from uneven vertex density. */
export function suggestSymmetryAxis(ring: Ring): SymmetryAxis {
  const perimeter = ringPerimeter(ring) || 1;
  const center = { x: 0, y: 0 };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const weight = Math.hypot(b.x - a.x, b.y - a.y) / perimeter;
    center.x += weight * (a.x + b.x) / 2;
    center.y += weight * (a.y + b.y) / 2;
  }
  let xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const weight = Math.hypot(b.x - a.x, b.y - a.y);
    const ax = a.x - center.x, ay = a.y - center.y;
    const bx = b.x - center.x, by = b.y - center.y;
    xx += weight * (ax * ax + ax * bx + bx * bx) / 3;
    yy += weight * (ay * ay + ay * by + by * by) / 3;
    xy += weight * (2 * ax * ay + ax * by + bx * ay + 2 * bx * by) / 6;
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  let dx = Math.cos(angle), dy = Math.sin(angle);
  // Top to bottom, or left to right for a horizontal tool.
  if (dy < -1e-9 || (Math.abs(dy) < 1e-9 && dx < 0)) { dx = -dx; dy = -dy; }
  const along = ring.map(p => (p.x - center.x) * dx + (p.y - center.y) * dy);
  const min = Math.min(...along), max = Math.max(...along);
  return {
    start: { x: center.x + dx * min, y: center.y + dy * min },
    end: { x: center.x + dx * max, y: center.y + dy * max },
  };
}

/**
 * Mirror the chosen boundary about the axis, preserving concave grips and tips.
 * Averaging uses a width profile and requires one continuous cross-section.
 * Holes and disconnected mirrored halves are rejected rather than filled in.
 * This uses the existing polygon only; no image detection or raster sampling.
 */
export function symmetrizeShape(shape: Shape, axis: SymmetryAxis, side: SymmetrySide): SymmetryResult {
  if (shape.holes.length) return { error: "This prototype supports outlines without interior holes." };
  if (shape.outer.length < 3 || !shape.outer.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    return { error: "Choose a valid outline." };
  }
  const dx = axis.end.x - axis.start.x, dy = axis.end.y - axis.start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) return { error: "Move the axis endpoints farther apart." };
  const direction = { x: dx / length, y: dy / length };
  const right = { x: direction.y, y: -direction.x };
  const local = shape.outer.map(p => ({
    x: (p.x - axis.start.x) * right.x + (p.y - axis.start.y) * right.y,
    y: (p.x - axis.start.x) * direction.x + (p.y - axis.start.y) * direction.y,
  }));
  const toPhoto = (x: number, y: number): Point => ({
    x: axis.start.x + right.x * x + direction.x * y,
    y: axis.start.y + right.y * x + direction.y * y,
  });
  if (side !== "average") return mirrorSide(local, side, toPhoto);
  const levels = [...new Set(local.map(p => p.y))].sort((a, b) => a - b);
  const profile: Point[] = [];
  const epsilon = 1e-7;
  const edges = local.map((a, i) => ({ a, b: local[(i + 1) % local.length] }));
  const xAt = (edge: typeof edges[number], y: number) => edge.a.x +
    (y - edge.a.y) * (edge.b.x - edge.a.x) / (edge.b.y - edge.a.y);

  for (let i = 1; i < levels.length; i++) {
    const y0 = levels[i - 1], y1 = levels[i];
    if (y1 - y0 < epsilon) continue;
    const mid = (y0 + y1) / 2;
    const crossing = edges.filter(({ a, b }) => (a.y > mid) !== (b.y > mid))
      .sort((a, b) => xAt(a, mid) - xAt(b, mid));
    if (crossing.length !== 2) return { error: "Average both needs a continuous width profile. Choose Use left side or Use right side to preserve grips and recesses." };
    const width = (y: number) => {
      const left = xAt(crossing[0], y), right = xAt(crossing[1], y);
      return (right - left) / 2;
    };
    const w0 = width(y0), w1 = width(y1);
    profile.push({ x: Math.max(0, w0), y: y0 });
    // Clip a chosen half at its actual axis crossing, not at the next vertex.
    if (w0 * w1 < 0) profile.push({ x: 0, y: y0 + (y1 - y0) * w0 / (w0 - w1) });
    profile.push({ x: Math.max(0, w1), y: y1 });
  }
  const first = profile.findIndex(p => p.x > epsilon);
  let last = profile.length - 1;
  while (last >= 0 && profile[last].x <= epsilon) last--;
  if (first < 0) return { error: "Move the axis through the tool, or choose the other side." };
  const trimmed = profile.slice(Math.max(0, first - 1), Math.min(profile.length, last + 2));
  if (trimmed.slice(1, -1).some(p => p.x <= epsilon)) {
    return { error: "The chosen side separates into pieces. Move the axis through the tool." };
  }
  const ring = [
    ...trimmed.map(p => toPhoto(-p.x, p.y)),
    ...[...trimmed].reverse().map(p => toPhoto(p.x, p.y)),
  ];
  const result = normalizeOutline([{ outer: ensureOrientation(ring, 1), holes: [] }])[0];
  return result ? { shape: result } : { error: "The selected side has no usable area." };
}

/**
 * Extract the chosen side's boundary in contour order, then reflect it back.
 * Unlike a width envelope, this retains edges that turn back along the axis.
 * One off-axis chain with two distinct axis contacts gives one simple ring;
 * multiple chains would join across empty space or pinch at an axis contact.
 */
function mirrorSide(local: Ring, side: "left" | "right", toPhoto: (x: number, y: number) => Point): SymmetryResult {
  const epsilon = 1e-7;
  const sign = side === "left" ? -1 : 1;
  // Snap numerical noise at the axis before splitting its edge crossings.
  const points = local.map(p => ({ x: Math.abs(p.x) < epsilon ? 0 : p.x * sign, y: p.y }));
  const split: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    split.push(a);
    if (a.x * b.x < 0) split.push({ x: 0, y: a.y + (b.y - a.y) * a.x / (a.x - b.x) });
  }
  const start = split.findIndex((p, i) => p.x > 0 && split[(i + split.length - 1) % split.length].x <= 0);
  if (start < 0) return { error: "Move the axis through the tool, or choose the other side." };
  const chain = [split[(start + split.length - 1) % split.length]];
  let count = 0;
  while (count < split.length && split[(start + count) % split.length].x > 0) {
    chain.push(split[(start + count) % split.length]);
    count++;
  }
  chain.push(split[(start + count) % split.length]);
  const remaining = Array.from({ length: split.length - count }, (_, i) => split[(start + count + i) % split.length]);
  if (remaining.some(p => p.x > 0) || chain[0].x !== 0 || chain.at(-1)!.x !== 0 ||
      Math.abs(chain[0].y - chain.at(-1)!.y) < epsilon) {
    return { error: "The chosen side separates into pieces. Move the axis through the tool." };
  }
  const ring = [
    ...chain.map(p => toPhoto(sign * p.x, p.y)),
    ...chain.slice(1, -1).reverse().map(p => toPhoto(-sign * p.x, p.y)),
  ];
  const result = normalizeOutline([{ outer: ring, holes: [] }])[0];
  return result ? { shape: result } : { error: "The selected side has no usable area." };
}
