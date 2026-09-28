// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { usePocketGeometry } from "./use-pocket-geometry";

const build = vi.hoisted(() => ({ pending: [] as (() => void)[], resolve: vi.fn() }));
vi.mock("@/lib/manifold/runtime", () => ({ withKernel: (fn: () => unknown) => new Promise(resolve => {
  build.pending.push(() => resolve(fn()));
}) }));
vi.mock("@/lib/gridfinity/pocket-geometry", () => ({ resolvedPocketGeometry: build.resolve }));
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); build.pending = []; vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("shares derived geometry and invalidates it on pose, shape and fill edits without publishing stale results", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container);
  cleanup.push(() => React.act(() => root.unmount()));
  const spec = parseBinSpec({ gridX:3, gridY:3, heightUnits:6, fill:"solid" });
  const shape: TracedShape = { id:"s", name:"Tool", sourceMmPerPx:1, pointCount:4,
    bboxMm:{minX:0,minY:0,maxX:10,maxY:10}, outlineMm:[{outer:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],holes:[]}] };
  const pocket = parseCutoutPlacement({id:"p",shapeId:"s",position:{x:0,y:0},elevationMm:7});
  const shapes = new Map([[shape.id,shape]]), cutouts = [pocket];
  const mesh = {positions:new Float32Array(),indices:new Uint32Array(),normals:null};
  build.resolve.mockImplementation((_kernel, _shape, placement) => ({full:[],opening:[],mesh, elevation:placement.elevationMm}));
  let current: ReturnType<typeof usePocketGeometry>[] = [];
  function View({ items = cutouts, sources = shapes, bin = spec }) {
    const a = usePocketGeometry(items, sources, bin), b = usePocketGeometry(items, sources, bin);
    current = [a,b];
    return null;
  }
  React.act(() => root.render(<View />));
  await React.act(async () => build.pending.splice(0).forEach(fn => fn()));
  expect(build.resolve).toHaveBeenCalledTimes(1);
  expect(current[0].get("p")).toBe(current[1].get("p"));
  const first = current[0].get("p");
  const moved = [{...pocket,elevationMm:12}];
  React.act(() => root.render(<View items={moved} />));
  expect(current[0].size).toBe(0);
  const obsolete = build.pending.splice(0);
  const latest = [{...pocket,elevationMm:20}];
  React.act(() => root.render(<View items={latest} />));
  await React.act(async () => build.pending.splice(0).forEach(fn => fn()));
  const newest = current[0].get("p");
  expect(newest).not.toBe(first);
  expect(newest).toHaveProperty("elevation",20);
  await React.act(async () => obsolete.forEach(fn => fn()));
  expect(current[0].get("p")).toBe(newest);
  const changedShapes = new Map([[shape.id,{...shape,outlineMm:[]}]]);
  React.act(() => root.render(<View items={latest} sources={changedShapes} />));
  await React.act(async () => build.pending.splice(0).forEach(fn => fn()));
  expect(current[0].get("p")).not.toBe(newest);
  const reshaped = current[0].get("p");
  React.act(() => root.render(<View items={latest} sources={changedShapes} bin={{...spec,fillHeightPercent:50}} />));
  await React.act(async () => build.pending.splice(0).forEach(fn => fn()));
  expect(current[0].get("p")).not.toBe(reshaped);
  React.act(() => root.render(<View items={[]} />));
  expect(current[0].size).toBe(0);
});
