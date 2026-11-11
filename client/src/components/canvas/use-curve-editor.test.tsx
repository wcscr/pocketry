import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCurveEditor } from "./use-curve-editor";
import { curveControls, evaluateCurve, sampleCurves, type CurveOutline } from "@shared/geometry/curves";
import type { Outline } from "@shared/geometry/types";
import * as photoWorker from "@/lib/detect/worker-client";
import { compareContours } from "@shared/geometry/contour-metrics";

const outline = [{ outer: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }], holes: [] }];
let root: Root, host: HTMLDivElement, saved: CurveOutline | undefined;
const onCommit = vi.fn(), navigation = { onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn(), startPan: vi.fn() };
const rounded: Outline = [{ outer: Array.from({ length: 48 }, (_, i) => ({ x: 50 + 40 * Math.cos(i * Math.PI / 24), y: 50 + 40 * Math.sin(i * Math.PI / 24) })), holes: [] }];
function Harness({ placed = false, input = outline, units = 1, unit = "mm", contextKey = "source", dense }: { placed?: boolean; input?: Outline; units?: number; unit?: "mm" | "px"; contextKey?: string; dense?: Outline }) {
  const [curves, setCurves] = React.useState<CurveOutline>();
  saved = curves;
  const editor = useCurveEditor({ outline: input, curves, enabled: true, contextKey, scale: 1, tolerance: 0.025,
    allowOutlineSimplification: !!dense,
    fitUnitsPerUnit: units, fitUnit: unit,
    viewport: navigation,
    fromClient: (x, y) => placed ? { x: (200 - x) / 2, y: 300 - y } : { x, y },
    toCanvas: p => placed ? { x: 200 - 2 * p.x, y: 300 - p.y } : p,
    onCommit: (value, label) => { onCommit(value, label); setCurves(value); },
  });
  return <><svg onPointerDown={editor.down} onPointerMove={editor.move} onPointerUp={editor.end} onPointerCancel={editor.end} onLostPointerCapture={editor.lostCapture} onContextMenu={editor.contextMenu}>{editor.overlay}</svg>{editor.startButton}{editor.controls}</>;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); saved = undefined;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

it("simplifies the accepted outline in an explicit preview and applies one edit", async () => {
  const dense = [{ outer: Array.from({ length: 256 }, (_, i) => ({ x: 50 + 42 * Math.cos(i * Math.PI / 128), y: 50 + 42 * Math.sin(i * Math.PI / 128) })), holes: [] }];
  React.act(() => root.render(<Harness input={rounded} dense={dense} />));
  React.act(() => button("Bend edges").click());
  await React.act(async () => button("Smooth outline").click());
  expect(host.querySelector('[data-testid="reconstruction-source"]')).toBeNull();
  React.act(() => button("Original").click());
  expect(host.querySelector('[data-testid="reconstruction-source"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="curve-fit-preview"]')).toBeNull();
  React.act(() => button("Preview").click());
  // Compare with the visible outline, not hidden 256-point detection evidence.
  expect(host.textContent).toContain("Preview ready.");
  expect(onCommit).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="curve-fit-preview"]')!.getAttribute("d")).toContain("C");
  React.act(() => button("Apply").click());
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit.mock.calls[0][1]).toBe("Smooth outline");
  // Smoothing may need additional samples; geometry quality, not a lower
  // point count, establishes whether the preview is useful.
  // The raw evidence differs from the accepted shape by 2 mm.
  // The preview's 0.2 mm bound must be relative to what the user actually saw.
  const distance = compareContours(sampleCurves(saved!, .001), rounded, { spacing: .05 });
  expect(Math.max(distance.missingMax!, distance.excessMax!, distance.cutInMax!)).toBeLessThanOrEqual(.2);
});

