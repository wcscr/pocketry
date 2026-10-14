import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { binToCanvas, canvasToBin, transformPointPlacement, untransformPointPlacement } from "@shared/gridfinity/cutout";
import { curveControls, evaluateCurve } from "@shared/geometry/curves";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { ShapeLibraryProvider, useShapeLibrary, type ShapeLibrary } from "@/state/shape-library";
import { PanelProvider } from "@/components/layout/panel-context";
import { LayoutCanvas } from "./layout-canvas";

vi.mock("@/hooks/use-element-size", () => ({ useElementSize: () => [vi.fn(), { width: 800, height: 600 }] }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false, useHasTouchInput: () => false, getMobileLayoutSnapshot: () => false }));
vi.mock("@/state/experimental-features", () => ({ useExperimentalFeatures: () => ({ enabled: true }) }));
let store: BinStore, library: ShapeLibrary, host: HTMLDivElement, root: ReturnType<typeof createRoot>;
function Scene() { store = useBin(); library = useShapeLibrary(); return <LayoutCanvas />; }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  React.act(() => root.render(<PanelProvider><ShapeLibraryProvider><BinProvider><Scene /></BinProvider></ShapeLibraryProvider></PanelProvider>));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function pointer(target: Element, type: string, x: number, y: number) {
  React.act(() => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
    target.dispatchEvent(event);
  });
}
it("edits a placed contour in local coordinates, retaining source revisions through undo, redo and saved history", () => {
  const pocket = createBasicPocket("rectangle", { x: -20, y: -10 }, { x: 20, y: 10 }, "curve-pocket")!;
  const cutout = { ...pocket.cutout, position: { x: 7, y: -4 }, rotationDeg: 37, mirrored: true, scaleX: 1.7, scaleY: 0.8 };
  const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6 });
  React.act(() => {
    library.storeShape(pocket.shape);
    store.dispatch({ type: "HYDRATE", spec, cutouts: [cutout], fingerHoles: [] });
    store.dispatch({ type: "SELECT_CUTOUT", id: cutout.id });
    store.dispatch({ type: "SET_EDITOR_MODE", editorMode: "contour" });
  });
  const svg = host.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
  Object.defineProperty(svg.querySelector("g")!, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
  Object.defineProperty(svg, "createSVGPoint", { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) });
  const start = host.querySelector<HTMLButtonElement>('[data-testid="button-edit-curves"]')!;
  expect(start).not.toBeNull(); React.act(() => start.click());
  const edge = host.querySelector('[data-curve-kind="edge"][data-curve-index="0"]')!;
  const ring = pocket.shape.outlineMm[0].outer;
  const midpoint = { x: (ring[0].x + ring[1].x) / 2, y: (ring[0].y + ring[1].y) / 2 };
  const canvas = binToCanvas(transformPointPlacement(midpoint, cutout), spec);
  const end = { x: canvas.x + 4, y: canvas.y - 7 };
  const before = store.history.stack.length;
  pointer(edge, "pointerdown", canvas.x, canvas.y);
  pointer(svg, "pointermove", end.x, end.y);
  expect(library.shapes).toHaveLength(1);
  pointer(svg, "pointerup", end.x, end.y);
  const revised = library.shapes.find(s => s.id === store.cutouts[0].shapeId)!;
  expect(revised.id).not.toBe(pocket.shape.id);
  expect(store.history.stack).toHaveLength(before + 1);
  const bent = evaluateCurve(curveControls(revised.curvesMm![0].outer, 0), 0.5);
  const expected = untransformPointPlacement(canvasToBin(end, spec), cutout);
  expect(bent.x).toBeCloseTo(expected.x, 8); expect(bent.y).toBeCloseTo(expected.y, 8);
  expect(library.shapes.find(s => s.id === pocket.shape.id)).toEqual(pocket.shape);
  React.act(() => store.dispatch({ type: "UNDO" })); expect(store.cutouts[0].shapeId).toBe(pocket.shape.id);
  React.act(() => store.dispatch({ type: "REDO" })); expect(store.cutouts[0].shapeId).toBe(revised.id);
  const saved = parseProjectDoc(JSON.parse(JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION, name: "Curve test",
    shapes: library.shapes, spec: store.spec, cutouts: store.cutouts, fingerHoles: store.fingerHoles, history: store.history })))!;
  expect(saved).not.toBeNull();
  expect(saved.shapes.find(s => s.id === revised.id)!.curvesMm).toEqual(revised.curvesMm);
  expect(saved.history!.stack[saved.history!.index].doc.cutouts[0].shapeId).toBe(revised.id);
});
