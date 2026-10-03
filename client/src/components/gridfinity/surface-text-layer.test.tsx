import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { binToCanvas } from "@shared/gridfinity/cutout";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { SurfaceTextLayer } from "./surface-text-layer";

afterEach(() => vi.unstubAllGlobals());

describe("text dragging", () => {
  it.each(["release", "disable editing", "grab between letters"])("%s commits a text drag once and preserves saved undo history", ending => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("DOMPoint", class { constructor(public x: number, public y: number) {} matrixTransform() { return this; } });
    let store!: BinStore;
    function Scene({ interactive = true }: { interactive?: boolean }) { store = useBin(); return <svg><SurfaceTextLayer interactive={interactive} /></svg>; }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      React.act(() => root.render(<BinProvider><Scene /></BinProvider>));
      const label = surfaceTextSchema.parse({ id: "drag", text: "AB8", position: { x: 0, y: 0 } });
      React.act(() => store.dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: [label] }, historyLabel: "Add text" }));
      const historySize = store.history.stack.length;
      const group = host.querySelector("g")!;
      Object.defineProperty(group, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
      const path = host.querySelector(ending === "grab between letters" ? "rect" : "path")!;
      Object.defineProperty(path.parentElement!, "setPointerCapture", { value: vi.fn() });
      const pointer = (type: string, x: number, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperty(event, "pointerId", { value: 1 });
        path.dispatchEvent(event);
      });
      pointer("pointerdown", 10, 10);
      expect(store.selectedSurfaceTextId).toBe(label.id);
      pointer("pointermove", 12, 9);
      pointer("pointermove", 16, 7);
      expect(store.spec.surfaceTexts[0].position).toEqual({ x: 6, y: 3 });
      expect(store.history.stack.length).toBe(historySize);
      if (ending === "disable editing") {
        React.act(() => root.render(<BinProvider><Scene interactive={false} /></BinProvider>));
        expect(host.querySelector("rect")!.getAttribute("pointer-events")).toBe("none");
        pointer("pointermove", 22, 2);
      }
      pointer("pointerup", 16, 7);
      expect(store.history.stack.length).toBe(historySize + 1);
      expect(store.spec.surfaceTexts[0].position).toEqual({ x: 6, y: 3 });
      if (ending === "disable editing") {
        pointer("pointerdown", 16, 7);
        pointer("pointermove", 30, 2);
        pointer("pointerup", 30, 2);
        expect(store.history.stack.length).toBe(historySize + 1);
        expect(store.spec.surfaceTexts[0].position).toEqual({ x: 6, y: 3 });
      }
      const saved = parseProjectDoc(JSON.parse(JSON.stringify({
        schemaVersion: PROJECT_SCHEMA_VERSION, spec: store.spec, shapes: [],
        cutouts: [], fingerHoles: [], history: store.history,
      })))!;
      expect(saved.history!.stack.at(-1)!.doc.spec.surfaceTexts[0].position).toEqual({ x: 6, y: 3 });
      React.act(() => store.dispatch({ type: "UNDO" }));
      expect(store.spec.surfaceTexts[0].position).toEqual({ x: 0, y: 0 });
      React.act(() => store.dispatch({ type: "REDO" }));
      expect(store.spec.surfaceTexts[0].position).toEqual({ x: 6, y: 3 });
    } finally { React.act(() => root.unmount()); host.remove(); }
  });
});

