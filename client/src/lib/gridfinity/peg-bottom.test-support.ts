// Shared fixtures and lifecycle hooks for the matching test suites.
import { afterEach, beforeAll, expect } from "vitest";
import type { ManifoldToplevel, Mesh } from "manifold-3d";
import { parseBinSpec } from "@shared/gridfinity/types";
import { DEFAULT_PEG_BOTTOM } from "@shared/gridfinity/peg-bottom";
import { Arena } from "@/lib/manifold/arena";
import { loadManifold } from "@/lib/manifold/runtime";

let wasm: ManifoldToplevel;
let arena = new Arena();
beforeAll(async () => { wasm = await loadManifold(); });
afterEach(() => { arena.dispose(); arena = new Arena(); });
const spec = (patch: Record<string, unknown> = {}) => parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 3, lip: "none", pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "sloped", density: 1 }, ...patch });

/** All down-facing faces except build-plate contacts must be 45 degrees or steeper. */
function checkSupportFree(mesh: Mesh, bottom: number, bridgeZ?: number): void {
  let slopes = 0;
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    const points = Array.from(mesh.triVerts.subarray(i, i + 3), v => Array.from(mesh.vertProperties.subarray(v * mesh.numProp, v * mesh.numProp + 3)));
    const [a, b, c] = points;
    const u = b.map((x, j) => x - a[j]), v = c.map((x, j) => x - a[j]);
    const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    if (nz >= -1e-8 || points.every(p => Math.abs(p[2] - bottom) < 1e-5)) continue;
    if (bridgeZ !== undefined && points.every(p => Math.abs(p[2] - bridgeZ) < 1e-5)) continue;
    expect(-nz / Math.hypot(nx, ny), JSON.stringify(points)).toBeLessThanOrEqual(1.00001);
    slopes++;
  }
  expect(slopes).toBeGreaterThan(0);
}

export { wasm, arena, spec, checkSupportFree };
