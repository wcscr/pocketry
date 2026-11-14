// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { curvesFromOutline, editCurves, mapCurves } from "@shared/geometry/curves";
import { OUTER_RING, type Outline, type Point } from "@shared/geometry/types";

import { outlineToPathData } from "@/lib/export/svg";
import { mapOutline, outlineBounds } from "@/lib/geometry/outline";
import { rigidPoint } from "@/lib/geometry/outline-fit";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";

import { TraceContourPositionTool } from "./trace-contour-position-tool";

let trace: TraceStore;
let root: Root;
let host: HTMLDivElement;
/** 0.5 mm per pixel. */
const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 };
const outline: Outline = [
  { outer: [{ x: 20, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 110 }, { x: 20, y: 110 }], holes: [[{ x: 30, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 40 }, { x: 50, y: 20 }]] },
  { outer: [{ x: 100, y: 20 }, { x: 140, y: 20 }, { x: 150, y: 60 }, { x: 100, y: 80 }], holes: [] },
];
function Harness() { trace = useTrace(); return <TraceContourPositionTool />; }
function button(text: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text);
  expect(result, `Missing ${text}`).toBeDefined(); return result!;
}
const click = (text: string) => React.act(() => button(text).click());
const preview = () => document.querySelector('[data-testid="position-result"]')!.getAttribute("d");
const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
/** Type a value into a number field and commit it with Enter, as a person would. */
function enter(id: string, value: string) {
  React.act(() => {
    const input = field(id);
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}
const press = (selector: string, key: string, shiftKey = false) => React.act(() => {
  document.querySelector(selector)!.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
});
function ready(selected = 1) {
  React.act(() => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "driver" });
    trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 200, height: 150 } });
    trace.dispatch({ type: "SET_CALIBRATION", calibration });
    trace.dispatch({ type: "DETECTED", imageUrl: "photo", outline, rawOutline: outline, svg: "", region: null });
    trace.dispatch({ type: "SELECT_RING", selection: { shapeIndex: selected, ringIndex: OUTER_RING } });
  });
}
const centerOf = (shapes: Outline): Point => { const b = outlineBounds(shapes)!; return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; };
const closeTo = (points: Point[]) => points.map(point => ({ x: expect.closeTo(point.x, 6), y: expect.closeTo(point.y, 6) }));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  React.act(() => root.render(<TraceProvider><Harness /></TraceProvider>));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("Move & rotate", () => {
  it("moves and turns the selected contour by the typed amounts as one undoable edit", () => {
    ready();
    const history = trace.history;
    click("Move & rotate");
    expect(button("Apply").disabled).toBe(true);
    expect(preview()).toBe(outlineToPathData([outline[1]]));
    enter("position-right", "5");       // 5 mm is 10 px at this scale
    enter("position-down", "-2.5");     // 2.5 mm up
    enter("position-turn", "90");
    const pose = { radians: Math.PI / 2, pivot: centerOf([outline[1]]), shift: { x: 10, y: -5 } };
    const expected = mapOutline([outline[1]], point => rigidPoint(point, pose))[0];
    expect(preview()).toBe(outlineToPathData([expected]));
    expect(trace.history).toBe(history);

    click("Apply");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trace.outline[0]).toBe(outline[0]);
    expect(trace.outline[1].outer).toEqual(closeTo(expected.outer));
    expect(trace.history.index).toBe(history.index + 1);
    expect(trace.history.stack.at(-1)!.label).toBe("Move and rotate contour");
    React.act(() => trace.undo());
    expect(trace.outline).toEqual(outline);
    React.act(() => trace.redo());
    expect(trace.outline[1].outer).toEqual(closeTo(expected.outer));
  });

  it("carries a contour's holes with it", () => {
    ready(0);
    click("Move & rotate");
    enter("position-turn", "180");
    click("Apply");
    const pose = { radians: Math.PI, pivot: centerOf([outline[0]]), shift: { x: 0, y: 0 } };
    expect(trace.outline[0].outer).toEqual(closeTo(outline[0].outer.map(point => rigidPoint(point, pose))));
    expect(trace.outline[0].holes[0]).toEqual(closeTo(outline[0].holes[0].map(point => rigidPoint(point, pose))));
    expect(trace.outline[1]).toEqual(outline[1]);
    expect(trace.history.stack.at(-1)!.label).toBe("Rotate contour");
  });

  it("nudges with the arrow keys on the contour and on the turn handle", () => {
    ready();
    click("Move & rotate");
    press('[data-testid="position-result"]', "ArrowRight");
    press('[data-testid="position-result"]', "ArrowRight");
    press('[data-testid="position-result"]', "ArrowUp", true);
    expect(field("position-right").value).toBe("1");      // 2 px
    expect(field("position-down").value).toBe("-2.5");   // 5 px up
    press('[aria-label^="Turn handle"]', "ArrowRight");
    press('[aria-label^="Turn handle"]', "ArrowLeft", true);
    expect(field("position-turn").value).toBe("-4.5");
    click("Apply");
    const pose = { radians: -4.5 * Math.PI / 180, pivot: centerOf([outline[1]]), shift: { x: 2, y: -5 } };
    expect(trace.outline[1].outer).toEqual(closeTo(outline[1].outer.map(point => rigidPoint(point, pose))));
  });

  it("moves every contour together about their common center", () => {
    ready();
    click("Move & rotate");
    enter("position-right", "3");
    click("All contours");
    // Changing what is moved starts from rest, so an offset cannot silently carry over.
    expect(field("position-right").value).toBe("0");
    click("90° right");
    click("Apply");
    const pose = { radians: Math.PI / 2, pivot: centerOf(outline), shift: { x: 0, y: 0 } };
    trace.outline.forEach((shape, index) => expect(shape.outer).toEqual(closeTo(outline[index].outer.map(point => rigidPoint(point, pose)))));
    expect(trace.history.stack.at(-1)!.label).toBe("Rotate outline");
  });

  it("moves editable curves with their handles", () => {
    ready();
    const bent = editCurves(curvesFromOutline(outline), { shapeIndex: 1, ringIndex: OUTER_RING }, { kind: "bend", index: 0, t: 0.5, delta: { x: 0, y: -4 } });
    React.act(() => trace.dispatch({ type: "CURVES_COMMITTED", curves: bent, label: "Bend edge" }));
    React.act(() => trace.dispatch({ type: "SELECT_RING", selection: { shapeIndex: 1, ringIndex: OUTER_RING } }));
    const before = trace.curves!;
    click("Move & rotate");
    expect(preview()).toContain("C");
    enter("position-right", "4");
    click("Apply");
    expect(trace.curves![0]).toEqual(before[0]);
    expect(trace.curves![1]).toEqual(mapCurves([before[1]], point => ({ x: point.x + 8, y: point.y }))[0]);
    expect(trace.history.stack.at(-1)!.label).toBe("Move contour");
    React.act(() => trace.undo());
    expect(trace.curves).toEqual(before);
  });

  it("changes nothing on Reset or Cancel", () => {
    ready();
    const history = trace.history;
    click("Move & rotate");
    enter("position-down", "6");
    expect(button("Apply").disabled).toBe(false);
    React.act(() => document.querySelector<HTMLButtonElement>('[aria-label="Reset position"]')!.click());
    expect(preview()).toBe(outlineToPathData([outline[1]]));
    expect(button("Apply").disabled).toBe(true);
    enter("position-down", "6");
    click("Cancel");
    expect(trace.history).toBe(history);
    expect(trace.outline).toBe(outline);
  });

  it("explains that editable curves cannot be moved while a trace margin is set", () => {
    React.act(() => {
      trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "driver" });
      trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 200, height: 150 } });
      trace.dispatch({ type: "SET_CALIBRATION", calibration });
      trace.dispatch({ type: "SET_MARGIN", margin: 1 });
      trace.dispatch({ type: "DETECTED", imageUrl: "photo", outline, rawOutline: outline, curves: curvesFromOutline(outline), svg: "", region: null });
    });
    click("Move & rotate");
    enter("position-right", "2");
    expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toBe("Set Margin to zero to move editable curves.");
    expect(button("Apply").disabled).toBe(true);
  });

  it("is unavailable without an outline and closes when the outline changes underneath it", () => {
    expect(button("Move & rotate").disabled).toBe(true);
    ready();
    click("Move & rotate");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    React.act(() => trace.dispatch({ type: "OUTLINE_COMMITTED", outline: [outline[0]], label: "Remove contour" }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
