import { maskFromEdges, labelMaskComponents, type EdgeMask } from "./edge-mask";
import { selectAutomaticEdges, type SelectedEdgeMask } from "./adaptive-edges";
import { recoverClippedBoundary, type BoundaryRecoveryReport } from "./boundary-recovery";
import type { EdgeSensitivityReport } from "./types";

const EXTRA_THRESHOLDS = [.59, .58, .57, .56, .55, .54, .53, .52, .51];
const STABLE_IOU = .985;

function area(mask: Uint8Array): number {
  return mask.reduce((sum, value) => sum + (value ? 1 : 0), 0);
}

function perimeter(mask: Uint8Array, width: number, height: number): number {
  let length = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!mask[i]) continue;
    if (!x || !mask[i - 1]) length++;
    if (x === width - 1 || !mask[i + 1]) length++;
    if (!y || !mask[i - width]) length++;
    if (y === height - 1 || !mask[i + width]) length++;
  }
  return length;
}

function overlap(a: Uint8Array, b: Uint8Array): number {
  let intersection = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) intersection++;
    if (a[i] || b[i]) union++;
  }
  return intersection / Math.max(1, union);
}

function exteriorPaper(mask: Uint8Array, width: number, height: number): Uint8Array {
  const seen = new Uint8Array(mask.length), queue = new Uint32Array(mask.length);
  let head = 0, tail = 0;
  const push = (i: number): void => {
    if (mask[i] && !seen[i]) { seen[i] = 1; queue[tail++] = i; }
  };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (x) push(i - 1);
    if (x + 1 < width) push(i + 1);
    if (y) push(i - width);
    if (y + 1 < height) push(i + width);
  }
  return seen;
}

/** Automatic reconstruction on one unchanged learned edge map. The coarse
 * sensitivity search remains the fallback; a clipping retry or finer search
 * must satisfy local evidence checks. Color only constrains selection: it never
 * becomes an added edge barrier. Recognized strips supply no color authority.
 * At most 14 thresholds are evaluated (5 coarse + 9 fine), with no new inference.
 */
export function reconstructEdges(edges: Float32Array, width: number, height: number,
  seeds: Uint8Array, background: Uint8Array, unknown: Uint8Array): SelectedEdgeMask {
  const count = width * height;
  if (background.length !== count || unknown.length !== count) throw new Error("Invalid reconstruction evidence");
  const safeSeeds = Uint8Array.from(seeds, (value, i) => unknown[i] ? 0 : value);
  const safeBackground = Uint8Array.from(background, (value, i) => unknown[i] ? 0 : value);
  const original = selectAutomaticEdges(edges, width, height, safeSeeds, safeBackground), base = original.result;
  let trials = original.selection.edgeThresholdTrials;
  let recovery: BoundaryRecoveryReport | undefined;
  const seedCount = area(safeSeeds);
  const coverage = (mask: Uint8Array): number => mask.reduce((sum, value, i) =>
    sum + (value && safeSeeds[i] ? 1 : 0), 0) / Math.max(1, seedCount);
  const finish = (result = base, threshold = original.selection.edgeThreshold,
    edgeReconstruction?: EdgeSensitivityReport["edgeReconstruction"]): SelectedEdgeMask => ({ result,
    selection: { ...original.selection, edgeThreshold: threshold, edgeThresholdTrials: trials,
      seedCoverage: coverage(result.mask), edgeReconstruction, boundaryRecovery: recovery } });

  if (base.reason === "selection-too-tight") {
    const recovered = recoverClippedBoundary(edges, width, height, safeSeeds, .60);
    trials++;
    recovery = recovered.recovery;
    if (!recovered.reason) {
      if (!unknown.some((value, i) => value && recovered.mask[i] !== base.mask[i])) {
        return finish(recovered, .60, "clipped-boundary-recovery");
      }
      recovery = { ...recovery, status: "rejected", reason: "unknown-strip-change" };
    }
    return finish();
  }
  if (seedCount < Math.max(16, count * .001)) return finish();
  // Preserve already-confirmed coarse threshold improvements exactly.
  if (!base.reason && original.selection.edgeThreshold < .60) return finish();

  const labels = labelMaskComponents(base.mask, width, height, 4);
  const source = labelMaskComponents(safeSeeds, width, height, 4);
  const parents = Int32Array.from(source.sizes, (_, i) => i);
  const root = (id: number): number => {
    while (parents[id] !== id) { parents[id] = parents[parents[id]]; id = parents[id]; }
    return id;
  };
  function associations(parts: ReturnType<typeof labelMaskComponents>): Set<number>[] {
    const maps = parts.sizes.map(() => new Map<number, number>()), totals = new Uint32Array(parts.sizes.length);
    for (let i = 0; i < count; i++) if (parts.labels[i] && source.labels[i]) {
      const label = parts.labels[i], seed = source.labels[i];
      maps[label].set(seed, (maps[label].get(seed) ?? 0) + 1); totals[label]++;
    }
    return maps.map((map, label) => new Set([...map].filter(([seed, n]) =>
      source.sizes[seed] >= Math.max(16, seedCount * .001) &&
      n >= Math.max(3, Math.min(totals[label], source.sizes[seed]) * .02)).map(([seed]) => seed)));
  }
  for (const set of associations(labels)) {
    const ids = [...set];
    for (const id of ids.slice(1)) parents[root(id)] = root(ids[0]);
  }
  const paper = exteriorPaper(safeBackground, width, height), fringe = new Uint8Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!base.mask[y * width + x] && edges[y * width + x] < .60) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) fringe[yy * width + xx] = 1;
    }
  }
  const baseArea = area(base.mask), baseCoverage = coverage(base.mask);
  const basePerimeter = perimeter(base.mask, width, height);
  function safe(candidate: EdgeMask): boolean {
    if (candidate.reason) return false;
    for (let i = 0; i < count; i++) {
      if (base.mask[i] && !candidate.mask[i]) return false;
      if (unknown[i] && candidate.mask[i] !== base.mask[i]) return false;
      if (candidate.mask[i] && !fringe[i] && paper[i]) return false;
    }
    const next = labelMaskComponents(candidate.mask, width, height, 4);
    for (const set of associations(next)) if (new Set([...set].map(root)).size > 1) return false;
    return true;
  }

  let pending: { result: EdgeMask; threshold: number } | undefined;
  let previous: EdgeMask | undefined;
  for (const threshold of EXTRA_THRESHOLDS) {
    const candidate = maskFromEdges(edges, width, height, safeSeeds, threshold);
    trials++;
    const support = coverage(candidate.mask), candidateArea = area(candidate.mask);
    const candidatePerimeter = perimeter(candidate.mask, width, height), guarded = safe(candidate);
    const recoveredSupport = support >= .98 &&
      support - baseCoverage >= Math.min(.05, Math.max(.001, (1 - baseCoverage) / 2));
    const completeBoundary = !base.reason && candidateArea > baseArea * 1.005 && candidatePerimeter < basePerimeter * .85;
    const eligible = guarded && (recoveredSupport || completeBoundary);
    if (pending && eligible && overlap(pending.result.mask, candidate.mask) >= STABLE_IOU) {
      return finish(pending.result, pending.threshold, "fine-threshold-confirmation");
    }
    // Stable, already-complete results need no continued expansion.
    if (previous && !base.reason && baseCoverage >= .98 && guarded && !eligible &&
      overlap(previous.mask, candidate.mask) >= .995 && overlap(base.mask, candidate.mask) >= .99) break;
    pending = eligible ? { result: candidate, threshold } : undefined;
    previous = candidate;
  }
  return finish();
}
