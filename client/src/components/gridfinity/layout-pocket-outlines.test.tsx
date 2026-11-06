// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CutoutPlacement } from "@shared/gridfinity/cutout";
import type { PocketGeometry } from "@/lib/gridfinity/worker-api";
import { parseBinSpec } from "@shared/gridfinity/types";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { ShapeLibraryProvider, useShapeLibrary, type ShapeLibrary } from "@/state/shape-library";
import { PanelProvider } from "@/components/layout/panel-context";
import { LayoutCanvas } from "./layout-canvas";

const requests = vi.hoisted(() => [] as { cutout: CutoutPlacement; resolve: (geometry: PocketGeometry) => void; reject: () => void }[]);
vi.mock("@/lib/gridfinity/pocket-geometry-client", () => ({
  retainPocketGeometryWorker: () => () => {},
  requestPocketGeometry: (_shape: unknown, cutout: CutoutPlacement) => new Promise<PocketGeometry>((resolve, reject) => {
    requests.push({ cutout, resolve, reject: () => reject(new Error("Outline failed")) });
  }),
}));
vi.mock("@/hooks/use-element-size", () => ({ useElementSize: () => [vi.fn(), { width: 800, height: 600 }] }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false, useHasTouchInput: () => false, getMobileLayoutSnapshot: () => false }));
vi.mock("@/state/experimental-features", () => ({ useExperimentalFeatures: () => ({ enabled: true }) }));

let store: BinStore, library: ShapeLibrary, host: HTMLDivElement, root: ReturnType<typeof createRoot>;
function Scene() { store = useBin(); library = useShapeLibrary(); return <LayoutCanvas />; }
const pocket = createBasicPocket("rectangle", { x: -4, y: -15 }, { x: 4, y: 15 }, "tool")!;
const geometry: PocketGeometry = { full: pocket.shape.outlineMm, opening: pocket.shape.outlineMm,
  mesh: { positions: new Float32Array(), indices: new Uint32Array(), normals: null }, edges: [] };
const path = () => host.querySelector<SVGPathElement>('path[data-cutout-id]')!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear(); requests.length = 0;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  React.act(() => root.render(<PanelProvider><ShapeLibraryProvider><BinProvider><Scene /></BinProvider></ShapeLibraryProvider></PanelProvider>));
  React.act(() => {
    library.storeShape(pocket.shape);
    store.dispatch({ type: "HYDRATE", spec: parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6 }), cutouts: [{ ...pocket.cutout, elevationMm: 7 }], fingerHoles: [] });
  });
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function edit(patch: Partial<CutoutPlacement>) {
  React.act(() => store.dispatch({ type: "UPDATE_CUTOUT", id: pocket.cutout.id, patch }));
}

it("keeps a visible current-pose guide during moves/rotation and ignores an obsolete opening", async () => {
  expect(path().getAttribute("d")).not.toBe("");
  expect(Number(path().getAttribute("stroke-width"))).toBeGreaterThan(0);
  expect(path().dataset.placementGuide).toBe("true");
  expect(host.textContent).toContain("Updating pocket outlines");
  await React.act(async () => requests.at(-1)!.resolve(geometry));
  expect(path().dataset.placementGuide).toBeUndefined();
  expect(host.textContent).not.toContain("Updating pocket outlines");
  const original = path().getAttribute("d");
  edit({ position: { x: 15, y: 0 } });
  const moving = path().getAttribute("d");
  expect(moving).not.toBe(""); expect(moving).not.toBe(original);
  const previous = requests.at(-1)!;
  edit({ rotationDeg: 90 });
  expect(path().getAttribute("d")).not.toBe(moving);
  await React.act(async () => previous.resolve(geometry));
  expect(path().dataset.placementGuide).toBe("true");
  expect(host.querySelector('[data-testid="layout-canvas"]')?.getAttribute("aria-busy")).toBe("true");
  // A genuinely empty opening must stay empty after completion (e.g. raised above the fill).
  await React.act(async () => requests.at(-1)!.resolve({ ...geometry, opening: [] }));
  expect(path().getAttribute("d")).toBe("");
  expect(path().dataset.placementGuide).toBeUndefined();
  expect(host.textContent).not.toContain("Updating pocket outlines");
});

it("keeps the guide after a failed outline and clears the busy message", async () => {
  await React.act(async () => requests.at(-1)!.reject());
  expect(path().getAttribute("d")).not.toBe("");
  expect(path().dataset.placementGuide).toBe("true");
  expect(host.textContent).toContain("Pocket outlines unavailable");
  expect(host.textContent).not.toContain("Updating pocket outlines");
  edit({ elevationMm: 8 });
  expect(host.textContent).toContain("Updating pocket outlines");
  await React.act(async () => requests.at(-1)!.resolve(geometry));
  expect(path().dataset.placementGuide).toBeUndefined();
});
