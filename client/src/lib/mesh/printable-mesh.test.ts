import { describe, expect, it } from "vitest";
import { preparePrintableMesh, type PrintableMesh, type PrintableMeshDiagnostics } from "./printable-mesh";
import refinementFixture from "./fixtures/rounded-refinement.json";

const tetraPositions = [0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 1];
const tetraIndices = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
const seamIndices = [0, 2, 4, 4, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3, 0, 4, 1];
const finIndices = [0, 2, 1, 0, 3, 2, 1, 2, 3, 0, 1, 4, 0, 4, 3, 1, 3, 4];
const chainIndices = [0, 2, 4, 4, 2, 1, 0, 5, 3, 5, 1, 3, 0, 3, 2, 1, 2, 3, 0, 4, 1, 1, 5, 0];

function mesh(positions = tetraPositions, indices = tetraIndices): PrintableMesh {
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function volume({ positions: p, indices: t }: PrintableMesh): number {
  let volume = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    volume += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) +
      p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return volume;
}

function faces({ positions, indices }: PrintableMesh): string[] {
  const result: string[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const corners = Array.from(indices.slice(i, i + 3), index => positions.slice(index * 3, index * 3 + 3).join(","));
    result.push([0, 1, 2].map(j => corners.slice(j).concat(corners.slice(0, j)).join(";")).sort()[0]);
  }
  return result.sort();
}

function expectClosed({ positions, indices }: PrintableMesh): void {
  const edges = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = indices[i + j], b = indices[i + (j + 1) % 3];
      expect(a).not.toBe(b);
      const key = `${a}:${b}`;
      expect(edges.has(key)).toBe(false);
      edges.set(key, 1);
    }
  }
  for (const edge of edges.keys()) expect(edges.has(edge.split(":").reverse().join(":"))).toBe(true);
  expect(new Set(indices).size * 3).toBe(positions.length);
}

function expectPreserved(input: PrintableMesh, triangleCount: number): PrintableMesh {
  const before = { positions: input.positions.slice(), indices: input.indices.slice() };
  const result = preparePrintableMesh(input);
  expect(input).toEqual(before);
  expect(result.indices.length).toBe(triangleCount * 3);
  expect(volume(result)).toBeCloseTo(volume(input), 10);
  expectClosed(result);
  expect(preparePrintableMesh(result)).toEqual(result);
  return result;
}

