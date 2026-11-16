import { curveControls, curvesFromOutline, evaluateCurve, mapCurves, normalizeCurves, sampleCurveRing, splitCurve,
  type Cubic, type CurveOutline, type CurveRing } from "@shared/geometry/curves";
import { validateFittedContour } from "@shared/geometry/curve-fit";
import { reconstructContour } from "@shared/geometry/contour-reconstruction";
import type { Point } from "@shared/geometry/types";
import { symmetrizeShape, type SymmetryAxis, type SymmetrySide } from "./symmetry";

export interface CurveSymmetryRequest { source: CurveOutline; shapeIndex: number; axis: SymmetryAxis; side: SymmetrySide; tolerance: number }
export interface CurveSymmetryResult {
  curves: CurveOutline;
  /** Average alone approximates an adaptively sampled width profile. */
  profileAllowance: number;
  anchors: number;
  cubics: number;
}
interface Piece { c: Cubic; curved: boolean; startSmooth?: boolean; endSmooth?: boolean }

/** Exact quadratic roots, used to partition a cubic into monotone intervals. */
function quadratic(a: number, b: number, c: number): number[] {
  const epsilon = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), 1e-30) * 1e-13;
  if (Math.abs(a) <= epsilon) return Math.abs(b) <= epsilon ? [] : [-c / b];
  const d = b * b - 4 * a * c;
  if (d < -epsilon * epsilon) return [];
  const q = -.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(Math.max(0, d)));
  return Math.abs(q) <= epsilon ? [-b / (2 * a)] : [q / a, c / q];
}

/** Isolate every axis crossing, including tangent contacts. No rasterization. */
function axisRoots(c: Cubic, epsilon: number, budget: () => void): number[] {
  const a = c[3].x - 3 * c[2].x + 3 * c[1].x - c[0].x;
  const b = 3 * (c[2].x - 2 * c[1].x + c[0].x), d = 3 * (c[1].x - c[0].x);
  const breaks = [0, ...quadratic(3 * a, 2 * b, d).filter(t => t > 0 && t < 1), 1].sort((a, b) => a - b);
  const roots = breaks.filter(t => Math.abs(evaluateCurve(c, t).x) <= epsilon);
  for (let i = 1; i < breaks.length; i++) {
    let lo = breaks[i - 1], hi = breaks[i], left = evaluateCurve(c, lo).x, right = evaluateCurve(c, hi).x;
    if (Math.abs(left) <= epsilon || Math.abs(right) <= epsilon || left * right >= 0) continue;
    for (let k = 0; k < 52; k++) { budget(); const mid = (lo + hi) / 2, value = evaluateCurve(c, mid).x;
      if (left * value <= 0) { hi = mid; right = value; } else { lo = mid; left = value; }
    }
    roots.push((lo + hi) / 2);
  }
  return roots.filter(t => t > 1e-12 && t < 1 - 1e-12).sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > 1e-10);
}

function mirrorRing(ring: CurveRing, sign: -1 | 1, epsilon: number, budget: () => void, seamAllowance = 0): CurveRing {
  const pieces: (Piece & { chosen: boolean })[] = [];
  for (let i = 0; i < ring.length; i++) {
    const c = curveControls(ring, i), cuts = [...axisRoots(c, epsilon, budget), 1];
    let remaining = c, previous = 0;
    for (let j = 0; j < cuts.length; j++) {
      budget(); const t = cuts[j], [piece, rest] = splitCurve(remaining, (t - previous) / (1 - previous));
      const snap = (p: Point) => ({ x: Math.abs(p.x) <= epsilon ? 0 : p.x, y: p.y });
      piece[0] = snap(piece[0]); piece[3] = snap(piece[3]);
      pieces.push({ c: piece, curved: !!(ring[i].out || ring[(i + 1) % ring.length].in),
        startSmooth: j ? true : ring[i].smooth, endSmooth: j + 1 === cuts.length ? ring[(i + 1) % ring.length].smooth : true,
        chosen: evaluateCurve(piece, .5).x * sign > epsilon });
      remaining = rest; previous = t;
    }
  }
  const starts = pieces.map((p, i) => p.chosen && !pieces[(i + pieces.length - 1) % pieces.length].chosen ? i : -1).filter(i => i >= 0);
  if (!starts.length) throw new Error("Move the axis through the tool, or choose the other side.");
  if (starts.length !== 1) throw new Error("The chosen side separates into pieces. Move the axis through the tool.");
  const chain: Piece[] = [];
  for (let j = 0; j < pieces.length && pieces[(starts[0] + j) % pieces.length].chosen; j++) chain.push(pieces[(starts[0] + j) % pieces.length]);
  if (!chain.length || chain[0].c[0].x !== 0 || chain.at(-1)!.c[3].x !== 0 || Math.abs(chain[0].c[0].y - chain.at(-1)!.c[3].y) <= epsilon) {
    throw new Error("The axis must meet the chosen side at two distinct ends.");
  }
  if (chain.slice(1).some(p => Math.abs(p.c[0].x) <= epsilon)) throw new Error("The chosen side touches the axis inside the outline. Move the axis to avoid a pinch.");
  if (chain.length === 1) {
    const p = chain[0], [a, b] = splitCurve(p.c, .5);
    chain.splice(0, 1, { ...p, c: a, endSmooth: true }, { ...p, c: b, startSmooth: true });
  }
  // Average's fitted profile spends half its allowance on reconstruction and
  // may spend the other half aligning supported smooth cap joins. A control
  // hull bounds each adjustment continuously. Left/Right never adjust handles.
  if (seamAllowance) for (const [piece, anchor, handle] of [[chain[0], 0, 1], [chain.at(-1)!, 3, 2]] as const) {
    if (piece.curved && Math.abs(piece.c[handle].y - piece.c[anchor].y) <= seamAllowance) piece.c[handle] = { ...piece.c[handle], y: piece.c[anchor].y };
  }
  const reflected: Piece[] = chain.slice().reverse().map(p => ({ c: p.c.slice().reverse().map(q => ({ x: -q.x, y: q.y })) as Cubic,
    curved: p.curved, startSmooth: p.endSmooth, endSmooth: p.startSmooth }));
  const segments = [...chain, ...reflected];
  const result: CurveRing = segments.map(p => ({ point: { ...p.c[0] } }));
  segments.forEach((p, i) => { if (p.curved) { result[i].out = { ...p.c[1] }; result[(i + 1) % result.length].in = { ...p.c[2] }; } });
  result.forEach((a, i) => {
    const before = curveControls(result, (i + result.length - 1) % result.length), after = curveControls(result, i);
    const u = { x: before[3].x - before[2].x, y: before[3].y - before[2].y }, v = { x: after[1].x - after[0].x, y: after[1].y - after[0].y };
    const length = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
    const atAxis = a.point.x === 0;
    a.smooth = (atAxis || segments[i].startSmooth !== false) && length > 1e-20 && (u.x * v.x + u.y * v.y) / length > 1 - 1e-10;
  });
  return result;
}

