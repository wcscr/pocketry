/** Recover an enclosed tool from edge components attached to crop-spanning printing. */
import {
  maskFromEdges, labelMaskComponents, scoreFromEdgeMask, type EdgeMask,
} from "./edge-mask";

export interface BoundaryRecoveryReport {
  status: 'unchanged' | 'recovered' | 'rejected';
  reason?: string;
  removedPixels?: number;
  lostSupportedPixels?: number;
  /** Recovery does not establish completeness of unseeded edge-only tips. */
  requiresReview: boolean;
}
export interface RecoveredEdgeMask extends EdgeMask { recovery: BoundaryRecoveryReport }

const neighbours = (index: number, width: number, height: number, visit: (i: number) => void): void => {
  const x = index % width, y = Math.floor(index / width);
  if (x) visit(index - 1); if (x + 1 < width) visit(index + 1);
  if (y) visit(index - width); if (y + 1 < height) visit(index + width);
};
function visitBorder(width: number, height: number, visit: (index: number) => void): void {
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
}
function exteriorOf(mask: Uint8Array, width: number, height: number): Uint8Array {
  const exterior = new Uint8Array(mask.length), queue = new Uint32Array(mask.length);
  let head = 0, tail = 0;
  const push = (i: number): void => { if (!mask[i] && !exterior[i]) { exterior[i] = 1; queue[tail++] = i; } };
  visitBorder(width, height, push);
  while (head < tail) neighbours(queue[head++], width, height, push);
  return exterior;
}
function closeSmallGaps(mask: Uint8Array, width: number, height: number): Uint8Array {
  const dilated = new Uint8Array(mask.length), closed = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let v = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.max(0, Math.min(width - 1, x + dx)), yy = Math.max(0, Math.min(height - 1, y + dy));
      v |= mask[yy * width + xx];
    }
    dilated[y * width + x] = v;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let v = 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.max(0, Math.min(width - 1, x + dx)), yy = Math.max(0, Math.min(height - 1, y + dy));
      v &= dilated[yy * width + xx];
    }
    closed[y * width + x] = v;
  }
  return closed;
}
function distanceFrom(source: Uint8Array, width: number, height: number): Uint16Array {
  const d = new Uint16Array(source.length); d.fill(65535);
  const queue = new Uint32Array(source.length); let head = 0, tail = 0;
  for (let i = 0; i < source.length; i++) if (source[i]) { d[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++];
    neighbours(i, width, height, j => { if (d[j] === 65535) { d[j] = d[i] + 1; queue[tail++] = j; } });
  }
  return d;
}
function selectedInteriors(barrier: Uint8Array, seeds: Uint8Array, width: number, height: number): Uint8Array {
  const exterior = exteriorOf(barrier, width, height);
  const interior = Uint8Array.from(barrier, (v, i) => !v && !exterior[i] ? 1 : 0);
  const { labels, sizes } = labelMaskComponents(interior, width, height, 4);
  const support = new Uint32Array(sizes.length);
  for (let i = 0; i < seeds.length; i++) if (labels[i] && seeds[i]) support[labels[i]]++;
  const keep = sizes.map((size, id) => id > 0 && support[id] >= Math.max(3, size * .07));
  return Uint8Array.from(labels, id => keep[id] ? 1 : 0);
}
function oppositeClipping(mask: Uint8Array, width: number, height: number): boolean {
  const { labels, sizes } = labelMaskComponents(mask, width, height);
  const sides = new Uint8Array(sizes.length);
  for (let x = 0; x < width; x++) { sides[labels[x]] |= 1; sides[labels[mask.length - width + x]] |= 2; }
  for (let y = 0; y < height; y++) { sides[labels[y * width]] |= 4; sides[labels[y * width + width - 1]] |= 8; }
  return sides.some((s, id) => id > 0 && ((s & 3) === 3 || (s & 12) === 12));
}
/** A broad foreground run cut by the ROI is not evidence of sheet lettering. */
function broadSeededBorder(mask: Uint8Array, seeds: Uint8Array, width: number, height: number): boolean {
  const longRun = (start: number, stride: number, length: number): boolean => {
    let run = 0;
    for (let j = 0; j < length; j++) {
      const i = start + j * stride;
      run = mask[i] && seeds[i] ? run + 1 : 0;
      if (run >= 8) return true;
    }
    return false;
  };
  return longRun(0, 1, width) || longRun((height - 1) * width, 1, width) ||
    longRun(0, width, height) || longRun(width - 1, width, height);
}

