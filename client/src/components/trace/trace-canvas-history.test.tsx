// @vitest-environment jsdom
import * as React from "react";
import { ExperimentalFeaturesProvider } from "@/state/experimental-features";
import { setExperimentalTools } from "./trace-experimental.test-support";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Outline } from "@shared/geometry/types";
import { mmPerPixel } from "@shared/geometry/scale";
import { simplifyAcceptedOutline } from "@shared/geometry/outline-simplification";
import { curvesFromOutline, CURVE_TOLERANCE_MM, normalizeCurves, sampleCurves } from "@shared/geometry/curves";

import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { TooltipProvider } from "@/components/ui/tooltip";

import { TraceDetectionControls } from "./trace-detection-controls";
import { MAX_DETECTION_HINTS, type DetectionHint } from "@shared/geometry/detection-hints";
import { TraceCanvas as TraceCanvasComponent, type OutlineToolRequest } from "./trace-canvas";
import { TracePhotoBoundsControl } from "./trace-photo-bounds-control";
import { traceDraftSnapshot } from "@/lib/trace-draft";
import { traceDraftSchema } from "@shared/trace-draft";
import { projectFromTrace } from "@/lib/project/trace-export";
import { parseProjectDoc } from "@shared/gridfinity/project";

function TraceCanvas(props: React.ComponentProps<typeof TraceCanvasComponent>) {
  return <ExperimentalFeaturesProvider><TraceCanvasComponent {...props} /></ExperimentalFeaturesProvider>;
}

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const detected: Outline = [
  {
    outer: [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 10, y: 90 },
    ],
    holes: [],
  },
];

const edited: Outline = [
  {
    outer: [...detected[0].outer, { x: 50, y: 95 }],
    holes: [],
  },
];

function SeedTrace(): null {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({ type: "SOURCE_LOADED", imageUrl: "data:image/png;base64,AA==", fileName: "tool.png" });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    dispatch({
      type: "DETECTED",
      imageUrl: "data:image/png;base64,AA==",
      outline: detected,
      rawOutline: detected,
      svg: "<svg/>",
      region: null,
    });
    dispatch({
      type: "OUTLINE_COMMITTED",
      outline: edited,
      label: "Add contour node",
    });
    dispatch({
      type: "SET_CALIBRATION",
      calibration: {
        startX: 10,
        startY: 10,
        endX: 90,
        endY: 90,
        lengthMm: 50,
      },
    });
    dispatch({
      type: "SET_REGION",
      region: { x: 5, y: 5, width: 90, height: 90 },
    });
  }, [dispatch]);
  return null;
}

function SeedScaleDraft(): null {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,AA==",
      fileName: "tool.png",
    });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    dispatch({ type: "SET_MODE", mode: "calibrate" });
    dispatch({
      type: "SET_DRAFT_CALIBRATION",
      draftCalibration: { startX: 10, startY: 20 },
    });
  }, [dispatch]);
  return null;
}

function SeedMeasurementScale(): null {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,AA==",
      fileName: "tool.png",
    });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    dispatch({
      type: "SET_CALIBRATION",
      calibration: {
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 0,
        lengthMm: 50,
      },
    });
  }, [dispatch]);
  return null;
}

function ScaleStateProbe(): JSX.Element {
  const { mode, calibration, draftCalibration } = useTrace();
  return (
    <>
      <output data-testid="scale-mode">{mode}</output>
      <output data-testid="scale-committed">
        {calibration ? "committed" : "pending"}
      </output>
      <output data-testid="scale-draft">{JSON.stringify(draftCalibration)}</output>
      <output data-testid="scale-calibration">
        {calibration ? JSON.stringify(calibration) : "none"}
      </output>
      <output data-testid="scale-mm-per-pixel">
        {mmPerPixel(calibration)?.toFixed(6) ?? "none"}
      </output>
    </>
  );
}

function SeedPerspectiveSelection(): null {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,AA==",
      fileName: "tool.png",
    });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    dispatch({ type: "START_PERSPECTIVE_SELECTION" });
  }, [dispatch]);
  return null;
}

function SeedAutoScale({ existingManualScale = false }: { existingManualScale?: boolean }): JSX.Element {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,AA==",
      fileName: "tool.png",
    });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    if (existingManualScale) dispatch({
      type: "SET_CALIBRATION",
      calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 },
    });
    dispatch({
      type: "AUTO_CALIBRATION_DETECTED",
      sourceImageUrl: "data:image/png;base64,AA==",
      calibration: {
        startX: 10,
        startY: 10,
        endX: 90,
        endY: 90,
        lengthMm: 250,
      },
    });
  }, [dispatch, existingManualScale]);
  return (
    <button type="button" onClick={() => dispatch({ type: "ACCEPT_AUTO_CALIBRATION" })}>
      Accept auto scale
    </button>
  );
}

function installIdentitySvgCoordinates(): () => void {
  const ctmDescriptor = Object.getOwnPropertyDescriptor(
    SVGElement.prototype,
    "getScreenCTM",
  );
  const pointDescriptor = Object.getOwnPropertyDescriptor(
    SVGSVGElement.prototype,
    "createSVGPoint",
  );

  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({}) }),
  });
  Object.defineProperty(SVGSVGElement.prototype, "createSVGPoint", {
    configurable: true,
    value: () => {
      const point = {
        x: 0,
        y: 0,
        matrixTransform: () => ({ x: point.x, y: point.y }),
      };
      return point;
    },
  });

  return () => {
    if (ctmDescriptor) {
      Object.defineProperty(SVGElement.prototype, "getScreenCTM", ctmDescriptor);
    } else {
      delete (SVGElement.prototype as unknown as { getScreenCTM?: unknown })
        .getScreenCTM;
    }
    if (pointDescriptor) {
      Object.defineProperty(
        SVGSVGElement.prototype,
        "createSVGPoint",
        pointDescriptor,
      );
    } else {
      delete (SVGSVGElement.prototype as unknown as { createSVGPoint?: unknown })
        .createSVGPoint;
    }
  };
}

