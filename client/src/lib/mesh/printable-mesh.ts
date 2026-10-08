/** Geometry at the one-way Float32 export boundary. Never re-import the result
 * into a solid kernel: numerical repair there can change the intended solid. */
export interface PrintableMeshInput {
  positions: Float32Array;
  indices: Uint32Array;
  /** Explicit kernel identity pairs, including copies made for crease normals. */
  mergeFromVert?: Uint32Array;
  mergeToVert?: Uint32Array;
}
export interface PrintableMesh {
  positions: Float32Array;
  indices: Uint32Array;
}
export interface PrintableMeshDiagnostics {
  addedVertices: number;
  /** Displacement from committed midpoint refinements, in coordinate units.
   * This does not bound distance to removed zero-thickness input sheets. */
  cumulativeDisplacementBound: number;
  /** Sum of the permitted Float32 half-ULP bounds for committed refinements. */
  formatRoundingBound: number;
}
/**
 * Preserve oriented boundaries while removing exact Float32 degeneracies.
 * Existing coordinates do not move. The only new coordinates are shared
 * edge midpoints needed to represent otherwise parallel topological edges.
 * Each added point is checked against the exact Float32 half-ULP bound.
 * The conservative cumulative surface-displacement bound is the sum of the
 * added midpoint displacements; these refinements are not lossless.
 * Distinct touching components remain distinct: only explicit identity pairs
 * and already-connected zero-length edges are joined. Invalid output fails
 * explicitly, rather than returning a mesh with degenerate or exposed faces.
 */
export function preparePrintableMesh(input: PrintableMeshInput, report?: (diagnostics: PrintableMeshDiagnostics) => void): PrintableMesh {
  const { positions, indices } = input;
  if (positions.length % 3 || indices.length % 3)
    throw new Error("Printable mesh requires XYZ triples and triangle triples");
  for (const position of positions)
    if (!Number.isFinite(position))
      throw new Error("Printable mesh positions must be finite");
  const count = positions.length / 3;
  for (const index of indices)
    if (index >= count)
      throw new Error("Printable mesh index is out of range");
  const from = input.mergeFromVert ?? new Uint32Array();
  const to = input.mergeToVert ?? new Uint32Array();
  if (from.length !== to.length)
    throw new Error("Printable mesh identity maps have different lengths");
  const parent = Array.from({ length: count }, (_, i) => i);
  const root = (i: number): number => findRoot(parent, i);
  for (let i = 0; i < from.length; i++) {
    const a = from[i];
    const b = to[i];
    if (a >= count || b >= count)
      throw new Error("Printable mesh identity map is out of range");
    if ([0, 1, 2].some(axis => positions[a * 3 + axis] !== positions[b * 3 + axis]))
      throw new Error("Printable mesh identity pairs must have equal coordinates");
    parent[root(a)] = root(b);
  }
  const identityIndices = new Uint32Array(Array.from(indices, root));
  const predicates = new ExactGeometry();
  const result = indices.length
    ? finalizeGeometry(new Float32Array(positions), identityIndices, predicates)
    : { positions: new Float32Array(), indices: new Uint32Array() };
  const compact = compactVertices(result);
  validatePrintableTopology(compact, predicates);
  report?.(predicates.diagnostics());
  return compact;
}
function validatePrintableTopology({ positions: p, indices: t }: PrintableMesh, predicates: ExactGeometry): void {
  const directed = new Map<string, number>();
  const incident = new Map<number, number[]>();
  const next = (h: number) => h - h % 3 + (h + 1) % 3;
  for (let h = 0; h < t.length; h++) {
    const a = t[h];
    const b = t[next(h)];
    const key = `${a}:${b}`;
    if (a === b || directed.has(key))
      throw new Error("Printable mesh has duplicate directed edges");
    directed.set(key, h);
    const list = incident.get(a) ?? [];
    list.push(h);
    incident.set(a, list);
  }
  for (let k = 0; k < t.length; k += 3) {
    if (predicates.isZeroArea(p, [t[k], t[k + 1], t[k + 2]]))
      throw new Error("Printable mesh has an exact zero-area face");
  }
  const twins = new Int32Array(t.length);
  for (let h = 0; h < t.length; h++) {
    const twin = directed.get(`${t[next(h)]}:${t[h]}`);
    if (twin === undefined)
      throw new Error("Printable mesh has an exposed or inconsistently oriented edge");
    twins[h] = twin;
  }
  for (const faces of incident.values()) {
    const start = faces[0];
    let h = start;
    let count = 0;
    do {
      h = next(twins[h]);
      if (++count > faces.length)
        throw new Error("Printable mesh has an invalid vertex fan");
    } while (h !== start);
    if (count !== faces.length)
      throw new Error("Printable mesh has disconnected vertex fans");
  }
}
function finalizeGeometry(p: Float32Array, input: Uint32Array, predicates: ExactGeometry): PrintableMesh {
  while (true) {
    const collapsed = collapseExactTopology(p, input, predicates);
    const repaired = repairCollinearFaces(collapsed.positions, collapsed.indices, predicates);
    if (!repaired.needsCollapse) return repaired;
    // A zero-to-zero flip connected previously distinct coincident vertices.
    // The next topological collapse removes its two incident zero faces before
    // further flips; it preserves their original twin pairing rather than welds.
    p = repaired.positions;
    input = repaired.indices;
  }
}

