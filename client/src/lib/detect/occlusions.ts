import { pointInRing, ringBounds } from "@shared/geometry/rings";
import type { Ring } from "@shared/geometry/types";
import type { ScoreField } from "./types";

/**
 * Treat recognized aids as missing observations, not background or foreground.
 * Extend the surrounding binary field harmonically inside each footprint. An
 * interior aid disappears without a hole; a separate aid disappears into the
 * background. Mixed boundaries are estimates and must be reported for review.
 * This shared step changes neither source pixels nor scores outside the mask.
 */
export function restoreOccludedScore(field: ScoreField, footprints: readonly Ring[]): boolean {
  let inferredEdge = false;
  for (const footprint of footprints) {
    if (footprint.length < 3 || footprint.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) continue;
    const ring = footprint.map(p => ({
      x: (p.x - field.offsetX) * field.scale - 0.5,
      y: (p.y - field.offsetY) * field.scale - 0.5,
    }));
    const bounds = ringBounds(ring)!;
    const x0 = Math.max(0, Math.floor(bounds.minX) - 1), y0 = Math.max(0, Math.floor(bounds.minY) - 1);
    const x1 = Math.min(field.width - 1, Math.ceil(bounds.maxX) + 1), y1 = Math.min(field.height - 1, Math.ceil(bounds.maxY) + 1);
    if (x0 > x1 || y0 > y1) continue;
    const width = x1 - x0 + 1, height = y1 - y0 + 1;
    const mask = new Uint8Array(width * height);
    const values = new Float32Array(mask.length);
    const unknown: number[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      values[i] = field.score[(y + y0) * field.width + x + x0] >= field.iso ? 1 : 0;
      if (pointInRing(ring, { x: x + x0, y: y + y0 })) { mask[i] = 1; unknown.push(i); }
    }
    if (!unknown.length) continue;
    const neighbours = (i: number): number[] => {
      const x = i % width, y = Math.floor(i / width);
      return [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1, y + 1 < height ? i + width : -1].filter(n => n >= 0);
    };
    // Reuse adjacency across relaxation passes; clipped photo edges supply no
    // evidence, rather than being assumed to be white background.
    const adjacency = unknown.map(neighbours);
    let samples = 0, foreground = 0;
    for (const adjacent of adjacency) for (const n of adjacent) if (!mask[n]) { samples++; foreground += values[n]; }
    if (!samples) continue; // A crop wholly covered by the aid cannot be inferred.
    const mixed = foreground > 0 && foreground < samples;
    inferredEdge ||= mixed;
    for (const i of unknown) values[i] = foreground / samples;
    if (mixed) {
      // Successive over-relaxation on a bounded local patch. Convergence only
      // changes the estimate inside the aid; observed edges stay untouched.
      for (let pass = 0; pass < 600; pass++) {
        let change = 0;
        for (let k = 0; k < unknown.length; k++) {
          const i = unknown[k], adjacent = adjacency[k];
          let sum = 0;
          for (const n of adjacent) sum += values[n];
          const next = values[i] + 1.6 * (sum / adjacent.length - values[i]);
          change = Math.max(change, Math.abs(next - values[i]));
          values[i] = next;
        }
        if (change < 0.0001) break;
      }
    }
    for (const i of unknown) {
      const probability = Math.max(0, Math.min(1, values[i]));
      // Put the 50% transition at the existing iso, regardless of sensitivity.
      const score = probability < 0.5 ? probability * 2 * field.iso
        : field.iso + (probability - 0.5) * 2 * (255 - field.iso);
      field.score[(Math.floor(i / width) + y0) * field.width + i % width + x0] = Math.round(score);
    }
  }
  return inferredEdge;
}