afterEach(() => {
  setExperimentalTools(false);
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("direct Trace contour edits", () => {
  let trace: TraceStore;
  let svg: SVGSVGElement;
  let cleanup: () => void;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restore = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Probe() { trace = useTrace(); return null; }
    cleanup = () => { React.act(() => root.unmount()); restore(); };
    await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider>
      <TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
    React.act(() => trace.dispatch({ type: "SET_MODE", mode: "edit" }));
    svg = host.querySelector('[data-testid="trace-source-image"]')!.closest("svg")!;
    Object.defineProperty(svg, "setPointerCapture", { value: () => {} });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  function pointer(type: string, x: number, y: number, target: Element = svg, pointerType = "mouse", id = 1, primary = true) {
    React.act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, {
        pointerType: { value: pointerType }, pointerId: { value: id }, isPrimary: { value: primary },
      });
      target.dispatchEvent(event);
    });
  }

  it.each(["mouse", "touch"])("sweeps several anchors in one undoable %s stroke and discards interrupted strokes", pointerType => {
    const outer = [10, 30, 50, 70, 90].map(x => ({ x, y: 10 })).concat([{ x: 90, y: 90 }, { x: 10, y: 90 }]);
    const original = [{ outer, holes: [] }];
    React.act(() => trace.dispatch({ type: "OUTLINE_COMMITTED", outline: original }));
    const button = () => [...document.querySelectorAll("button")].find(b => b.textContent === "Point eraser");
    expect(button()).toBeUndefined();
    setExperimentalTools(true);
    React.act(() => button()!.click());
    const before = trace.history;
    const draw = () => {
      pointer("pointerdown", 30, 10, svg, pointerType);
      pointer("pointermove", 70, 10, svg, pointerType);
    };
    draw();
    expect(trace.history).toBe(before);
    pointer("pointercancel", 70, 10, svg, pointerType);
    draw();
    pointer("lostpointercapture", 70, 10, svg, pointerType);
    pointer("pointerup", 70, 10, svg, pointerType);
    if (pointerType === "touch") {
      draw();
      pointer("pointerdown", 90, 15, svg, "touch", 2, false);
      pointer("pointerup", 90, 15, svg, "touch", 2, false);
      pointer("pointerup", 70, 10, svg, "touch");
    }
    expect(trace.history).toBe(before);
    draw();
    pointer("pointerup", 70, 10, svg, pointerType);
    expect(trace.outline[0].outer).toEqual([outer[0], ...outer.slice(4)]);
    expect(trace.curves).toBeUndefined();
    expect(trace.history.index).toBe(before.index + 1);
    React.act(() => trace.undo());
    expect(trace.outline).toEqual(original);
    draw();
    setExperimentalTools(false);
    pointer("pointerup", 70, 10, svg, pointerType);
    expect(trace.outline).toEqual(original);
    expect(button()).toBeUndefined();
  });

  it.each(["pointermove", "pointerup", "mixed batch"])("keeps safe erasures when %s hits a corner protecting a hole", last => {
    const outer = [10, 40, 60, 90].map(x => ({ x, y: 10 })).concat([{ x: 90, y: 90 }, { x: 10, y: 90 }]);
    const hole = [{ x: 73, y: 19 }, { x: 73, y: 27 }, { x: 81, y: 27 }, { x: 81, y: 19 }];
    const source = [{ outer, holes: [hole] }];
    React.act(() => trace.dispatch({ type: "OUTLINE_COMMITTED", outline: source }));
    setExperimentalTools(true);
    React.act(() => [...document.querySelectorAll("button")].find(b => b.textContent === "Point eraser")!.click());
    const history = trace.history;
    const rendered = () => svg.querySelector('[data-testid="detected-contour-stroke"]')!.getAttribute("d");
    let safe: string | null;
    if (last === "mixed batch") {
      // The brush crosses the protected corner first and both removable points in one event.
      pointer("pointerdown", 115, 10);
      pointer("pointermove", 40, 10);
      safe = rendered();
      expect(trace.history).toBe(history);
      pointer("pointerup", 40, 10);
    } else {
      pointer("pointerdown", 40, 10);
      pointer("pointermove", 60, 10);
      safe = rendered();
      expect(trace.history).toBe(history);
      if (last === "pointermove") {
        pointer("pointermove", 90, 10);
        expect(rendered()).toBe(safe);
      }
      pointer("pointerup", 90, 10);
    }
    expect(rendered()).toBe(safe);
    expect(trace.outline).toEqual([{ outer: [outer[0], ...outer.slice(3)], holes: [hole] }]);
    expect(trace.history.index).toBe(history.index + 1);
    // Retrying just the blocked point cannot create an empty edit.
    pointer("pointerdown", 90, 10); pointer("pointerup", 90, 10);
    expect(trace.history.index).toBe(history.index + 1);
    React.act(() => trace.undo());
    expect(trace.outline).toEqual(source);
    React.act(() => trace.redo());
    expect(rendered()).toBe(safe);
  });

  it("locks a stroke to one ring and updates every pocket that shares the erased hole", () => {
    const hole = [{ x: 25, y: 35 }, { x: 25, y: 65 }, { x: 65, y: 65 }, { x: 65, y: 35 }, { x: 45, y: 35 }];
    const outer = [{ x: 10, y: 28 }, { x: 45, y: 28 }, { x: 90, y: 28 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
    const original = [{ outer, holes: [hole] }, { outer: detected[0].outer, holes: [hole] }];
    React.act(() => trace.dispatch({ type: "OUTLINE_COMMITTED", outline: original }));
    setExperimentalTools(true);
    React.act(() => [...document.querySelectorAll("button")].find(b => b.textContent === "Point eraser")!.click());
    pointer("pointerdown", 45, 35); pointer("pointerup", 45, 28);
    expect(trace.outline[0].outer).toEqual(outer);
    expect(trace.outline[0].holes[0]).toEqual(hole.slice(0, 4));
    expect(trace.outline[1].holes[0]).toEqual(hole.slice(0, 4));
    React.act(() => trace.undo());
    expect(trace.outline).toEqual(original);
  });

  it("erases actual curve anchors and restores handles exactly on Undo", () => {
    const source = curvesFromOutline([{ outer: [
      { x: 10, y: 10 }, { x: 30, y: 10 }, { x: 50, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 },
    ], holes: [] }]);
    source[0].outer[4].out = { x: 67, y: 98 };
    React.act(() => trace.dispatch({ type: "CURVES_COMMITTED", curves: source, label: "Curved base" }));
    setExperimentalTools(true);
    React.act(() => [...document.querySelectorAll("button")].find(b => b.textContent === "Point eraser")!.click());
    pointer("pointerdown", 30, 10); pointer("pointerup", 50, 10);
    expect(trace.curves?.[0].outer).toHaveLength(4);
    expect(trace.curves?.[0].outer[2].out).toEqual(source[0].outer[4].out);
    React.act(() => trace.undo());
    expect(trace.curves).toEqual(source);
    const history = trace.history;
    pointer("pointerdown", 30, 10);
    React.act(() => { trace.undo(); pointer("pointerup", 50, 10); });
    expect(trace.history.stack).toBe(history.stack);
    expect(trace.history.index).toBe(history.index - 1);
  });

  it.each([0, 1])("moves and cancels a shared hole from pocket %i", shapeIndex => {
    const hole = [{ x: 35, y: 35 }, { x: 35, y: 65 }, { x: 65, y: 65 }, { x: 65, y: 35 }];
    const innerPocket = detected[0].outer.map(p => ({ x: p.x * .8 + 10, y: p.y * .8 + 10 }));
    const independentHole = hole.map(p => ({ x: p.x / 10 + 20, y: p.y / 10 + 20 }));
    const original = [{ outer: detected[0].outer, holes: [hole, independentHole] },
      { outer: innerPocket, holes: [[...hole.slice(2), ...hole.slice(0, 2)]] }];
    React.act(() => {
      trace.dispatch({ type: "OUTLINE_COMMITTED", outline: original, label: "Add shared hole" });
      trace.dispatch({ type: "SELECT_RING", selection: { shapeIndex, ringIndex: 0 } });
    });
    const start = trace.history;
    pointer("pointerdown", 35, 35);
    for (const x of [45, 50]) {
      pointer("pointermove", x, 38);
      for (const pocket of trace.outline) expect(pocket.holes[0]).toContainEqual({ x, y: 38 });
      expect(trace.history).toBe(start);
    }
    const preview = trace.outline;
    pointer("pointerup", 50, 38);
    expect(trace.outline).toEqual(preview);
    expect(trace.outline[0].holes[1]).toEqual(independentHole);
    expect(trace.history.index).toBe(start.index + 1);
    React.act(() => trace.undo());
    expect(trace.outline).toEqual(original);
    React.act(() => trace.redo());
    expect(trace.outline).toEqual(preview);
    const committed = trace.history;
    pointer("pointerdown", 50, 38); pointer("pointermove", 60, 44); pointer("pointercancel", 60, 44);
    expect(trace.outline).toEqual(preview);
    expect(trace.history).toBe(committed);
  });

  it.each(["undo", "redo", "jump"] as const)("discards a held drag across %s and preserves its destination", action => {
    const before = trace.history.index;
    pointer("pointerdown", 50, 10); pointer("pointerup", 50, 10);
    const added = trace.history.index;
    expect(added).toBe(before + 1);
    if (action === "redo") React.act(() => trace.undo());
    pointer("pointerdown", 10, 10); pointer("pointermove", 29, 30);
    expect(trace.outline[0].outer[0]).toEqual({ x: 29, y: 30 });
    React.act(() => {
      if (action === "jump") trace.dispatch({ type: "JUMP_TO_HISTORY", index: before - 1 });
      else window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: action === "redo" }));
    });
    const destination = trace.history;
    expect(destination.index).toBe(action === "jump" ? before - 1 : action === "undo" ? before : added);
    const restored = destination.stack[destination.index].outline;
    pointer("pointermove", 34, 32); pointer("pointerup", 34, 32);
    expect(trace.outline).toBe(restored);
    expect(trace.history).toBe(destination);
    // A new gesture at the restored position still works.
    pointer("pointerdown", 10, 10); pointer("pointermove", 23, 24); pointer("pointerup", 23, 24);
    expect(trace.outline[0].outer[0]).toEqual({ x: 23, y: 24 });
  });

  it.each(["pointerup", "pointercancel"])("rejects a stale %s batched with Undo", type => {
    const before = trace.history;
    pointer("pointerdown", 10, 10); pointer("pointermove", 28, 29);
    React.act(() => {
      trace.undo();
      pointer(type, 28, 29);
    });
    expect(trace.history.stack).toBe(before.stack);
    expect(trace.history.index).toBe(before.index - 1);
    expect(trace.outline).toBe(before.stack[before.index - 1].outline);
  });

  it("accepts the next finger after Undo restores curves during a touch drag", () => {
    React.act(() => {
      trace.dispatch({ type: "CURVES_COMMITTED", curves: curvesFromOutline(detected), label: "Create curves" });
      trace.dispatch({ type: "SET_EDITABLE_CURVES", enabled: false });
    });
    pointer("pointerdown", 10, 10, svg, "touch"); pointer("pointermove", 35, 35, svg, "touch");
    React.act(() => trace.undo());
    expect(trace.curves).toBeDefined();
    pointer("pointerup", 35, 35, svg, "touch");
    React.act(() => trace.redo());
    expect(trace.curves).toBeUndefined();
    pointer("pointerdown", 10, 10, svg, "touch", 2);
    pointer("pointermove", 34, 37, svg, "touch", 2);
    pointer("pointerup", 34, 37, svg, "touch", 2);
    expect(trace.outline[0].outer[0]).toEqual({ x: 34, y: 37 });
  });

  it.each(["blur", "lostpointercapture"])("rolls back a drag on %s and accepts the next finger", interruption => {
    const original = trace.outline, history = trace.history;
    const transform = () => svg.querySelector("g[transform]")!.getAttribute("transform");
    const view = transform();
    pointer("pointerdown", 10, 10, svg, "touch");
    pointer("pointermove", 35, 36, svg, "touch");
    // A descendant can lose implicit touch capture when the canvas takes it.
    pointer("lostpointercapture", 35, 36, svg.querySelector("[data-vertex]")!, "touch");
    pointer("lostpointercapture", 35, 36, svg, "touch", 2);
    expect(trace.outline[0].outer[0]).toEqual({ x: 35, y: 36 });
    if (interruption === "blur") React.act(() => window.dispatchEvent(new Event("blur")));
    else pointer("lostpointercapture", 35, 36, svg, "touch");
    // The previous pointer may never deliver an up to the canvas.
    pointer("pointermove", 42, 43, svg, "touch");
    expect(trace.outline).toEqual(original);
    expect(trace.history).toBe(history);
    pointer("pointerdown", 10, 10, svg, "touch", 3);
    pointer("pointermove", 31, 32, svg, "touch", 3);
    pointer("pointerup", 31, 32, svg, "touch", 3);
    expect(trace.outline[0].outer[0]).toEqual({ x: 31, y: 32 });
    expect(trace.history.index).toBe(history.index + 1);
    expect(transform()).toBe(view);
  });

  it.each(["mouse", "touch"])("removes only the targeted coincident curve anchor with %s", pointerType => {
    React.act(() => {
      trace.dispatch({ type: "SET_EDITABLE_CURVES", enabled: true });
      trace.dispatch({ type: "ADD_CONTOUR" });
      trace.dispatch({ type: "ADD_CONTOUR" });
    });
    const lower = trace.outline[1].outer;
    const upper = trace.outline[2].outer;
    expect(upper).toEqual(lower);
    const before = trace.history;
    const remove = () => {
      const anchor = svg.querySelector<SVGCircleElement>('[data-curve-kind="point"][data-curve-shape="2"][data-curve-index="0"]')!;
      const x = Number(anchor.getAttribute("cx")), y = Number(anchor.getAttribute("cy"));
      if (pointerType === "touch") {
        pointer("pointerdown", x, y, anchor, "touch");
        React.act(() => { vi.advanceTimersByTime(700); });
        pointer("pointerup", x, y, svg, "touch");
      }
      React.act(() => anchor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: x, clientY: y })));
    };
    vi.useFakeTimers();
    remove();
    expect(trace.curves![1].outer.map(a => a.point)).toEqual(lower);
    expect(trace.curves![2].outer.map(a => a.point)).toEqual(upper.slice(1));
    remove(); // A triangle cannot lose a point, even with another square underneath.
    expect(trace.history.index).toBe(before.index + 1);
    React.act(() => trace.undo());
    expect(trace.outline).toEqual(before.stack[before.index].outline);
  });
});