const scenes: (() => void)[] = [];
afterEach(() => scenes.splice(0).forEach(cleanup => cleanup()));
function mountText() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("DOMPoint", class { constructor(public x: number, public y: number) {} matrixTransform() { return this; } });
  let store!: BinStore;
  function Scene({ interactive }: { interactive: boolean }) { store = useBin(); return <svg><SurfaceTextLayer interactive={interactive} /></svg>; }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = (interactive = true) => React.act(() => root.render(<BinProvider><Scene interactive={interactive} /></BinProvider>));
  render();
  const label = surfaceTextSchema.parse({ id: "label", name: "Socket label", text: "METRIC", position: { x: 2, y: 4 }, rotationDeg: 170 });
  React.act(() => {
    store.dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: [label] }, historyLabel: "Add text" });
    store.dispatch({ type: "SELECT_SURFACE_TEXT", id: label.id });
  });
  Object.defineProperty(host.querySelector("g")!, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
  const path = host.querySelector("path")!;
  Object.defineProperty(path.parentElement!, "setPointerCapture", { value: vi.fn() });
  const pointer = (target: Element, type: string, x: number, y: number) => React.act(() => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 }); target.dispatchEvent(event);
  });
  const edit = () => {
    React.act(() => path.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 })));
    return host.querySelector<HTMLInputElement>('[aria-label="Edit surface text wording"]')!;
  };
  const inputValue = (input: HTMLInputElement, value: string) => React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const key = (input: HTMLInputElement, key: string) => React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  scenes.push(() => { React.act(() => root.unmount()); host.remove(); });
  return { host, label, getStore: () => store, render, path, pointer, edit, inputValue, key };
}

it("rotates around the label center across the angle seam with one undo entry", () => {
  const { host, label, getStore, pointer, render } = mountText();
  const circle = host.querySelector("circle")!;
  Object.defineProperty(circle, "setPointerCapture", { value: vi.fn() });
  const stem = host.querySelector("line")!;
  const center = binToCanvas(label.position, getStore().spec);
  const x = Number(circle.getAttribute("cx")), y = Number(circle.getAttribute("cy"));
  expect(Number(stem.getAttribute("x2"))).toBe(x);
  const initialHistory = getStore().history.stack.length;
  pointer(circle, "pointerdown", x, y);
  pointer(circle, "pointermove", center.x + (y - center.y), center.y - (x - center.x));
  expect(getStore().spec.surfaceTexts[0].rotationDeg).toBeCloseTo(-100);
  expect(getStore().spec.surfaceTexts[0].position).toEqual(label.position);
  expect(getStore().history.stack.length).toBe(initialHistory);
  pointer(circle, "pointerup", center.x + (y - center.y), center.y - (x - center.x));
  expect(getStore().history.stack.length).toBe(initialHistory + 1);
  React.act(() => getStore().dispatch({ type: "UNDO" }));
  expect(getStore().spec.surfaceTexts[0]).toEqual(label);
  React.act(() => getStore().dispatch({ type: "REDO" }));
  expect(getStore().spec.surfaceTexts[0].rotationDeg).toBeCloseTo(-100);
  render(false);
  expect(host.querySelector("circle")).toBeNull();
});

it.each(["Enter", "blur"])("edits printed wording in Layout on %s without changing the object name", ending => {
  const { host, label, getStore, edit, inputValue, key } = mountText();
  const initialHistory = getStore().history.stack.length;
  const input = edit();
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(label.text.length);
  inputValue(input, "SAE");
  expect(getStore().spec.surfaceTexts[0].text).toBe(label.text);
  if (ending === "Enter") key(input, "Enter"); else React.act(() => input.blur());
  expect(host.querySelector("input")).toBeNull();
  expect(getStore().spec.surfaceTexts[0]).toEqual({ ...label, text: "SAE" });
  expect(getStore().history.stack.length).toBe(initialHistory + 1);
  React.act(() => getStore().dispatch({ type: "UNDO" }));
  expect(getStore().spec.surfaceTexts[0]).toEqual(label);
  React.act(() => getStore().dispatch({ type: "REDO" }));
  expect(getStore().spec.surfaceTexts[0].text).toBe("SAE");
});

it("validates inline wording and cancels Escape or disabled editing without undo noise", () => {
  const { host, label, getStore, edit, inputValue, key, render } = mountText();
  const initialHistory = getStore().history.stack.length;
  let input = edit();
  inputValue(input, " "); key(input, "Enter");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Enter some text.");
  expect(getStore().spec.surfaceTexts[0]).toEqual(label);
  inputValue(input, "SAE"); key(input, "Escape");
  expect(host.querySelector("input")).toBeNull();
  expect(getStore().history.stack.length).toBe(initialHistory);
  input = edit(); inputValue(input, "UNSAVED"); render(false);
  expect(host.querySelector("input")).toBeNull();
  expect(getStore().spec.surfaceTexts[0]).toEqual(label);
  expect(edit()).toBeNull();
});