describe("one-way printable Float32 topology", () => {
  it("preserves an ordinary oriented boundary and its input buffers", () => {
    const input = mesh();
    expect(faces(expectPreserved(input, 4))).toEqual(faces(input));
  });

  it("removes a collinear seam by retriangulating its adjacent face", () => {
    expectPreserved(mesh([...tetraPositions, 1, 0, 0], seamIndices), 6);
  });

  it("cancels opposite fin faces without leaving unused positions", () => {
    const output = expectPreserved(mesh([...tetraPositions, 4, 0, 0], finIndices), 4);
    expect(output.positions.length).toBe(12);
  });

  it("removes a completely flat closed component", () => {
    const output = expectPreserved(mesh([0, 0, 0, 2, 0, 0, 1, 0, 0, 1, 1, 0]), 0);
    expect(output.positions.length).toBe(0);
  });

  it("preserves tiny positive-volume features", () => {
    const input = mesh([0, 0, 0, 2, 0, 0, 1, 1e-6, 0, 1, 1, 1e-6]);
    expect(faces(expectPreserved(input, 4))).toEqual(faces(input));
  });

  it("keeps touching components separate unless topology identifies them", () => {
    const shifted = tetraPositions.map((value, i) => value + (i % 3 === 0 ? 2 : 0));
    const output = expectPreserved(mesh([...tetraPositions, ...shifted], [...tetraIndices, ...tetraIndices.map(i => i + 4)]), 8);
    expect(output.positions.length).toBe(24);
  });

  it("uses explicit seam identity pairs without coordinate welding", () => {
    const positions = new Float32Array(tetraIndices.flatMap(i => tetraPositions.slice(i * 3, i * 3 + 3)));
    const first = new Map<number, number>(), from: number[] = [], to: number[] = [];
    tetraIndices.forEach((vertex, i) => {
      const existing = first.get(vertex);
      if (existing === undefined) first.set(vertex, i);
      else { from.push(i); to.push(existing); }
    });
    const output = preparePrintableMesh({ positions, indices: Uint32Array.from(tetraIndices, (_, i) => i), mergeFromVert: new Uint32Array(from), mergeToVert: new Uint32Array(to) });
    expect(faces(output)).toEqual(faces(mesh()));
    expectClosed(output);
  });

  it("retains a noncollinear triangle whose double cross product rounds to zero", () => {
    const input = mesh([1e20, 1e20, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(faces(preparePrintableMesh(input))).toEqual(faces(input));
  });

  it("detects collinearity even when the double cross product is nonzero", () => {
    const positions = [128, 384, 0, 2 ** 60, 3 * 2 ** 60, 0, 0, 1, 0, 0, 0, 1, 256, 768, 0];
    const input = mesh(positions, seamIndices);
    const output = preparePrintableMesh(input);
    expect(output.indices.length).toBe(18);
    const rotated = mesh(positions, seamIndices.flatMap((_, i) => i % 3 ? [] : [seamIndices[i + 1], seamIndices[i + 2], seamIndices[i]]));
    expect(faces(preparePrintableMesh(rotated))).toEqual(faces(output));
  });

  it("chooses collinear endpoints by coordinate order rather than rounded length", () => {
    expectPreserved(mesh([...tetraPositions, 1e-20, 0, 0], seamIndices), 6);
  });

  it.each([[0, 14, 10.2, 12.8], [0, 2, 1e-20, 1], [-100, 50, -20, 0], [0, 10, 5, 5]])(
    "removes an entire collinear network (%s, %s, %s, %s)", (a, b, c, d) => {
      const input = mesh([a, 0, 0, b, 0, 0, a, 10, 0, a, 0, 10, c, 0, 0, d, 0, 0], chainIndices);
      expectPreserved(input, c === d ? 6 : 8);
    },
  );

  it("bounds rounded refinement when no exact Float32 midpoint exists", () => {
    const input = mesh(refinementFixture.positions, refinementFixture.indices);
    let diagnostics: PrintableMeshDiagnostics | undefined;
    const output = preparePrintableMesh(input, result => { diagnostics = result; });
    expectClosed(output);
    expect(diagnostics?.addedVertices).toBe(1);
    expect(diagnostics?.cumulativeDisplacementBound).toBe(0.000004291534423828125);
    expect(diagnostics!.cumulativeDisplacementBound).toBeLessThanOrEqual(diagnostics!.formatRoundingBound);
    const original = new Set(Array.from({ length: input.positions.length / 3 }, (_, i) => input.positions.slice(i * 3, i * 3 + 3).join(",")));
    const added = Array.from({ length: output.positions.length / 3 }, (_, i) => output.positions.slice(i * 3, i * 3 + 3).join(",")).filter(point => !original.has(point));
    expect(added).toHaveLength(1);
    expect(preparePrintableMesh(output)).toEqual(output);
  });

  it("accumulates refinement bounds across separate components", () => {
    const p = refinementFixture.positions;
    const t = refinementFixture.indices;
    const offset = p.length / 3;
    const mirrored = t.flatMap((_, i) => i % 3 ? [] : [t[i] + offset, t[i + 2] + offset, t[i + 1] + offset]);
    let diagnostics: PrintableMeshDiagnostics | undefined;
    const output = preparePrintableMesh(mesh([...p, ...p.map(value => -value)], [...t, ...mirrored]), result => { diagnostics = result; });
    expectClosed(output);
    expect(diagnostics?.addedVertices).toBe(2);
    expect(diagnostics?.cumulativeDisplacementBound).toBe(2 * 0.000004291534423828125);
    expect(diagnostics!.cumulativeDisplacementBound).toBeLessThanOrEqual(diagnostics!.formatRoundingBound);
  });

  it("rejects malformed input instead of returning a damaged mesh", () => {
    expect(() => preparePrintableMesh(mesh([0, 0], []))).toThrow("triples");
    expect(() => preparePrintableMesh(mesh([NaN, 0, 0], []))).toThrow("finite");
    expect(() => preparePrintableMesh(mesh([0, 0, 0], [0, 1, 2]))).toThrow("range");
    expect(() => preparePrintableMesh(mesh(tetraPositions, [...tetraIndices, 0, 2, 1]))).toThrow("duplicate directed");
    expect(() => preparePrintableMesh(mesh(tetraPositions, tetraIndices.slice(0, 9)))).toThrow("closed");
    expect(() => preparePrintableMesh({ ...mesh(), mergeFromVert: new Uint32Array([0]) })).toThrow("different lengths");
    expect(() => preparePrintableMesh({ ...mesh(), mergeFromVert: new Uint32Array([0]), mergeToVert: new Uint32Array([1]) })).toThrow("equal coordinates");
  });
});
