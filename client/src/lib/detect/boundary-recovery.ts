/** Recover an enclosed tool from edge components attached to crop-spanning printing. */
import {
  maskFromEdges, labelMaskComponents, scoreFromEdgeMask, type EdgeMask,
} from "./edge-mask";
import { morph } from "./edge-cleanup";

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
 * Connected runs of marked pixels that are evidence rather than noise: at least
 * eight pixels, and at least eight pixels long. The lost-seed veto of the general
 * recovery and the color support of a thin line share this measure.
 */
function longRuns(marked: Uint8Array, width: number, height: number): { labels: Int32Array; long: boolean[] } {
  const runs = labelMaskComponents(marked, width, height);
  const minX = new Int32Array(runs.sizes.length).fill(width), minY = new Int32Array(runs.sizes.length).fill(height);
  const maxX = new Int32Array(runs.sizes.length), maxY = new Int32Array(runs.sizes.length);
  for (let i = 0; i < marked.length; i++) if (runs.labels[i]) {
    const id = runs.labels[i], x = i % width, y = Math.floor(i / width);
    minX[id] = Math.min(minX[id], x); maxX[id] = Math.max(maxX[id], x);
    minY[id] = Math.min(minY[id], y); maxY[id] = Math.max(maxY[id], y);
  }
  return { labels: runs.labels, long: runs.sizes.map((size, id) => id > 0 && size >= 8 &&
    Math.max(maxX[id] - minX[id] + 1, maxY[id] - minY[id] + 1) >= 8) };
}

/** Parts of a mask narrower than this many model pixels across are lines, not the body of a tool. */
const BODY_RADIUS = 2;

/**
 * A mask that meets two opposite selection sides only by thin lines is not a
 * clipped tool.
 *
 * A tool the selection really cuts meets the side along a broad run. A printed
 * stroke left on the paper, a shadow line, or the corner of a tool drawn close
 * to the side meets it by a line a few pixels wide, and used to cost the whole
 * outline: the general recovery below keeps only areas with color support, so
 * a light metal part was removed, or the result was refused and color
 * detection, which cannot see light metal on white paper, took over.
 *
 * Here the body is what survives an opening. When no component's body meets
 * two opposite sides, the lines that stand clear of the body, reach a side and
 * have no color support are released from that side inward, and everything else
 * is kept as it was.
 *
 * Color evidence is not given up for this. A line with seeds on 7 % of its
 * pixels is not touched, and a release stops at a long run of seeds on the line
 * (`longRuns`): a shaft that is colored only near its handle loses its outer,
 * colorless end, as it does in the general recovery, and keeps the colored
 * stretch and everything behind it.
 *
 * One line that crosses two tools is released at both ends, but its middle
 * stretch reaches no side. A stretch without color support that stays on the
 * straight course between two released contacts, and is all that joins two
 * wide, color-supported pieces, is taken out as well, so the tools are not
 * traced as one outline. Only that stretch goes: the general recovery would
 * separate the tools too, but at the cost of every part without color support.
 *
 * Returns `undefined`, leaving the case to the general recovery, when:
 * - a body does span the selection: the tool is clipped, or an enclosure is false;
 * - two released lines reach opposite sides at the same height or in the same
 *   column: that is one printed line crossing the selection, which can close
 *   paper in with the tool, and the general recovery takes the paper out;
 * - the mask still meets two opposite sides afterward, by a line with color
 *   support or one whose color lies at the side: a thin colored part the
 *   selection cuts.
 */
