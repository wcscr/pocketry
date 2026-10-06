/**
 * Restore above-threshold branches removed by mask cleanup, such as a narrow
 * driver shaft attached to its handle. Never lower the threshold or grow into
 * background. Leave ambiguous regions joining multiple solid cores unchanged.
 * Both segmentation backends use this same connectivity rule.
 */
export function restoreThinFeatures(
  score: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  iso: number,
  kernelSize: number,
): void {
  let foreground = 0;
  let removed = 0;
  for (let i = 0; i < score.length; i++) {
    if (score[i] >= iso) {
      foreground++;
      if (!mask[i]) removed++;
    }
  }
  if (!removed) return;

  const labels = new Int32Array(score.length);
  const queue = new Uint32Array(foreground);
  const solidCores: boolean[] = [false];
  const radius = kernelSize;

  // A solid core must contain a patch wider than the cleanup kernel. Small
  // surviving fragments along a reflective shaft should not count as handles.
  const isSolid = (x: number, y: number): boolean => {
    if (x < radius || y < radius || x + radius >= width || y + radius >= height) return false;
    for (let yy = y - radius; yy <= y + radius; yy++) {
      for (let xx = x - radius; xx <= x + radius; xx++) {
        const p = yy * width + xx;
        if (!mask[p] || score[p] < iso) return false;
      }
    }
    return true;
  };

  // Label retained foreground using eight neighbours, including diagonal arms.
  for (let i = 0; i < score.length; i++) {
    if (!mask[i] || score[i] < iso || labels[i]) continue;
    const label = solidCores.length;
    let head = 0;
    let tail = 1;
    let solid = false;
    queue[0] = i;
    labels[i] = label;
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      const y = Math.floor(p / width);
      if (!solid) solid = isSolid(x, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          const n = yy * width + xx;
          if (!labels[n] && mask[n] && score[n] >= iso) {
            labels[n] = label;
            queue[tail++] = n;
          }
        }
      }
    }
    solidCores.push(solid);
  }

  const seenCores = new Uint8Array(solidCores.length);
  for (let i = 0; i < score.length; i++) {
    if (score[i] < iso || labels[i] < 0) continue;
    let head = 0;
    let tail = 0;
    let cores = 0;
    let solid = 0;
    const visit = (p: number): void => {
      const label = labels[p];
      if (label && !seenCores[label]) {
        seenCores[label] = 1;
        cores++;
        if (solidCores[label]) solid++;
      }
      labels[p] = -1;
      queue[tail++] = p;
    };
    visit(i);
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      const y = Math.floor(p / width);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          const n = yy * width + xx;
          if (labels[n] >= 0 && score[n] >= iso) visit(n);
        }
      }
    }
    // A thin line between separate solid tools is ambiguous, so preserve the
    // existing cleanup there. Isolated speckles have no retained core at all.
    if (solid === 1 || cores === 1) {
      for (let j = 0; j < tail; j++) mask[queue[j]] = 1;
    }
  }
}
