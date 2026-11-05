/** Pure, bounded edge-to-silhouette reconstruction. No model/runtime imports. */
export interface EdgeMask {
  score: Uint8Array;
  mask: Uint8Array;
  reason?: string;
}

/** Eight-neighbour component labels; each pixel enters the queue once. */
function components(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(mask.length), queue = new Uint32Array(mask.length);
  const sizes = [0];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    const label = sizes.length; let head = 0, tail = 1;
    queue[0] = i; labels[i] = label;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const j = yy * width + xx;
        if (mask[j] && !labels[j]) { labels[j] = label; queue[tail++] = j; }
      }
    }
    sizes.push(tail);
  }
  return { labels, sizes };
}

/** One model-pixel gap repair. It cannot bridge broad concave openings. */
function closeSmallGaps(mask: Uint8Array, width: number, height: number): Uint8Array {
  const dilated = new Uint8Array(mask.length), closed = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.max(0, Math.min(width - 1, x + dx)), yy = Math.max(0, Math.min(height - 1, y + dy));
      value |= mask[yy * width + xx];
    }
    dilated[y * width + x] = value;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.max(0, Math.min(width - 1, x + dx)), yy = Math.max(0, Math.min(height - 1, y + dy));
      value &= dilated[yy * width + xx];
    }
    closed[y * width + x] = value;
  }
  return closed;
}

/**
 * Exterior paper floods through low-edge regions. Bounded enclosures become
 * candidate tools; colour seeds select them without clipping new shafts to the
 * old mask. Internal lettering stays inside the filled outer silhouette.
 * Pixel budgets are model-space, not source-photo dimensions.
 */
export function maskFromEdges(edges: Float32Array, width: number, height: number,
  seeds: Uint8Array, threshold = 0.60): EdgeMask {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 ||
      count > 512 * 512 || edges.length !== count || seeds.length !== count ||
      !Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error("Invalid edge field");
  const barrier = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(edges[i]) || edges[i] < 0 || edges[i] > 1) throw new Error("Invalid edge probability");
    barrier[i] = edges[i] >= threshold ? 1 : 0;
  }
  const closed = closeSmallGaps(barrier, width, height);
  const exterior = new Uint8Array(count), queue = new Uint32Array(count);
  let head = 0, tail = 0;
  const push = (i: number) => { if (!closed[i] && !exterior[i]) { exterior[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (x) push(i - 1); if (x + 1 < width) push(i + 1);
    if (y) push(i - width); if (y + 1 < height) push(i + width);
  }
  const enclosed = Uint8Array.from(exterior, v => v ? 0 : 1);
  const { labels, sizes } = components(enclosed, width, height);
  const interiors = new Uint32Array(sizes.length), support = new Uint32Array(sizes.length);
  for (let i = 0; i < count; i++) if (labels[i]) {
    if (!closed[i]) interiors[labels[i]]++;
    if (seeds[i]) support[labels[i]]++;
  }
  let largest = 0;
  for (let label = 1; label < sizes.length; label++) {
    if (interiors[label] >= Math.max(3, count * 0.0001) && support[label] >= Math.max(3, sizes[label] * 0.07)) {
      largest = Math.max(largest, sizes[label]);
    }
  }
  const keep = sizes.map((size, label) => label > 0 && size >= Math.max(8, largest * 0.02) &&
    interiors[label] >= Math.max(3, count * 0.0001) && support[label] >= Math.max(3, size * 0.07));
  const mask = Uint8Array.from(labels, label => keep[label] ? 1 : 0);
  const area = mask.reduce((sum, v) => sum + v, 0);
  if (!area || area > count * 0.92) return { score: new Uint8Array(count), mask,
    reason: area ? "selection-too-tight" : "open-or-unsupported-boundary" };
  // Paper printing can close a false enclosure across a tight group crop.
  // Do not accept a mask clipped at both opposite selection sides.
  const clippedSides = new Uint8Array(sizes.length);
  for (let x = 0; x < width; x++) { clippedSides[labels[x]] |= 1; clippedSides[labels[count - width + x]] |= 2; }
  for (let y = 0; y < height; y++) { clippedSides[labels[y * width]] |= 4; clippedSides[labels[y * width + width - 1]] |= 8; }
  if (clippedSides.some((sides, label) => keep[label] && ((sides & 3) === 3 || (sides & 12) === 12))) {
    return { score: new Uint8Array(count), mask, reason: "selection-too-tight" };
  }

  // Soften interpolation without changing the filled silhouette. The previous
  // interior/exterior blend had a hard three-pixel cutoff: a four-pixel edge
  // band could become foreground/background/foreground across its width. The
  // tracer then followed the artificial slit down and back up a straight side.
  // This separable [1, 6, 1] kernel has >50% weight at its centre, so neither a
  // thin shaft nor an interior pixel can change class at iso 128. It rounds
  // subpixel crossings while preserving the binary mask's foreground samples.
  const score = new Uint8Array(count);
  const weights = [1, 6, 1];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.max(0, Math.min(width - 1, x + dx));
      const yy = Math.max(0, Math.min(height - 1, y + dy));
      sum += mask[yy * width + xx] * weights[dx + 1] * weights[dy + 1];
    }
    score[y * width + x] = Math.round(255 * sum / 64);
  }
  return { score, mask };
}