function releaseThinContacts(mask: Uint8Array, seeds: Uint8Array, width: number, height: number): { mask: Uint8Array; removed: number; lostSeeds: number } | undefined {
  const body = morph(morph(mask, width, height, BODY_RADIUS, false), width, height, BODY_RADIUS, true);
  const whole = labelMaskComponents(mask, width, height), sides = new Uint8Array(whole.sizes.length);
  /** Every border pixel with its side (1 top, 2 bottom, 4 left, 8 right) and its place along that side. */
  const onBorder = (visit: (i: number, side: number, along: number) => void): void => {
    for (let x = 0; x < width; x++) { visit(x, 1, x); visit(mask.length - width + x, 2, x); }
    for (let y = 0; y < height; y++) { visit(y * width, 4, y); visit(y * width + width - 1, 8, y); }
  };
  onBorder((i, side) => { if (body[i]) sides[whole.labels[i]] |= side; });
  if (sides.some((s, id) => id > 0 && ((s & 3) === 3 || (s & 12) === 12))) return undefined;

  // A line: mask more than a pixel clear of every body, so the ragged fringe of an edge is not one.
  const beside = morph(body, width, height, 1, true);
  const thin = Uint8Array.from(mask, (v, i) => v && !beside[i] ? 1 : 0);
  const lines = labelMaskComponents(thin, width, height);
  const support = new Uint32Array(lines.sizes.length);
  for (let i = 0; i < mask.length; i++) if (lines.labels[i] && seeds[i]) support[lines.labels[i]]++;
  const unsupported = (id: number) => id > 0 && support[id] < Math.max(1, lines.sizes[id] * .07);
  // Long runs of color on a line, widened to cover the line across: a release does not pass them.
  const runs = longRuns(Uint8Array.from(thin, (v, i) => v && seeds[i] ? 1 : 0), width, height);
  const colored = Uint8Array.from(thin, (_, i) => runs.long[runs.labels[i]] ? 1 : 0);
  const stop = morph(colored, width, height, BODY_RADIUS + 1, true);

  const gone = new Uint8Array(mask.length), queue = new Uint32Array(mask.length);
  let tail = 0;
  const contacts: Record<number, number[]> = { 1: [], 2: [], 4: [], 8: [] };
  /** Where a released line meets a side: one entry for each unbroken run of its border pixels, summed for a mean. */
  type End = { side: number; line: number; last: number; x: number; y: number; count: number };
  const ends: End[] = [], open: Record<number, End | undefined> = {};
  onBorder((i, side, along) => {
    const id = lines.labels[i];
    if (!unsupported(id) || stop[i]) return;
    contacts[side].push(along);
    if (!gone[i]) { gone[i] = 1; queue[tail++] = i; }
    let end = open[side];
    if (!end || end.line !== id || along !== end.last + 1) { end = open[side] = { side, line: id, last: along, x: 0, y: 0, count: 0 }; ends.push(end); }
    end.last = along; end.x += i % width; end.y += Math.floor(i / width); end.count++;
  });
  const aligned = (a: number[], b: number[]) => a.some((p) => b.some((q) => Math.abs(p - q) <= 2 * BODY_RADIUS));
  if (aligned(contacts[1], contacts[2]) || aligned(contacts[4], contacts[8])) return undefined;

  // Release each of those lines from its side contacts inward, as far as it runs without a long run of color.
  for (let head = 0; head < tail; head++) {
    const p = queue[head], x = p % width, y = Math.floor(p / width), id = lines.labels[p];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const j = yy * width + xx;
      if (lines.labels[j] === id && !stop[j] && !gone[j]) { gone[j] = 1; queue[tail++] = j; }
    }
  }
  const released = Uint8Array.from(mask, (v, i) => v && !gone[i] ? 1 : 0);
  if (oppositeClipping(released, width, height)) return undefined;

  // Stretches of line that stay. One with color support is tool material, whatever its course.
  const stay = labelMaskComponents(Uint8Array.from(thin, (v, i) => v && !gone[i] ? 1 : 0), width, height);
  const stretches: number[][] = stay.sizes.map(() => []), seeded = new Uint32Array(stay.sizes.length), hasColor = new Uint8Array(stay.sizes.length);
  for (let i = 0; i < mask.length; i++) {
    const id = stay.labels[i];
    if (!id) continue;
    stretches[id].push(i); seeded[id] += seeds[i];
    if (colored[i]) hasColor[id] = 1;
  }
  for (let id = 1; id < stretches.length; id++) if (seeded[id] >= Math.max(1, stretches[id].length * .07)) hasColor[id] = 1;
  // Which of them lie wholly on the straight course between two released contacts on different sides.
  const onCourse = new Uint8Array(stay.sizes.length);
  for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) {
    const p = ends[a], q = ends[b];
    if (p.side === q.side) continue;
    const px = p.x / p.count, py = p.y / p.count, dx = q.x / q.count - px, dy = q.y / q.count - py, length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const near = (i: number): boolean => {
      const rx = i % width - px, ry = Math.floor(i / width) - py, along = (rx * dx + ry * dy) / length;
      return along >= 0 && along <= length && Math.abs(rx * dy - ry * dx) / length <= BODY_RADIUS + 1;
    };
    for (let id = 1; id < stretches.length; id++) {
      const pixels = stretches[id];
      if (onCourse[id] || hasColor[id] || !near(pixels[0]) || !near(pixels[pixels.length - 1])) continue;
      if (pixels.every(near)) onCourse[id] = 1;
    }
  }
  if (onCourse.some(Boolean)) {
    // Take those stretches away and see what falls apart: two or more wide,
    // color-supported parts of one piece were tools of their own.
    const apart = labelMaskComponents(Uint8Array.from(released, (v, i) => v && !onCourse[stay.labels[i]] ? 1 : 0), width, height);
    const joined = labelMaskComponents(released, width, height);
    const color = new Uint32Array(apart.sizes.length), wide = new Uint8Array(apart.sizes.length), piece = new Int32Array(apart.sizes.length);
    for (let i = 0; i < released.length; i++) {
      const id = apart.labels[i];
      if (!id) continue;
      color[id] += seeds[i]; wide[id] |= body[i]; piece[id] = joined.labels[i];
    }
    const tools = new Uint32Array(joined.sizes.length);
    for (let id = 1; id < apart.sizes.length; id++) if (wide[id] && color[id] >= Math.max(3, apart.sizes[id] * .07)) tools[piece[id]]++;
    // In such a piece, a stretch that touches two of the parts is a join; one that hangs from a single part stays.
    for (let id = 1; id < stretches.length; id++) {
      const pixels = stretches[id];
      if (!onCourse[id] || tools[joined.labels[pixels[0]]] < 2) continue;
      let first = 0, joins = false;
      for (const i of pixels) {
        const x = i % width, y = Math.floor(i / width);
        for (let dy = -1; dy <= 1 && !joins; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const part = apart.labels[yy * width + xx];
          if (!part) continue;
          if (!first) first = part;
          else if (part !== first) { joins = true; break; }
        }
        if (joins) break;
      }
      if (joins) for (const i of pixels) { released[i] = 0; gone[i] = 1; }
    }
  }
  let removed = 0, lostSeeds = 0;
  for (let i = 0; i < mask.length; i++) if (gone[i]) { removed++; lostSeeds += seeds[i]; }
  return { mask: released, removed, lostSeeds };
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
  const released = releaseThinContacts(original.mask, seeds, width, height);
  if (released) {
    return { mask: released.mask, score: scoreFromEdgeMask(released.mask, width, height), recovery: {
      status: 'recovered', reason: 'thin-contact', removedPixels: released.removed, lostSupportedPixels: released.lostSeeds, requiresReview: true,
    } };
  }
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
  const lostTotal = missing.reduce((n, v) => n + v, 0);
  if (longRuns(missing, width, height).long.some(Boolean)) return reject('lost-local-foreground-evidence', lostTotal);
  // Preserve every already accepted source component at the mask stage. The
  // downstream tracer retains its separate minimum-size/topology safeguards.
  const source = labelMaskComponents(original.mask, width, height), retained = new Uint32Array(source.sizes.length);
  for (let i = 0; i < mask.length; i++) if (mask[i]) retained[source.labels[i]]++;
  if (source.sizes.some((size, id) => id > 0 && size >= 8 && retained[id] < 8)) return reject('removed-independent-source-component', lostTotal);
  return { mask, score: scoreFromEdgeMask(mask, width, height), recovery: {
    status: 'recovered', removedPixels: area - newArea, lostSupportedPixels: lostTotal, requiresReview: true,
  } };
}
