// Shared fixtures and lifecycle hooks for the matching test suites.
import { expect } from "vitest";
import { loadManifold } from "@/lib/manifold/runtime";
import type { HandlerContext } from "@/lib/worker/host";
import type { TransferableResult } from "@/lib/worker/host";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import {
  BUILD_BIN_METHOD,
  BUILD_FIT_CHECK_METHOD,
  BUILD_SURFACE_FIT_CHECK_METHOD,
  type BuildBinRequest,
  type BuildBinResult,
  type BuildFitCheckRequest,
  type BuildFitCheckResult,
  type BuildSurfaceFitCheckRequest,
  type BuildSurfaceFitCheckResult,
} from "./worker-api";

/**
 * The handlers are exercised directly with the real WASM — the RPC transport
 * (supersede, cancel wire format, transferables in flight) already has its
 * own suite in lib/worker/client.test.ts.
 */

type BuildHandler = (
  payload: BuildBinRequest,
  context: HandlerContext,
) => Promise<TransferableResult<BuildBinResult>>;

function getHandler(): BuildHandler {
  return createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as unknown as BuildHandler;
}

function previewMeshVolume(mesh: BuildBinResult["mesh"]): number {
  let sixTimesVolume = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const [a, b, c] = Array.from(mesh.indices.subarray(index, index + 3), vertex =>
      mesh.positions.subarray(vertex * 3, vertex * 3 + 3));
    sixTimesVolume += a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sixTimesVolume / 6;
}

type FitCheckHandler = (
  payload: BuildFitCheckRequest,
  context: HandlerContext,
) => Promise<TransferableResult<BuildFitCheckResult>>;

function getFitCheckHandler(): FitCheckHandler {
  return createBinWorkerHandlers(loadManifold)[
    BUILD_FIT_CHECK_METHOD
  ] as unknown as FitCheckHandler;
}

type SurfaceFitCheckHandler = (
  payload: BuildSurfaceFitCheckRequest,
  context: HandlerContext,
) => Promise<TransferableResult<BuildSurfaceFitCheckResult>>;

function getSurfaceFitCheckHandler(): SurfaceFitCheckHandler {
  return createBinWorkerHandlers(loadManifold)[
    BUILD_SURFACE_FIT_CHECK_METHOD
  ] as unknown as SurfaceFitCheckHandler;
}

function context(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    signal: new AbortController().signal,
    progress: () => {},
    ...overrides,
  };
}

function nonManifoldEdgeCount(mesh: BuildBinResult["mesh"]): number {
  // Only preview normal properties split physical vertices. Printable 3MF
  // topology must retain distinct vertex identities at touching components.
  const weldPositions = mesh.normals !== null;
  const vertexKey = (index: number) => weldPositions
    ? mesh.positions.subarray(index * 3, index * 3 + 3).join(",")
    : String(index);
  const edgeCounts = new Map<string, { count: number; direction: number }>();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = mesh.indices.subarray(offset, offset + 3);
    for (const [a, b] of [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ]) {
      const start = vertexKey(a);
      const end = vertexKey(b);
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      const edge = edgeCounts.get(key) ?? { count: 0, direction: 0 };
      edge.count++;
      edge.direction += start < end ? 1 : -1;
      edgeCounts.set(key, edge);
    }
  }
  return [...edgeCounts.values()].filter(edge => edge.count !== 2 || edge.direction !== 0).length;
}

function printableMeshVolume(mesh: BuildBinResult["mesh"]): number {
  let total = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = Array.from(mesh.indices.subarray(i, i + 3), n => mesh.positions.subarray(n * 3, n * 3 + 3));
    const u = Array.from(b, (v, j) => v - a[j]), v = Array.from(c, (n, j) => n - a[j]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    expect(Math.hypot(...cross), `triangle ${JSON.stringify([Array.from(a),Array.from(b),Array.from(c)])}`).toBeGreaterThan(0);
    total += (a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2]) / 6;
  }
  expect(nonManifoldEdgeCount(mesh)).toBe(0);
  return total;
}

const REQUEST: BuildBinRequest = {
  spec: { gridX: 1, gridY: 1, heightUnits: 2 },
  quality: { circularSegments: 16 },
};

export {
  BuildHandler,
  getHandler,
  previewMeshVolume,
  FitCheckHandler,
  getFitCheckHandler,
  SurfaceFitCheckHandler,
  getSurfaceFitCheckHandler,
  context,
  nonManifoldEdgeCount,
  printableMeshVolume,
  REQUEST,
};
