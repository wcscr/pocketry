import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { curvesFromOutline, type CurveOutline } from "@shared/geometry/curves";
import { usePointSelection } from "./use-point-selection";

const initial = curvesFromOutline([{ outer: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 50, y: 90 }, { x: 10, y: 90 }], holes: [] }]);
const viewport = { onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn(), startPan: vi.fn() };
let host: HTMLDivElement, root: Root, saved: CurveOutline;
const commit = vi.fn(), smooth = vi.fn();
function Harness({ placed = false, rotated = false, pan = false, context = "source" }: { placed?: boolean; rotated?: boolean; pan?: boolean; context?: string }) {
  const [source, setSource] = React.useState(initial); saved = source;
  const c = Math.cos(37 * Math.PI / 180), s = Math.sin(37 * Math.PI / 180);
  const selection = usePointSelection({ source, enabled: true, contextKey: context, scale: placed ? 2 : 1, viewport,
    fromClient: (x, y) => rotated ? { x: ((x - 200) * c + (y - 200) * s) / 2, y: (-(x - 200) * s + (y - 200) * c) / .75 } : placed ? { x: (200 - x) / 2, y: (300 - y) / 2 } : { x, y },
    toCanvas: p => rotated ? { x: 200 + 2 * p.x * c - .75 * p.y * s, y: 200 + 2 * p.x * s + .75 * p.y * c } : placed ? { x: 200 - p.x * 2, y: 300 - p.y * 2 } : p, panRequested: pan,
    onCommit: (next, label) => { commit(next, label); setSource(next); }, onSmoothSection: smooth });
  return <><svg onPointerDown={selection.down} onPointerMove={selection.move} onPointerUp={selection.end} onPointerCancel={selection.end} onLostPointerCapture={selection.lostCapture}>{selection.overlay}</svg>{selection.controls}<output data-testid="selected-indices">{selection.selection.map(p => p.index).join(",")}</output><input aria-label="Other field" /></>;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === name)!;
function pointer(type: string, x: number, y: number, shift = false, id = 1, touch = false) {
  React.act(() => { const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, shiftKey: shift });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: touch ? "touch" : "mouse" } }); host.querySelector("svg")!.dispatchEvent(event); });
}
const clickPoint = (x: number, y: number, shift = true) => { pointer("pointerdown", x, y, shift); pointer("pointerup", x, y, shift); };
it.each([false, true])("Shift-selects, toggles and drags a group once in its own frame (placed: %s)", placed => {
  React.act(() => root.render(<Harness placed={placed} />));
  const p = (x: number, y: number) => placed ? [200 - 2 * x, 300 - 2 * y] : [x, y];
  const a = p(10, 10), b = p(50, 10);
  clickPoint(a[0], a[1]); clickPoint(b[0], b[1]);
  expect(host.querySelectorAll('[data-testid="selected-outline-point"]')).toHaveLength(2); expect(commit).not.toHaveBeenCalled();
  clickPoint(b[0], b[1]); expect(host.querySelectorAll('[data-testid="selected-outline-point"]')).toHaveLength(1); clickPoint(b[0], b[1]);
  pointer("pointerdown", a[0], a[1]); const destination = p(20, 15); pointer("pointermove", destination[0], destination[1]);
  expect(commit).not.toHaveBeenCalled(); pointer("pointerup", destination[0], destination[1]);
  expect(commit).toHaveBeenCalledTimes(1); expect(saved[0].outer[0].point).toEqual({ x: 20, y: 15 }); expect(saved[0].outer[1].point).toEqual({ x: 60, y: 15 });
  expect(saved[0].outer.slice(2)).toEqual(initial[0].outer.slice(2)); expect(host.querySelectorAll('[data-testid="selected-outline-point"]')).toHaveLength(2);
});
it("box-selects a section, exposes simplification and deletes as one edit", () => {
  React.act(() => root.render(<Harness />)); pointer("pointerdown", -10, -10); pointer("pointermove", 105, 25); pointer("pointerup", 105, 25);
  expect(host.textContent).toContain("3 points selected"); expect(commit).not.toHaveBeenCalled();
  React.act(() => button("Simplify section").click()); expect(smooth).toHaveBeenCalledWith({ ref: { shapeIndex: 0, ringIndex: -1 }, start: 0, end: 2 });
  React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
  expect(commit).toHaveBeenCalledTimes(1); expect(saved[0].outer.map(a => a.point)).toEqual(initial[0].outer.slice(3).map(a => a.point));
});
it("selects the screen rectangle correctly on a rotated, nonuniformly stretched pocket", () => {
  React.act(() => root.render(<Harness rotated />));
  pointer("pointerdown", 150, 190); pointer("pointermove", 300, 330); pointer("pointerup", 300, 330);
  expect(host.querySelector('[data-testid="selected-indices"]')!.textContent).toBe("0,1,4,5");
  expect(commit).not.toHaveBeenCalled();
});
it("uses the visible Select points toggle for touch and cancels a group drag on pinch", () => {
  React.act(() => root.render(<Harness />)); React.act(() => button("Select points").click());
  for (const x of [10, 50]) { pointer("pointerdown", x, 10, false, 1, true); pointer("pointerup", x, 10, false, 1, true); }
  expect(host.textContent).toContain("2 points selected"); pointer("pointerdown", 10, 10, false, 1, true); pointer("pointermove", 30, 25, false, 1, true);
  pointer("pointerdown", 90, 90, false, 2, true); pointer("pointerup", 30, 25, false, 1, true); pointer("pointerup", 90, 90, false, 2, true);
  expect(commit).not.toHaveBeenCalled(); expect(saved).toEqual(initial);
});
it.each(["Escape", "pointercancel", "lostpointercapture", "blur"])("cancels a draft on %s without history", kind => {
  React.act(() => root.render(<Harness />)); clickPoint(10, 10); clickPoint(50, 10); pointer("pointerdown", 10, 10); pointer("pointermove", 30, 30);
  if (kind === "Escape") React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  else if (kind === "blur") React.act(() => window.dispatchEvent(new Event("blur"))); else pointer(kind, 30, 30);
  pointer("pointerup", 30, 30); expect(commit).not.toHaveBeenCalled(); expect(saved).toEqual(initial);
});
it("keeps keyboard shortcuts out of text fields and blocks deletion below three points", () => {
  React.act(() => root.render(<Harness />));
  React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true })));
  expect(host.textContent).toContain("6 points selected");
  React.act(() => host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
  expect(host.querySelector('[role="alert"]')).toBeNull(); expect(commit).not.toHaveBeenCalled();
  React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("three points"); expect(commit).not.toHaveBeenCalled();
});
it("leaves Space-pan to the viewport and clears stale selection on a source change", () => {
  React.act(() => root.render(<Harness />)); clickPoint(10, 10); clickPoint(50, 10);
  React.act(() => root.render(<Harness pan />)); pointer("pointerdown", -10, -10); pointer("pointermove", 105, 105); pointer("pointerup", 105, 105);
  expect(host.textContent).toContain("2 points selected"); expect(commit).not.toHaveBeenCalled();
  React.act(() => root.render(<Harness context="new photo" />)); expect(host.querySelectorAll('[data-testid="selected-outline-point"]')).toHaveLength(0);
});
