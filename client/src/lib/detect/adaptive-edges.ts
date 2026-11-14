import { labelMaskComponents, maskFromEdges, type EdgeMask } from "./edge-mask";
import type { EdgeSensitivityReport } from "./types";

export interface SelectedEdgeMask { result: EdgeMask; selection: EdgeSensitivityReport }

/** Bounded search on ONE learned edge map, only when its initial enclosure
 * misses significant colour evidence. Strong exterior paper and independent
 * seeded objects constrain expansion; minimizing component count is not a goal.
 */
export function selectAutomaticEdges(edges: Float32Array, width: number, height: number, seeds: Uint8Array,
  knownBackground: Uint8Array): SelectedEdgeMask {
  if (knownBackground.length !== seeds.length) throw new Error("Invalid background evidence");
  const initial = maskFromEdges(edges, width, height, seeds, .60), count = seeds.length;
  const seedCount = seeds.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  const coverage = (mask: Uint8Array) => seedCount ? seeds.reduce((sum, value, i) => sum + (value && mask[i] ? 1 : 0), 0) / seedCount : 0;
  const initialCoverage = coverage(initial.mask);
  let trials = 1;
  const finish = (result = initial, threshold = .60, support = initialCoverage): SelectedEdgeMask => ({ result,
    selection: { edgeThreshold: threshold, edgeThresholdTrials: trials, automaticSensitivity: true, seedCoverage: support } });
  // An already complete boundary stays byte-identical. Tight selections cannot
  // improve by adding barriers; very sparse evidence cannot justify a search.
  if (initial.reason === "selection-too-tight" || seedCount < Math.max(16, count * .001)) return finish();
  const original = labelMaskComponents(initial.mask, width, height, 4);
  if (!initial.reason && initialCoverage >= .98 && original.sizes.filter(size => size >= 8).length === 1) return finish();
  const sourceLabels = labelMaskComponents(seeds, width, height, 4);
  const associations = original.sizes.map(() => new Map<number, number>());
  const material = new Uint32Array(associations.length);
  for (let i = 0; i < count; i++) if (original.labels[i] && sourceLabels.labels[i]) {
    const label = original.labels[i], source = sourceLabels.labels[i], map = associations[label];
    map.set(source, (map.get(source) ?? 0) + 1); material[label]++;
  }
  const sharedSources = associations.map((map, label) => new Set([...map].filter(([source, overlap]) =>
    sourceLabels.sizes[source] >= Math.max(16, seedCount * .001) && overlap >= Math.max(3, Math.min(material[label], sourceLabels.sizes[source]) * .02)).map(([source]) => source)));
  const fragments = (sets: Set<number>[]): number => {
    const occurrences = new Map<number, number>();
    for (const set of sets) for (const id of set) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    return [...occurrences.values()].reduce((sum, value) => sum + Math.max(0, value - 1), 0);
  };
  const initialFragments = fragments(sharedSources);
  if (!initial.reason && initialCoverage >= .98 && !initialFragments) return finish();
  const parents = Int32Array.from(sourceLabels.sizes, (_, i) => i);
  const root = (label: number): number => { while (parents[label] !== label) { parents[label] = parents[parents[label]]; label = parents[label]; } return label; };
  // Colours already enclosed together belong to the same supported object.
  // Shared continuous colour also connects fragments across an open edge.
  for (const sources of sharedSources) { const ids = [...sources]; for (const id of ids.slice(1)) parents[root(id)] = root(ids[0]); }

  // Only low-evidence paper connected to the crop border is protected. A white
  // reflection or recognized aid inside the tool is not an exterior separator.
  const paper = new Uint8Array(count), queue = new Uint32Array(count); let head = 0, tail = 0;
  const push = (i: number) => { if (knownBackground[i] && !paper[i]) { paper[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < width; x++) { push(x); push(count - width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (x) push(i - 1); if (x + 1 < width) push(i + 1);
    if (y) push(i - width); if (y + 1 < height) push(i + width);
  }
  // A one-pixel localization fringe may move with the edge threshold. New
  // foreground deeper into observed exterior paper would seal a real gap.
  const fringe = new Uint8Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (initial.mask[y * width + x] || edges[y * width + x] >= .60) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < width && yy >= 0 && yy < height) fringe[yy * width + xx] = 1;
    }
  }
  const safe = (candidate: EdgeMask): number | undefined => {
    if (candidate.reason) return;
    for (let i = 0; i < count; i++) {
      if (initial.mask[i] && !candidate.mask[i]) return;
      if (candidate.mask[i] && !fringe[i] && paper[i]) return;
    }
    const next = labelMaskComponents(candidate.mask, width, height, 4);
    const supports = next.sizes.map(() => new Map<number, number>()), totals = new Uint32Array(supports.length);
    for (let i = 0; i < count; i++) if (next.labels[i] && sourceLabels.labels[i]) {
      const label = next.labels[i], source = sourceLabels.labels[i];
      supports[label].set(source, (supports[label].get(source) ?? 0) + 1); totals[label]++;
    }
    // Measure support against the smaller evidence region. A large recovered
    // tool must not make a small independent tool disappear below a percentage
    // of the combined area. Already co-enclosed colors share a root above.
    const nextSources = supports.map((map, label) => new Set([...map].filter(([source, overlap]) => sourceLabels.sizes[source] >= Math.max(16, seedCount * .001)
      && overlap >= Math.max(3, Math.min(totals[label], sourceLabels.sizes[source]) * .02)).map(([source]) => source)));
    for (const set of nextSources) {
      const groups = new Set([...set].map(root));
      if (groups.size > 1) return;
    }
    return fragments(nextSources);
  };
  let pending: { result: EdgeMask; threshold: number; support: number } | undefined;
  for (const threshold of [.57, .54, .51, .48]) {
    const result = maskFromEdges(edges, width, height, seeds, threshold); trials++;
    const support = coverage(result.mask);
    const missingGain = Math.min(.05, (1 - initialCoverage) / 2);
    const coherent = support >= .98 && (initialFragments > 0 || support - initialCoverage >= missingGain) ? safe(result) : undefined;
    const eligible = coherent === 0;
    if (pending && eligible) {
      let intersection = 0, union = 0;
      for (let i = 0; i < count; i++) { if (pending.result.mask[i] && result.mask[i]) intersection++; if (pending.result.mask[i] || result.mask[i]) union++; }
      if (union && intersection / union >= .985) return finish(pending.result, pending.threshold, pending.support);
    }
    pending = eligible ? { result, threshold, support } : undefined;
  }
  return finish();
}
