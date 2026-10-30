import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { parseBinSpec } from "@shared/gridfinity/types";
import { binWallThicknessMm } from "@shared/gridfinity/standard";
import { compartmentLayout } from "@shared/gridfinity/compartments";
import { wallSlantPointMm } from "@shared/gridfinity/wall-slant";
import { buildBin, buildBinWithCutouts, PREVIEW_QUALITY, EXPORT_QUALITY } from "./bin";

let wasm: Awaited<ReturnType<typeof loadManifold>>;
let arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const spec = (extra: Record<string, unknown> = {}) => parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 4, fill: "none", lip: "none", bottomFilletRadiusMm: 3, ...extra });
const probe = (x: number, y: number, z: number) => arena.track(arena.track(kernel.Manifold.cube([0.1, 0.1, 0.1], true)).translate([x, y, z]));

function expectClosedStl(stl: ArrayBuffer): void {
  // STL has no vertex identity: coordinate-equal edges must also have just
  // two incident faces, or a closed indexed mesh can serialize a contact seam.
  const edges = new Map<string, number>();
  const bytes = new DataView(stl);
  for (let i = 0; i < bytes.getUint32(80, true); i++) {
    const vertices = [0, 1, 2].map(j => [0, 1, 2].map(k => bytes.getFloat32(84 + i * 50 + 12 + j * 12 + k * 4, true)).join(","));
    for (let j = 0; j < 3; j++) {
      const edge = [vertices[j], vertices[(j + 1) % 3]].sort().join("/");
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  expect([...edges.values()].every(count => count === 2)).toBe(true);
}

describe("hollow bottom fillet solids", () => {
  it("preserves zero-radius and solid-filled geometry", () => {
    for (const fill of ["none", "solid"] as const) {
      const base = buildBin(kernel, spec({ fill, bottomFilletRadiusMm: 0 }), PREVIEW_QUALITY);
      const kept = buildBin(kernel, spec({ fill, bottomFilletRadiusMm: fill === "solid" ? 3 : 0 }), PREVIEW_QUALITY);
      expect(kept.solid.volume()).toBeCloseTo(base.solid.volume(), 7);
      expect(kept.parts.compartments).toBeNull();
    }
  });
  it.each([false, true])("rounds outer walls and both faces of dividers (dividers=%s)", divided => {
    const bin = spec({ compartments: { rows: divided ? 2 : 1, columns: divided ? 2 : 1 } });
    const built = buildBin(kernel, bin, EXPORT_QUALITY);
    const sharp = buildBin(kernel, { ...bin, bottomFilletRadiusMm: 0 }, EXPORT_QUALITY);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.boundingBox()).toEqual(sharp.solid.boundingBox());
    expect(arena.track(sharp.solid.subtract(built.solid)).volume()).toBeLessThan(1e-6);
    const inner = 41.75 - binWallThicknessMm(bin);
    const samples = [[inner - 0.2, 10], [-inner + 0.2, 10], [10, inner - 0.2], [10, -inner + 0.2]];
    if (divided) samples.push([0.8, 10], [-0.8, 10], [10, 0.8], [10, -0.8]);
    for (const [x, y] of samples) {
      expect(arena.track(built.solid.intersect(probe(x, y, 7.5))).volume()).toBeCloseTo(0.001, 6);
      expect(arena.track(built.solid.intersect(probe(x, y, 10.5))).volume()).toBeCloseTo(0, 7);
    }
    expect(arena.track(built.solid.intersect(probe(10, 10, 7.5))).volume()).toBeCloseTo(0, 7);
    expect(built.solid.decompose().map(p => arena.track(p))).toHaveLength(1);
  });
  it.each((["x", "y"] as const).flatMap(axis => [false, true].map(scoop => ({ axis, scoop }))))("follows slants, one fixed wall and closing wedges: %j", ({ axis, scoop }) => {
    for (const side of ["both", "negative", "positive"] as const) {
      for (const angleDeg of [-20, 20, -80, 80]) {
        const bin = spec({ compartments: { rows: 2, columns: 2, scoop }, wallSlant: { axis, side, angleDeg } });
        const built = buildBin(kernel, bin, PREVIEW_QUALITY);
        const envelope = buildBin(kernel, { ...bin, fill: "solid" }, PREVIEW_QUALITY).solid;
        expect(built.solid.status()).toBe("NoError");
        expect(Math.abs(arena.track(built.solid.subtract(envelope)).volume()), `${axis}/${side}/${angleDeg} overflow`).toBeLessThan(1e-5);
        expect(built.solid.decompose().map(p => arena.track(p)).filter(p => p.volume() > 1e-6)).toHaveLength(1);
        const p = wallSlantPointMm(bin, { x: 0.8, y: 10 }, 7.5);
        expect(arena.track(built.solid.intersect(probe(p.x, p.y, 7.5))).volume(), `${axis}/${side}/${angleDeg} divider`).toBeGreaterThan(0.0009);
        if (side !== "both") {
          const fixedSign = side === "positive" ? -1 : 1;
          const p = { x: 10, y: 10, [axis]: fixedSign * (41.75 - binWallThicknessMm(bin) - 0.2) };
          expect(arena.track(built.solid.intersect(probe(p.x, p.y, 7.5))).volume(), `${axis}/${side}/${angleDeg} fixed wall`).toBeGreaterThan(0.0009);
        }
      }
    }
  });
  it.each([false, true])("lets the scoop govern its edge without stacking a ledge (dividers=%s)", divided => {
    const bin = spec({ compartments: { rows: divided ? 2 : 1, columns: divided ? 2 : 1, scoop: true } });
    const built = buildBin(kernel, bin, EXPORT_QUALITY);
    const scoop = buildBin(kernel, { ...bin, bottomFilletRadiusMm: 0 }, EXPORT_QUALITY);
    const { scoopRadius, scoopWalls } = compartmentLayout(bin);
    // Away from transverse walls, the existing larger scoop must be identical.
    for (const front of scoopWalls) {
      const window = arena.track(arena.track(kernel.Manifold.cube([1, scoopRadius + 1, scoopRadius + 1]))
        .translate([10, front - 0.5, 7]));
      expect(arena.track(arena.track(built.solid.subtract(scoop.solid)).intersect(window)).volume()).toBeLessThan(1e-6);
    }
    expect(arena.track(scoop.solid.subtract(built.solid)).volume()).toBeLessThan(1e-6);
    expect(built.solid.decompose().map(p => arena.track(p))).toHaveLength(1);
  });
  it("keeps shallow, tiny, arbitrary and custom cavities valid", () => {
    for (const extra of [
      { heightUnits: 1 }, { heightUnits: 1.5, lip: "standard" },
      { gridX: 1, gridY: 1, gridPitch: "quarter", compartments: { rows: 3, columns: 3 } },
      { arbitrarySizeMm: { width: 27, length: 19 }, flatBottom: true, compartments: { rows: 2, scoop: true } },
      { footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }, compartments: { rows: 3, columns: 3, scoop: true } },
    ]) {
      const bin = spec({ bottomFilletRadiusMm: 50, ...extra });
      const built = buildBin(kernel, bin, PREVIEW_QUALITY);
      expect(built.solid.status()).toBe("NoError");
      expect(built.solid.decompose().map(p => arena.track(p)).filter(p => p.volume() > 1e-6)).toHaveLength(1);
      expect(extractPrintableMeshData(kernel, built.solid).indices.length).toBeGreaterThan(0);
    }
  });
  it("keeps the requested larger fillet when its radius exceeds the scoop", () => {
    const bin = spec({ bottomFilletRadiusMm: 14, compartments: { rows: 2, columns: 2, scoop: true } });
    const withScoop = buildBin(kernel, bin, EXPORT_QUALITY);
    const filletOnly = buildBin(kernel, { ...bin, compartments: { ...bin.compartments, scoop: false } }, EXPORT_QUALITY);
    // The 10.5 mm scoop fits entirely in the larger rounded bottom.
    expect(compartmentLayout(bin).scoopRadius).toBeLessThan(bin.bottomFilletRadiusMm);
    expect(arena.track(withScoop.solid.subtract(filletOnly.solid)).volume()).toBeLessThan(1e-6);
    expect(arena.track(filletOnly.solid.subtract(withScoop.solid)).volume()).toBeLessThan(1e-6);
  });
  it.each((["x", "y"] as const).flatMap(axis => (["positive", "negative"] as const).map(side => ({ axis, side }))))("serializes closing wedges without floor contact seams: %j", ({ axis, side }) => {
    const bin = spec({ bottomFilletRadiusMm: 4, compartments: { rows: 2, columns: 2, scoop: true },
      wallSlant: { axis, side, angleDeg: side === "positive" ? -80 : 80 } });
    const built = buildBin(kernel, bin, EXPORT_QUALITY);
    expectClosedStl(writeBinarySTL(extractPrintableMeshData(kernel, built.solid)));
  });
  it("preserves material partitions and serializes watertight STL and 3MF", () => {
    const bin = spec({ bottomFilletRadiusMm: 4, compartments: { rows: 2, columns: 2, scoop: true }, wallSlant: { axis: "y", angleDeg: 25, side: "positive" } });
    const built = buildBinWithCutouts(kernel, bin, null, EXPORT_QUALITY, {
      floorInsertThicknessMm: 0.6, rimInsertThicknessMm: 0.6, colorDividerTops: true,
    });
    const parts = built.materialParts!;
    const solids = [parts.body, parts.pocketFloors!, parts.stackingRim!];
    // Fillets stay body-colored; only exposed flat floor receives the accent.
    expect(arena.track(parts.pocketFloors!.intersect(probe(40.6, 10, 6.8))).volume()).toBeCloseTo(0, 7);
    expect(arena.track(parts.body.intersect(probe(40.6, 10, 6.8))).volume()).toBeCloseTo(0.001, 6);
    expect(solids.reduce((sum, part) => sum + part.volume(), 0)).toBeCloseTo(built.solid.volume(), 4);
    for (let i = 0; i < solids.length; i++) {
      expect(solids[i].status()).toBe("NoError");
      for (let j = i + 1; j < solids.length; j++) expect(Math.abs(arena.track(solids[i].intersect(solids[j])).volume())).toBeLessThan(1e-5);
    }
    const mesh = extractPrintableMeshData(kernel, built.solid);
    const stl = writeBinarySTL(mesh);
    expect(stl.byteLength).toBe(84 + mesh.indices.length / 3 * 50);
    expectClosedStl(stl);
    const zip = unzipSync(writeThreeMf(solids.map((solid, i) => ({ name: `Material ${i}`, mesh: extractPrintableMeshData(kernel, solid) }))));
    expect(strFromU8(zip["3D/3dmodel.model"])).toContain("<triangle");
    const edges = new Map<string, number>();
    for (let i = 0; i < mesh.indices.length; i += 3) for (let j = 0; j < 3; j++) {
      const a = mesh.indices[i + j], b = mesh.indices[i + (j + 1) % 3];
      const key = `${Math.min(a, b)}/${Math.max(a, b)}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    expect([...edges.values()].every(count => count === 2)).toBe(true);
  });
});