function repairCollinearFaces(p: Float32Array, input: Uint32Array, predicates: ExactGeometry): PrintableMesh & { needsCollapse: boolean } {
  const faces = Array.from({ length: input.length / 3 }, (_, f) => [input[f * 3], input[f * 3 + 1], input[f * 3 + 2]] as number[] | null);
  const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const edges = new Map<string, Set<number>>();
  const edgeList = (tr: number[]) => tr.map((a, j) => ({ key: key(a, tr[(j + 1) % 3]), sign: a < tr[(j + 1) % 3] ? 1 : -1 }));
  const add = (f: number) => {
    for (const { key: k } of edgeList(faces[f]!)) {
      let set = edges.get(k);
      if (!set) {
        set = new Set();
        edges.set(k, set);
      }
      set.add(f);
    }
  };
  const remove = (f: number) => {
    for (const { key: k } of edgeList(faces[f]!)) {
      const set = edges.get(k)!;
      set.delete(f);
      if (!set.size)
        edges.delete(k);
    }
    faces[f] = null;
  };
  const opposite = (a: number[], b: number[]) => [0, 1, 2].some(i => a[0] === b[i] && a[1] === b[(i + 2) % 3] && a[2] === b[(i + 1) % 3]);
  const queue: number[] = [];
  for (let f = 0; f < faces.length; f++) {
    add(f);
    if (predicates.isZeroArea(p, faces[f]!))
      queue.push(f);
  }
  // Every rewrite strictly decreases the lexicographic potential:
  // (zero-area face count, summed exact squared edge lengths of zero faces).
  // Zero-to-zero flips use existing vertices only. There are finitely many
  // such faces, so this terminates without an arbitrary iteration allowance.
  let changes = 0;
  while (true) {
    const before = changes;
    for (const f of queue) {
      const ids = faces[f];
      if (!ids || !predicates.isZeroArea(p, ids))
        continue;
      // Exact collinearity lets coordinate ordering identify the segment ends.
      // Squared lengths can tie incorrectly when exponents differ greatly.
      const axis = [0, 1, 2].find(i => p[ids[0] * 3 + i] !== p[ids[1] * 3 + i] || p[ids[0] * 3 + i] !== p[ids[2] * 3 + i])!;
      const ordered = [...ids].sort((a, b) => p[a * 3 + axis] - p[b * 3 + axis]);
      const end1 = ordered[0];
      const end2 = ordered[2];
      const e = ids.findIndex((a, j) => (a === end1 && ids[(j + 1) % 3] === end2) || (a === end2 && ids[(j + 1) % 3] === end1));
      const a = ids[e];
      const b = ids[(e + 1) % 3];
      const c = ids[(e + 2) % 3];
      const adj = edges.get(key(a, b))!;
      if (adj.size !== 2)
        continue;
      const n = [...adj].find(n => n !== f)!;
      const d = faces[n]!.find(v => v !== a && v !== b);
      if (d === undefined)
        continue;
      const proposals = [[c, a, d], [c, d, b]];
      const proposalZeros = proposals.map(t => predicates.isZeroArea(p, t));
      const zeroRewrite = proposalZeros.every(Boolean) && predicates.isZeroArea(p, faces[n]!);
      if (proposalZeros.some(Boolean) && !zeroRewrite)
        continue;
      const removed = new Set([f, n]);
      let keep: number[][] = [];
      for (const t of proposals) {
        const cancel = [...(edges.get(key(c, d)) ?? [])].find(i => !removed.has(i) && opposite(t, faces[i]!));
        if (cancel === undefined)
          keep.push(t);
        else
          removed.add(cancel);
      }
      const previousPositions = p;
      let refinement: Midpoint | undefined;
      if (keep.length === 2 && edges.has(key(c, d))) {
        if (zeroRewrite) continue;
        refinement = predicates.midpoint(p, c, d);
        const point = refinement.point;
        const mid = p.length / 3;
        const expanded = new Float32Array(p.length + 3);
        expanded.set(p);
        expanded.set(point, p.length);
        p = expanded;
        keep = keep.flatMap(t => splitTriangle(t, c, d, mid));
        if (keep.some(t => predicates.isZeroArea(p, t)))
          throw new Error("Rounded refinement creates a zero-area triangle");
        for (let i = 0; i < keep.length; i++)
          if (!predicates.sameOrientation(p, proposals[Math.floor(i / 2)], keep[i]))
            throw new Error("Rounded refinement reverses a triangle");
      }
      const delta = new Map<string, {
        count: number;
        sign: number;
      }>();
      for (const f of removed)
        for (const edge of edgeList(faces[f]!)) {
          const value = delta.get(edge.key) ?? { count: 0, sign: 0 };
          value.count--;
          value.sign -= edge.sign;
          delta.set(edge.key, value);
        }
      for (const t of keep)
        for (const edge of edgeList(t)) {
          const value = delta.get(edge.key) ?? { count: 0, sign: 0 };
          value.count++;
          value.sign += edge.sign;
          delta.set(edge.key, value);
        }
      if ([...delta].some(([key, value]) => {
        const count = (edges.get(key)?.size ?? 0) + value.count;
        return count !== 0 && count !== 2 || value.sign !== 0;
      })) {
        p = previousPositions;
        continue;
      }
      const oldZeros = [...removed].map(id => faces[id]!).filter(t => predicates.isZeroArea(p, t));
      const newZeros = keep.filter(t => predicates.isZeroArea(p, t));
      const oldEnergy = oldZeros.reduce((sum, t) => sum + predicates.edgeEnergy(p, t), 0n);
      const newEnergy = newZeros.reduce((sum, t) => sum + predicates.edgeEnergy(p, t), 0n);
      if (newZeros.length > oldZeros.length ||
          (newZeros.length === oldZeros.length && newEnergy >= oldEnergy)) {
        p = previousPositions;
        continue;
      }
      if (refinement)
        predicates.commit(refinement);
      for (const id of removed)
        remove(id);
      for (const t of keep) {
        const id = faces.length;
        faces.push(t);
        add(id);
        if (predicates.isZeroArea(p, t)) queue.push(id);
      }
      changes++;
      if (zeroRewrite && [0, 1, 2].every(axis => p[c * 3 + axis] === p[d * 3 + axis])) {
        return {
          positions: p,
          indices: new Uint32Array(faces.filter((t): t is number[] => t !== null).flat()),
          needsCollapse: true,
        };
      }
    }
    if (changes === before)
      break;
  }
  let remaining = 0;
  for (const t of faces)
    if (t && predicates.isZeroArea(p, t))
      remaining++;
  if (remaining)
    throw new Error("Printable mesh contains unresolved collinear faces");
  return { positions: p, indices: new Uint32Array(faces.filter((t): t is number[] => t !== null).flat()), needsCollapse: false };
}
/** Follow original half-edge twins through removed faces before assigning
 * surviving vertex fans. Coordinate-equal touching components stay separate. */