/** Original curve-aware symmetry. Left/Right split native cubic crossings and
 * reflect controls exactly. Average rebuilds a bounded, adaptively sampled width
 * profile into native curves, then mirrors one fitted half for exact symmetry.
 * Topology guards reject pinches, disconnected halves and other-shape changes.
 */
export function symmetrizeCurves({ source, shapeIndex, axis, side, tolerance }: CurveSymmetryRequest): CurveSymmetryResult {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new Error("Invalid curve precision.");
  const shape = source[shapeIndex];
  if (!shape || shape.outer.length < 3) throw new Error("Choose a valid outline.");
  if (shape.holes.length) throw new Error("Symmetry currently supports outlines without interior holes. Straighten only keeps holes unchanged.");
  if (source.reduce((n, s) => n + s.outer.length + s.holes.reduce((n, r) => n + r.length, 0), 0) > 6_000 ||
      !source.every(s => [s.outer, ...s.holes].every(r => r.every(a => [a.point, a.in, a.out].every(p => !p || Number.isFinite(p.x) && Number.isFinite(p.y)))))) {
    throw new Error("This outline is too complex or has invalid coordinates.");
  }
  const dx = axis.end.x - axis.start.x, dy = axis.end.y - axis.start.y, length = Math.hypot(dx, dy);
  if (![axis.start.x, axis.start.y, axis.end.x, axis.end.y].every(Number.isFinite) || length < 1) throw new Error("Move the axis endpoints farther apart.");
  const local = (p: Point): Point => ({ x: ((p.x - axis.start.x) * dy - (p.y - axis.start.y) * dx) / length,
    y: ((p.x - axis.start.x) * dx + (p.y - axis.start.y) * dy) / length });
  const photo = (p: Point): Point => ({ x: axis.start.x + (dy * p.x + dx * p.y) / length, y: axis.start.y + (-dx * p.x + dy * p.y) / length });
  const epsilon = Math.max(length, ...shape.outer.map(a => Math.hypot(a.point.x - axis.start.x, a.point.y - axis.start.y))) * 1e-10 + 1e-12;
  let work = 0;
  const budget = () => { if (++work > 5_000_000) throw new Error("This symmetry preview is too complex. Select a smaller outline."); };
  let ring = mapCurves([shape], local)[0].outer;
  if (side === "average") {
    const sampled = sampleCurveRing(ring, tolerance / 8);
    if (sampled.length > 2500) throw new Error("Average is too detailed for this outline. Choose Left or Right.");
    const profile = symmetrizeShape({ outer: sampled, holes: [] }, { start: { x: 0, y: 0 }, end: { x: 0, y: length } }, "average");
    if (!profile.shape) throw new Error(profile.error);
    ring = reconstructContour(curvesFromOutline([profile.shape]), { shapeIndex: 0, ringIndex: -1 }, profile.shape.outer, tolerance / 2).curves[0].outer;
  }
  const mirrored = mirrorRing(ring, side === "right" ? 1 : -1, epsilon, budget, side === "average" ? tolerance / 2 : 0);
  const curves = mapCurves(source, p => ({ ...p }));
  curves[shapeIndex] = mapCurves([{ outer: mirrored, holes: [] }], photo)[0];
  const normalized = normalizeCurves(curves, tolerance);
  validateFittedContour(source, normalized, { shapeIndex, ringIndex: -1 }, tolerance, budget);
  const outer = normalized[shapeIndex].outer;
  return { curves: normalized, anchors: outer.length, cubics: outer.filter((a, i) => a.out || outer[(i + 1) % outer.length].in).length,
    profileAllowance: side === "average" ? tolerance : 0 };
}