it("handles text keyboard edits, undo, deletion, and deselection like other Layout objects", () => {
  const { getStore, render, edit, key } = mountText();
  const original = getStore().spec.surfaceTexts[0];
  const press = (key: string, shiftKey = false) => React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, cancelable: true })));
  press("ArrowRight"); press("ArrowUp", true); press("r");
  expect(getStore().spec.surfaceTexts[0]).toEqual({ ...original, position: { x: 3, y: 4.1 }, rotationDeg: -175 });
  React.act(() => getStore().dispatch({ type: "UNDO" }));
  expect(getStore().spec.surfaceTexts[0].rotationDeg).toBe(170);
  React.act(() => getStore().dispatch({ type: "REDO" }));
  expect(getStore().spec.surfaceTexts[0].rotationDeg).toBe(-175);
  const input = edit(); key(input, "Backspace");
  expect(getStore().spec.surfaceTexts).toHaveLength(1);
  key(input, "Escape"); press("Escape");
  expect(getStore().selectedSurfaceTextId).toBeNull();
  React.act(() => getStore().dispatch({ type: "SELECT_SURFACE_TEXT", id: original.id }));
  render(false); press("Delete"); press("ArrowRight");
  expect(getStore().spec.surfaceTexts[0].position.x).toBe(3);
  render(); press("Delete");
  expect(getStore().spec.surfaceTexts).toHaveLength(0);
  React.act(() => getStore().dispatch({ type: "UNDO" }));
  expect(getStore().spec.surfaceTexts).toHaveLength(1);
});

it.each(["move", "rotate"])("Escape cancels an active text %s without saving a partial gesture", kind => {
  const { host, path, label, getStore, pointer } = mountText();
  const target = kind === "move" ? path : host.querySelector("circle")!;
  if (kind === "rotate") Object.defineProperty(target, "setPointerCapture", { value: vi.fn() });
  const initialHistory = getStore().history.stack.length;
  pointer(target, "pointerdown", 10, 10);
  pointer(target, "pointermove", 20, 25);
  expect(getStore().spec.surfaceTexts[0]).not.toEqual(label);
  React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })));
  pointer(target, "pointermove", 30, 35);
  pointer(target, "pointerup", 30, 35);
  expect(getStore().spec.surfaceTexts[0]).toEqual(label);
  expect(getStore().history.stack.length).toBe(initialHistory);
  expect(getStore().selectedSurfaceTextId).toBe(label.id);
});

it("renders a maximum-length label with dense font outlines without overflowing the argument stack", () => {
  const { host, getStore } = mountText();
  // Synthetic 2,000-point glyph reproduces complex system fonts without shipping one.
  const outline = Array.from({ length: 2000 }, (_, i) => {
    const angle = i / 2000 * 2 * Math.PI;
    return `${i ? "l" : "m"} ${(500 + 400 * Math.cos(angle)).toFixed(3)} ${(500 + 400 * Math.sin(angle)).toFixed(3)}`;
  }).join(" ") + " z";
  const dense = surfaceTextSchema.parse({ id: "dense", text: "A".repeat(120), position: { x: 0, y: 0 },
    font: { kind: "local", name: "Dense test font", resolution: 1000, glyphs: { A: { ha: 1000, o: outline } } } });
  React.act(() => {
    getStore().dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: [dense] } });
    getStore().dispatch({ type: "SELECT_SURFACE_TEXT", id: dense.id });
  });
  const bounds = host.querySelector("rect");
  expect(bounds).not.toBeNull();
  expect(Number(bounds!.getAttribute("width"))).toBeCloseTo(719.8);
  expect(Number.isFinite(Number(host.querySelector("circle")!.getAttribute("cy")))).toBe(true);
});
