import { collapseStraightRuns, thinEditingOutline } from "@shared/geometry/edit-point-spacing";
import type { Outline, Point, Ring, RingRef } from "@shared/geometry/types";

interface StraightRun extends RingRef {
  removed: Point[];
}

// Each edit installs one entire certified chord. Splitting its removed points
// into smaller groups would create different edges with unmeasured deviations.
function changedRuns(before: Outline, after: Outline): StraightRun[] {
  const runs: StraightRun[] = [];
  const visit = (ring: Ring, next: Ring, ref: RingRef) => {
    if (ring.length === next.length) return;
    const kept = new Set(next);
    const start = ring.indexOf(next[0]);
    let removed: Point[] = [];
    for (let offset = 1; offset <= ring.length; offset++) {
      const p = ring[(start + offset) % ring.length];
      if (!kept.has(p)) removed.push(p);
      else if (removed.length) {
        runs.push({ ...ref, removed });
        removed = [];
      }
    }
  };
  before.forEach((shape, i) => {
    visit(shape.outer, after[i].outer, { shapeIndex: i, ringIndex: -1 });
    shape.holes.forEach((hole, j) => visit(hole, after[i].holes[j], { shapeIndex: i, ringIndex: j }));
  });
  return runs;
}

function removeRuns(outline: Outline, runs: StraightRun[]): Outline {
  const removals = outline.map(() => new Map<number, Set<Point>>());
  for (const { shapeIndex, ringIndex, removed } of runs) {
    const rings = removals[shapeIndex];
    const points = rings.get(ringIndex) ?? new Set<Point>();
    for (const p of removed) points.add(p);
    rings.set(ringIndex, points);
  }
  const filter = (ring: Ring, removed?: Set<Point>) => removed ? ring.filter(p => !removed.has(p)) : ring;
  return outline.map((shape, i) => ({
    outer: filter(shape.outer, removals[i].get(-1)),
    holes: shape.holes.map((hole, j) => filter(hole, removals[i].get(j))),
  }));
}

/** A higher level starts from the exact accepted outline of the previous level.
 * All chord distances still refer to the original fitted boundary. */
export function simplifyEditingPoints(source: Outline, spacing: number, step: number, detail: number,
  levels: number, acceptable: (candidate: Outline) => boolean): Outline {
  const spaced = thinEditingOutline(source, spacing, Math.min(step, detail));
  let accepted = spaced !== source && acceptable(spaced) ? spaced : source;
  let endpoints = spaced;
  for (let level = 1; level <= levels && (level - 1) * step < detail; level++) {
    const proposal = collapseStraightRuns(source, endpoints, Math.min(level * step, detail));
    if (proposal === endpoints) continue;
    if (acceptable(proposal)) {
      accepted = proposal;
      endpoints = accepted;
      continue;
    }
    // If spacing itself failed, only a complete later proposal can establish a
    // valid base. A partial straight-run edit presumes its unchanged edges passed.
    if (endpoints !== accepted) continue;
    // Keep useful edges elsewhere when one chord crosses protected material.
    // Bound extra full-outline checks per level so higher levels always share
    // the same earlier decisions, including on very complex photos.
    const groups = [changedRuns(accepted, proposal)];
    for (let i = 0; i < groups.length && i < 9; i++) {
      const group = groups[i];
      // The full proposal at index zero has already failed. Check both halves
      // before subdividing further so one bad edge cannot use every retry.
      if (i > 0) {
        const candidate = removeRuns(accepted, group);
        if (acceptable(candidate)) {
          accepted = candidate;
          continue;
        }
      }
      if (group.length > 1) {
        const mid = Math.ceil(group.length / 2);
        groups.push(group.slice(0, mid), group.slice(mid));
      }
    }
    endpoints = accepted;
  }
  return accepted;
}