describe("TraceCanvas edit history", () => {
  it.each([false, true])("preserves zoom and pan when adding, undoing, and redoing a contour (mobile: %s)", async mobile => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", mobile ? 390 : 1200);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }));
    const bounds = vi.spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, mobile ? 390 : 1000, 600));
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    let trace: TraceStore;
    function Probe(): null { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      React.act(() => trace!.dispatch({ type: "SOURCE_READY", imageSize: { width: 800, height: 600 } }));
      const svg = host.querySelector("svg")!;
      const transform = () => svg.querySelector("g[transform]")!.getAttribute("transform");
      const fitted = transform();
      React.act(() => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in (+)"]')!.click());
      React.act(() => svg.dispatchEvent(new WheelEvent("wheel", { deltaX: 37, deltaY: 53, bubbles: true, cancelable: true })));
      const positioned = transform();
      expect(positioned).not.toBe(fitted);

      React.act(() => trace!.dispatch({ type: "ADD_CONTOUR" }));
      expect(trace!.outline).toHaveLength(2);
      expect(trace!.selection).toEqual({ shapeIndex: 1, ringIndex: -1 });
      expect(transform()).toBe(positioned);
      React.act(() => trace!.undo());
      expect(trace!.outline).toHaveLength(1);
      expect(transform()).toBe(positioned);
      React.act(() => trace!.redo());
      expect(trace!.outline).toHaveLength(2);
      expect(transform()).toBe(positioned);
    } finally { React.act(() => root.unmount()); bounds.mockRestore(); }
  });

  it.each(["mouse", "touch"])("edits a new square immediately with %s and undoes creation independently", async pointerType => {
    const mobile = pointerType === "touch";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", mobile ? 390 : 1200);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }));
    const restoreCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    let trace: TraceStore;
    function Probe(): null { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      const original = trace!.outline;
      React.act(() => {
        trace!.dispatch({ type: "SOURCE_READY", imageSize: { width: 800, height: 600 } });
        trace!.dispatch({ type: "SET_REGION", region: { x: 100, y: 200, width: 400, height: 200 } });
        trace!.dispatch({ type: "ADD_CONTOUR" });
      });
      const square = trace!.outline[1].outer;
      const svg = host.querySelector("svg")!;
      Object.defineProperty(svg, "setPointerCapture", { value: () => {} });
      const pointer = (type: string, x: number, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: 1 }, isPrimary: { value: true } });
        svg.dispatchEvent(event);
      });
      pointer("pointerdown", 300, 275); pointer("pointerup", 300, 275);
      expect(trace!.outline[1].outer).toHaveLength(5);
      pointer("pointerdown", 300, 275); pointer("pointermove", 300, 250); pointer("pointerup", 300, 250);
      expect(trace!.outline[1].outer).toContainEqual({ x: 300, y: 250 });
      expect(trace!.outline[0]).toEqual(original[0]);
      React.act(() => trace!.undo());
      expect(trace!.outline[1].outer).toContainEqual({ x: 300, y: 275 });
      React.act(() => trace!.undo());
      expect(trace!.outline[1].outer).toEqual(square);
      React.act(() => trace!.undo());
      expect(trace!.outline).toEqual(original);
      React.act(() => trace!.redo());
      expect(trace!.outline[1].outer).toEqual(square);
      // Two untouched starter squares coincide. Point insertion must still
      // target the newly selected contour, not the older one underneath it.
      React.act(() => trace!.dispatch({ type: "ADD_CONTOUR" }));
      pointer("pointerdown", 300, 275); pointer("pointerup", 300, 275);
      expect(trace!.outline[2].outer).toHaveLength(5);
      expect(trace!.outline[1].outer).toEqual(square);
      pointer("pointerdown", 275, 275); pointer("pointermove", 255, 255); pointer("pointerup", 255, 255);
      expect(trace!.outline[2].outer[0]).toEqual({ x: 255, y: 255 });
      expect(trace!.outline[1].outer).toEqual(square);
      expect(host.querySelector('[aria-label="Outline editing controls"]')?.querySelectorAll("button")).toHaveLength(1);
      expect(host.querySelector('[data-testid="selected-outline-point"]')).toBeNull();
      React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" })));
      expect(trace!.outline[2].outer).toHaveLength(5);
      const contextMenu = () => React.act(() => svg.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 255, clientY: 255 })));
      if (mobile) {
        vi.useFakeTimers();
        try {
          pointer("pointerdown", 255, 255); pointer("pointercancel", 255, 255);
          React.act(() => { vi.advanceTimersByTime(700); });
          expect(trace!.outline[2].outer).toHaveLength(5);
          pointer("pointerdown", 255, 255);
          React.act(() => { vi.advanceTimersByTime(700); });
          pointer("pointerup", 255, 255);
        } finally { vi.useRealTimers(); }
      }
      // A native touch context menu may follow the hold. It must not delete twice.
      contextMenu();
      expect(trace!.outline[2].outer).toHaveLength(4);
      React.act(() => trace!.undo());
      expect(trace!.outline[2].outer[0]).toEqual({ x: 255, y: 255 });
    } finally { React.act(() => root.unmount()); restoreCoordinates(); }
  });

  it("edits curve handles in standard mode and preserves them across the experimental switch", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    let trace!: TraceStore;
    function Probe() { trace = useTrace(); return null; }
    const pointer = (target: Element, type: string, x: number, y: number) => React.act(() => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerType: { value: "mouse" }, pointerId: { value: 1 } });
      target.dispatchEvent(event);
    });
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      React.act(() => {
        trace.dispatch({ type: "OUTLINE_COMMITTED", outline: detected });
        trace.dispatch({ type: "SET_MODE", mode: "edit" });
      });
      expect(host.querySelector('[data-testid="curve-control-handle"]')).toBeNull();
      React.act(() => trace.dispatch({ type: "SET_EDITABLE_CURVES", enabled: true }));
      const history = trace.history;
      const point = host.querySelector('[data-curve-kind="point"][data-curve-index="0"]')!;
      const svg = point.closest("svg")!;
      pointer(point, "pointerdown", 10, 10); pointer(svg, "pointerup", 10, 10);
      expect(trace.history).toBe(history);
      expect(host.querySelectorAll('[data-testid="curve-control-handle"]')).toHaveLength(2);
      expect(host.querySelector('[data-testid="curve-editor-controls"]')).toBeNull();
      const handle = host.querySelector('[data-curve-kind="out"]')!;
      const x = Number(handle.getAttribute("cx"));
      pointer(handle, "pointerdown", x, 10); pointer(svg, "pointermove", x, 16); pointer(svg, "pointerup", x, 16);
      expect(trace.curves?.[0].outer[0].out).toEqual({ x, y: 16 });
      const curves = trace.curves;
      const straightEdge = host.querySelector('[data-curve-kind="edge"][data-curve-index="1"]')!;
      pointer(straightEdge, "pointerdown", 90, 50); pointer(svg, "pointerup", 90, 50);
      const split = trace.curves!;
      expect(split[0].outer).toHaveLength(5);
      expect(split[0].outer[0].out).toEqual({ x, y: 16 });
      React.act(() => svg.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 90, clientY: 50 })));
      expect(trace.curves?.[0].outer).toHaveLength(4);
      React.act(() => trace.undo()); expect(trace.curves).toEqual(split);
      React.act(() => trace.undo()); expect(trace.curves).toEqual(curves);
      const restored = trace.curves;
      const edge = host.querySelector('[data-curve-kind="edge"]')!;
      pointer(edge, "pointerdown", 50, 13); pointer(svg, "pointermove", 50, 27); pointer(svg, "pointerup", 50, 27);
      expect(trace.curves).toBe(restored);
      setExperimentalTools(true);
      expect(host.querySelector('[data-testid="curve-editor-controls"]')).not.toBeNull();
      setExperimentalTools(false);
      expect(host.querySelector('[data-testid="curve-editor-controls"]')).toBeNull();
      expect(trace.curves).toBe(restored);
      expect(trace.history.index).toBe(history.index + 1);
      React.act(() => trace.undo());
      expect(trace.curves).toBeUndefined(); expect(trace.outline).toEqual(detected);
    } finally { React.act(() => root.unmount()); restoreCoordinates(); }
  });

  it.each(["auto", "range", "reconstruct", "reconstruct-edited"])("keeps %s fitting opt-in and undoable through Trace recovery and Bin transfer", async mode => {
    setExperimentalTools(true);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    let trace: TraceStore;
    function Probe() { trace = useTrace(); return null; }
    const rounded: Outline = [{ outer: Array.from({ length: 48 }, (_, i) => ({ x: 50 + 40 * Math.cos(i * Math.PI / 24), y: 50 + 40 * Math.sin(i * Math.PI / 24) })), holes: [] }];
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      React.act(() => {
        trace!.dispatch({ type: "SET_EDITABLE_CURVES", enabled: true });
        if (mode.startsWith("reconstruct")) {
          const dense: Outline = [{ outer: Array.from({ length: 256 }, (_, i) => ({ x: 50 + 40 * Math.cos(i * Math.PI / 128), y: 50 + 40 * Math.sin(i * Math.PI / 128) })), holes: [] }];
          trace!.dispatch({ type: "DETECTED", imageUrl: trace!.imageUrl, outline: mode === "reconstruct-edited" ? dense : rounded, rawOutline: dense, svg: "", region: trace!.region });
          if (mode === "reconstruct-edited") trace!.dispatch({ type: "OUTLINE_COMMITTED", outline: rounded, label: "Manual edits" });
        } else trace!.dispatch({ type: "OUTLINE_COMMITTED", outline: rounded });
        trace!.dispatch({ type: "SET_MODE", mode: mode.startsWith("reconstruct") ? "pan" : "edit" });
      });
      const before = trace!.history.stack.length;
      const click = (name: string) => React.act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === name)!.click());
      expect(trace!.curves).toBeUndefined();
      if (mode.startsWith("reconstruct")) await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} outlineToolRequest={{ tool: "smooth", sourceRevision: trace!.sourceRevision }} /></TooltipProvider></TraceProvider>));
      else { click("Bend edges"); click(mode === "auto" ? "Auto-fit contour" : "Select a section"); }
      if (mode === "range") {
        for (const [label, value] of [["First fit point", "0"], ["Last fit point", "16"]]) React.act(() => {
          const select = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
          select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        click("Preview fit");
      }
      expect(host.querySelector('[data-testid="curve-fit-preview"]')).not.toBeNull();
      expect(trace!.history.stack).toHaveLength(before); expect(trace!.curves).toBeUndefined();
      click(mode.startsWith("reconstruct") ? "Apply" : "Apply fit");
      const curves = trace!.curves!;
      expect(curves[0].outer.length).toBeLessThan(48); expect(trace!.history.stack).toHaveLength(before + 1);
      const draft = traceDraftSchema.parse(JSON.parse(JSON.stringify(traceDraftSnapshot(trace!)!)));
      React.act(() => trace!.dispatch({ type: "TRACE_DRAFT_RESTORED", draft }));
      expect(trace!.curves).toEqual(curves);
      React.act(() => trace!.undo()); expect(trace!.curves).toBeUndefined(); expect(trace!.outline).toEqual(rounded);
      React.act(() => trace!.redo()); expect(trace!.curves).toEqual(curves);
      const project = projectFromTrace(trace!.outline, { mmPerPx: mmPerPixel(trace!.calibration)!, imageHeight: 100 }, "Fitted trace", 0, curves);
      const saved = parseProjectDoc(JSON.parse(JSON.stringify(project)))!;
      expect(saved.shapes[0].curvesMm).toEqual(project.shapes[0].curvesMm);
      expect(saved.shapes[0].curvesMm![0].outer).toHaveLength(curves[0].outer.length);
    } finally { React.act(() => root.unmount()); }
  });
  it.each([false, true])("uses one Auto preview without compounding legacy presets, including recovery and edits (curves=%s)", async editableCurves => {
    setExperimentalTools(true);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    let trace!: TraceStore; function Probe() { trace = useTrace(); return null; }

    const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!;
    const click = (label: string) => React.act(async () => button(label).click());
    const open = () => React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} outlineToolRequest={{ tool: "smooth", sourceRevision: trace.sourceRevision }} /></TooltipProvider></TraceProvider>));
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      const rounded: Outline = [{ outer: Array.from({ length: 96 }, (_, i) => {
        const angle = i * Math.PI / 48, radius = 40 + .3 * Math.sin(angle * 17);
        return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
      }), holes: [] }];
      React.act(() => { trace.dispatch({ type: "SET_EDITABLE_CURVES", enabled: editableCurves }); trace.dispatch({ type: "OUTLINE_COMMITTED", outline: rounded }); trace.dispatch({ type: "SET_MODE", mode: "pan" }); });
      const source = curvesFromOutline(trace.outline), unitsPerUnit = mmPerPixel(trace.calibration)!;
      // A synthetic draft saved by the former Balanced preset must still use
      // its original accepted source when opened in the single-preview UI.
      const legacy = simplifyAcceptedOutline({ source, tolerance: .1 / unitsPerUnit, sampleTolerance: CURVE_TOLERANCE_MM / unitsPerUnit, editableCurves });
      const autoSimplification = { source, allowance: .1, unitsPerUnit, unit: "mm" as const };
      React.act(() => trace.dispatch(editableCurves
        ? { type: "CURVES_COMMITTED", curves: legacy.curves, label: "Smooth outline", autoSimplification }
        : { type: "OUTLINE_COMMITTED", outline: legacy.curves.map(s => ({ outer: s.outer.map(a => a.point), holes: s.holes.map(r => r.map(a => a.point)) })), label: "Smooth outline", autoSimplification }));
      const legacyDraft = traceDraftSchema.parse(JSON.parse(JSON.stringify(traceDraftSnapshot(trace)!)));
      React.act(() => trace.dispatch({ type: "TRACE_DRAFT_RESTORED", draft: legacyDraft }));
      await open();
      expect(host.querySelector('[data-testid="applied-simplification"]')).toBeNull();
      expect(button("Apply").disabled).toBe(false);
      const direct = simplifyAcceptedOutline({ source, tolerance: .2 / unitsPerUnit, sampleTolerance: CURVE_TOLERANCE_MM / unitsPerUnit, editableCurves });
      await click("Apply");
      const expected = editableCurves ? sampleCurves(normalizeCurves(direct.curves), CURVE_TOLERANCE_MM / unitsPerUnit)
        : direct.curves.map(s => ({ outer: s.outer.map(a => a.point), holes: s.holes.map(r => r.map(a => a.point)) }));
      expect(trace.outline).toEqual(expected);
      expect(trace.history.stack[trace.history.index].autoSimplification).toMatchObject({ source, allowance: .2 });
      const applied = trace.outline, index = trace.history.index;
      const draft = traceDraftSchema.parse(JSON.parse(JSON.stringify(traceDraftSnapshot(trace)!)));
      React.act(() => trace.dispatch({ type: "TRACE_DRAFT_RESTORED", draft }));
      await open();
      expect(host.querySelector('[data-testid="applied-simplification"]')).not.toBeNull();
      expect(button("Apply").disabled).toBe(true);
      await click("Apply");
      expect(trace.outline).toEqual(applied); expect(trace.history.index).toBe(index);
      await click("Cancel");
      React.act(() => trace.undo());
      await open(); expect(host.querySelector('[data-testid="applied-simplification"]')).toBeNull();
      expect(button("Apply").disabled).toBe(false); await click("Cancel");
      React.act(() => trace.redo());
      await open(); expect(host.querySelector('[data-testid="applied-simplification"]')).not.toBeNull(); await click("Cancel");
      React.act(() => {
        if (trace.curves) trace.dispatch({ type: "SET_EDITABLE_CURVES", enabled: false });
        trace.dispatch({ type: "OUTLINE_COMMITTED", outline: rounded.map(s => ({ ...s, outer: s.outer.map(p => ({ ...p, x: p.x + 2 })) })) });
      });
      const editedSource = curvesFromOutline(trace.outline);
      await open(); expect(host.querySelector('[data-testid="applied-simplification"]')).toBeNull(); await click("Apply");
      expect(trace.history.stack[trace.history.index].autoSimplification?.source).toEqual(editedSource);
    } finally { React.act(() => root.unmount()); }
  });
  it.each([false, true])("auto simplifies the current native curve source (future detections use curves=%s)", async editableCurves => {
    setExperimentalTools(true);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    let trace!: TraceStore; function Probe() { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      const rounded: Outline = [{ outer: Array.from({ length: 48 }, (_, i) => ({ x: 50 + 40 * Math.cos(i * Math.PI / 24), y: 50 + 40 * Math.sin(i * Math.PI / 24) })), holes: [] }];
      React.act(() => {
        trace.dispatch({ type: "SET_EDITABLE_CURVES", enabled: true });
        trace.dispatch({ type: "CURVES_COMMITTED", curves: curvesFromOutline(rounded), label: "Edit curve" });
        if (!editableCurves) { trace.dispatch({ type: "SET_EDITABLE_CURVES", enabled: false }); trace.dispatch({ type: "UNDO" }); }
        trace.dispatch({ type: "SET_MODE", mode: "pan" });
      });
      const before = trace.curves, outline = trace.outline, index = trace.history.index;
      expect(trace.editableCurves).toBe(editableCurves); expect(before).toBeDefined();
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} outlineToolRequest={{ tool: "smooth", sourceRevision: trace.sourceRevision }} /></TooltipProvider></TraceProvider>));
      expect(host.querySelector('[data-testid="curve-fit-preview"]')).not.toBeNull();
      React.act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Apply")!.click());
      expect(trace.history.index).toBe(index + 1); expect(trace.curves).not.toEqual(before); expect(trace.outline).not.toEqual(outline);
      React.act(() => trace.undo()); expect(trace.curves).toEqual(before); expect(trace.outline).toEqual(outline);
    } finally { React.act(() => root.unmount()); }
  });
  it.each([{ editable: false, mode: "Line" }, { editable: false, mode: "Smooth curve" }, { editable: true, mode: "Line" }, { editable: true, mode: "Smooth curve" }])(
    "previews and repairs a selected section with calibration and one undo: $mode, editable $editable", async ({ editable, mode }) => {
      setExperimentalTools(true);
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", NoopResizeObserver);
      vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      const restore = installIdentitySvgCoordinates(), host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
      let trace: TraceStore; function Probe() { trace = useTrace(); return null; }
      const rounded: Outline = [{ outer: Array.from({ length: 48 }, (_, i) => ({ x: 50 + 40 * Math.cos(i * Math.PI / 24), y: 50 + 40 * Math.sin(i * Math.PI / 24) })), holes: [] }];
      try {
        await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
        React.act(() => { trace!.dispatch({ type: "OUTLINE_COMMITTED", outline: rounded }); trace!.dispatch({ type: "SET_EDITABLE_CURVES", enabled: editable }); trace!.dispatch({ type: "SET_MODE", mode: "edit" }); });
        const before = trace!.history.index, calibration = trace!.calibration;
        const click = (name: string) => React.act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === name)!.click());
        const selectEndpoints = () => {
          const svg = host.querySelector("svg")!;
          for (const index of [6, 12]) for (const type of ["pointerdown", "pointerup"]) React.act(() => {
            const p = rounded[0].outer[index], event = new MouseEvent(type, { bubbles: true, button: 0, clientX: p.x, clientY: p.y, shiftKey: true });
            Object.defineProperties(event, { pointerType: { value: "mouse" }, pointerId: { value: 1 } }); svg.dispatchEvent(event);
          });
        };
        selectEndpoints(); click("Repair section"); expect(host.querySelector('[data-testid="outline-repair-preview"]')).not.toBeNull();
        expect(trace!.history.index).toBe(before); click("Cancel repair"); expect(trace!.outline).toEqual(rounded);
        selectEndpoints(); click("Repair section"); click(mode); click("Apply repair");
        expect(trace!.history.index).toBe(before + 1); expect(trace!.calibration).toEqual(calibration);
        expect(!!trace!.curves).toBe(editable);
        if (editable && mode === "Smooth curve") expect(trace!.curves![0].outer.some(a => a.in || a.out)).toBe(true);
        const after = trace!.outline, curves = trace!.curves;
        for (const index of [6, 12]) expect(after[0].outer).toContainEqual(rounded[0].outer[index]);
        React.act(() => trace!.undo()); expect(trace!.outline).toEqual(rounded); expect(trace!.curves).toBeUndefined(); expect(trace!.calibration).toEqual(calibration);
        React.act(() => trace!.redo()); expect(trace!.outline).toEqual(after); expect(trace!.curves).toEqual(curves);
      } finally { React.act(() => root.unmount()); host.remove(); restore(); }
    });
  it("opens curve editing on the real canvas and keeps an edge bend as one undoable source edit", async () => {
    setExperimentalTools(true);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restore = installIdentitySvgCoordinates();
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    let trace: TraceStore;
    function Probe() { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      React.act(() => trace!.dispatch({ type: "SET_MODE", mode: "edit" }));
      React.act(() => trace!.dispatch({ type: "SET_EDITABLE_CURVES", enabled: true }));
      const entry = host.querySelector<HTMLButtonElement>('[data-testid="button-edit-curves"]');
      expect(entry).not.toBeNull(); React.act(() => entry!.click());
      const before = trace!.history.stack.length;
      const bend = host.querySelector<HTMLButtonElement>('[aria-label="Bend curve outward"]')!;
      React.act(() => bend.click());
      const curves = trace!.curves;
      expect(curves?.[0].outer).toHaveLength(edited[0].outer.length);
      expect(host.querySelector('[data-testid="curve-source-path"]')!.getAttribute("d")).toContain("C");
      expect(trace!.history.stack).toHaveLength(before + 1);
      React.act(() => trace!.undo()); expect(trace!.curves).toBeUndefined(); expect(trace!.outline).toEqual(edited);
      React.act(() => trace!.redo()); expect(trace!.curves).toEqual(curves);
    } finally { React.act(() => root.unmount()); restore(); }
  });
  it.each(["click", "tiny", "cancel", "escape", "commit", "decline"])("preserves edited geometry through region %s", async gesture => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restore = installIdentitySvgCoordinates();
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    let trace: TraceStore;
    function Probe() { trace = useTrace(); return null; }
    const reprocess = vi.fn();
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={reprocess} /></TooltipProvider></TraceProvider>));
      const before = trace!;
      const svg = host.querySelector("svg")!;
      Object.defineProperty(svg, "setPointerCapture", { value: () => {} });
      const pointer = (type: string, x: number, y: number) => React.act(() => svg.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })));
      React.act(() => trace.dispatch({ type: "SET_MODE", mode: "region" }));
      pointer("pointerdown", 20, 20);
      if (gesture !== "click") pointer("pointermove", gesture === "tiny" ? 22 : 70, 70);
      if (gesture === "escape") React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      pointer(gesture === "cancel" ? "pointercancel" : "pointerup", 70, 70);
      expect(trace!.outline).toBe(before.outline);
      expect(trace!.history).toBe(before.history);
      expect(trace!.region).toEqual(before.region);
      expect(reprocess).not.toHaveBeenCalled();
      if (gesture === "commit" || gesture === "decline") {
        const dialog = document.querySelector('[role="alertdialog"]')!;
        expect(dialog.textContent).toContain("Re-detect in a new region?");
        const action = [...dialog.querySelectorAll('button')].find(button => button.textContent === (gesture === "commit" ? "Replace manual edits" : "Keep my edits"))!;
        await React.act(async () => action.click());
      }
      expect(trace!.region).toEqual(gesture === "commit" ? { x: 20, y: 20, width: 50, height: 50 } : before.region);
      expect(reprocess).toHaveBeenCalledTimes(gesture === "commit" ? 1 : 0);
      if (gesture === "commit") expect(reprocess).toHaveBeenLastCalledWith({ x: 20, y: 20, width: 50, height: 50 });
      React.act(() => trace.undo());
      expect(trace!.outline).toEqual(detected);
    } finally { React.act(() => root.unmount()); restore(); }
  });

  it.each([false, true])("blocks region drawing until scale is accepted (pending: %s)", async pending => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restore = installIdentitySvgCoordinates();
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    let trace: TraceStore;
    function Probe() { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      React.act(() => {
        trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "tool" });
        trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
        if (pending) trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: "photo", calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 } });
        trace.dispatch({ type: "SET_MODE", mode: "region" });
      });
      const regionButton = host.querySelector<HTMLButtonElement>('[aria-label="Region"]')!;
      expect(regionButton.disabled).toBe(true);
      const svg = host.querySelector("svg")!;
      Object.defineProperty(svg, "setPointerCapture", { value: () => {} });
      React.act(() => svg.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20 })));
      expect(trace!.region).toBeNull();
    } finally { React.act(() => root.unmount()); restore(); }
  });

  it("clips to the paper by default and reveals the same corrected image when toggled", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let trace: TraceStore;
    function Probe() { trace = useTrace(); return <TracePhotoBoundsControl />; }
    try {
      await React.act(async () => root.render(<TraceProvider><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      await React.act(async () => {
        trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "original", fileName: "large-tool" });
        trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 1000, height: 800 } });
        trace.dispatch({ type: "PERSPECTIVE_APPLIED", sourceImageUrl: "original", imageUrl: "corrected",
          imageSize: { width: 1000, height: 800 }, paper: "a4", source: "template",
          calibration: { startX: 200, startY: 100, endX: 410, endY: 100, lengthMm: 210 },
          paperBounds: { x: 200, y: 100, width: 210, height: 297 } });
      });
      const crop = () => host.querySelector('[data-testid="trace-paper-crop"]');
      expect(crop()?.getAttribute("x")).toBe("200");
      expect(crop()?.getAttribute("width")).toBe("210");
      const sourceImage = host.querySelector('[data-testid="trace-source-image"]');
      const scale = trace!.calibration;
      const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
      await React.act(async () => toggle.click());
      expect(crop()).toBeNull();
      expect(host.querySelector('[data-testid="trace-source-image"]')).toBe(sourceImage);
      expect(trace!.calibration).toBe(scale);
      await React.act(async () => toggle.click());
      expect(crop()?.getAttribute("width")).toBe("210");
      await React.act(async () => trace.dispatch({ type: "ROTATE_SOURCE", direction: "clockwise",
        naturalSize: { width: 1000, height: 800 }, maxSize: { width: 1200, height: 1200 } }));
      expect(crop()?.getAttribute("width")).toBe("297");
      expect(crop()?.getAttribute("height")).toBe("210");
      expect(trace!.perspectiveCorrection?.showFullPhoto).toBe(false);
    } finally { React.act(() => root.unmount()); }
  });

  it("allows button-focused Undo and Redo while leaving zoom, dialogs and earlier handlers alone", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await React.act(async () => {
        root.render(<TraceProvider><SeedTrace /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>);
      });
      const outlinePath = () => host.querySelector('[data-testid="detected-contour-stroke"]')?.getAttribute("d");
      const editedPath = outlinePath();
      expect(editedPath).toBeTruthy();
      const key = (target: EventTarget, value: string, ctrlKey = false, handled = false) => {
        const event = new KeyboardEvent("keydown", { key: value, ctrlKey, bubbles: true, cancelable: true });
        if (handled) event.preventDefault();
        React.act(() => target.dispatchEvent(event));
        return event;
      };
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      document.body.appendChild(dialog);
      expect(key(window, "z", true).defaultPrevented).toBe(false);
      expect(key(window, "+").defaultPrevented).toBe(false);
      expect(outlinePath()).toBe(editedPath);
      dialog.remove();

      const button = host.querySelector('[aria-label="Set scale"]')!;
      expect(key(button, "z", true).defaultPrevented).toBe(true);
      expect(outlinePath()).not.toBe(editedPath);
      expect(key(button, "y", true).defaultPrevented).toBe(true);
      expect(outlinePath()).toBe(editedPath);
      expect(key(button, "1").defaultPrevented).toBe(false);
      key(window, "z", true, true);
      expect(outlinePath()).toBe(editedPath);

      expect(key(window, "z", true).defaultPrevented).toBe(true);
      expect(outlinePath()).not.toBe(editedPath);
      expect(key(window, "+").defaultPrevented).toBe(true);
    } finally { React.act(() => root.unmount()); }
  });

  it("opens canvas toolbar tips below the toolbar", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedTrace />
            <TooltipProvider delayDuration={0}>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const setScale = host.querySelector<HTMLButtonElement>(
        '[aria-label="Set scale"]',
      );
      await React.act(async () => {
        const hover = new MouseEvent("pointermove", { bubbles: true });
        Object.defineProperty(hover, "pointerType", { value: "mouse" });
        setScale?.dispatchEvent(hover);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(host.innerHTML).toContain('data-side="bottom"');
      expect(host.innerHTML).toContain("Set scale");
    } finally {
      React.act(() => root.unmount());
    }
  });

  it("exposes named history beside the undo and redo controls", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await React.act(async () => {
      root.render(
        <TraceProvider>
          <SeedTrace />
          <TooltipProvider>
            <TraceCanvas onReprocess={() => {}} />
          </TooltipProvider>
        </TraceProvider>,
      );
      await Promise.resolve();
    });

    const history = host.querySelector(
      '[data-testid="button-trace-history"]',
    ) as HTMLButtonElement;
    expect(history).not.toBeNull();
    React.act(() => history.click());
    expect(document.body.textContent).toContain("Detected outline");
    expect(document.body.textContent).toContain("Add contour node");
    expect(host.querySelector('[aria-label^="Undo Add contour node"]')).not.toBeNull();

    const fill = host.querySelector('[data-testid="detected-contour-fill"]');
    const halo = host.querySelector('[data-testid="detected-contour-halo"]');
    const stroke = host.querySelector('[data-testid="detected-contour-stroke"]');
    const region = host.querySelector('[data-testid="detection-region-outline"]');
    expect(fill?.getAttribute("class")).toContain("fill-fuchsia-500/10");
    expect(halo?.getAttribute("stroke-width")).toBe("6");
    expect(halo?.getAttribute("class")).toContain("stroke-white/95");
    expect(stroke?.getAttribute("stroke-width")).toBe("2.75");
    expect(stroke?.getAttribute("class")).toContain("stroke-fuchsia-500/95");
    expect(region?.getAttribute("opacity")).toBe("0.4");
    // A completed ruler remains visible and editable after scale mode ends.
    expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(2);
    expect(host.querySelectorAll("[data-ruler-handle]")).toHaveLength(2);
    expect(host.querySelector('[data-testid="ruler-line"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="ruler-length-label"]')?.textContent,
    ).toContain("50 mm");

    await React.act(async () => {
      host
        .querySelector<SVGGElement>('[data-testid="ruler-length-label"]')
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await Promise.resolve();
    });
    const inlineLength = document.querySelector<HTMLInputElement>(
      '[data-testid="ruler-length-inline-input"]',
    );
    expect(inlineLength).not.toBeNull();
    expect(document.activeElement).toBe(inlineLength);

    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(inlineLength, "75");
      inlineLength?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await React.act(async () => {
      inlineLength?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(
      document.querySelector('[data-testid="ruler-length-inline-input"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="ruler-length-label"]')?.textContent,
    ).toContain("75 mm");

    React.act(() => root.unmount());
  });

  it("hides an accepted sheet ruler before region selection", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await React.act(async () => {
      root.render(
        <TraceProvider>
          <SeedAutoScale />
          <TooltipProvider>
            <TraceCanvas onReprocess={() => {}} />
          </TooltipProvider>
        </TraceProvider>,
      );
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="ruler-line"]')).not.toBeNull();
    React.act(() =>
      host
        .querySelector<HTMLButtonElement>("button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(host.querySelector('[data-testid="ruler-line"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(0);

    React.act(() => root.unmount());
  });

  it("keeps detected reference previews read-only when a manual scale remains accepted", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await React.act(async () => root.render(
        <TraceProvider><SeedAutoScale existingManualScale /><ScaleStateProbe />
          <TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider>
        </TraceProvider>,
      ));
      expect(host.querySelector('[data-testid="scale-mm-per-pixel"]')?.textContent).toBe("0.500000");
      expect(host.querySelector('[data-testid="ruler-length-label"]')?.textContent).toContain("250 mm");
      expect(host.querySelectorAll("[data-ruler-handle]")).toHaveLength(0);
      React.act(() => host.querySelector('[data-testid="ruler-length-label"]')?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }),
      ));
      expect(document.querySelector('[data-testid="ruler-length-inline-input"]')).toBeNull();
      expect(host.querySelector('[data-testid="scale-mm-per-pixel"]')?.textContent).toBe("0.500000");
    } finally { React.act(() => root.unmount()); }
  });

  it("replaces completed ruler points instead of restoring the old ruler", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedTrace />
            <ScaleStateProbe />
            <TooltipProvider>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const canvas = host.querySelector("svg");
      const setScale = host.querySelector<HTMLButtonElement>(
        '[aria-label="Set scale"]',
      );
      expect(canvas).not.toBeNull();
      expect(setScale).not.toBeNull();
      expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(2);

      await React.act(async () => {
        setScale?.click();
      });
      expect(host.querySelector('[data-testid="scale-mode"]')?.textContent).toBe(
        "calibrate",
      );
      expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(0);

      for (const [clientX, clientY] of [
        [20, 30],
        [75, 85],
      ]) {
        await React.act(async () => {
          canvas?.dispatchEvent(
            new MouseEvent("pointerdown", {
              bubbles: true,
              button: 0,
              clientX,
              clientY,
            }),
          );
        });
      }

      expect(host.querySelector('[data-testid="scale-mode"]')?.textContent).toBe(
        "pan",
      );
      expect(
        host.querySelector('[data-testid="scale-committed"]')?.textContent,
      ).toBe("committed");
      expect(host.querySelector('[data-testid="scale-draft"]')?.textContent).toBe(
        JSON.stringify({ startX: 20, startY: 30, endX: 75, endY: 85 }),
      );
      const line = host.querySelector('[data-testid="ruler-line"]');
      expect(line?.getAttribute("x1")).toBe("20");
      expect(line?.getAttribute("y1")).toBe("30");
      expect(line?.getAttribute("x2")).toBe("75");
      expect(line?.getAttribute("y2")).toBe("85");
      expect(line?.getAttribute("data-ruler-preview")).toBe("true");
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });

  it("measures between two points without changing the accepted scale", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedMeasurementScale />
            <ScaleStateProbe />
            <TooltipProvider>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const canvas = host.querySelector("svg");
      const measure = host.querySelector<HTMLButtonElement>(
        '[aria-label="Measure distance"]',
      );
      expect(canvas).not.toBeNull();
      expect(measure?.disabled).toBe(false);

      await React.act(async () => measure?.click());
      expect(host.querySelector('[data-testid="scale-mode"]')?.textContent).toBe(
        "measure",
      );
      expect(host.querySelector('[data-testid="ruler-overlay"]')).toBeNull();

      await React.act(async () => {
        canvas?.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 20,
            clientY: 30,
          }),
        );
      });
      await React.act(async () => {
        canvas?.dispatchEvent(
          new MouseEvent("pointermove", {
            bubbles: true,
            clientX: 60,
            clientY: 30,
          }),
        );
      });

      expect(
        host.querySelectorAll('[data-testid="measurement-marker"]'),
      ).toHaveLength(2);
      expect(
        host
          .querySelector('[data-testid="measurement-line"]')
          ?.getAttribute("data-measurement-preview"),
      ).toBe("true");
      expect(
        host.querySelector('[data-testid="measurement-length-label"]')
          ?.textContent,
      ).toContain("20 mm");

      await React.act(async () => {
        canvas?.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 60,
            clientY: 30,
          }),
        );
      });
      expect(
        host
          .querySelector('[data-testid="measurement-line"]')
          ?.getAttribute("data-measurement-preview"),
      ).toBeNull();
      expect(
        host.querySelector('[data-testid="scale-calibration"]')?.textContent,
      ).toBe(
        JSON.stringify({
          startX: 0,
          startY: 0,
          endX: 100,
          endY: 0,
          lengthMm: 50,
        }),
      );

      await React.act(async () => {
        host.querySelector<HTMLButtonElement>('[aria-label="Select"]')?.click();
      });
      expect(
        host.querySelector('[data-testid="measurement-overlay"]'),
      ).toBeNull();
      expect(
        host.querySelector('[data-testid="ruler-overlay"]'),
      ).not.toBeNull();
      expect(
        host.querySelector('[data-testid="scale-mm-per-pixel"]')?.textContent,
      ).toBe("0.500000");
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });

  it("extends the draft ruler to follow the pointer after its first marker", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedScaleDraft />
            <ScaleStateProbe />
            <TooltipProvider>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const canvas = host.querySelector("svg");
      expect(canvas).not.toBeNull();
      expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(1);

      await React.act(async () => {
        canvas?.dispatchEvent(
          new MouseEvent("pointermove", {
            bubbles: true,
            clientX: 70,
            clientY: 80,
          }),
        );
      });

      const line = host.querySelector('[data-testid="ruler-line"]');
      expect(line?.getAttribute("data-ruler-preview")).toBe("true");
      expect(line?.getAttribute("x2")).toBe("70");
      expect(line?.getAttribute("y2")).toBe("80");
      expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(2);
      expect(host.querySelector('[data-testid="ruler-length-label"]')).toBeNull();
      expect(host.querySelector('[data-testid="scale-mode"]')?.textContent).toBe(
        "calibrate",
      );
      expect(host.querySelector('[data-testid="scale-draft"]')?.textContent).toBe(
        JSON.stringify({ startX: 10, startY: 20 }),
      );
      expect(
        host.querySelector('[data-testid="scale-committed"]')?.textContent,
      ).toBe("pending");

      await React.act(async () => {
        canvas?.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 70,
            clientY: 80,
          }),
        );
      });

      expect(host.querySelector('[data-testid="scale-mode"]')?.textContent).toBe(
        "pan",
      );
      expect(
        host.querySelector('[data-testid="scale-committed"]')?.textContent,
      ).toBe("pending");
      expect(host.querySelector('[data-testid="scale-draft"]')?.textContent).toBe(
        JSON.stringify({ startX: 10, startY: 20, endX: 70, endY: 80 }),
      );
      expect(
        host.querySelector('[data-testid="ruler-line"]')?.getAttribute(
          "data-ruler-preview",
        ),
      ).toBe("true");
      expect(
        host.querySelector('[data-testid="ruler-length-label"]')?.textContent,
      ).toContain("100 mm");
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });

  it("drags either completed ruler endpoint and recalculates the scale", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedTrace />
            <ScaleStateProbe />
            <TooltipProvider>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const canvas = host.querySelector("svg");
      expect(canvas).not.toBeNull();
      Object.defineProperties(canvas!, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        hasPointerCapture: { configurable: true, value: () => false },
        releasePointerCapture: { configurable: true, value: vi.fn() },
      });

      const startHandle = host.querySelector(
        '[data-ruler-handle="start"] [data-testid="ruler-handle-hit-area"]',
      );
      expect(startHandle).not.toBeNull();
      expect(host.querySelector('[data-testid="scale-mm-per-pixel"]')?.textContent).toBe(
        "0.441942",
      );

      await React.act(async () => {
        startHandle?.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 10,
            clientY: 10,
          }),
        );
        canvas?.dispatchEvent(
          new MouseEvent("pointermove", {
            bubbles: true,
            button: 0,
            clientX: 25,
            clientY: 30,
          }),
        );
        canvas?.dispatchEvent(
          new MouseEvent("pointerup", {
            bubbles: true,
            button: 0,
            clientX: 25,
            clientY: 30,
          }),
        );
      });

      expect(host.querySelector('[data-testid="scale-calibration"]')?.textContent).toBe(
        JSON.stringify({
          startX: 25,
          startY: 30,
          endX: 90,
          endY: 90,
          lengthMm: 50,
        }),
      );
      expect(host.querySelector('[data-testid="scale-mm-per-pixel"]')?.textContent).toBe(
        "0.565233",
      );
      expect(host.querySelector('[data-testid="ruler-line"]')?.getAttribute("x1")).toBe(
        "25",
      );
      expect(host.querySelector('[data-testid="ruler-line"]')?.getAttribute("y1")).toBe(
        "30",
      );

      const endHandle = host.querySelector(
        '[data-ruler-handle="end"] [data-testid="ruler-handle-hit-area"]',
      );
      await React.act(async () => {
        endHandle?.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 90,
            clientY: 90,
          }),
        );
        canvas?.dispatchEvent(
          new MouseEvent("pointermove", {
            bubbles: true,
            button: 0,
            clientX: 130,
            clientY: -20,
          }),
        );
        canvas?.dispatchEvent(
          new MouseEvent("pointerup", {
            bubbles: true,
            button: 0,
            clientX: 130,
            clientY: -20,
          }),
        );
      });

      expect(host.querySelector('[data-testid="scale-calibration"]')?.textContent).toBe(
        JSON.stringify({
          startX: 25,
          startY: 30,
          endX: 99,
          endY: 0,
          lengthMm: 50,
        }),
      );
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });

  it("places four manual perspective corners and closes the correction quad", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedPerspectiveSelection />
            <TooltipProvider>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const canvas = host.querySelector("svg");
      expect(canvas).not.toBeNull();
      const points = [
        [10, 10],
        [90, 12],
        [88, 90],
        [12, 88],
      ];
      for (const [clientX, clientY] of points) {
        await React.act(async () => {
          canvas?.dispatchEvent(
            new MouseEvent("pointerdown", {
              bubbles: true,
              button: 0,
              clientX,
              clientY,
            }),
          );
        });
      }

      expect(host.querySelectorAll('[data-testid="perspective-marker"]')).toHaveLength(
        4,
      );
      expect(host.querySelectorAll("[data-perspective-handle]")).toHaveLength(4);
      expect(
        host.querySelector('[data-testid="perspective-outline"]')?.getAttribute("d"),
      ).toContain("Z");
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });
});

