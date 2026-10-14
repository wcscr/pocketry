import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCurveEditor } from "./use-curve-editor";
import { curveControls, evaluateCurve, sampleCurves, type CurveOutline } from "@shared/geometry/curves";

const outline = [{ outer: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }], holes: [] }];
let root: Root, host: HTMLDivElement, saved: CurveOutline | undefined;
const onCommit = vi.fn(), navigation = { onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn(), startPan: vi.fn() };
function Harness({ placed = false }: { placed?: boolean }) {
  const [curves, setCurves] = React.useState<CurveOutline>();
  saved = curves;
  const editor = useCurveEditor({ outline, curves, enabled: true, contextKey: "source", scale: 1, tolerance: 0.025,
    viewport: navigation,
    fromClient: (x, y) => placed ? { x: (200 - x) / 2, y: 300 - y } : { x, y },
    toCanvas: p => placed ? { x: 200 - 2 * p.x, y: 300 - p.y } : p,
    onCommit: (value, label) => { onCommit(value, label); setCurves(value); },
  });
  return <><svg onPointerDown={editor.down} onPointerMove={editor.move} onPointerUp={editor.end} onPointerCancel={editor.end} onLostPointerCapture={editor.lostCapture}>{editor.overlay}</svg>{editor.startButton}{editor.controls}</>;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); saved = undefined;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
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
  render(); pointer(edge(), "pointerdown", 50, 10); pointer(svg(), "pointerup", 50, 10);
  expect(onCommit).not.toHaveBeenCalled();
  React.act(() => button("Curve").click());
  expect(onCommit).toHaveBeenCalledTimes(1);
  React.act(() => button("Curve").click());
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll('[data-testid="curve-control-handle"]')).toHaveLength(2);
  const before = sampleCurves(saved!);
  React.act(() => button("Split edge").click());
  expect(saved![0].outer).toHaveLength(5);
  expect(sampleCurves(saved!)[0].outer).toContainEqual({ x: 50, y: 10 });
  expect(before[0].outer[0]).toEqual(saved![0].outer[0].point);
  expect(host.querySelector('[aria-label="Curve selection"]')).toHaveProperty("value", "point:1");
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