/**
 * Fixed general candidate for opposite-side clipping failures only. It preserves
 * both raw and gap-repaired enclosed regions, plus seeded barrier pixels.
 * Guarded removals are a subset of the original mask, so they cannot merge two
 * previously independent binary components. Ambiguous unseeded tips remain an
 * explicit limitation, recorded in the detection diagnostics for review.
 */
export function recoverClippedBoundary(edges: Float32Array, width: number, height: number,
  seeds: Uint8Array, threshold = .60): RecoveredEdgeMask {
  const original = maskFromEdges(edges, width, height, seeds, threshold);
  if (original.reason !== 'selection-too-tight') return { ...original, recovery: { status: 'unchanged', requiresReview: false } };
  const reject = (reason: string, lostSupportedPixels?: number): RecoveredEdgeMask => ({
    ...original, recovery: { status: 'rejected', reason, lostSupportedPixels, requiresReview: true },
  });
  const area = original.mask.reduce((n, v) => n + v, 0);
  if (area > original.mask.length * .92 || !oppositeClipping(original.mask, width, height)) return reject('not-an-isolated-clipping-retry');
  if (broadSeededBorder(original.mask, seeds, width, height)) return reject('substantial-foreground-at-crop-border');
  const barrier = Uint8Array.from(edges, value => value >= threshold ? 1 : 0);
  const closed = closeSmallGaps(barrier, width, height);
  const foreground = selectedInteriors(closed, seeds, width, height);
  const rawForeground = selectedInteriors(barrier, seeds, width, height);
  for (let i = 0; i < foreground.length; i++) foreground[i] |= rawForeground[i];
  const background = Uint8Array.from(closed, (v, i) => !v && !foreground[i] ? 1 : 0);
  visitBorder(width, height, i => { background[i] = 1; });
  const foregroundDistance = distanceFrom(foreground, width, height), backgroundDistance = distanceFrom(background, width, height);
  const candidate = Uint8Array.from(foreground, (v, i) => v || closed[i] &&
    (foregroundDistance[i] < backgroundDistance[i] || seeds[i]) ? 1 : 0);
  const exterior = exteriorOf(candidate, width, height);
  // A recovery is deletion-only, including after filling internal lettering.
  const mask = Uint8Array.from(exterior, (v, i) => !v && original.mask[i] ? 1 : 0);
  const newArea = mask.reduce((n, v) => n + v, 0);
  if (!newArea || newArea > mask.length * .92) return reject('invalid-recovered-area');
  if (oppositeClipping(mask, width, height)) return reject('recovered-mask-still-clipped');
  // Allow a three-pixel boundary
  // localization fringe, then veto substantial connected missing seed evidence.
  // This is deliberately not a claim that unseeded geometry is protected.
  const fringe = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) fringe[yy * width + xx] = 1;
    }
  }
  const missing = Uint8Array.from(mask, (_, i) => original.mask[i] && seeds[i] && !fringe[i] ? 1 : 0);
  const lost = labelMaskComponents(missing, width, height), lostTotal = missing.reduce((n, v) => n + v, 0);
  const minX = new Int32Array(lost.sizes.length).fill(width), minY = new Int32Array(lost.sizes.length).fill(height);
  const maxX = new Int32Array(lost.sizes.length), maxY = new Int32Array(lost.sizes.length);
  for (let i = 0; i < missing.length; i++) if (lost.labels[i]) {
    const id = lost.labels[i], x = i % width, y = Math.floor(i / width);
    minX[id] = Math.min(minX[id], x); maxX[id] = Math.max(maxX[id], x);
    minY[id] = Math.min(minY[id], y); maxY[id] = Math.max(maxY[id], y);
  }
  if (lost.sizes.some((size, id) => id > 0 && size >= 8 && Math.max(maxX[id] - minX[id] + 1, maxY[id] - minY[id] + 1) >= 8)) {
    return reject('lost-local-foreground-evidence', lostTotal);
  }
  // Preserve every already accepted source component at the mask stage. The
  // downstream tracer retains its separate minimum-size/topology safeguards.
  const source = labelMaskComponents(original.mask, width, height), retained = new Uint32Array(source.sizes.length);
  for (let i = 0; i < mask.length; i++) if (mask[i]) retained[source.labels[i]]++;
  if (source.sizes.some((size, id) => id > 0 && size >= 8 && retained[id] < 8)) return reject('removed-independent-source-component', lostTotal);
  return { mask, score: scoreFromEdgeMask(mask, width, height), recovery: {
    status: 'recovered', removedPixels: area - newArea, lostSupportedPixels: lostTotal, requiresReview: true,
  } };
}
