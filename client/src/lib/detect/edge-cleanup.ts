import { labelMaskComponents } from "./edge-mask";

export interface EdgeCleanupReport {
  filledSlits: number;
  trimmedBranches: number;
  filledPixels: number;
  removedPixels: number;
  topologyRejected: boolean;
  softenedPixels: number;
  softeningRejected: boolean;
}

/** Original colour evidence and recognized aids, sampled in model coordinates. */
export interface EdgeCleanupEvidence {
  colour: Uint8Array;
  iso: number;
  seeds: Uint8Array;
  unknown: Uint8Array;
}

/** Square morphology proposes locations only; it is never the returned mask. */
function morph(mask: Uint8Array, width: number, height: number, radius: number, dilate: boolean): Uint8Array {
  const horizontal = new Uint8Array(mask.length), result = new Uint8Array(mask.length);
  const apply = (source: Uint8Array, target: Uint8Array, vertical: boolean) => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let value = dilate ? 0 : 1;
      for (let d = -radius; d <= radius; d++) {
        const xx = x + (vertical ? 0 : d), yy = y + (vertical ? d : 0);
        const sample = xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : source[yy * width + xx];
        if (dilate ? sample : !sample) { value = dilate ? 1 : 0; break; }
      }
      target[y * width + x] = value;
    }
  };
  apply(mask, horizontal, false); apply(horizontal, result, true);
  return result;
}

/** Chebyshev distance to the opened body, matching the proposal's square metric. */
function bodyDistance(body: Uint8Array, width: number, height: number): Uint16Array {
  const distance = Uint16Array.from(body, value => value ? 0 : 1024);
  for (const direction of [1, -1]) {
    for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
      const x = direction > 0 ? xx : width - 1 - xx, y = direction > 0 ? yy : height - 1 - yy, i = y * width + x;
      for (const [dx, dy] of [[-direction, 0], [-direction, -direction], [0, -direction], [direction, -direction]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) distance[i] = Math.min(distance[i], distance[ny * width + nx] + 1);
      }
    }
  }
  return distance;
}

function components(mask: Uint8Array, width: number, height: number, connectivity: 4 | 8 = 8) {
  const result = labelMaskComponents(mask, width, height, connectivity);
  const pixels: number[][] = result.sizes.map(() => []);
  for (let i = 0; i < mask.length; i++) if (result.labels[i]) pixels[result.labels[i]].push(i);
  return { ...result, pixels };
}

/**
 * Repair only a long narrow rail beside an existing body and
 * its adjoining slit. A small opening/closing locates candidates; colour must
 * justify each edit. Unsupported outward shafts, short corners, paper gaps,
 * separate objects and recognized aids are protected. All budgets are in the
 * bounded (at most 512px) learned-model frame, not original camera pixels.
 *
 * Strong paper pixels are never filled. Existing colour seeds are never removed.
 * Foreground and background components must retain their individual identities.
 * Ambiguous candidates retain the original mask; this is not a general smoother.
 */
