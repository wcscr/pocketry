// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { PocketMeasurements } from "./pocket-measurements";

const shape: TracedShape = {
  id: "tool", name: "Test tool", sourceMmPerPx: 0.25, traceMarginMm: 0.5, pointCount: 4,
  outlineMm: [{ outer: [{ x: -20, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 10 }, { x: -20, y: 10 }], holes: [] }],
  bboxMm: { minX: -20, minY: -10, maxX: 20, maxY: 10 },
};
let store: BinStore;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const inspect = vi.fn();
const scale = vi.fn();

function Probe() {
  store = useBin();
  const cutout = store.cutouts[0];
  return cutout ? <PocketMeasurements cutout={cutout} shape={shape} inspect={inspect} setScale={scale} /> : null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  inspect.mockReset(); scale.mockReset();
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  React.act(() => root.render(<ShapeLibraryProvider><BinProvider><Probe /></BinProvider></ShapeLibraryProvider>));
  React.act(() => store.dispatch({ type: "HYDRATE", spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6 }),
    cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, scaleX: 0.9, scaleY: 0.9, clearanceMm: 0.5, depth: { mode: "mm", value: 12 } })] }));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function enter(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  React.act(() => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  React.act(() => input.blur());
}

describe("pocket measurements", () => {
  it("preserves precise imported coordinates and scale when rounded fields are only focused", () => {
    React.act(() => store.dispatch({
      type: "UPDATE_CUTOUT", id: "pocket",
      patch: { position: { x: 33.4893721, y: 3.553823 }, scaleX: 0.90347291 },
    }));
    const before = store.cutouts[0];
    for (const label of ["X position in millimetres", "Pocket width in millimetres"]) {
      const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      React.act(() => input.focus());
      React.act(() => input.blur());
    }
    expect(store.cutouts[0]).toBe(before);
    expect(scale).not.toHaveBeenCalled();
  });

  it("edits exact coordinates as one undoable placement and cuts through that position", () => {
    enter("X position in millimetres", "17.35");
    expect(store.cutouts[0].position.x).toBe(17.35);
    expect(store.history.stack).toHaveLength(2);
    React.act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Inspect this pocket in 3D")!.click());
    expect(inspect).toHaveBeenCalledWith({ axis: "x", offsetMm: 17.35 });
    expect(store.viewMode).toBe("3d");
    React.act(() => store.dispatch({ type: "UNDO" }));
    expect(store.cutouts[0].position.x).toBe(0);
  });

  it("shows physical size, scaled allowance, and the geometry kernel's depth reference", () => {
    expect(host.querySelector<HTMLInputElement>('[aria-label="Pocket width in millimetres"]')!.value).toBe("37");
    expect(host.textContent).toContain("0.95 / 0.95 mm per edge");
    const resolved = resolvePocketDepth(store.spec, store.cutouts[0].depth);
    expect(host.textContent).toContain(`Floor: ${resolved.floorZ!.toFixed(1)} mm`);
    expect(host.textContent).toContain("Cut depth: 12.0 mm");
    enter("Pocket width in millimetres", "50");
    expect(scale.mock.lastCall?.[0]).toBe("x");
    expect(scale.mock.lastCall?.[1]).toBeCloseTo(122.5);
  });
});