describe("desktop point focus", () => {
  it("selects and deselects without changing geometry in Select", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restore = installIdentitySvgCoordinates();
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    let trace: TraceStore;
    function Probe(): null { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      React.act(() => trace!.dispatch({ type: "SET_MODE", mode: "pan" }));
      const before = trace!;
      const svg = host.querySelector("svg")!;
      Object.defineProperty(svg, "setPointerCapture", { value: () => {} });
      const pointer = (type: string, x: number, y: number) => React.act(() => svg.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })));
      for (const [x, y] of [[10, 10], [50, 10]]) {
        pointer("pointerdown", x, y); pointer("pointerup", x, y);
        expect(trace!.selection).toEqual({ shapeIndex: 0, ringIndex: -1 });
        expect(host.querySelector("[data-vertex]")).toBeNull();
        expect(host.querySelector('[aria-label="Contour editing tools"]')).toBeNull();
      }
      pointer("pointerdown", 10, 10); pointer("pointermove", 35, 35); pointer("pointerup", 35, 35);
      const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
      React.act(() => svg.dispatchEvent(menu));
      expect(menu.defaultPrevented).toBe(true);
      expect(document.querySelector('[role="menu"]')?.textContent).toContain("Properties");
      React.act(() => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      pointer("pointerdown", 200, 200); pointer("pointerup", 200, 200);
      expect(trace!.selection).toBeNull();
      pointer("pointerdown", 50, 10); pointer("pointerup", 50, 10);
      React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(trace!.selection).toBeNull();
      expect(trace!.outline).toBe(before.outline);
      expect(trace!.history).toBe(before.history);
    } finally { React.act(() => root.unmount()); restore(); }
  });

  it("focuses and deletes points in Edit contours", async () => {
    setExperimentalTools(true);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    let trace: ReturnType<typeof useTrace>;
    function Probe(): null { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      React.act(() => trace!.dispatch({ type: "SET_MODE", mode: "edit" }));
      const svg = host.querySelector('svg')!;
      Object.defineProperty(svg, 'setPointerCapture', { value: () => {} });
      const pointer = (type: string, x: number, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: type === 'pointermove' ? -1 : 0, clientX: x, clientY: y });
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
        svg.dispatchEvent(event);
      });
      const remove = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Delete point');
      const historyIndex = trace!.history.index;
      pointer('pointerdown', 11, 11);
      expect(host.querySelector('[data-testid="contour-magnifier"]')).not.toBeNull();
      pointer('pointermove', 11, 11);
      pointer('pointermove', 12, 12);
      pointer('pointerup', 12, 12);
      expect(host.querySelector('[data-testid="contour-magnifier"]')).toBeNull();
      expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Point eraser')).toBe(true);
      expect(host.querySelector('[aria-label="Outline editing controls"]')?.className).toContain("flex-wrap");
      expect(host.querySelector('[data-vertex="0"]')!.getAttribute('data-point-selected')).toBe('true');
      expect(trace!.history.index).toBe(historyIndex);
      expect(trace!.outline).toEqual(edited);
      pointer('pointerdown', 200, 200); pointer('pointerup', 200, 200);
      expect(trace!.selection).toEqual({ shapeIndex: 0, ringIndex: -1 });
      expect(host.querySelector('[data-vertex]')).not.toBeNull();
      expect(trace!.outline).toEqual(edited);
      expect(trace!.history.index).toBe(historyIndex);
      React.act(() => trace!.dispatch({ type: "SELECT_RING", selection: { shapeIndex: 0, ringIndex: -1 } }));
      pointer('pointerdown', 10, 10); pointer('pointerup', 10, 10);
      React.act(() => remove()!.click());
      expect(trace!.outline[0].outer).toHaveLength(4);
      expect(remove()).toBeUndefined();
      React.act(() => trace!.undo());
      expect(trace!.outline).toEqual(edited);
      React.act(() => trace!.dispatch({ type: "SELECT_RING", selection: { shapeIndex: 0, ringIndex: -1 } }));
      pointer('pointerdown', 50, 10); pointer('pointerup', 50, 10);
      expect(trace!.outline[0].outer).toHaveLength(6);
      expect(remove()).toBeDefined();
      const beforeRemoval = trace!.history.index;
      const rightClick = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 50, clientY: 10 });
      React.act(() => svg.dispatchEvent(rightClick));
      expect(rightClick.defaultPrevented).toBe(true);
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(trace!.outline[0].outer).toHaveLength(5);
      expect(trace!.history.index).toBe(beforeRemoval + 1);
      expect(remove()).toBeUndefined();
      React.act(() => trace!.undo());
      expect(trace!.outline[0].outer).toHaveLength(6);
      React.act(() => trace!.redo());
      expect(trace!.outline[0].outer).toHaveLength(5);
      pointer('pointerdown', 10, 10); pointer('pointermove', 25, 25); pointer('pointerup', 25, 25);
      expect(trace!.outline[0].outer[0]).toEqual({ x: 25, y: 25 });
      expect(host.querySelector('[data-point-selected]')).not.toBeNull();
      React.act(() => trace!.undo());
      expect(trace!.outline).toEqual(edited);
      React.act(() => trace!.dispatch({ type: "SELECT_RING", selection: { shapeIndex: 0, ringIndex: -1 } }));
      const beforeCancel = trace!.history;
      pointer('pointerdown', 10, 10); pointer('pointermove', 30, 30); pointer('pointercancel', 30, 30);
      expect(trace!.outline).toEqual(edited);
      expect(trace!.history).toBe(beforeCancel);
      expect(remove()).toBeUndefined();
      React.act(() => trace!.dispatch({ type: "SELECT_RING", selection: { shapeIndex: 0, ringIndex: -1 } }));
      pointer('pointerdown', 10, 10); pointer('pointermove', 30, 30);
      React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      pointer('pointerup', 30, 30);
      expect(trace!.outline).toEqual(edited);
      expect(trace!.history).toBe(beforeCancel);
      expect(trace!.selection).toBeNull();
      React.act(() => trace!.dispatch({ type: "SELECT_RING", selection: { shapeIndex: 0, ringIndex: -1 } }));
      pointer('pointerdown', 10, 10); pointer('pointerup', 10, 10);
      React.act(() => remove()!.click());
      pointer('pointerdown', 90, 10); pointer('pointerup', 90, 10);
      React.act(() => remove()!.click());
      pointer('pointerdown', 90, 90); pointer('pointerup', 90, 90);
      expect(trace!.outline[0].outer).toHaveLength(3);
      expect(remove()!.disabled).toBe(true);
    } finally { React.act(() => root.unmount()); restoreSvgCoordinates(); }
  });
});