export function cleanupEdgeMask(mask: Uint8Array, width: number, height: number, evidence: EdgeCleanupEvidence): {
  mask: Uint8Array; report: EdgeCleanupReport;
} {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || count > 512 * 512 ||
      mask.length !== count || evidence.colour.length !== count || evidence.seeds.length !== count || evidence.unknown.length !== count ||
      !Number.isFinite(evidence.iso) || evidence.iso <= 0 || evidence.iso > 255) throw new Error("Invalid edge-cleanup field");
  const report: EdgeCleanupReport = { filledSlits: 0, trimmedBranches: 0, filledPixels: 0, removedPixels: 0, topologyRejected: false, softenedPixels: 0, softeningRejected: false };
  const unchanged = () => ({ mask, report });
  const opened = morph(morph(mask, width, height, 2, false), width, height, 2, true);
  const branches = components(Uint8Array.from(mask, (value, i) => value && !opened[i] ? 1 : 0), width, height);
  if (!branches.sizes.some((size, i) => i > 0 && size >= 12)) return unchanged();
  const distance = bodyDistance(opened, width, height);
  const closed = morph(morph(mask, width, height, 4, true), width, height, 4, false);
  const gaps = components(Uint8Array.from(mask, (value, i) => !value && closed[i] ? 1 : 0), width, height);
  const source = labelMaskComponents(mask, width, height, 4);
  const result = mask.slice();
  const bodySizes = new Uint32Array(source.sizes.length);
  for (let i = 0; i < count; i++) if (opened[i]) bodySizes[source.labels[i]]++;
  const span = (pixels: number[]): number => {
    if (!pixels.length) return 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (const i of pixels) { const x = i % width, y = Math.floor(i / width); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return Math.hypot(maxX - minX, maxY - minY);
  };
  const neighbours = (i: number, visit: (j: number) => void) => {
    const x = i % width, y = Math.floor(i / width);
    if (x) visit(i - 1); if (x + 1 < width) visit(i + 1);
    if (y) visit(i - width); if (y + 1 < height) visit(i + width);
  };
  const protectedLocation = (i: number) => evidence.unknown[i] || i % width < 4 || i % width >= width - 4 || i < width * 4 || i >= count - width * 4;
  for (const branch of branches.pixels.slice(1)) {
    const length = span(branch), owner = source.labels[branch[0]], budget = source.sizes[owner] * .01;
    const paperBranch = branch.every(i => !evidence.seeds[i]) &&
      branch.filter(i => evidence.colour[i] < evidence.iso * .65).length >= branch.length * .9;
    if (bodySizes[owner] < source.sizes[owner] * .8 || branch.length < 12 || length < 8 || branch.length / length > 4.5 || branch.length > budget * (paperBranch ? 2 : 1) ||
        branch.some(i => distance[i] > 10 || source.labels[i] !== owner || protectedLocation(i))) continue;
    const adjacentGap = (candidates: ReturnType<typeof components>) => {
      const ids = new Set<number>();
      for (const i of branch) neighbours(i, j => { if (candidates.labels[j]) ids.add(candidates.labels[j]); });
      return [...ids].flatMap(id => candidates.pixels[id]);
    };
    const gap = adjacentGap(gaps);
    if (!gap.length) continue;
    const gapLength = span(gap);
    if (gap.length > budget * (paperBranch ? 4 : 1) || gapLength < 8 || gap.length / gapLength > 8 || gap.some(protectedLocation)) continue;
    let differentObject = false;
    for (const i of gap) neighbours(i, j => { if (source.labels[j] && source.labels[j] !== owner) differentObject = true; });
    if (differentObject) continue;
    const paper = gap.filter(i => evidence.colour[i] < evidence.iso * .4).length;
    const material = gap.filter(i => evidence.colour[i] >= evidence.iso * .75).length;
    if (gap.length <= budget && paper <= gap.length * .1 && material >= gap.length * .8) {
      // Preserve confident paper, including at the open mouth of the channel.
      let added = 0;
      for (const i of gap) if (!result[i] && evidence.colour[i] >= evidence.iso * .4) { result[i] = 1; added++; }
      if (added) report.filledSlits++;
    } else if (paperBranch) {
      for (const i of branch) result[i] = 0;
      report.trimmedBranches++;
    } else continue;
  }
  if (!report.filledSlits && !report.trimmedBranches) return unchanged();
  const background = (values: Uint8Array) => labelMaskComponents(Uint8Array.from(values, v => v ? 0 : 1), width, height);
  const sourceBackground = background(mask);
  // Counts alone can hide a simultaneous split and merge. Match component
  // identities through surviving pixels as well, for both foreground and paper.
  const corresponds = (before: ReturnType<typeof labelMaskComponents>, after: ReturnType<typeof labelMaskComponents>) => {
    if (before.sizes.length !== after.sizes.length) return false;
    const forward = new Uint32Array(before.sizes.length), reverse = new Uint32Array(after.sizes.length);
    for (let i = 0; i < count; i++) {
      const a = before.labels[i], b = after.labels[i];
      if (!a || !b) continue;
      if ((forward[a] && forward[a] !== b) || (reverse[b] && reverse[b] !== a)) return false;
      forward[a] = b; reverse[b] = a;
    }
    return forward.subarray(1).every(Boolean) && reverse.subarray(1).every(Boolean);
  };
  const sameTopology = (values: Uint8Array) => corresponds(source, labelMaskComponents(values, width, height, 4)) &&
    corresponds(sourceBackground, background(values));
  if (!sameTopology(result)) {
    report.topologyRejected = true; report.filledSlits = 0; report.trimmedBranches = 0;
    return unchanged();
  }
  // Fair only within six pixels of an accepted repair, by at most three
  // pixels from its boundary. Colour seeds, paper, aids and other objects anchor
  // four local radius-four disk votes; this never smooths the complete outline.
  const active = new Set<number>();
  for (let i = 0; i < count; i++) if (result[i] !== mask[i]) {
    const x = i % width, y = Math.floor(i / width);
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < width && yy >= 0 && yy < height) active.add(yy * width + xx);
    }
  }
  const inner = morph(result, width, height, 3, false), outer = morph(result, width, height, 3, true);
  let softened = result.slice();
  for (let pass = 0; pass < 4; pass++) {
    const next = softened.slice();
    for (const i of active) {
      if (protectedLocation(i)) continue;
      let sum = 0, owner = 0, protectedNeighbour = false;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy > 16) continue;
        const j = i + dy * width + dx, label = source.labels[j];
        sum += softened[j];
        if (evidence.unknown[j] || (label && owner && label !== owner)) protectedNeighbour = true;
        if (label) owner = label;
      }
      if (protectedNeighbour || !owner || bodySizes[owner] < source.sizes[owner] * .8) continue;
      if (sum > 24 && !softened[i] && outer[i] && evidence.colour[i] >= evidence.iso * .4) next[i] = 1;
      if (sum < 25 && softened[i] && !inner[i] && !evidence.seeds[i]) next[i] = 0;
    }
    softened = next;
  }
  if (sameTopology(softened)) {
    for (let i = 0; i < count; i++) if (softened[i] !== result[i]) report.softenedPixels++;
    result.set(softened);
  } else report.softeningRejected = true;
  for (let i = 0; i < count; i++) { if (result[i] && !mask[i]) report.filledPixels++; if (mask[i] && !result[i]) report.removedPixels++; }
  return { mask: result, report };
}