function collapseExactTopology(p: Float32Array, input: Uint32Array, predicates: ExactGeometry): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const parent = Array.from({ length: p.length / 3 }, (_, i) => i);
  const root = (i: number): number => findRoot(parent, i);
  const next = (h: number) => h - h % 3 + (h + 1) % 3;
  for (let h = 0; h < input.length; h++) {
    const a = input[h];
    const b = input[next(h)];
    if (p[a * 3] === p[b * 3] && p[a * 3 + 1] === p[b * 3 + 1] && p[a * 3 + 2] === p[b * 3 + 2])
      parent[root(a)] = root(b);
  }
  const mapped = Array.from(input, root);
  const twin = new Int32Array(input.length).fill(-1);
  const directed = new Map<string, number>();
  for (let h = 0; h < input.length; h++) {
    const key = `${input[h]}:${input[next(h)]}`;
    if (directed.has(key))
      throw new Error("Input mesh has duplicate directed edges");
    directed.set(key, h);
  }
  for (let h = 0; h < input.length; h++) {
    const t = directed.get(`${input[next(h)]}:${input[h]}`);
    if (t === undefined)
      throw new Error('Input mesh not closed');
    twin[h] = t;
  }
  const dead = new Uint8Array(input.length / 3);
  const partner = new Int32Array(dead.length).fill(-1);
  const key = (t: number[]) => [t, t.slice(1).concat(t[0]), t.slice(2).concat(t.slice(0, 2))].map(t => t.join(',')).sort()[0];
  const oriented = new Map<string, number[]>();
  for (let f = 0; f < dead.length; f++) {
    const t = mapped.slice(f * 3, f * 3 + 3);
    if (new Set(t).size < 3) {
      dead[f] = 1;
      continue;
    }
    const reverse = key([t[0], t[2], t[1]]);
    const stack = oriented.get(reverse);
    if (stack?.length) {
      const opposite = stack.pop()!;
      dead[f] = dead[opposite] = 2;
      partner[f] = opposite;
      partner[opposite] = f;
    }
    else {
      const k = key(t);
      const stack = oriented.get(k) ?? [];
      stack.push(f);
      oriented.set(k, stack);
    }
  }
  const trace = (h: number) => {
    let t = twin[h];
    const seen = new Set<number>();
    while (dead[Math.floor(t / 3)]) {
      if (seen.has(t))
        throw new Error('Unresolved collapsed topology');
      seen.add(t);
      const f = Math.floor(t / 3);
      let q = -1;
      if (dead[f] === 1) {
        for (let j = f * 3; j < f * 3 + 3; j++)
          if (j !== t && mapped[j] !== mapped[next(j)])
            q = j;
      }
      else {
        const f2 = partner[f];
        for (let j = f2 * 3; j < f2 * 3 + 3; j++)
          if (mapped[j] === mapped[next(t)] && mapped[next(j)] === mapped[t])
            q = j;
      }
      if (q < 0)
        throw new Error('Cannot trace collapsed boundary');
      t = twin[q];
    }
    return t;
  };
  const corners = Array.from({ length: input.length }, (_, i) => i);
  const fan = (i: number): number => findRoot(corners, i);
  for (let h = 0; h < input.length; h++) {
    if (dead[Math.floor(h / 3)])
      continue;
    const t = trace(h);
    if (trace(t) !== h || mapped[h] !== mapped[next(t)] || mapped[next(h)] !== mapped[t])
      throw new Error("Collapsed boundary pairing mismatch");
    corners[fan(h)] = fan(next(t));
    corners[fan(next(h))] = fan(t);
  }
  const vertices = new Map<number, number>();
  const outp: number[] = [];
  const outt: number[] = [];
  const outEdges: number[] = [];
  for (let h = 0; h < input.length; h++) {
    if (dead[Math.floor(h / 3)])
      continue;
    const f = fan(h);
    let i = vertices.get(f);
    if (i === undefined) {
      i = vertices.size;
      vertices.set(f, i);
      const v = input[h];
      outp.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
    }
    outt.push(i);
    outEdges.push(Math.min(h, trace(h)));
  }
  return refineParallelEdges(new Float32Array(outp), new Uint32Array(outt), outEdges, predicates);
}
function splitTriangle(t: number[], a: number, b: number, mid: number): number[][] {
  const j = t.findIndex((v, i) => (v === a && t[(i + 1) % 3] === b) || (v === b && t[(i + 1) % 3] === a));
  if (j < 0)
    throw new Error("Refinement edge missing");
  const start = t[j];
  const end = t[(j + 1) % 3];
  const other = t[(j + 2) % 3];
  return [[start, mid, other], [mid, end, other]];
}
/** A delta-complex can have distinct edges with the same vertex endpoints.
 * Subdivide only original edge instances, using one shared added vertex for
 * their original twin faces; never choose a pairing from coordinates. */
