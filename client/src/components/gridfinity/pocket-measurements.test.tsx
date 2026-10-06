// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { ExperimentalFeaturesProvider, EXPERIMENTAL_FEATURES_KEY } from "@/state/experimental-features";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { PocketDepthSummary, PocketMeasurements, PocketSizeInputs } from "./pocket-measurements";
import type { BuildBinSection } from "@/lib/gridfinity/worker-api";

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
  const [section, setSection] = React.useState<BuildBinSection | null>(null);
  const cutout = store.cutouts[0];
  return cutout ? <><PocketSizeInputs cutout={cutout} shape={shape} setScale={scale} /><PocketMeasurements cutout={cutout} shape={shape} /><PocketDepthSummary cutout={cutout} shape={shape} section={section} inspect={next => { inspect(next); setSection(next); }} /></> : null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  localStorage.setItem(EXPERIMENTAL_FEATURES_KEY, "true");
  inspect.mockReset(); scale.mockReset();
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  React.act(() => root.render(<ExperimentalFeaturesProvider><ShapeLibraryProvider><BinProvider><Probe /></BinProvider></ShapeLibraryProvider></ExperimentalFeaturesProvider>));
  React.act(() => store.dispatch({ type: "HYDRATE", spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6 }),
    cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, scaleX: 0.9, scaleY: 0.9, clearanceMm: 0.5, depth: { mode: "mm", value: 12 } })] }));
  React.act(() => [...host.querySelectorAll("summary")].find((summary) => summary.textContent?.includes("Position"))!.click());
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); localStorage.removeItem(EXPERIMENTAL_FEATURES_KEY); vi.unstubAllGlobals(); });