it("marks a no-effect preview visually and explains it on keyboard focus", async () => {
  React.act(() => root.render(<Harness input={outline} dense={outline} />));
  React.act(() => button("Bend edges").click());
  await React.act(async () => button("Smooth outline").click());
  const indicator = host.querySelector<HTMLElement>('[aria-label="Smoothing would not change the outline."]')!;
  expect(indicator.querySelector('[data-testid="unchanged-simplification"]')).not.toBeNull();
  expect(button("Apply").disabled).toBe(true);
  await React.act(async () => indicator.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Smoothing would not change the outline.");
  expect(onCommit).not.toHaveBeenCalled();
});

it("cancels a pending reconstruction and ignores its late worker result", async () => {
  vi.stubGlobal("Worker", class {});
  let finish!: (value: never) => void, signal: AbortSignal | undefined;
  const invoke = vi.spyOn(photoWorker, "simplifyInWorker").mockImplementation((_payload, inputSignal) => {
    signal = inputSignal; return new Promise(resolve => { finish = resolve; });
  });
  try {
    React.act(() => root.render(<Harness input={rounded} dense={rounded} />));
    React.act(() => button("Bend edges").click());
    await React.act(async () => button("Smooth outline").click());
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ source: expect.any(Array), tolerance: .2,
      sampleTolerance: .025 }), expect.any(AbortSignal));
    expect(host.textContent).toContain("Updating preview");
    expect(button("Apply").disabled).toBe(true);
    React.act(() => button("Cancel").click());
    expect(signal?.aborted).toBe(true);
    await React.act(async () => finish({ curves: [], changed: true } as never));
    expect(host.querySelector('[data-testid="curve-fit-preview"]')).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  } finally { invoke.mockRestore(); }
});

it("opens one automatic preview with no amount controls and cancels without saving", async () => {
  React.act(() => root.render(<Harness input={rounded} dense={rounded} />)); React.act(() => button("Bend edges").click());
  await React.act(async () => button("Smooth outline").click());
  expect(host.querySelector('input[type="number"]')).toBeNull();
  expect(host.querySelector('[aria-label="Simplification amount"]')).toBeNull();
  expect(host.textContent).not.toMatch(/More detail|Balanced|Smoother/);
  expect(host.querySelector('[data-testid="curve-fit-preview"]')).not.toBeNull();
  expect(onCommit).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Update preview");
  expect(host.textContent).not.toContain("Advanced");
  React.act(() => button("Cancel").click()); expect(onCommit).not.toHaveBeenCalled(); expect(saved).toBeUndefined();
});

afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === name)!;
function render(placed = false) {
  React.act(() => root.render(<Harness placed={placed} />));
  React.act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-edit-curves"]')!.click());
}
function pointer(target: Element, type: string, x: number, y: number, id = 1, pointerType = "mouse") {
  React.act(() => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: pointerType } });
    target.dispatchEvent(event);
  });
}
const edge = () => host.querySelector('[data-curve-kind="edge"][data-curve-index="0"]')!;
const svg = () => host.querySelector("svg")!;

it.each([false, true])("bends a selected edge in its own coordinate frame and commits exactly once (placed: %s)", placed => {
  render(placed);
  const start = placed ? { x: 100, y: 290 } : { x: 50, y: 10 };
  pointer(edge(), "pointerdown", start.x, start.y);
  pointer(svg(), "pointermove", start.x, start.y - 15);
  expect(onCommit).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="curve-source-path"]')!.getAttribute("d")).toContain("C");
  pointer(svg(), "pointerup", start.x, start.y - 15);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(saved![0].outer).toHaveLength(4);
  const midpoint = evaluateCurve(curveControls(saved![0].outer, 0), 0.5);
  expect(midpoint.y).toBeCloseTo(placed ? 25 : -5);
});

it.each(["Escape", "pointercancel", "lostpointercapture", "blur"])("discards a draft on %s without saving or changing history", kind => {
  render(); pointer(edge(), "pointerdown", 50, 10); pointer(svg(), "pointermove", 50, 25);
  if (kind === "Escape") React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  else if (kind === "blur") React.act(() => window.dispatchEvent(new Event("blur")));
  else pointer(svg(), kind, 50, 25);
  pointer(svg(), "pointerup", 50, 25);
  expect(onCommit).not.toHaveBeenCalled(); expect(saved).toBeUndefined();
  expect(host.querySelector('[data-testid="curve-source-path"]')!.getAttribute("d")).not.toContain("C");
});

