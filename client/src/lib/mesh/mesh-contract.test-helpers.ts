import { expect } from "vitest";
import type { MeshData } from "./mesh-data";

type Vec = readonly [number, number, number];
type Triangle = readonly [Vec, Vec, Vec];
const point = (mesh: MeshData, index: number): Vec => [
  mesh.positions[3 * index], mesh.positions[3 * index + 1], mesh.positions[3 * index + 2],
];
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
function triangles(mesh: MeshData): Triangle[] {
  const result: Triangle[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    result.push([point(mesh, mesh.indices[i]), point(mesh, mesh.indices[i + 1]), point(mesh, mesh.indices[i + 2])]);
  }
  return result;
}

/** Independent signed triangle volume; no kernel reconstruction or repair. */
export function signedMeshVolume(mesh: MeshData): number {
  if (mesh.indices.length === 0) return 0;
  const origin = point(mesh, mesh.indices[0]);
  return triangles(mesh).reduce((sum, [a, b, c]) =>
    sum + dot(minus(a, origin), cross(minus(b, origin), minus(c, origin))) / 6, 0);
}

// Every finite Float32 is an integer multiple of 2^-149. Use that exact
// integer representation to keep the topology oracle independent of rounded
// double cross products (which can lose small coordinates beside large ones).
function exactFloat32Units(values: Float32Array): bigint[] {
  const bits = new Uint32Array(values.buffer, values.byteOffset, values.length);
  return Array.from(bits, word => {
    const exponent = (word >>> 23) & 255;
    const magnitude = exponent === 0 ? BigInt(word & 0x7fffff)
      : BigInt((word & 0x7fffff) | 0x800000) << BigInt(exponent - 1);
    return word >>> 31 ? -magnitude : magnitude;
  });
}

/** 3MF preserves indexed identities, including distinct components that touch. */
export function expectPrintableTopology(mesh: MeshData, label = "mesh"): void {
  expect(mesh.positions.length % 3, label).toBe(0);
  expect(mesh.indices.length % 3, label).toBe(0);
  expect(Array.from(mesh.positions).every(Number.isFinite), label).toBe(true);
  const exact = exactFloat32Units(mesh.positions);
  const edges = new Map<string, { count: number; direction: number }>();
  const links = new Map<number, Map<number, number[]>>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const indices = Array.from(mesh.indices.subarray(i, i + 3));
    expect(indices.every(index => index < mesh.positions.length / 3), label).toBe(true);
    const [a, b, c] = indices;
    const u = [0, 1, 2].map(axis => exact[3 * b + axis] - exact[3 * a + axis]);
    const v = [0, 1, 2].map(axis => exact[3 * c + axis] - exact[3 * a + axis]);
    expect([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].some(value => value !== 0n), `${label}: zero-area triangle ${i / 3}`).toBe(true);
    for (let j = 0; j < 3; j++) {
      const vertex = indices[j], left = indices[(j + 1) % 3], right = indices[(j + 2) % 3];
      const link = links.get(vertex) ?? new Map<number, number[]>();
      link.set(left, [...(link.get(left) ?? []), right]);
      link.set(right, [...(link.get(right) ?? []), left]);
      links.set(vertex, link);
    }
    for (let j = 0; j < 3; j++) {
      const a = indices[j], b = indices[(j + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++;
      edge.direction += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  // Two incident faces must traverse a shared edge in opposite directions.
  expect([...edges.values()].filter(edge => edge.count !== 2 || edge.direction !== 0), `${label}: oriented boundary edges`).toEqual([]);
  // Edge closure alone misses two shells pinched at one indexed vertex.
  for (const [vertex, link] of links) {
    expect([...link.values()].every(neighbors => neighbors.length === 2), `${label}: vertex ${vertex} link degrees`).toBe(true);
    const seen = new Set<number>(), pending = [link.keys().next().value!];
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      pending.push(...link.get(current)!);
    }
    expect(seen.size, `${label}: vertex ${vertex} link is one cycle`).toBe(link.size);
  }
}

function segmentDistanceSquared(p: Vec, a: Vec, b: Vec): number {
  const v = minus(b, a), w = minus(p, a), length = dot(v, v);
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, dot(w, v) / length));
  const d: Vec = [w[0] - t * v[0], w[1] - t * v[1], w[2] - t * v[2]];
  return dot(d, d);
}

function triangleDistanceSquared(p: Vec, [a, b, c]: Triangle): number {
  const ab = minus(b, a), ac = minus(c, a), ap = minus(p, a);
  const normal = cross(ab, ac), normal2 = dot(normal, normal);
  if (normal2 > 0) {
    const u = dot(cross(ap, ac), normal) / normal2;
    const v = dot(cross(ab, ap), normal) / normal2;
    if (u >= 0 && v >= 0 && u + v <= 1) return dot(ap, normal) ** 2 / normal2;
  }
  return Math.min(segmentDistanceSquared(p, a, b), segmentDistanceSquared(p, b, c), segmentDistanceSquared(p, c, a));
}

function distanceSquared(p: Vec, surface: readonly Triangle[]): number {
  let nearest = Infinity;
  for (const triangle of surface) nearest = Math.min(nearest, triangleDistanceSquared(p, triangle));
  return nearest;
}

