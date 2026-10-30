import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { parseBinSpec } from "@shared/gridfinity/types";
import { compartmentLabelTabPlacements, compartmentLayout, compartmentHeightMm } from "@shared/gridfinity/compartments";
import { wallSlantCloses, wallSlantPointMm } from "@shared/gridfinity/wall-slant";
import { buildBin, buildBinWithCutouts, PREVIEW_QUALITY, EXPORT_QUALITY } from "./bin";
import { buildLabelTab } from "./label-tab";

let wasm: Awaited<ReturnType<typeof loadManifold>>;
let arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const spec = (extra: Record<string, unknown> = {}) => parseBinSpec({ gridX: 2, gridY: 3, heightUnits: 6, fill: "none", lip: "none", ...extra });
const quality = PREVIEW_QUALITY;
const probe = (x: number, y: number, z: number) => arena.track(arena.track(kernel.Manifold.cube([0.1, 0.1, 0.1], true)).translate([x, y, z]));

describe("compartment solids", () => {
  it("leaves 1 by 1 and solid fill unchanged", () => {
    const plain = buildBin(kernel, spec(), quality);
    expect(plain.parts.compartments).toBeNull();
    const filled = spec({ fill: "solid" });
    const retained = buildBin(kernel, { ...filled, compartments: { rows: 3, columns: 4, dividerThicknessMm: 2, scoop: true } }, quality);
    expect(retained.parts.compartments).toBeNull();
    expect(retained.solid.volume()).toBeCloseTo(buildBin(kernel, filled, quality).solid.volume(), 7);
  });
  it.each([[1, 3], [3, 1], [2, 3]])("makes %i by %i open compartments in one connected body", (rows, columns) => {
    const bin = spec({ compartments: { rows, columns }, lip: "standard" });
    const built = buildBin(kernel, bin, quality);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(part => arena.track(part))).toHaveLength(1);
    expect(arena.track(built.solid.slice(20)).toPolygons()).toHaveLength(1 + rows * columns);
    expect(built.parts.compartments!.boundingBox().max[2]).toBeCloseTo(40.8);
    expect(built.solid.boundingBox()).toEqual(buildBin(kernel, spec({ lip: "standard" }), quality).solid.boundingBox());
  });
  it("adds a concave front scoop to every row, including an undivided bin", () => {
    for (const rows of [1, 3]) {
      const bin = spec({ compartments: { rows, columns: 2, scoop: true } });
      const built = buildBin(kernel, bin, quality);
      const { rowFronts, scoopRadius: r } = compartmentLayout(bin);
      for (const front of rowFronts) {
        expect(arena.track(built.solid.intersect(probe(-15, front + 0.1 * r, 7 + 0.2 * r))).volume()).toBeCloseTo(0.001, 6);
        expect(arena.track(built.solid.intersect(probe(-15, front + 0.7 * r, 7 + 0.2 * r))).volume()).toBeCloseTo(0, 7);
      }
      expect(built.solid.decompose().map(part => arena.track(part))).toHaveLength(1);
    }
    expect(buildBin(kernel, spec({ compartments: { scoop: true } }), quality).parts.compartments!.volume()).toBeGreaterThan(0);
  });
  it.each(["x", "y"] as const)("matches %s slants, including one fixed wall and closing wedges", axis => {
    for (const side of ["both", "negative", "positive"] as const) {
      for (const angleDeg of [-20, 20, -75, 75]) {
        const bin = spec({ compartments: { rows: 2, columns: 2, scoop: true }, wallSlant: { axis, side, angleDeg } });
        const built = buildBin(kernel, bin, quality);
        expect(built.solid.status()).toBe("NoError");
        const pieces = built.solid.decompose().map(part => arena.track(part));
        const envelope = buildBin(kernel, { ...bin, fill: "solid" }, quality).solid;
        const overflow = arena.track(built.solid.subtract(envelope)).volume();
        expect(Math.abs(overflow), `${axis}/${side}/${angleDeg} overflow`).toBeLessThan(1e-5);
        // Decompose includes negative cavity shells when a closing wedge seals
        // a compartment; zero-volume coincident sheets are not separate bodies.
        expect(pieces.filter(p => p.volume() > 1e-6), `${axis}/${side}/${angleDeg} bodies`).toHaveLength(1);
        if (!wallSlantCloses(bin)) expect(pieces.every(p => p.volume() >= -1e-6)).toBe(true);
        expect(extractPrintableMeshData(kernel, built.solid).indices.length).toBeGreaterThan(0);
        const point = wallSlantPointMm(bin, { x: 0, y: 0 }, 15);
        expect(arena.track(built.solid.intersect(probe(point.x, point.y, 15))).volume()).toBeGreaterThan(0.0009);
        expect(built.parts.base.boundingBox()).toEqual(buildBin(kernel, spec(), quality).parts.base.boundingBox());
      }
    }
  });
  it.each(["full", "half", "quarter"] as const)("clips the grid and scoops to a custom %s footprint", gridPitch => {
    const bin = spec({ gridPitch, gridX: 2, gridY: 2, compartments: { rows: 2, columns: 2, scoop: true },
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
    const built = buildBin(kernel, bin, quality);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(part => arena.track(part))).toHaveLength(1);
    expect(arena.track(built.solid.subtract(buildBin(kernel, { ...bin, fill: "solid" }, quality).solid)).volume()).toBeLessThan(1e-5);
  });
  it("preserves arbitrary flat bottoms and directly serializes printable STL and 3MF", () => {
    const bin = spec({ arbitrarySizeMm: { width: 93, length: 67 }, flatBottom: true, compartments: { rows: 2, columns: 3, scoop: true } });
    for (const buildQuality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
      const built = buildBin(kernel, bin, buildQuality);
      expect(built.solid.status()).toBe("NoError");
      const mesh = extractPrintableMeshData(kernel, built.solid);
      expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
      const stl = writeBinarySTL(mesh);
      expect(stl.byteLength).toBe(84 + mesh.indices.length / 3 * 50);
      const zip = unzipSync(writeThreeMf([{ name: "Compartments", mesh }]));
      expect(strFromU8(zip["3D/3dmodel.model"])).toContain("<triangle");
    }
  });
  it("partitions multicolor floor and rim without adding material", () => {
    const bin = spec({ lip: "standard", compartments: { rows: 2, columns: 3, scoop: true } });
    const built = buildBinWithCutouts(kernel, bin, null, quality, { floorInsertThicknessMm: 0.6, rimInsertThicknessMm: 0.6 });
    const parts = built.materialParts!;
    const sum = parts.body.volume() + parts.pocketFloors!.volume() + parts.stackingRim!.volume();
    expect(sum).toBeCloseTo(built.solid.volume(), 4);
    expect(arena.track(parts.body.intersect(parts.pocketFloors!)).volume()).toBeLessThan(1e-5);
    expect(parts.body.status()).toBe("NoError");
    const floorFaces = (solid: typeof parts.body) => {
      const mesh = extractPrintableMeshData(kernel, solid);
      const triangles: [number, number][][] = [];
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const vertices = [0, 1, 2].map(j => {
          const k = mesh.indices[i + j] * 3;
          return [mesh.positions[k], mesh.positions[k + 1], mesh.positions[k + 2]];
        });
        if (!vertices.every(p => Math.abs(p[2] - 7) < 1e-5)) continue;
        const [a, b, c] = vertices;
        const winding = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (winding < 0) vertices.reverse();
        triangles.push(vertices.map(p => [p[0], p[1]]));
      }
      return triangles.length ? arena.track(new kernel.CrossSection(triangles)) : null;
    };
    const bodyFaces = floorFaces(parts.body), accentFaces = floorFaces(parts.pocketFloors!);
    if (bodyFaces && accentFaces) expect(arena.track(bodyFaces.intersect(accentFaces)).area()).toBeLessThan(0.001);
  });
});