it("keeps clicks/selection out of history, then exposes handles and an exact split", () => {
  render(); pointer(host.querySelector('[data-curve-kind="point"]')!, "pointerdown", 10, 10); pointer(svg(), "pointerup", 10, 10);
  expect(onCommit).not.toHaveBeenCalled();
  React.act(() => { const select = host.querySelector<HTMLSelectElement>('[aria-label="Curve selection"]')!;
    select.value = "edge:0"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  React.act(() => button("Add handles").click());
  expect(onCommit).toHaveBeenCalledTimes(1);
  React.act(() => button("Add handles").click());
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll('[data-testid="curve-control-handle"]')).toHaveLength(2);
  const before = sampleCurves(saved!);
  React.act(() => button("Add midpoint").click());
  expect(saved![0].outer).toHaveLength(5);
  expect(sampleCurves(saved!)[0].outer).toContainEqual({ x: 50, y: 10 });
  expect(before[0].outer[0]).toEqual(saved![0].outer[0].point);
  expect(host.querySelector('[aria-label="Curve selection"]')).toHaveProperty("value", "point:1");
});

it.each([false, true])("keeps click-to-add and right-click-to-delete in curve editing (placed: %s)", placed => {
  render(placed); React.act(() => button("Add handles").click());
  const start = placed ? { x: 100, y: 290 } : { x: 50, y: 10 };
  const before = onCommit.mock.calls.length;
  pointer(edge(), "pointerdown", start.x, start.y); pointer(svg(), "pointerup", start.x, start.y);
  expect(saved![0].outer).toHaveLength(5); expect(onCommit).toHaveBeenCalledTimes(before + 1);
  expect(saved![0].outer[1].point.x).toBeCloseTo(50, 3); expect(saved![0].outer[1].in).toBeDefined(); expect(saved![0].outer[1].out).toBeDefined();
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y });
  React.act(() => svg().dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true); expect(saved![0].outer).toHaveLength(4); expect(onCommit).toHaveBeenCalledTimes(before + 2);
  React.act(() => svg().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1000, clientY: 1000 })));
  expect(onCommit).toHaveBeenCalledTimes(before + 2);
});

it("cancels a touch edit when a second finger starts a pinch", () => {
  render(); pointer(edge(), "pointerdown", 50, 10, 1, "touch");
  pointer(svg(), "pointermove", 50, 30, 1, "touch");
  pointer(svg(), "pointerdown", 80, 80, 2, "touch");
  pointer(svg(), "pointermove", 100, 100, 2, "touch");
  pointer(svg(), "pointerup", 100, 100, 2, "touch");
  pointer(svg(), "pointerup", 50, 30, 1, "touch");
  expect(onCommit).not.toHaveBeenCalled(); expect(navigation.onPointerDown).toHaveBeenCalledTimes(2);
  expect(navigation.onPointerMove).toHaveBeenCalledTimes(2); expect(navigation.onPointerUp).toHaveBeenCalledTimes(2);
});

it.each(["blur", "source replacement"])("accepts a fresh touch after an interrupted edit (%s)", interruption => {
  render();
  pointer(edge(), "pointerdown", 50, 10, 17, "touch");
  pointer(svg(), "pointermove", 50, 25, 17, "touch");
  // The old finger never produces an up event when focus/the source changes.
  if (interruption === "blur") React.act(() => window.dispatchEvent(new Event("blur")));
  else {
    React.act(() => root.render(<Harness contextKey="new source" />));
    React.act(() => button("Bend edges").click());
  }
  expect(onCommit).not.toHaveBeenCalled();
  pointer(edge(), "pointerdown", 50, 10, 23, "touch");
  pointer(svg(), "pointermove", 50, 30, 23, "touch");
  pointer(svg(), "pointerup", 50, 30, 23, "touch");
  expect(onCommit).toHaveBeenCalledTimes(1);
});

it("keeps both fingers out of editing after a group drag becomes a pinch", () => {
  render(); React.act(() => button("Select points").click());
  const point = (index: number) => host.querySelector(`[data-curve-kind="point"][data-curve-index="${index}"]`)!;
  for (const [index, x] of [[0, 10], [1, 90]]) { pointer(point(index), "pointerdown", x, 10, 1, "touch"); pointer(svg(), "pointerup", x, 10, 1, "touch"); }
  pointer(point(0), "pointerdown", 10, 10, 1, "touch"); pointer(svg(), "pointermove", 25, 25, 1, "touch");
  pointer(point(2), "pointerdown", 90, 90, 2, "touch"); pointer(svg(), "pointermove", 110, 110, 2, "touch");
  pointer(svg(), "pointerup", 110, 110, 2, "touch"); pointer(svg(), "pointermove", 35, 35, 1, "touch"); pointer(svg(), "pointerup", 35, 35, 1, "touch");
  expect(onCommit).not.toHaveBeenCalled(); expect(saved).toBeUndefined();
});

function startFitting(mode: "auto" | "range", units = 1, unit: "mm" | "px" = "mm") {
  React.act(() => root.render(<Harness input={rounded} units={units} unit={unit} />));
  expect(onCommit).not.toHaveBeenCalled();
  React.act(() => button("Bend edges").click());
  expect(onCommit).not.toHaveBeenCalled();
  React.act(() => button(mode === "auto" ? "Auto-fit contour" : "Select a section").click());
}
function inputValue(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  React.act(() => {
    const prototype = input.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(input.tagName === "INPUT" ? "input" : "change", { bubbles: true }));
  });
}

