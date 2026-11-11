import type { Outline, Ring } from "./types";

/** Arc-length Gaussian smoothing of an accepted polygon. Original vertices
 * remain in the sampling, so the displacement cap also bounds every point of
 * every original edge by linear interpolation. Sharp corners stop the filter;
 * increasing the allowance increases its spatial width, not the output error. */
export function smoothAcceptedPolygon(outline: Outline, allowance: number, sampleStep: number): Outline {
  let work = 0, samples = 0;
  const budget = () => { if (++work > 5_000_000) throw new Error("This outline is too complex to smooth. Select a smaller region."); };
  const smooth = (ring: Ring): Ring => {
    if (ring.length < 3 || !ring.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error("Choose a valid outline.");
    const perimeter = ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]; return sum + Math.hypot(b.x - a.x, b.y - a.y); }, 0);
    const step = Math.max(sampleStep, perimeter / Math.max(1, 10_000 - ring.length));
    const points: Ring = [], corners: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], p = ring[(i + ring.length - 1) % ring.length];
      const turn = Math.abs(Math.atan2((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x),
        (a.x - p.x) * (b.x - a.x) + (a.y - p.y) * (b.y - a.y)));
      if (turn > Math.PI / 3) corners.push(points.length);
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      samples += count;
      if (samples > 12_000) throw new Error("This outline is too detailed to smooth at once. Select a smaller region.");
      for (let j = 0; j < count; j++) points.push({ x: a.x + (b.x - a.x) * j / count, y: a.y + (b.y - a.y) * j / count });
    }
    const n = points.length, distances = [0];
    for (let i = 0; i < n; i++) distances.push(distances[i] + Math.hypot(points[(i + 1) % n].x - points[i].x, points[(i + 1) % n].y - points[i].y));
    const total = distances[n], sigma = allowance * 4;
    return points.map((p, i) => {
      let radius = Math.min(total / 4, sigma * 3);
      for (const corner of corners) {
        budget(); const distance = Math.abs(distances[corner] - distances[i]);
        radius = Math.min(radius, distance, total - distance);
      }
      if (radius < 1e-9) return { ...p };
      let x = 0, y = 0, weight = 0;
      const add = (index: number, distance: number) => {
        budget();
        const length = (distances[index + 1] - distances[index] +
          (index ? distances[index] - distances[index - 1] : total - distances[n - 1])) / 2;
        const w = Math.exp(-.5 * (distance / sigma) ** 2) * length;
        x += points[index].x * w; y += points[index].y * w; weight += w;
      };
      add(i, 0);
      for (const direction of [-1, 1]) for (let offset = 1; offset < n; offset++) {
        const index = (i + direction * offset + n) % n;
        const distance = direction === 1 ? (distances[index] - distances[i] + total) % total : (distances[i] - distances[index] + total) % total;
        if (distance > radius) break;
        add(index, distance);
      }
      if (!weight) return { ...p };
      const dx = x / weight - p.x, dy = y / weight - p.y;
      const fraction = Math.min(1, allowance / (Math.hypot(dx, dy) || 1));
      return { x: p.x + dx * fraction, y: p.y + dy * fraction };
    });
  };
  return outline.map(s => ({ outer: smooth(s.outer), holes: s.holes.map(smooth) }));
}
