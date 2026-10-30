import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseCutoutPlacement, tracedShapeSchema, type CutoutPlacement } from "@shared/gridfinity/cutout";
import { buildBinWithCutouts, PREVIEW_QUALITY, EXPORT_QUALITY } from "./bin";
import { extractMeshData, extractPrintableMeshData, type MeshData } from "@/lib/mesh/mesh-data";
import { expectPrintableTopology, signedMeshVolume } from "@/lib/mesh/mesh-contract.test-helpers";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());

const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 2.5, fill: "solid", lip: "standard" });
const shape = tracedShapeSchema.parse({ id: "rectangle", name: "Rectangle", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -12, minY: -3, maxX: 12, maxY: 3 },
  outlineMm: [{ outer: [{ x: -12, y: -3 }, { x: 12, y: -3 }, { x: 12, y: 3 }, { x: -12, y: 3 }], holes: [] }] });
const pocket = parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 0, y: 0 },
  depth: { mode: "mm", value: 5 }, elevationMm: 11.3,
  insertionMode: "vertical", colorFloorAxis: "insertion", colorCoverage: "floor",
  topFilletMm: 0, bottomFilletMm: 0, cornerRoundMm: 0 });

/** A rotated rectangle's lower envelope in bin coordinates. This excludes the
 * legitimate vertical edges of the thin lining BELOW its sloping floor. */
function floorHeight(x: number, tilt: number, depth = 5): number {
  if (tilt === 0) return 11.3 + 5 - depth;
  const angle = Math.abs(tilt) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const rotatedX = Math.sign(tilt) * x;
  return Math.max(11.3 + 12*s + 5*c - depth/c - Math.tan(angle)*rotatedX,
    11.3 + (rotatedX-(12*c-5*s))/Math.tan(angle));
}

function exposedWallArea(mesh: MeshData, tilt: number, split = false): number {
  const p = mesh.positions;
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map(j => mesh.indices[i+j] * 3);
    const center = [0, 1, 2].map(j => (p[a+j]+p[b+j]+p[c+j])/3);
    const outerWall = Math.abs(Math.abs(center[1])-3) < 1e-4;
    const internalWall = split && Math.abs(center[1]) < 1e-4;
    if (!outerWall && !internalWall) continue;
    // The shelf's thin lining can expose its own edge immediately below the
    // shallow floor. It must never extend farther down the internal wall.
    if (internalWall) {
      if (center[2] <= floorHeight(center[0], tilt) + .002
        || center[2] >= floorHeight(center[0], tilt, 3) - .602) continue;
    } else {
      const depth = split && center[1] < 0 ? 3 : 5;
      if (center[2] <= floorHeight(center[0], tilt, depth) + .002) continue;
    }
    const u = [0, 1, 2].map(j => p[b+j]-p[a+j]), v = [0, 1, 2].map(j => p[c+j]-p[a+j]);
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const length = Math.hypot(...n);
    if (Math.abs(n[2]) < length * 1e-5) area += length / 2;
  }
  return area;
}

function verify(p: CutoutPlacement) {
  const layout = { shapesById: new Map([[shape.id, shape]]), cutouts: [p], fingerHoles: [] };
  for (const quality of [PREVIEW_QUALITY, EXPORT_QUALITY]) {
    const plain = buildBinWithCutouts(kernel, spec, layout, quality);
    const colored = buildBinWithCutouts(kernel, spec, layout, quality, { floorInsertThicknessMm: .6 });
    const parts = colored.materialParts!;
    expect(colored.solid.volume()).toBeCloseTo(plain.solid.volume(), 6);
    expect(parts.pocketFloors!.volume()).toBeGreaterThan(1);
    expect(arena.track(parts.body.intersect(parts.pocketFloors!)).volume()).toBeLessThan(.0001);
    expect(parts.body.volume()+parts.pocketFloors!.volume()).toBeCloseTo(plain.solid.volume(), 5);
    // The old full-height translated mask had large, effectively zero-volume
    // wall sheets. Volume assertions alone miss what the user sees rendered.
    expect(exposedWallArea(extractMeshData(kernel, parts.pocketFloors!), p.tilt?.yDeg ?? 0, !!p.split)).toBeLessThan(.01);
    if (quality === EXPORT_QUALITY) {
      const printable = [parts.body, parts.pocketFloors!].map(part => extractPrintableMeshData(kernel, part));
      printable.forEach((part, i) => expectPrintableTopology(part, `material ${i}`));
      expect(exposedWallArea(printable[1], p.tilt?.yDeg ?? 0, !!p.split)).toBeLessThan(.01);
      expect(Math.abs(printable.reduce((v, mesh) => v+signedMeshVolume(mesh), 0)-plain.solid.volume())).toBeLessThan(.05);
    }
  }
}

it.each([0, .7, 30, 60, -30])("keeps vertical drop-in walls out of floor color at %s degrees", tilt => {
  verify({ ...pocket, tilt: { xDeg: 0, yDeg: tilt } });
});

it("uses the same finite floor band for an explicit bin-vertical reference and axial clearance", () => {
  verify({ ...pocket, tilt: { xDeg: 0, yDeg: 30 }, insertionMode: "axis", insertionAxis: "z", colorFloorAxis: "vertical" });
});

it("keeps split seats and their internal wall out of the full-height floor mask", () => {
  verify({ ...pocket, split: { boundary: [{ x: -13, y: 0 }, { x: 13, y: 0 }],
    depths: [{ mode: "mm", value: 5 }, { mode: "mm", value: 3 }] } });
});

it("preserves rounded floors and top rims while excluding vertical drop-in walls", () => {
  verify({ ...pocket, tilt: { xDeg: 0, yDeg: 30 }, bottomFilletMm: .5, topFilletMm: .5 });
});
