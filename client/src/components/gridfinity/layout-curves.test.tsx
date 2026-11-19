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

it("deletes only the selected point of a placed pocket after a box is interrupted", () => {
  const pocket = createBasicPocket("rectangle", { x: -20, y: -10 }, { x: 20, y: 10 }, "selection-pocket")!;
  const cutout = { ...pocket.cutout, rotationDeg: 37, mirrored: true, scaleX: 1.7, scaleY: 0.8 };
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
  React.act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-edit-curves"]')!.click());
  const select = [...host.querySelectorAll("button")].find(b => b.textContent === "Select points")!;
  select.focus();
  React.act(() => select.click());
  expect(document.activeElement).toBe(select);
  const ring = pocket.shape.outlineMm[0].outer;
  const screen = ring.map(p => binToCanvas(transformPointPlacement(p, cutout), spec));
  pointer(svg, "pointerdown", screen[0].x, screen[0].y);
  pointer(svg, "pointerup", screen[0].x, screen[0].y);
  expect(document.activeElement).toBe(svg);
  const history = store.history;
  const left = Math.min(...screen.map(p => p.x)) - 60, top = Math.min(...screen.map(p => p.y)) - 60;
  const right = Math.max(...screen.map(p => p.x)) + 60, bottom = Math.max(...screen.map(p => p.y)) + 60;
  pointer(svg, "pointerdown", left, top);
  pointer(svg, "pointermove", right, bottom);
  expect(svg.querySelectorAll('[data-testid="selected-outline-point"]')).toHaveLength(ring.length);
  pointer(svg, "pointercancel", right, bottom);
  pointer(svg, "pointerup", right, bottom);
  expect(svg.querySelectorAll('[data-testid="selected-outline-point"]')).toHaveLength(1);
  expect(store.history).toBe(history);
  React.act(() => svg.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })));
  expect(store.cutouts).toHaveLength(1);
  const revised = library.shapes.find(shape => shape.id === store.cutouts[0].shapeId)!;
  expect(revised.curvesMm![0].outer.map(a => a.point)).toEqual(ring.slice(1));
  expect(store.history.index).toBe(history.index + 1);
});

it.each(["auto", "range"])("applies %s fitting once in Bin and restores the original points on undo and project reload", mode => {
  const pocket = createBasicPocket("circle", { x: -20, y: -20 }, { x: 20, y: 20 }, "fit-pocket")!;
  const cutout = { ...pocket.cutout, rotationDeg: 37, mirrored: true, scaleX: 1.7, scaleY: 0.8 };
  React.act(() => {
    library.storeShape(pocket.shape);
    store.dispatch({ type: "HYDRATE", spec: parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6 }), cutouts: [cutout], fingerHoles: [] });
    store.dispatch({ type: "SELECT_CUTOUT", id: cutout.id });
    store.dispatch({ type: "SET_EDITOR_MODE", editorMode: "contour" });
  });
  const click = (name: string) => React.act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === name)!.click());
  const before = store.history.stack.length;
  expect(library.shapes[0].curvesMm).toBeUndefined();
  click("Bend edges"); click(mode === "auto" ? "Auto-fit contour" : "Select a section");
  if (mode === "range") {
    for (const [label, value] of [["First fit point", "0"], ["Last fit point", "16"]]) React.act(() => {
      const select = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
      select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click("Preview fit");
  }
  expect(host.querySelector('[data-testid="curve-fit-preview"]')).not.toBeNull();
  expect(store.history.stack).toHaveLength(before); expect(library.shapes).toHaveLength(1);
  click("Apply fit");
  const revised = library.shapes.find(s => s.id === store.cutouts[0].shapeId)!;
  expect(revised.id).not.toBe(pocket.shape.id); expect(revised.curvesMm).toBeDefined();
  expect(revised.curvesMm![0].outer.length).toBeLessThan(pocket.shape.outlineMm[0].outer.length);
  expect(store.history.stack).toHaveLength(before + 1);
  React.act(() => store.dispatch({ type: "UNDO" })); expect(store.cutouts[0].shapeId).toBe(pocket.shape.id);
  React.act(() => store.dispatch({ type: "REDO" })); expect(store.cutouts[0].shapeId).toBe(revised.id);
  const project = parseProjectDoc(JSON.parse(JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION, name: "Fitted",
    shapes: library.shapes, spec: store.spec, cutouts: store.cutouts, fingerHoles: store.fingerHoles, history: store.history })))!;
  expect(project).not.toBeNull(); expect(project.shapes.find(s => s.id === revised.id)!.curvesMm).toEqual(revised.curvesMm);
  expect(project.history!.stack[project.history!.index - 1].doc.cutouts[0].shapeId).toBe(pocket.shape.id);
});
