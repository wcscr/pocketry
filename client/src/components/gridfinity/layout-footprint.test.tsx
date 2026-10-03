// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { binToCanvas, fingerHoleSchema } from "@shared/gridfinity/cutout";
import { cellCenterMm, type GridCell } from "@shared/gridfinity/footprint";
import { gridPitchMm } from "@shared/gridfinity/standard";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { parseBinSpec, type BinSpec } from "@shared/gridfinity/types";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { ShapeLibraryProvider, useShapeLibrary, type ShapeLibrary } from "@/state/shape-library";
import { LayoutCanvas } from "./layout-canvas";
import { PanelProvider } from "@/components/layout/panel-context";

vi.mock("@/hooks/use-element-size", () => ({ useElementSize: () => [vi.fn(), { width: 800, height: 600 }] }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/state/experimental-features", () => ({ useExperimentalFeatures: () => ({ enabled: true }) }));

let store: BinStore;
let library: ShapeLibrary;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Scene() {
  store = useBin(); library = useShapeLibrary();
  return <LayoutCanvas />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  React.act(() => root.render(<PanelProvider><ShapeLibraryProvider><BinProvider><Scene /></BinProvider></ShapeLibraryProvider></PanelProvider>));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function load(gridPitch: BinSpec["gridPitch"] = "full") {
  const pocket = createBasicPocket("rectangle", { x: -3, y: -3 }, { x: 3, y: 3 }, "pocket")!;
  const text = surfaceTextSchema.parse({ id: "text", name: "Socket label", text: "SAE", position: { x: 0, y: 6 }, rotationDeg: 23 });
  const hole = fingerHoleSchema.parse({ id: "finger", center: { x: 0, y: -5 }, diameterMm: 6 });
  const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, gridPitch, surfaceTexts: [text], labelTab: { edge: { cell: { x: 0, y: 0 }, side: "south" } } });
  React.act(() => {
    library.storeShape(pocket.shape);
    store.dispatch({ type: "HYDRATE", spec, cutouts: [pocket.cutout], fingerHoles: [hole] });
    store.dispatch({ type: "SET_EDITOR_MODE", editorMode: "footprint" });
  });
  const svg = host.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
  Object.defineProperty(svg.querySelector("g")!, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
  Object.defineProperty(svg, "createSVGPoint", { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) });
  return { spec, cutouts: [pocket.cutout], fingerHoles: [hole] };
}
function clickCell(cell: GridCell) {
  const center = binToCanvas(cellCenterMm(store.spec, cell), store.spec);
  const pitch = gridPitchMm(store.spec.gridPitch);
  const target = [...host.querySelectorAll<SVGRectElement>('[data-testid="footprint-cell"], [data-testid="footprint-halo-cell"]')].find(rect =>
    Math.abs(Number(rect.getAttribute("x")) + pitch / 2 - center.x) < 1e-6 && Math.abs(Number(rect.getAttribute("y")) + pitch / 2 - center.y) < 1e-6)!;
  expect(target).toBeDefined();
  React.act(() => {
    const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: center.x, clientY: center.y });
    Object.defineProperty(event, "pointerId", { value: 1 });
    target.dispatchEvent(event);
  });
}
const cases = [
  { side: "east", cell: { x: 2, y: 1 }, shift: { x: 0, y: 0 }, delta: { x: -1, y: 0 }, grid: { x: 3, y: 2 } },
  { side: "west", cell: { x: -1, y: 1 }, shift: { x: 1, y: 0 }, delta: { x: 1, y: 0 }, grid: { x: 3, y: 2 } },
  { side: "north", cell: { x: 1, y: 2 }, shift: { x: 0, y: 0 }, delta: { x: 0, y: -1 }, grid: { x: 2, y: 3 } },
  { side: "south", cell: { x: 1, y: -1 }, shift: { x: 0, y: 1 }, delta: { x: 0, y: 1 }, grid: { x: 2, y: 3 } },
];
it.each(cases.flatMap(value => (["full", "half", "quarter"] as const).map(pitch => ({ ...value, pitch }))))(
  "keeps every object and anchored cell aligned when growing/shrinking $side at $pitch pitch, with atomic undo", ({ cell, shift, delta, grid, pitch }) => {
    const original = load(pitch);
    const step = gridPitchMm(pitch) / 2;
    const before = store.history.stack.length;
    clickCell(cell);
    expect([store.spec.gridX, store.spec.gridY]).toEqual([grid.x, grid.y]);
    expect(store.cutouts[0].position).toEqual({ x: delta.x * step, y: delta.y * step });
    expect(store.spec.surfaceTexts[0]).toEqual({ ...original.spec.surfaceTexts[0], position: { x: delta.x * step, y: 6 + delta.y * step } });
    expect(store.fingerHoles[0]).toEqual({ ...original.fingerHoles[0], center: { x: delta.x * step, y: -5 + delta.y * step } });
    expect(store.spec.labelTab!.edge!.cell).toEqual(shift);
    expect(store.history.stack.length).toBe(before + 1);
    const expanded = { spec: store.spec, cutouts: store.cutouts, fingerHoles: store.fingerHoles };
    React.act(() => store.dispatch({ type: "UNDO" }));
    expect({ spec: store.spec, cutouts: store.cutouts, fingerHoles: store.fingerHoles }).toEqual(original);
    React.act(() => store.dispatch({ type: "REDO" }));
    expect({ spec: store.spec, cutouts: store.cutouts, fingerHoles: store.fingerHoles }).toEqual(expanded);
    React.act(() => store.dispatch({ type: "SET_EDITOR_MODE", editorMode: "footprint" }));
    clickCell({ x: cell.x + shift.x, y: cell.y + shift.y });
    expect({ spec: store.spec, cutouts: store.cutouts, fingerHoles: store.fingerHoles }).toEqual(original);
    expect(store.history.stack.length).toBe(before + 2);
    React.act(() => store.dispatch({ type: "UNDO" }));
    expect({ spec: store.spec, cutouts: store.cutouts, fingerHoles: store.fingerHoles }).toEqual(expanded);
  },
);
it("keeps all object coordinates unchanged for an edit that retains the grid bounds", () => {
  const original = load();
  clickCell({ x: 1, y: 1 });
  expect(store.spec.footprint.kind).toBe("custom");
  expect([store.spec.gridX, store.spec.gridY]).toEqual([2, 2]);
  expect(store.spec.surfaceTexts).toEqual(original.spec.surfaceTexts);
  expect(store.fingerHoles).toEqual(original.fingerHoles);
  expect(store.cutouts).toEqual(original.cutouts);
  expect(store.spec.labelTab).toEqual(original.spec.labelTab);
  expect(store.history.stack).toHaveLength(2);
});
