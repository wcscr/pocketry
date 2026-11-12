// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { curvesFromOutline, editCurves, sampleCurves } from "@shared/geometry/curves";
import type { Outline } from "@shared/geometry/types";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { outlineToPathData } from "@/lib/export/svg";
import { offsetDetectedOutline } from "@/lib/geometry/trace-refinement";
import { traceDraftSchema } from "@shared/trace-draft";
import { traceDraftSnapshot } from "@/lib/trace-draft";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TraceCanvas } from "./trace-canvas";
import { TraceDetectionControls } from "./trace-detection-controls";

vi.mock("@/lib/geometry/trace-refinement", async original => ({
  ...await original<typeof import("@/lib/geometry/trace-refinement")>(), offsetDetectedOutline: vi.fn(),
}));
const raw: Outline = [{ outer: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }], holes: [[{ x: 40, y: 40 }, { x: 40, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 40 }]] },
  { outer: [{ x: 95, y: 10 }, { x: 99, y: 10 }, { x: 99, y: 20 }, { x: 95, y: 20 }], holes: [] }];
const curves = editCurves(curvesFromOutline(raw), { shapeIndex: 0, ringIndex: -1 },
  { kind: "bend", index: 0, t: .5, delta: { x: 0, y: 3 } });
const fitted = sampleCurves(curves, .1);
const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 25 };
const region = { x: 0, y: 0, width: 100, height: 100 };
let root: Root, host: HTMLDivElement, trace: TraceStore;
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === name)!;
const reviewSwitch = () => host.querySelector<HTMLButtonElement>('[data-testid="detected-outline-controls"] [role="switch"]')!;
function Harness() { trace = useTrace(); return <TooltipProvider><TraceDetectionControls onReprocess={() => {}} /><TraceCanvas onReprocess={() => {}} /></TooltipProvider>; }
async function click(element: HTMLElement) { await React.act(async () => element.click()); }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await React.act(async () => root.render(<TraceProvider><Harness /></TraceProvider>));
  React.act(() => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "data:image/png;base64,AA==", fileName: "synthetic" });
    trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    trace.dispatch({ type: "SET_CALIBRATION", calibration });
    trace.dispatch({ type: "SET_REGION", region });
    trace.dispatch({ type: "SET_MODE", mode: "pan" });
    trace.dispatch({ type: "DETECTED", imageUrl: "data:image/png;base64,AA==", outline: fitted, rawOutline: raw, curves,
      autoSimplification: { source: curvesFromOutline(raw), allowance: .2, unitsPerUnit: .25, unit: "mm" },
      refinementBase: fitted, region, svg: "", estimatedEdgeRegions: [raw[0].outer] });
  });
  await click(button("Manual detection settings"));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("compares the earlier contour without changing history or the saved outline", async () => {
  const history = trace.history, outline = trace.outline;
  await click(reviewSwitch());
  expect(reviewSwitch().getAttribute('aria-checked')).toBe('true');
  expect(trace.history).toBe(history); expect(trace.outline).toBe(outline);
  expect(traceDraftSnapshot(trace)!.state.outline).toEqual(outline);
  expect(host.querySelector('[data-testid="detected-outline-preview"] path')!.getAttribute('d')).toBe(outlineToPathData(raw));
  expect(host.querySelector('[data-testid="detected-contour-stroke"]')).toBeNull();
  await click(reviewSwitch());
  expect(host.querySelector('[data-testid="detected-outline-preview"]')).toBeNull();
  expect(trace.history).toBe(history); expect(trace.curves).toEqual(curves);
  await click(reviewSwitch());
  React.act(() => reviewSwitch().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(trace.detectedOutlineReview.showing).toBe(false);
  expect(trace.history).toBe(history);
});

it("uses detected points in one undoable step and restores fitted curves and smoothing metadata", async () => {
  const before = trace;
  await click(reviewSwitch()); await click(button("Use detected outline"));
  expect(trace.outline).toEqual(raw); expect(trace.curves).toBeUndefined(); expect(trace.rawOutline).toEqual(raw);
  expect(trace.margin).toBe(before.margin); expect(trace.calibration).toBe(before.calibration); expect(trace.region).toBe(before.region);
  expect(trace.history.index).toBe(before.history.index + 1);
  expect(trace.history.stack.at(-1)).toMatchObject({ label: "Use detected outline", hasManualEdits: true, refinementBase: raw, baselineMarginPx: 0 });
  expect(trace.history.stack.at(-1)!.autoSimplification).toBeUndefined();
  expect(trace.estimatedEdgeRegions).toEqual(before.estimatedEdgeRegions);
  expect(trace.detectedOutlineReview.showing).toBe(false);
  React.act(() => trace.undo());
  expect(trace.outline).toEqual(fitted); expect(trace.curves).toEqual(curves);
  expect(trace.history.stack[trace.history.index].autoSimplification).toEqual(before.history.stack[before.history.index].autoSimplification);
  React.act(() => trace.redo()); expect(trace.outline).toEqual(raw);
  const draft = traceDraftSchema.parse(JSON.parse(JSON.stringify(traceDraftSnapshot(trace))));
  React.act(() => trace.dispatch({ type: "TRACE_DRAFT_RESTORED", draft }));
  expect(trace.detectedOutlineReview.showing).toBe(false);
  expect(trace.outline).toEqual(raw); expect(trace.rawOutline).toEqual(raw);
  React.act(() => trace.undo()); expect(trace.curves).toEqual(curves);
  React.act(() => trace.redo());
  await click(reviewSwitch()); expect(button("Use detected outline").disabled).toBe(true);
  expect(host.textContent).toContain('Detected outline is already in use.');
});

it.each(['edit', 'processing', 'region', 'sensitivity'])("closes a comparison when %s changes", async change => {
  await click(reviewSwitch());
  React.act(() => {
    if (change === 'edit') trace.dispatch({ type: "SET_MODE", mode: "edit" });
    if (change === 'processing') trace.dispatch({ type: "SET_PROCESSING", processing: true });
    if (change === 'region') trace.dispatch({ type: "SET_REGION", region: { ...region, x: 1 } });
    if (change === 'sensitivity') trace.dispatch({ type: "SET_SENSITIVITY", sensitivity: 97 });
  });
  expect(trace.detectedOutlineReview.showing).toBe(false);
  expect(host.querySelector('[data-testid="detected-outline-preview"]')).toBeNull();
  expect(trace.outline).toEqual(fitted);
});

it("preserves calibrated margin and discards a late preview from previous settings", async () => {
  const offset = [{ ...raw[0], outer: raw[0].outer.map(p => ({ x: p.x + 2, y: p.y + 2 })) }];
  let finish!: (outline: Outline) => void;
  vi.mocked(offsetDetectedOutline).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  React.act(() => { trace.dispatch({ type: "SET_EDITABLE_CURVES", enabled: false }); trace.dispatch({ type: "SET_MARGIN", margin: .5 }); });
  await click(reviewSwitch()); expect(button("Use detected outline").disabled).toBe(true);
  expect(offsetDetectedOutline).toHaveBeenCalledWith(raw, 2);
  React.act(() => trace.dispatch({ type: "SET_MARGIN", margin: 1 }));
  await React.act(async () => finish(offset));
  expect(trace.detectedOutlineReview.showing).toBe(false); expect(trace.outline).toEqual(fitted);
  vi.mocked(offsetDetectedOutline).mockResolvedValueOnce(offset);
  await click(reviewSwitch()); await click(button("Use detected outline"));
  expect(offsetDetectedOutline).toHaveBeenLastCalledWith(raw, 4);
  expect(trace.margin).toBe(1); expect(trace.outline).toEqual(offset);
  // Later refinements start from the accepted offset contour, so clearance is
  // not applied twice and holes collapsed by that margin cannot reappear.
  expect(trace.history.stack.at(-1)).toMatchObject({ margin: 1, refinementBase: offset, baselineMarginPx: 4 });
});

it("reports a preview failure through its hint and accessible status without replacing geometry", async () => {
  vi.mocked(offsetDetectedOutline).mockRejectedValueOnce(new Error('Could not prepare this margin.'));
  React.act(() => { trace.dispatch({ type: "SET_EDITABLE_CURVES", enabled: false }); trace.dispatch({ type: "SET_MARGIN", margin: .5 }); });
  await click(reviewSwitch());
  expect(button("Use detected outline").disabled).toBe(true);
  expect(trace.detectedOutlineReview.hint).toBe('Could not prepare this margin.');
  expect(host.querySelector('[data-testid="detected-outline-controls"] [role="status"]')!.classList.contains('sr-only')).toBe(true);
  expect(trace.outline).toEqual(fitted);
});