/** Sample occupied-solid boundaries, excluding zero-volume or sub-tolerance fins. */
function surfaceSamples(mesh: MeshData, budget: number, tolerance: number): Vec[] {
  const result: Vec[] = [];
  const surface = triangles(mesh), count = surface.length;
  for (let i = 0; i < Math.min(count, budget); i++) {
    const [a, b, c] = surface[Math.floor(i * count / Math.min(count, budget))];
    const center: Vec = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const normal = cross(minus(b, a), minus(c, a)), length = Math.sqrt(dot(normal, normal));
    if (length === 0) continue;
    // Inset vertex samples slightly into the face to avoid corner ambiguity.
    const candidates: Vec[] = [center, ...[a, b, c].map((v): Vec => [
      0.99 * v[0] + 0.01 * center[0], 0.99 * v[1] + 0.01 * center[1], 0.99 * v[2] + 0.01 * center[2],
    ])];
    for (const p of candidates) {
      const side = (sign: number): Vec => [p[0] + sign * normal[0] / length, p[1] + sign * normal[1] / length, p[2] + sign * normal[2] / length];
      // An unregularized triangle sheet may extend far from the meaningful
      // solid. Removing it must not be mistaken for moving an occupied wall.
      if (contains(side(2 * tolerance), surface) !== contains(side(-2 * tolerance), surface)) result.push(p);
    }
  }
  return result;
}

/** Check meaningful boundaries and volume separately; this is a sampled oracle, not a Hausdorff proof. */
export function expectSameGeometry(reference: MeshData, actual: MeshData, label: string,
  toleranceMm = 0.001, volumeToleranceMm3 = 0.05, sampleBudget = 128): void {
  expect(Math.abs(signedMeshVolume(actual) - signedMeshVolume(reference)), `${label}: signed volume change`).toBeLessThan(volumeToleranceMm3);
  for (const [from, to] of [[reference, actual], [actual, reference]]) {
    const surface = triangles(to);
    let maximum = 0;
    const samples = surfaceSamples(from, sampleBudget, toleranceMm);
    expect(samples.length, `${label}: occupied boundary samples`).toBeGreaterThan(0);
    for (const p of samples) maximum = Math.max(maximum, distanceSquared(p, surface));
    expect(Math.sqrt(maximum), `${label}: sampled surface displacement`).toBeLessThan(toleranceMm);
  }
}

// A fixed non-axis ray avoids alignment with ordinary horizontal/vertical faces.
const ray: Vec = [1, 0.3713906763541037, 0.2198765432109876];
function contains(p: Vec, surface: readonly Triangle[]): boolean {
  const hits: { t: number; direction: number }[] = [];
  for (const [a, b, c] of surface) {
    const ab = minus(b, a), ac = minus(c, a), h = cross(ray, ac), determinant = dot(ab, h);
    if (Math.abs(determinant) < 1e-12) continue;
    const s = minus(p, a), u = dot(s, h) / determinant;
    const q = cross(s, ab), v = dot(ray, q) / determinant, t = dot(ac, q) / determinant;
    if (u >= 0 && v >= 0 && u + v <= 1 && t > 0) hits.push({ t, direction: Math.sign(determinant) });
  }
  hits.sort((a, b) => a.t - b.t);
  let crossings = 0;
  for (let i = 0; i < hits.length;) {
    const first = hits[i].t;
    let direction = 0;
    do { direction += hits[i++].direction; } while (i < hits.length && Math.abs(hits[i].t - first) < 1e-7);
    // Shared triangle edges count once; coincident opposite faces cancel.
    if (direction !== 0) crossings++;
  }
  return crossings % 2 === 1;
}

/** Independent parity probes catch missing material and overlaps without a CSG oracle. */
export function expectPartitionOccupancy(reference: MeshData, parts: readonly MeshData[], sampleBudget = 96): void {
  const original = triangles(reference), surfaces = parts.map(triangles);
  const probes: Vec[] = [];
  // Include material interfaces inside the solid: aggregate-boundary probes
  // alone cannot see an overlapping or missing region wholly inside a part.
  // Share one total budget so adding interfaces does not multiply runtime.
  const sources = [original, ...surfaces];
  const perSource = Math.ceil(sampleBudget / sources.length);
  for (const source of sources) {
    for (let i = 0; i < Math.min(source.length, perSource); i++) {
      const [a, b, c] = source[Math.floor(i * source.length / Math.min(source.length, perSource))];
      const n = cross(minus(b, a), minus(c, a)), length = Math.sqrt(dot(n, n));
      if (length === 0) continue;
      for (const offset of [-0.005, 0.005]) probes.push([
        (a[0] + b[0] + c[0]) / 3 + offset * n[0] / length,
        (a[1] + b[1] + c[1]) / 3 + offset * n[1] / length,
        (a[2] + b[2] + c[2]) / 3 + offset * n[2] / length,
      ]);
    }
  }
  let checked = 0;
  for (const p of probes) {
    // Keep probes away from ambiguous boundaries in both representations.
    if ([original, ...surfaces].some(surface => distanceSquared(p, surface) < 1e-6)) continue;
    const occupied = surfaces.filter(surface => contains(p, surface)).length;
    expect(occupied, `material occupancy at ${p.join(",")}`).toBe(contains(p, original) ? 1 : 0);
    checked++;
  }
  expect(checked, "unambiguous occupancy probes").toBeGreaterThan(10);
}