it("auto-fit is opt-in, previews without saving, and applies as exactly one edit", () => {
  startFitting("auto");
  expect(host.querySelector('[data-testid="curve-fit-preview"]')).not.toBeNull();
  expect(onCommit).not.toHaveBeenCalled(); expect(saved).toBeUndefined();
  React.act(() => button("Apply fit").click());
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit.mock.calls[0][1]).toBe("Auto-fit contour");
  expect(saved![0].outer.length).toBeLessThan(rounded[0].outer.length);
  React.act(() => button("Auto-fit contour").click());
  expect(button("Apply fit").disabled).toBe(true);
  expect(onCommit).toHaveBeenCalledTimes(1);
});

it.each(["button", "Escape"])("cancels a fitting preview with %s without changing geometry", how => {
  startFitting("auto");
  if (how === "button") React.act(() => button("Cancel fit").click());
  else React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector('[data-testid="curve-fit-preview"]')).toBeNull();
  expect(onCommit).not.toHaveBeenCalled(); expect(saved).toBeUndefined();
});

it("selects a wrapped range with touch or menus without starting a drag", () => {
  startFitting("range");
  const point = (index: number) => host.querySelector(`[data-curve-kind="point"][data-curve-index="${index}"]`)!;
  pointer(point(40), "pointerdown", 1, 1, 1, "touch"); pointer(svg(), "pointerup", 1, 1, 1, "touch");
  pointer(point(8), "pointerdown", 1, 1, 1, "touch"); pointer(svg(), "pointerup", 1, 1, 1, "touch");
  expect(host.querySelector('[aria-label="First fit point"]')).toHaveProperty("value", "40");
  expect(host.querySelector('[aria-label="Last fit point"]')).toHaveProperty("value", "8");
  expect(host.textContent).toContain("17 points selected");
  expect(onCommit).not.toHaveBeenCalled();
  React.act(() => button("Preview fit").click());
  expect(button("Apply fit").disabled).toBe(false);
  React.act(() => button("Swap ends").click());
  expect(button("Apply fit").disabled).toBe(true);
  inputValue('[aria-label="First fit point"]', "40"); inputValue('[aria-label="Last fit point"]', "8");
  React.act(() => button("Preview fit").click()); React.act(() => button("Apply fit").click());
  expect(onCommit).toHaveBeenCalledTimes(1); expect(onCommit.mock.calls[0][1]).toBe("Fit selected points");
});

it("invalidates a preview on tolerance/source/scale changes and reports invalid tolerance", () => {
  startFitting("auto");
  inputValue('[aria-label="Maximum change from current outline (mm)"]', "0");
  expect(button("Apply fit").disabled).toBe(true);
  React.act(() => button("Preview fit").click());
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("positive");
  inputValue('[aria-label="Maximum change from current outline (mm)"]', "0.1");
  React.act(() => button("Preview fit").click());
  expect(button("Apply fit").disabled).toBe(false);
  React.act(() => root.render(<Harness input={rounded} units={2} />));
  expect(host.querySelector('[data-testid="curve-fit-preview"]')).toBeNull();
  React.act(() => button("Auto-fit contour").click());
  React.act(() => root.render(<Harness input={outline} units={2} contextKey="replacement" />));
  expect(host.querySelector('[data-testid="curve-fit-preview"]')).toBeNull();
  expect(onCommit).not.toHaveBeenCalled();
});

it("uses pixels before calibration and keeps unchanged contours out of history", () => {
  startFitting("auto", 1, "px");
  expect(host.querySelector('[aria-label="Maximum change from current outline (px)"]')).toHaveProperty("value", "1");
  React.act(() => root.render(<Harness input={rounded} units={1} unit="mm" />));
  expect(host.querySelector('[data-testid="curve-fit-preview"]')).toBeNull();
  React.act(() => button("Auto-fit contour").click());
  expect(host.querySelector('[aria-label="Maximum change from current outline (mm)"]')).toHaveProperty("value", "0.1");
  React.act(() => button("Cancel fit").click());
  React.act(() => root.render(<Harness input={outline} />));
  React.act(() => button("Auto-fit contour").click());
  expect(button("Apply fit").disabled).toBe(true);
  expect(host.textContent).toContain("No changes needed"); expect(onCommit).not.toHaveBeenCalled();
});