function enter(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  React.act(() => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  React.act(() => input.blur());
}

describe("pocket measurements", () => {
  it("opts into either insertion direction and preserves pose and dimensions through undo", () => {
    enter("Pocket X rotation in degrees", "30");
    const before = store.cutouts[0];
    React.act(() => host.querySelector<HTMLInputElement>('[aria-label="Clear pocket insertion path"]')!.click());
    expect(store.cutouts[0]).toEqual({ ...before, insertionMode: "axis" });
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Pocket insertion direction"]')!;
    React.act(() => { select.value = "vertical"; select.dispatchEvent(new Event("change", {bubbles:true})); });
    expect(store.cutouts[0]).toEqual({ ...before, insertionMode: "vertical" });
    React.act(() => store.dispatch({ type: "UNDO" }));
    expect(store.cutouts[0]).toEqual({ ...before, insertionMode: "axis" });
    React.act(() => store.dispatch({ type: "UNDO" }));
    expect(store.cutouts[0]).toEqual(before);
    expect(host.querySelector('[aria-label="Pocket insertion direction"]')).toBeNull();
  });

  it("keeps minimum-floor mode and source dimensions during tilt, lowering, raising, and undo", () => {
    React.act(() => store.dispatch({type:"UPDATE_CUTOUT",id:"pocket",patch:{depth:{mode:"remaining",floorThicknessMm:9}}}));
    enter("Pocket X rotation in degrees","30");
    const depth = store.cutouts[0].depth;
    expect(depth).toMatchObject({mode:"remaining",floorThicknessMm:9,sourceDepthMm:expect.any(Number)});
    enter("Pocket elevation in millimetres","3");
    expect(store.cutouts[0].depth).toEqual(depth);
    expect(host.textContent).toContain("Lowest point: 9.0 mm");
    enter("Pocket elevation in millimetres","12");
    expect(store.cutouts[0].depth).toEqual(depth);
    expect(host.textContent).toContain("Lowest point: 12.0 mm");
    React.act(() => store.dispatch({type:"UNDO"}));
    expect(store.cutouts[0]).toMatchObject({elevationMm:3,depth});
  });

  it("recovers a horizontal insertion path through vertical drop-in with undo", () => {
    enter("Pocket X rotation in degrees", "90");
    React.act(() => host.querySelector<HTMLInputElement>('[aria-label="Clear pocket insertion path"]')!.click());
    const before = store.cutouts[0];
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("horizontal");
    React.act(() => [...host.querySelectorAll("button")].find(b => b.textContent === "Use vertical drop-in")!.click());
    expect(store.cutouts[0]).toEqual({ ...before, insertionMode: "vertical" });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    React.act(() => store.dispatch({ type: "UNDO" }));
    expect(store.cutouts[0]).toEqual(before);
  });

  it.each<[string, Partial<CutoutPlacement>, "x" | "y"]>([
    ["wide pocket", {}, "x"],
    ["long pocket", { scaleY: 3 }, "y"],
    ["rotated pocket", { rotationDeg: 90 }, "y"],
    ["mirrored rotated pocket", { rotationDeg: 90, mirrored: true }, "y"],
    ["sideways thick pocket", { tilt: { xDeg: 90, yDeg: 0 }, elevationMm: 7, depth: { mode: "mm", value: 60 } }, "y"],
    ["equal dimensions", { scaleX: 0.5, scaleY: 1 }, "x"],
  ])("defaults inspection to the longest placed dimension for a %s", (_name, patch, axis) => {
    React.act(() => store.dispatch({ type: "UPDATE_CUTOUT", id: "pocket", patch }));
    React.act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-inspect-pocket"]')!.click());
    expect(inspect.mock.lastCall![0].axis).toBe(axis);
    expect(host.querySelector(`[aria-label="Inspect pocket along ${axis.toUpperCase()}"]`)!.getAttribute("aria-pressed")).toBe("true");
  });

  it("does not carry a manual axis choice into a different pocket", () => {
    const click = (selector: string) => React.act(() => host.querySelector<HTMLButtonElement>(selector)!.click());
    click('[data-testid="button-inspect-pocket"]');
    click('[aria-label="Inspect pocket along Y"]');
    click('[data-testid="button-inspect-pocket"]');
    React.act(() => store.dispatch({ type: "HYDRATE", spec: store.spec,
      cutouts: [{ ...store.cutouts[0], id: "other-pocket" }] }));
    click('[data-testid="button-inspect-pocket"]');
    expect(inspect.mock.lastCall![0].axis).toBe("x");
  });

  it("edits independent tilt angles and resets them with undo", () => {
    enter("Pocket X rotation in degrees", "15");
    enter("Pocket Y rotation in degrees", "-35");
    expect(store.cutouts[0].tilt).toEqual({ xDeg: 15, yDeg: -35 });
    expect(store.history.stack).toHaveLength(3);
    React.act(() => store.dispatch({ type: "UNDO" }));
    expect(store.cutouts[0].tilt).toEqual({ xDeg: 15, yDeg: 0 });
    React.act(() => store.dispatch({ type: "REDO" }));
    expect(host.textContent).toContain("Depth: 12.0 mm");
    expect(host.textContent).toContain("Along pocket axis");
    React.act(() => [...host.querySelectorAll("button")].find(b => b.textContent === "Reset to X–Y plane")!.click());
    expect(store.cutouts[0].tilt).toEqual({xDeg:0,yDeg:0});
    React.act(() => store.dispatch({ type: "UNDO" }));
    expect(store.cutouts[0].tilt).toEqual({ xDeg: 15, yDeg: -35 });
  });

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

  it("switches inspection axes through the rotated solid's center without changing the pocket", () => {
    React.act(() => store.dispatch({ type: "UPDATE_CUTOUT", id: "pocket", patch: {
      position: { x: 17.35, y: 6.8 }, scaleX: 1, scaleY: 1, tilt: { xDeg: 90, yDeg: 0 }, elevationMm: 10,
    } }));
    const before = store.cutouts[0], history = store.history;
    const click = (selector: string) => React.act(() => host.querySelector<HTMLButtonElement>(selector)!.click());
    click('[data-testid="button-inspect-pocket"]');
    expect(inspect).toHaveBeenLastCalledWith({ axis: "x", offsetMm: 17.35 });
    click('[aria-label="Inspect pocket along Y"]');
    expect(inspect).toHaveBeenLastCalledWith({ axis: "y", offsetMm: 12.8 });
    expect(host.querySelector('[aria-label="Inspect pocket along Y"]')!.getAttribute("aria-pressed")).toBe("true");
    click('[aria-label="Inspect pocket along X"]');
    expect(inspect).toHaveBeenLastCalledWith({ axis: "x", offsetMm: 17.35 });
    click('[aria-label="Inspect pocket along Y"]');
    click('[data-testid="button-inspect-pocket"]');
    expect(inspect).toHaveBeenLastCalledWith(null);
    click('[data-testid="button-inspect-pocket"]');
    expect(inspect).toHaveBeenLastCalledWith({ axis: "y", offsetMm: 12.8 });
    expect(store.cutouts[0]).toBe(before);
    expect(store.history).toBe(history);
  });

  it("subtracts inward clearance from physical size and never displays a negative dimension", () => {
    React.act(() => store.dispatch({ type: "UPDATE_CUTOUT", id: "pocket", patch: { clearanceMm: -0.5 } }));
    expect(host.querySelector<HTMLInputElement>('[aria-label="Pocket width in millimetres"]')!.value).toBe("35");
    enter("Pocket width in millimetres", "39");
    expect(scale.mock.lastCall).toEqual(["x", 100]);
    React.act(() => store.dispatch({ type: "UPDATE_CUTOUT", id: "pocket", patch: { clearanceMm: -2, scaleX: 0.05 } }));
    expect(host.querySelector<HTMLInputElement>('[aria-label="Pocket width in millimetres"]')!.value).toBe("0");
  });

  it("shows physical size and the geometry kernel's depth reference", () => {
    expect(host.querySelector<HTMLInputElement>('[aria-label="Pocket width in millimetres"]')!.value).toBe("37");
    const resolved = resolvePocketDepth(store.spec, store.cutouts[0].depth);
    expect(host.textContent).toContain(`Floor: ${resolved.floorZ!.toFixed(1)} mm`);
    expect(host.textContent).toContain("Cut depth: 12.0 mm");
    const depthGroup = host.querySelector<HTMLDetailsElement>('[data-testid="pocket-depth-summary"]')!;
    expect(depthGroup.open).toBe(true);
    expect(depthGroup.querySelector('summary')!.textContent).toBe('Depth');
    enter("Pocket width in millimetres", "50");
    expect(scale.mock.lastCall?.[0]).toBe("x");
    expect(scale.mock.lastCall?.[1]).toBeCloseTo(122.5);
  });
});