function refineParallelEdges(p: Float32Array, input: Uint32Array, labels: number[], predicates: ExactGeometry): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  type Face = {
    vertices: number[];
    edges: number[];
  };
  let faces: Face[] = Array.from({ length: input.length / 3 }, (_, i) => ({ vertices: Array.from(input.slice(i * 3, i * 3 + 3)), edges: labels.slice(i * 3, i * 3 + 3) }));
  const groups = new Map<string, Set<number>>();
  for (const face of faces)
    for (let j = 0; j < 3; j++) {
      const a = face.vertices[j];
      const b = face.vertices[(j + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      let set = groups.get(key);
      if (!set) {
        set = new Set();
        groups.set(key, set);
      }
      set.add(face.edges[j]);
    }
  const targets = [...groups.values()].flatMap(set => [...set].sort((a, b) => a - b).slice(1));
  let label = labels.reduce((m, n) => Math.max(m, n), -1) + 1;
  for (const target of targets) {
    const selected = faces.filter(f => f.edges.includes(target));
    if (selected.length !== 2)
      throw new Error("Refinement edge is not a reciprocal pair");
    const j = selected[0].edges.indexOf(target);
    const a = selected[0].vertices[j];
    const b = selected[0].vertices[(j + 1) % 3];
    const mid = p.length / 3;
    const refinement = predicates.midpoint(p, a, b);
    const point = refinement.point;
    const expanded = new Float32Array(p.length + 3);
    expanded.set(p);
    expanded.set(point, p.length);
    p = expanded;
    const first = label++;
    const second = label++;
    faces = faces.flatMap(face => {
      const e = face.edges.indexOf(target);
      if (e < 0)
        return [face];
      const start = face.vertices[e];
      const end = face.vertices[(e + 1) % 3];
      const other = face.vertices[(e + 2) % 3];
      if (!((start === a && end === b) || (start === b && end === a)))
        throw new Error("Refinement twin endpoints mismatch");
      const internal = label++;
      const parts = splitTriangle(face.vertices, a, b, mid);
      if (parts.some(t => !predicates.sameOrientation(p, face.vertices, t)))
        throw new Error("Refinement creates a degenerate or reversed triangle");
      return [{ vertices: parts[0], edges: [start === a ? first : second, internal, face.edges[(e + 2) % 3]] }, { vertices: parts[1], edges: [end === b ? second : first, face.edges[(e + 1) % 3], internal] }];
    });
    predicates.commit(refinement);
  }
  return { positions: p, indices: new Uint32Array(faces.flatMap(f => f.vertices)) };
}
/** Iterative path compression also handles long chains of collapsed edges. */
function findRoot(parents: number[], index: number): number {
  let root = index;
  while (parents[root] !== root)
    root = parents[root];
  while (parents[index] !== index) {
    const next = parents[index];
    parents[index] = root;
    index = next;
  }
  return root;
}
type ExactVector = [
  bigint,
  bigint,
  bigint
];
type Midpoint = {
  point: [
    number,
    number,
    number
  ];
  displacement: bigint;
  roundingBound: bigint;
};
/** All exact values use the same dyadic lattice as finite Float32 numbers. */
class ExactGeometry {
  private readonly values = new Map<number, bigint>();
  private readonly bits = new DataView(new ArrayBuffer(4));
  private displacement = 0n;
  private roundingBound = 0n;
  private addedVertices = 0;
  /** An integer multiple of 2^-149, including subnormal coordinates. */
  private dyadic(value: number): bigint {
    const cached = this.values.get(value);
    if (cached !== undefined)
      return cached;
    this.bits.setFloat32(0, value);
    const bits = this.bits.getUint32(0);
    const exponent = (bits >>> 23) & 255;
    const fraction = bits & 0x7fffff;
    let integer = exponent
      ? BigInt(fraction | 0x800000) << BigInt(exponent - 1)
      : BigInt(fraction);
    if (bits >>> 31)
      integer = -integer;
    this.values.set(value, integer);
    return integer;
  }
  private cross(positions: Float32Array, triangle: number[]): ExactVector {
    const a = triangle[0] * 3;
    const b = triangle[1] * 3;
    const c = triangle[2] * 3;
    const u = [0, 1, 2].map(axis => this.dyadic(positions[b + axis]) - this.dyadic(positions[a + axis]));
    const v = [0, 1, 2].map(axis => this.dyadic(positions[c + axis]) - this.dyadic(positions[a + axis]));
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  }
  /** Exact nonnegative integer potential for collinear-network retriangulation. */
  edgeEnergy(positions: Float32Array, triangle: number[]): bigint {
    let sum = 0n;
    for (let corner = 0; corner < 3; corner++) {
      const a = triangle[corner] * 3;
      const b = triangle[(corner + 1) % 3] * 3;
      for (let axis = 0; axis < 3; axis++) {
        const difference = this.dyadic(positions[a + axis]) - this.dyadic(positions[b + axis]);
        sum += difference * difference;
      }
    }
    return sum;
  }

  isZeroArea(positions: Float32Array, triangle: number[]): boolean {
    // Double products can falsely classify both zero and nonzero determinants
    // when coordinate exponents differ. Decide from the exact stored values.
    return this.cross(positions, triangle).every(component => component === 0n);
  }
  sameOrientation(positions: Float32Array, before: number[], after: number[]): boolean {
    const a = this.cross(positions, before);
    const b = this.cross(positions, after);
    return a.reduce((sum, component, axis) => sum + component * b[axis], 0n) > 0n;
  }
  midpoint(positions: Float32Array, a: number, b: number): Midpoint {
    const point = [0, 1, 2].map(axis => Math.fround((positions[a * 3 + axis] + positions[b * 3 + axis]) / 2)) as [
      number,
      number,
      number
    ];
    let displacement = 0n;
    let roundingBound = 0n;
    for (let axis = 0; axis < 3; axis++) {
      // In units 2^-150, this is the exact midpoint error, even when the
      // intermediate double average rounds. Half a Float32 ULP bounds it.
      const error = 2n * this.dyadic(point[axis]) - this.dyadic(positions[a * 3 + axis]) - this.dyadic(positions[b * 3 + axis]);
      const magnitude = error < 0n ? -error : error;
      this.bits.setFloat32(0, point[axis]);
      const exponent = (this.bits.getUint32(0) >>> 23) & 255;
      const bound = exponent ? 1n << BigInt(exponent - 1) : 1n;
      if (magnitude > bound)
        throw new Error("Added midpoint exceeds Float32 rounding bound");
      displacement += magnitude;
      roundingBound += bound;
    }
    if ([a, b].some(vertex => point.every((value, axis) => value === positions[vertex * 3 + axis]))) {
      throw new Error("Added midpoint collapses to an endpoint");
    }
    return { point, displacement, roundingBound };
  }
  commit(midpoint: Midpoint): void {
    // Each split admits a barycentric correspondence with displacement bounded
    // by its midpoint error. Summing local L1 bounds also covers later splits
    // that depend on previously added vertices. Rejected proposals never count.
    this.displacement += midpoint.displacement;
    this.roundingBound += midpoint.roundingBound;
    this.addedVertices++;
    if (this.displacement > this.roundingBound) {
      throw new Error("Cumulative refinement exceeds Float32 rounding bound");
    }
  }
  diagnostics(): PrintableMeshDiagnostics {
    return {
      addedVertices: this.addedVertices,
      cumulativeDisplacementBound: dyadicBoundToNumber(this.displacement),
      formatRoundingBound: dyadicBoundToNumber(this.roundingBound),
    };
  }
}


/** Drop orphaned positions without changing coordinate values or identities. */
function compactVertices(mesh: PrintableMesh): PrintableMesh {
  const mapping = new Map<number, number>();
  const positions: number[] = [];
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < indices.length; i++) {
    const original = mesh.indices[i];
    let compact = mapping.get(original);
    if (compact === undefined) {
      compact = mapping.size;
      mapping.set(original, compact);
      positions.push(
        mesh.positions[original * 3],
        mesh.positions[original * 3 + 1],
        mesh.positions[original * 3 + 2],
      );
    }
    indices[i] = compact;
  }
  return { positions: new Float32Array(positions), indices };
}


/** Round positive diagnostic bounds upward before exact power-of-two scaling. */
function dyadicBoundToNumber(value: bigint): number {
  let rounded = Number(value);
  if (BigInt(rounded) < value) {
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, rounded);
    bits.setBigUint64(0, bits.getBigUint64(0) + 1n);
    rounded = bits.getFloat64(0);
  }
  return rounded * 2 ** -150;
}