it.each(["x", "y"] as const)("builds scoop material only on the obtuse side for %s slants", axis => {
  for (const angleDeg of [-20, 20]) {
    const bin = spec({ compartments: { rows: 2, columns: 2, scoop: true }, wallSlant: { axis, angleDeg } });
    const built = buildBin(kernel, bin, quality);
    const { scoopWalls, scoopSide, scoopRadius: radius } = compartmentLayout(bin);
    for (const wall of scoopWalls) {
      const z = 7 + radius * 0.2;
      for (const fraction of [0.1, 0.7]) {
        const p = { x: -15, y: -15, [axis]: wall - scoopSide * radius * fraction };
        const moved = wallSlantPointMm(bin, p, z);
        const volume = arena.track(built.solid.intersect(probe(moved.x, moved.y, z))).volume();
        expect(volume).toBeCloseTo(fraction === 0.1 ? 0.001 : 0, 6);
      }
    }
  }
});

it.each(["north", "south", "east", "west"] as const)("attaches a label shelf to every sub-bin's %s wall", wall => {
  for (const angleDeg of [0, -20, 20]) {
    const bin = spec({ compartments: { rows: 2, columns: 3, scoop: true }, labelTab: { wall, width: "full", scope: "compartments" },
      wallSlant: angleDeg ? { axis: "y", angleDeg } : null });
    const built = buildBin(kernel, bin, quality);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(part => arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
    expect(arena.track(built.solid.slice(41.9)).toPolygons()).toHaveLength(7);
    for (const tab of compartmentLabelTabPlacements(bin)) {
      const angle = tab.rotation * Math.PI / 180;
      const p = wallSlantPointMm(bin, { x: tab.x + tab.depth / 2 * Math.sin(angle), y: tab.y - tab.depth / 2 * Math.cos(angle) }, 41.5);
      expect(arena.track(built.solid.intersect(probe(p.x, p.y, 41.5))).volume()).toBeCloseTo(0.001, 6);
    }
    const mesh = extractPrintableMeshData(kernel, built.solid);
    expect(mesh.indices.length).toBeGreaterThan(0);
  }
});

it("keeps repeated tabs inside an irregular footprint", () => {
  for (const wall of ["north", "south", "east", "west"]) {
    const bin = spec({ gridX: 2, gridY: 2, compartments: { rows: 3, columns: 3, scoop: true },
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      labelTab: { wall, width: "center", scope: "compartments" } });
    const built = buildBin(kernel, bin, quality);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(part => arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
    const envelope = buildBin(kernel, { ...bin, fill: "solid", labelTab: null }, quality).solid;
    expect(arena.track(built.solid.subtract(envelope)).volume()).toBeLessThan(1e-5);
  }
});


it.each(["negative", "positive"] as const)("keeps sub-bin tabs attached with only the %s wall slanted", side => {
  for (const axis of ["x", "y"] as const) {
    for (const angleDeg of [-20, 20]) {
      const bin = spec({ compartments: { rows: 2, columns: 3, scoop: true }, wallSlant: { axis, side, angleDeg },
        labelTab: { wall: axis === "x" ? "east" : "north", width: "right", scope: "compartments" } });
      const built = buildBin(kernel, bin, quality);
      expect(built.solid.status()).toBe("NoError");
      expect(built.solid.decompose().map(part => arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
      expect(extractPrintableMeshData(kernel, built.solid).indices.length).toBeGreaterThan(0);
    }
  }
});

it("keeps repeated label tabs below the stacking clearance", () => {
  const bin = spec({ lip: "standard", compartments: { rows: 2, columns: 3 },
    labelTab: { wall: "north", width: "left", scope: "compartments" } });
  const tabs = buildLabelTab(kernel, bin, quality.circularSegments)!;
  expect(tabs.boundingBox().max[2]).toBeCloseTo(40.8);
  const built = buildBin(kernel, bin, quality);
  expect(built.solid.decompose().map(part => arena.track(part))).toHaveLength(1);
});


it("removes dividers independently while retaining a whole-bin scoop and one label tab", () => {
  for (const scoop of [false, true]) {
    const disabled = spec({ compartments: { enabled: false, rows: 3, columns: 4, scoop },
      labelTab: { wall: "north", width: "full", scope: "compartments" } });
    const single = { ...disabled, compartments: { ...disabled.compartments, rows: 1, columns: 1 } };
    const built = buildBin(kernel, disabled, quality);
    const baseline = buildBin(kernel, single, quality);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.volume()).toBeCloseTo(baseline.solid.volume(), 6);
    expect(arena.track(built.solid.subtract(baseline.solid)).volume()).toBeLessThan(1e-6);
    expect(built.solid.decompose().map(part => arena.track(part))).toHaveLength(1);
    const enabled = buildBin(kernel, { ...disabled, compartments: { ...disabled.compartments, enabled: true } }, quality);
    expect(enabled.solid.volume()).toBeGreaterThan(built.solid.volume());
    expect(extractPrintableMeshData(kernel, enabled.solid).indices.length).toBeGreaterThan(0);
  }
});


it.each([
  { lip: "standard" }, { lip: "none" },
  ...(["x", "y"] as const).flatMap(axis => [-20, 20].map(angleDeg => ({ lip: "none", wallSlant: { axis, angleDeg } }))),
  { lip: "none", wallSlant: { axis: "y", angleDeg: 20, side: "positive" } },
])("colors divider tops at their own height without changing geometry: %j", extra => {
  const bin = spec({ ...extra, compartments: { rows: 2, columns: 3, scoop: true },
    labelTab: { wall: "south", scope: "compartments", width: "full" } });
  const options = { floorInsertThicknessMm: 0.6, rimInsertThicknessMm: 0.8 };
  const off = buildBinWithCutouts(kernel, bin, null, quality, options);
  const on = buildBinWithCutouts(kernel, bin, null, quality, { ...options, colorDividerTops: true });
  const top = 7 + compartmentHeightMm(bin);
  const layout = compartmentLayout(bin);
  for (const [x, y] of [[10, layout.rowCenters[0]], [layout.columnCenters[0], 15]]) {
    for (const [z, colored] of [[top - 0.2, true], [top - 1, false]] as const) {
      const p = wallSlantPointMm(bin, { x, y }, z);
      const sample = probe(p.x, p.y, z);
      expect(arena.track(on.materialParts!.stackingRim!.intersect(sample)).volume()).toBeCloseTo(colored ? 0.001 : 0, 6);
      expect(arena.track(off.materialParts!.stackingRim!.intersect(sample)).volume()).toBeCloseTo(0, 6);
      expect(arena.track(on.materialParts!.body.intersect(sample)).volume()).toBeCloseTo(colored ? 0 : 0.001, 6);
    }
  }
  expect(on.solid.volume()).toBeCloseTo(off.solid.volume(), 7);
  const parts = [on.materialParts!.body, on.materialParts!.pocketFloors!, on.materialParts!.stackingRim!];
  expect(parts.reduce((sum, part) => sum + part.volume(), 0)).toBeCloseTo(on.solid.volume(), 4);
  for (let i = 0; i < parts.length; i++) {
    expect(parts[i].status()).toBe("NoError");
    expect(extractPrintableMeshData(kernel, parts[i]).indices.length).toBeGreaterThan(0);
    for (let j = i + 1; j < parts.length; j++) expect(Math.abs(arena.track(parts[i].intersect(parts[j])).volume())).toBeLessThan(1e-5);
  }
});

it("keeps scoop-only, disabled, solid-fill and rim-disabled designs unchanged", () => {
  for (const extra of [
    { compartments: { scoop: true } },
    { compartments: { enabled: false, rows: 2, columns: 3, scoop: true } },
    { fill: "solid", compartments: { rows: 2, columns: 3 } },
  ]) {
    const bin = spec(extra);
    const off = buildBinWithCutouts(kernel, bin, null, quality, { rimInsertThicknessMm: 0.8 });
    const on = buildBinWithCutouts(kernel, bin, null, quality, { rimInsertThicknessMm: 0.8, colorDividerTops: true });
    expect(on.materialParts!.stackingRim!.volume()).toBeCloseTo(off.materialParts!.stackingRim!.volume(), 7);
  }
  expect(buildBinWithCutouts(kernel, spec({ compartments: { rows: 2 } }), null, quality, { colorDividerTops: true }).materialParts).toBeNull();
});

it("clips deep divider color to a short custom bin without painting the floor or missing cells", () => {
  const bin = spec({ gridX: 2, gridY: 2, heightUnits: 2, compartments: { rows: 3, columns: 3, scoop: true },
    footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
  const result = buildBinWithCutouts(kernel, bin, null, quality, { floorInsertThicknessMm: 0.6, rimInsertThicknessMm: 7.35, colorDividerTops: true });
  expect(result.materialParts!.stackingRim!.status()).toBe("NoError");
  expect(Math.abs(arena.track(result.materialParts!.stackingRim!.subtract(result.solid)).volume())).toBeLessThan(1e-5);
  expect(Math.abs(arena.track(result.materialParts!.stackingRim!.intersect(result.materialParts!.pocketFloors!)).volume())).toBeLessThan(1e-5);
  expect(extractPrintableMeshData(kernel, result.materialParts!.body).indices.length).toBeGreaterThan(0);
});
