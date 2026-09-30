import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { SurfaceTextLayer } from "./surface-text-layer";

afterEach(() => vi.unstubAllGlobals());

describe("text dragging", () => {
  it("moves in the y-up frame, commits once and preserves saved undo history", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("DOMPoint", class { constructor(public x: number, public y: number) {} matrixTransform() { return this; } });
    let store!: BinStore;
    function Scene() { store = useBin(); return <svg><SurfaceTextLayer interactive /></svg>; }
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
      const path = host.querySelector("path")!;
      Object.defineProperty(path, "setPointerCapture", { value: vi.fn() });
      const pointer = (type: string, x: number, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperty(event, "pointerId", { value: 1 });
        path.dispatchEvent(event);
      });
      pointer("pointerdown", 10, 10);
      pointer("pointermove", 12, 9);
      pointer("pointermove", 16, 7);
      expect(store.spec.surfaceTexts[0].position).toEqual({ x: 6, y: 3 });
      expect(store.history.stack.length).toBe(historySize);
      pointer("pointerup", 16, 7);
      expect(store.history.stack.length).toBe(historySize + 1);
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