describe("touch-accessible trace tools", () => {
  it("uses mobile point tools, shows a magnifier, and gives pinch priority over a point drag", async () => {
    setExperimentalTools(true);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    let trace: ReturnType<typeof useTrace>;
    function Probe(): null { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      const svg = host.querySelector("svg")!;
      const pointer = (type: string, x: number, y: number, id = 1) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperties(event, { pointerType: { value: "touch" }, pointerId: { value: id } });
        svg.dispatchEvent(event);
      });
      expect(host.querySelector('[aria-label="Correct"]')).toBeNull();
      React.act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit outline"]')!.click());
      const historyIndex = trace!.history.index;
      pointer("pointerdown", 10, 10); pointer("pointermove", 25, 25);
      expect(trace!.outline[0].outer[0]).toEqual({ x: 25, y: 25 });
      const magnifier = host.querySelector('[data-testid="contour-magnifier"]')!;
      expect(magnifier.querySelector('use')!.getAttribute('href')).toBe(`#${svg.querySelector('g')!.id}`);
      pointer("pointerdown", 90, 90, 2);
      expect(trace!.outline).toEqual(edited);
      expect(host.querySelector('[data-testid="contour-magnifier"]')).toBeNull();
      pointer("pointermove", 110, 110, 2); pointer("pointerup", 110, 110, 2); pointer("pointerup", 25, 25);
      expect(trace!.history.index).toBe(historyIndex);
      pointer("pointerdown", 10, 10); pointer("pointermove", 20, 20); pointer("pointerup", 20, 20);
      expect(trace!.history.index).toBe(historyIndex + 1);
      React.act(() => trace!.undo()); expect(trace!.outline).toEqual(edited);
      pointer("pointerdown", 50, 10); pointer("pointerup", 50, 10);
      expect(trace!.outline[0].outer).toHaveLength(6);
      pointer("pointerdown", 50, 10);
      expect(trace!.outline[0].outer).toHaveLength(6);
      pointer("pointerup", 50, 10);
      expect(trace!.outline[0].outer).toHaveLength(6);
      expect(host.querySelectorAll('[data-point-selected="true"]')).toHaveLength(1);
      React.act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Delete point")!.click());
      expect(trace!.outline[0].outer).toHaveLength(5);
      React.act(() => trace!.dispatch({ type: "SET_MODE", mode: "pan" }));
      expect(host.querySelector('[aria-label="Contour editing tools"]')).toBeNull();
      pointer("pointerdown", 10, 10); pointer("pointermove", 35, 35); pointer("pointerup", 35, 35);
      expect(trace!.outline).toEqual(edited);
    } finally { React.act(() => root.unmount()); restoreSvgCoordinates(); }
  });

  it("removes points by tapping, preserves a minimum triangle, and supports undo", async () => {
    setExperimentalTools(true);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let trace: ReturnType<typeof useTrace>;
    function Probe(): null { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      const pentagon = [{ outer: [...detected[0].outer.slice(0, 3), { x: 50, y: 95 }, detected[0].outer[3]], holes: [] }];
      React.act(() => trace.dispatch({ type: "OUTLINE_COMMITTED", outline: pentagon }));
      const svg = host.querySelector('svg[data-testid="trace-scene"]') ?? host.querySelector("svg");
      expect(host.querySelector('[aria-label="Correct"]')).toBeNull();
      React.act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit outline"]')!.click());
      const eraser = () => [...host.querySelectorAll("button")].find(b => b.textContent === "Point eraser");
      expect(eraser()!.getAttribute("aria-pressed")).toBe("false");
      React.act(() => eraser()!.click());
      expect(eraser()!.getAttribute("aria-pressed")).toBe("true");
      const remove = (x: number, y: number) => {
        for (const type of ["pointerdown", "pointerup"]) React.act(() => {
          const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
          Object.defineProperties(event, { pointerType: { value: "touch" }, pointerId: { value: 1 }, isPrimary: { value: true } });
          svg!.dispatchEvent(event);
        });
      };
      remove(10, 10);
      expect(trace!.outline[0].outer).toHaveLength(4);
      expect(trace!.history.stack[trace!.history.index].label).toBe("Erase outline points");
      remove(90, 10);
      expect(trace!.outline[0].outer).toHaveLength(3);
      remove(90, 90);
      expect(trace!.outline[0].outer).toHaveLength(3);
      React.act(() => trace!.undo());
      expect(trace!.outline[0].outer).toHaveLength(4);
      React.act(() => trace!.undo());
      expect(trace!.outline).toEqual(pentagon);
      remove(500, 500);
      expect(trace!.outline).toEqual(pentagon);
      React.act(() => eraser()!.click());
      expect(trace!.mode).toBe("edit");
      expect(eraser()!.getAttribute("aria-pressed")).toBe("false");
      React.act(() => eraser()!.click());
      expect(trace!.mode).toBe("remove");
      setExperimentalTools(false);
      expect(trace!.mode).toBe("edit");
      expect(trace!.outline).toEqual(pentagon);
      expect(eraser()).toBeUndefined();
      React.act(() => trace!.dispatch({ type: "SET_MODE", mode: "pan" }));
      expect(trace!.selection).not.toBeNull();
      expect(eraser()).toBeUndefined();
      React.act(() => trace!.dispatch({ type: "SET_MODE", mode: "edit" }));
      React.act(() => trace!.dispatch({ type: "SELECT_RING", selection: null }));
      expect(eraser()).toBeUndefined();
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });
});

