// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OUTER_RING, type Outline } from "@shared/geometry/types";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { rectRing } from "@/lib/geometry/fixtures";
import { outlineToPathData } from "@/lib/export/svg";
import { suggestSymmetryAxis } from "@/lib/geometry/symmetry";
import { TraceSymmetryTool } from "./trace-symmetry-tool";

let trace: TraceStore;
let root: Root;
let host: HTMLDivElement;
const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 };
const outline: Outline = [
  { outer: rectRing(20, 0, 15, 100), holes: [] },
  { outer: [{ x: 80, y: 10 }, { x: 90, y: 10 }, { x: 94, y: 30 }, { x: 90, y: 90 }, { x: 80, y: 90 }], holes: [] },
];
function Harness() { trace = useTrace(); return <TraceSymmetryTool />; }
function button(text: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text);
  expect(result, `Missing ${text}`).toBeDefined(); return result!;
}
const click = (text: string) => React.act(() => button(text).click());
const preview = () => document.querySelector('[data-testid="symmetry-result"]')!.getAttribute("d");
const toggleUpright = () => React.act(() => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
const uprightPreview = () => document.querySelector('[data-testid="symmetry-upright-result"]')?.getAttribute("d");
function ready() {
  React.act(() => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "driver" });
    trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 200, height: 150 } });
    trace.dispatch({ type: "SET_CALIBRATION", calibration });
    trace.dispatch({ type: "DETECTED", imageUrl: "photo", outline, rawOutline: outline, svg: "", region: null });
    trace.dispatch({ type: "SELECT_RING", selection: { shapeIndex: 1, ringIndex: OUTER_RING } });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  React.act(() => root.render(<TraceProvider><Harness /></TraceProvider>));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("symmetry preview", () => {
  it("disables the tool until an outline is available", () => {
    expect(button("Symmetry & straighten").disabled).toBe(true);
  });

  it("previews either side and keyboard axis changes without altering the trace on Cancel", () => {
    ready(); const original = trace.outline, history = trace.history;
    click("Symmetry & straighten"); const average = preview();
    click("Use left side"); const left = preview();
    expect(left).not.toEqual(average);
    click("Use right side"); expect(preview()).not.toEqual(left);
    click("Average both");
    React.act(() => document.querySelector('[aria-label="First axis handle"]')!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    ));
    expect(preview()).not.toEqual(average);
    click("Reset axis"); expect(preview()).toEqual(average);
    expect(trace.outline).toBe(original); expect(trace.history).toBe(history);
    click("Cancel"); expect(trace.outline).toBe(original); expect(trace.history).toBe(history);
  });

  it("changes only the selected shape in one undoable edit and preserves calibration", () => {
    ready(); const original = trace.outline, history = trace.history;
    click("Symmetry & straighten"); click("Use left side"); click("Apply symmetry");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trace.outline[0]).toBe(original[0]); expect(trace.outline[1]).not.toEqual(original[1]);
    expect(trace.history.index).toBe(history.index + 1);
    expect(trace.history.stack[trace.history.index]).toMatchObject({ label: "Make contour symmetric", hasManualEdits: true });
    expect(trace.history.stack[trace.history.index].refinementBase).toBe(trace.outline);
    expect(trace.calibration).toBe(calibration); expect(trace.imageSize).toEqual({ width: 200, height: 150 });
    const changed = trace.outline;
    React.act(() => trace.undo()); expect(trace.outline).toBe(original);
    React.act(() => trace.redo()); expect(trace.outline).toBe(changed);
  });

  it("previews upright rotation without moving the photo comparison or committing on Cancel", () => {
    ready(); const original = trace.outline, history = trace.history;
    click("Symmetry & straighten"); const originalPreview = preview();
    expect(uprightPreview()).toBeUndefined();
    toggleUpright();
    expect(uprightPreview()).toBeTruthy(); expect(uprightPreview()).not.toEqual(originalPreview);
    expect(preview()).toEqual(originalPreview);
    toggleUpright(); expect(uprightPreview()).toBeUndefined(); expect(preview()).toEqual(originalPreview);
    toggleUpright(); click("Cancel");
    expect(trace.outline).toBe(original); expect(trace.history).toBe(history);
  });

  it("applies the upright preview as one edit, keeping other shapes and calibration unchanged", () => {
    ready(); const original = trace.outline, history = trace.history, image = trace.imageUrl;
    click("Symmetry & straighten"); toggleUpright(); const expected = uprightPreview();
    click("Apply symmetry & rotation");
    expect(outlineToPathData([trace.outline[1]])).toEqual(expected);
    const uprightAxis = suggestSymmetryAxis(trace.outline[1].outer);
    expect(uprightAxis.start.x).toBeCloseTo(uprightAxis.end.x, 8);
    expect(uprightAxis.end.y).toBeGreaterThan(uprightAxis.start.y);
    expect(trace.outline[0]).toBe(original[0]); expect(trace.calibration).toBe(calibration);
    expect(trace.imageUrl).toBe(image); expect(trace.imageSize).toEqual({ width: 200, height: 150 });
    expect(trace.history.index).toBe(history.index + 1);
    expect(trace.history.stack[trace.history.index].label).toBe("Make contour symmetric and upright");
    const changed = trace.outline;
    React.act(() => trace.undo()); expect(trace.outline).toBe(original);
    React.act(() => trace.redo()); expect(trace.outline).toBe(changed);
  });

  it("dismisses a stale preview after another edit or source replacement", () => {
    ready(); click("Symmetry & straighten");
    React.act(() => trace.dispatch({ type: "OUTLINE_COMMITTED", outline: [...trace.outline] }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click("Symmetry & straighten");
    React.act(() => trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "replacement", fileName: "new" }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("blocks unsupported holes instead of removing them", () => {
    ready();
    React.act(() => trace.dispatch({ type: "OUTLINE_COMMITTED", outline: [
      outline[0], { ...outline[1], holes: [rectRing(83, 20, 2, 5)] },
    ] }));
    click("Symmetry & straighten");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("interior holes");
    expect(button("Apply symmetry").disabled).toBe(true);
  });

  it("rolls back a cancelled pointer drag without committing anything", () => {
    ready(); const history = trace.history;
    click("Symmetry & straighten"); const initial = preview();
    const canvas = document.querySelector<SVGSVGElement>('[data-testid="symmetry-preview"]')!;
    const handle = document.querySelector('[aria-label="First axis handle"]')!;
    Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(canvas, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperty(canvas, "createSVGPoint", { value: () => ({ x: 0, y: 0,
      matrixTransform() { return { x: this.x, y: this.y }; } }) });
    const pointer = (element: Element, type: string, x = 82, y = 15) => React.act(() => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
      element.dispatchEvent(event);
    });
    pointer(handle, "pointerdown"); pointer(canvas, "pointermove");
    expect(preview()).not.toEqual(initial);
    pointer(canvas, "pointercancel");
    expect(preview()).toEqual(initial); expect(trace.history).toBe(history);
  });
});
