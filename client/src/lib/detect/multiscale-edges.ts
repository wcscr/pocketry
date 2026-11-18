import { labelMaskComponents, maskFromEdges } from "./edge-mask";
import { dilate, erode } from "./segment-js";
import { exteriorPaper } from "./reconstruct-edges";

/** A retry may join fragments of an already-associated object, but must not
 * bridge independent seeded objects that the primary result kept separate. */
export function preservesSeedSeparation(primary: Uint8Array, candidate: Uint8Array, seeds: Uint8Array, width: number, height: number): boolean {
  const source = labelMaskComponents(seeds, width, height, 4);
  const parents = Int32Array.from(source.sizes, (_, i) => i);
  const minimum = Math.max(16, seeds.reduce((sum, value) => sum + (value ? 1 : 0), 0) * .001);
  const root = (id: number): number => {
    while (parents[id] !== id) { parents[id] = parents[parents[id]]; id = parents[id]; }
    return id;
  };
  const associations = (mask: Uint8Array) => {
    const parts = labelMaskComponents(mask, width, height, 4), sets = parts.sizes.map(() => new Set<number>());
    for (let i = 0; i < mask.length; i++) if (parts.labels[i] && source.labels[i] && source.sizes[source.labels[i]] >= minimum) {
      sets[parts.labels[i]].add(source.labels[i]);
    }
    return sets;
  };
  for (const set of associations(primary)) {
    const ids = [...set]; for (const id of ids.slice(1)) parents[root(id)] = root(ids[0]);
  }
  return associations(candidate).every(set => new Set([...set].map(root)).size <= 1);
}

/** The two learned maps share the fine pixel grid. Use the coarse prediction
 * only when its own enclosure explains more independent material evidence.
 * Combine edge probabilities, so detail present at just one scale can still
 * close the boundary. Never paste the coarse silhouette into the fine one.
 */
export function recoverAcrossScales(primary: Uint8Array, fineEdges: Float32Array, coarseEdges: Float32Array,
  width: number, height: number, seeds: Uint8Array, background: Uint8Array, unknown: Uint8Array, threshold: number) {
  const coarse = maskFromEdges(coarseEdges, width, height, seeds, threshold);
  if (coarse.reason) return;
  let seedCount = 0, coarseSupport = 0, fineSupport = 0;
  for (let i = 0; i < seeds.length; i++) if (seeds[i]) {
    seedCount++; fineSupport += primary[i]; coarseSupport += coarse.mask[i];
  }
  // Ignore small differences at the boundary caused by resampling.
  if (coarseSupport - fineSupport < Math.max(16, .005 * seedCount)) return;
  // A slightly thicker coarse edge can pick up many seeds along a long tool.
  // Require missing material inside the disagreement, beyond the two-pixel
  // registration allowance between the 512 and 768 grids.
  const registrationRadius = 2;
  const missingInterior = Uint8Array.from(coarse.mask, (v, i) => v && !primary[i] ? 1 : 0);
  erode(missingInterior, width, height, registrationRadius);
  if (!missingInterior.some((v, i) => v && seeds[i])) return;
  const combined = Float32Array.from(fineEdges, (v, i) => Math.max(v, coarseEdges[i]));
  const result = maskFromEdges(combined, width, height, seeds, threshold);
  if (result.reason) return;
  const paper = exteriorPaper(background, width, height);
  // Paper needs nearby support even inside a coarse enclosure, which can span a real gap.
  const support = Uint8Array.from(primary, (v, i) => v || seeds[i] || combined[i] >= threshold ? 1 : 0);
  dilate(support, width, height, registrationRadius);
  let recoveredSupport = 0;
  for (let i = 0; i < seeds.length; i++) {
    if (result.mask[i] === primary[i]) continue;
    if (!result.mask[i] || unknown[i] || (paper[i] && !support[i])) return;
    recoveredSupport += seeds[i];
  }
  if (recoveredSupport < .5 * (coarseSupport - fineSupport) ||
    !preservesSeedSeparation(primary, result.mask, seeds, width, height) ||
    !preservesSeedSeparation(coarse.mask, result.mask, seeds, width, height)) return;
  return { result, seedCoverage: (fineSupport + recoveredSupport) / seedCount };
}