it.each(["mouse", "touch"])("keeps Correct behind the experimental detection controls and cancels unfinished %s strokes", async pointerType => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.stubGlobal("matchMedia", () => ({ matches: pointerType === "touch", addEventListener() {}, removeEventListener() {} }));
  const restore = installIdentitySvgCoordinates();
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let trace!: TraceStore;
  const apply = vi.fn((hints: DetectionHint[]) => trace.dispatch({ type: "DETECTED", imageUrl: trace.imageUrl,
    outline: detected, rawOutline: detected, detectionHints: hints, svg: "", region: trace.region }));
  function Harness() {
    trace = useTrace();
    const [request, setRequest] = React.useState<OutlineToolRequest>();
    return <>
      <TraceDetectionControls compact={pointerType === "touch"} onReprocess={() => {}}
        onCorrectOutline={() => { trace.detectedOutlineReview.close(); trace.dispatch({ type: "SET_MODE", mode: "pan" }); setRequest({ tool: "correct", sourceRevision: trace.sourceRevision }); }} />
      <TraceCanvasComponent onReprocess={() => {}} onCorrection={apply} outlineToolRequest={request} onOutlineToolHandled={() => setRequest(undefined)} />
    </>;
  }
  const launch = () => Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Correct");
  const control = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const click = (button: HTMLButtonElement) => React.act(() => button.click());
  try {
    await React.act(async () => root.render(<ExperimentalFeaturesProvider><TraceProvider><TooltipProvider><Harness /></TooltipProvider></TraceProvider></ExperimentalFeaturesProvider>));
    React.act(() => {
      trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "test" });
      trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
      const region = { x: 0, y: 0, width: 100, height: 100 };
      trace.dispatch({ type: "SET_REGION", region });
      trace.dispatch({ type: "DETECTED", imageUrl: "photo", region, outline: detected, rawOutline: detected, svg: "" });
    });
    expect(launch()).toBeUndefined();
    setExperimentalTools(true);
    if (pointerType === "mouse") {
      expect(launch()!.closest("[hidden]")).not.toBeNull();
      click(Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Manual detection settings")!);
    }
    expect(launch()!.closest("[hidden]")).toBeNull();
    click(launch()!);
    expect(control("Add").getAttribute("aria-pressed")).toBe("true");
    click(host.querySelector<HTMLButtonElement>('[data-testid="detected-outline-controls"] [role="switch"]')!);
    expect(trace.detectedOutlineReview.showing).toBe(true);
    expect(control("Add")).toBeNull();
    click(launch()!);
    expect(trace.detectedOutlineReview.showing).toBe(false);
    const svg = host.querySelector<SVGSVGElement>('[data-testid="trace-source-image"]')!.closest("svg")!;
    Object.defineProperty(svg, "setPointerCapture", { value: () => {} });
    const pointer = (type: string, x: number, id = 1) => React.act(() => {
      const e = new MouseEvent(type, { button: 0, bubbles: true, clientX: x, clientY: 20 });
      Object.defineProperties(e, { pointerType: { value: pointerType }, pointerId: { value: id }, isPrimary: { value: id === 1 } });
      svg.dispatchEvent(e);
    });
    pointer("pointerdown", 20); pointer("pointermove", 30); pointer("pointerup", 30);
    const marks = trace.detectionHints;
    expect(marks).toEqual([{ kind: "tool", points: [{ x: 20, y: 20 }, { x: 30, y: 20 }], radius: 1 }]);
    click(control("Remove"));
    pointer("pointerdown", 40); pointer("pointerup", 40);
    expect(trace.detectionHints[1].kind).toBe("paper");
    click(control("Clear correction marks"));
    expect(trace.detectionHints).toEqual([]);
    React.act(() => trace.undo());
    expect(trace.detectionHints).toHaveLength(2);
    pointer("pointerdown", 50); pointer("pointercancel", 50);
    pointer("pointerdown", 50); pointer("lostpointercapture", 50); pointer("pointerup", 50);
    if (pointerType === "touch") {
      pointer("pointerdown", 25); pointer("pointermove", 35);
      const view = svg.querySelector("g[transform]")!;
      const beforePinch = view.getAttribute("transform");
      pointer("pointerdown", 70, 2); pointer("pointermove", 35);
      expect(view.getAttribute("transform")).toBe(beforePinch);
      pointer("pointerup", 70, 2); pointer("pointerup", 35);
    }
    const before = trace.history;
    pointer("pointerdown", 20);
    setExperimentalTools(false); pointer("pointerup", 20);
    expect(apply).toHaveBeenCalledTimes(3);
    expect(trace.history).toBe(before);
    expect(trace.mode).toBe("edit");
    expect(launch()).toBeUndefined();
    expect(control("Add")).toBeNull();
    expect(host.querySelector('[data-testid="detection-hint"]')).toBeNull();
    setExperimentalTools(true);
    expect(control("Add")).toBeNull();
    click(launch()!);
    expect(host.querySelectorAll('[data-testid="detection-hint"]')).toHaveLength(2);
    React.act(() => apply(Array.from({ length: MAX_DETECTION_HINTS }, () => marks[0])));
    expect(control("Add").disabled).toBe(true);
    const atLimit = trace.history;
    pointer("pointerdown", 15); pointer("pointerup", 15);
    expect(trace.history).toBe(atLimit);
    click(control("Clear correction marks")); click(control("Done correcting"));
    React.act(() => trace.dispatch({ type: "OUTLINE_COMMITTED", outline: edited }));
    expect(launch()!.disabled).toBe(true);
  } finally { React.act(() => root.unmount()); restore(); }
});
