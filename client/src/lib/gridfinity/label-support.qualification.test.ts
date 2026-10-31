import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData, type MeshData } from "@/lib/mesh/mesh-data";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { parseBinSpec } from "@shared/gridfinity/types";
import { validateBinSpec } from "@shared/gridfinity/validate";
import { buildBin, buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";

let wasm: Awaited<ReturnType<typeof loadManifold>>;
let arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());

/** Surface angles measured from horizontal in the exported, deformed mesh. */
function downwardFaces(mesh: MeshData, minimumZ = 7.001) {
  const faces: { angle: number; area: number }[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const p = [0, 1, 2].map(j => [0, 1, 2].map(k => mesh.positions[mesh.indices[i + j] * 3 + k]));
    if (Math.max(...p.map(v => v[2])) < minimumZ) continue;
    const u = p[1].map((v, j) => v - p[0][j]), v = p[2].map((v, j) => v - p[0][j]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n);
    if (n[2] < -1e-6 && length > 1e-6) faces.push({ angle: Math.acos(-n[2] / length) * 180 / Math.PI, area: length / 2 });
  }
  return faces;
}

function expectClosedStl(mesh: MeshData) {
  const bytes = new DataView(writeBinarySTL(mesh)), edges = new Map<string, number>();
  for (let i = 0; i < bytes.getUint32(80, true); i++) {
    const vertices = [0, 1, 2].map(j => [0, 1, 2].map(k => bytes.getFloat32(84 + i * 50 + 12 + j * 12 + k * 4, true)).join(","));
    for (let j = 0; j < 3; j++) {
      const edge = [vertices[j], vertices[(j + 1) % 3]].sort().join("/");
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  expect([...edges].filter(([, count]) => count !== 2).slice(0, 5)).toEqual([]);
}

describe("label underside support after wall slant", () => {
  it.each([0, 0.4])("keeps the Metric Screw Storage label undersides at 36 degrees with %s mm recess", recessMm => {
    // Geometry from the reported print: six south-facing tabs, a 30-degree
    // lean and an 8 mm floor fillet. The old mesh had 27.1-degree undersides.
    const spec = parseBinSpec({ gridX: 4, gridY: 4, gridPitch: "half", heightUnits: 5.5, lip: "none", fill: "none",
      wallSlant: { axis: "y", angleDeg: 30 }, bottomFilletRadiusMm: 8,
      compartments: { enabled: true, rows: 2, columns: 3, dividerThicknessMm: 1.2 },
      labelTab: { wall: "south", autoWall: true, scope: "compartments", width: "full", recessMm } });
    const built = buildBin(kernel, spec, EXPORT_QUALITY), mesh = extractPrintableMeshData(kernel, built.solid);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(p => arena.track(p)).filter(p => p.volume() > 1e-6)).toHaveLength(1);
    const faces = downwardFaces(mesh, 15.01);
    expect(Math.min(...faces.map(f => f.angle))).toBeCloseTo(36, 2);
    expect(faces.filter(f => f.angle < 36.01).reduce((sum, f) => sum + f.area, 0)).toBeGreaterThan(4000);
    expectClosedStl(mesh);
  });

  it.each(["x", "y"] as const)("supports both signs and single-wall %s slants, with or without dividers", axis => {
    for (const side of ["both", "positive", "negative"] as const) for (const angleDeg of [-30, 30]) {
      for (const scope of ["outer", "compartments"] as const) for (const heightUnits of [2, 6]) {
        const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits, lip: "none", fill: "none",
          wallSlant: { axis, side, angleDeg }, compartments: { rows: 2, columns: 2 },
          labelTab: { wall: axis === "y" ? angleDeg > 0 ? "south" : "north" : angleDeg > 0 ? "west" : "east",
            scope, width: "center" } });
        const built = buildBin(kernel, spec, PREVIEW_QUALITY);
        expect(built.solid.status()).toBe("NoError");
        const faces = downwardFaces(extractPrintableMeshData(kernel, built.solid));
        // Boolean joins can expose sub-nozzle slivers at the 0.02 mm mounting
        // overlap. A substantial shelf face must retain the support angle.
        expect(faces.filter(f => f.angle < 35.95).reduce((sum, f) => sum + f.area, 0), `${side}/${angleDeg}/${scope}/${heightUnits}`).toBeLessThan(0.1);
      }
    }
  });

  it("extends a shallow label support to the floor without shrinking its top", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 2, fill: "none", lip: "none",
      wallSlant: { axis: "y", angleDeg: 30 }, labelTab: { wall: "south", width: "full" } });
    const built = buildBin(kernel, spec, EXPORT_QUALITY);
    const top = arena.track(built.solid.slice(13.8));
    const oldTopSpec = { ...spec, wallSlant: { axis: "y" as const, angleDeg: -30 } };
    const mirrored = buildBin(kernel, oldTopSpec, EXPORT_QUALITY);
    expect(top.area()).toBeCloseTo(arena.track(mirrored.solid.slice(13.8)).area(), 4);
    expect(built.solid.decompose().map(p => arena.track(p))).toHaveLength(1);
    expectClosedStl(extractPrintableMeshData(kernel, built.solid));
  });

  it("warns when the wall itself is too steep for the nominal support angle", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "none",
      wallSlant: { axis: "y", angleDeg: 60 }, labelTab: { wall: "south", width: "full", scope: "compartments" } });
    expect(validateBinSpec(spec).issues.some(i => i.code === "label-tab-overhang" && i.severity === "warning")).toBe(true);
    expect(validateBinSpec({ ...spec, wallSlant: { axis: "y", angleDeg: 30 } }).issues.some(i => i.code === "label-tab-overhang")).toBe(false);
  });

  it("keeps floor-reaching supports in body material without a bottom fillet", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 2, fill: "none", lip: "none",
      wallSlant: { axis: "y", angleDeg: 30 }, labelTab: { wall: "south", width: "full" } });
    const built = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY, { floorInsertThicknessMm: 0.6 });
    const probe = arena.track(arena.track(kernel.Manifold.cube([0.1, 0.1, 0.1], true)).translate([0, -39.8, 6.8]));
    const { body, pocketFloors } = built.materialParts!;
    expect(arena.track(body.intersect(probe)).volume()).toBeCloseTo(0.001, 6);
    expect(arena.track(pocketFloors!.intersect(probe)).volume()).toBeCloseTo(0, 7);
    expect(body.volume() + pocketFloors!.volume()).toBeCloseTo(built.solid.volume(), 4);
  });

  it.each([false, true])("keeps clipped labels, scoops and fillets closed (closing=%s)", closing => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 5, lip: "none", fill: "none",
      footprint: closing ? { kind: "rectangle" } : { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      wallSlant: closing ? { axis: "x", angleDeg: -80, side: "positive" } : { axis: "y", angleDeg: 30 },
      bottomFilletRadiusMm: 4, compartments: { rows: 2, columns: 2, scoop: true },
      labelTab: { wall: closing ? "east" : "south", scope: "compartments", width: "full" } });
    const built = buildBin(kernel, spec, EXPORT_QUALITY);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(p => arena.track(p)).filter(p => p.volume() > 1e-6)).toHaveLength(1);
    expectClosedStl(extractPrintableMeshData(kernel, built.solid));
  });
});
