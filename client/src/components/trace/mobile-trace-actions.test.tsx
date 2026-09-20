// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import type { PerspectiveProposal } from "@/lib/calibrate/perspective";
import { MobileTraceActions } from "./mobile-trace-actions";

let trace: TraceStore;
let host: HTMLDivElement;
let root: Root;
const openSettings = vi.fn();
const choosePhoto = vi.fn();
const applyPerspective = vi.fn();
const startOver = vi.fn();
const reprocess = vi.fn();
const detectMarkers = vi.fn();
const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 };
function Harness(): JSX.Element {
  trace = useTrace();
  return <MobileTraceActions onChoosePhoto={choosePhoto} onOpenSettings={openSettings} onApplyPerspective={applyPerspective}
    onReprocess={reprocess} onDetectMarkers={detectMarkers} onStartOver={() => { startOver(); trace.dispatch({ type: "SOURCE_CLEARED" }); }} />;
}
function button(text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll("button")).find(button => button.textContent === text);
  expect(result, `Missing button: ${text}`).toBeDefined();
  return result!;
}
function load(): void {
  React.act(() => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "tool" });
    trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 800, height: 600 } });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  React.act(() => root.render(<TraceProvider><Harness /></TraceProvider>));
});
afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("Mobile trace progression", () => {
  const readyOutline = () => {
    load();
    React.act(() => {
      trace.dispatch({ type: "SET_CALIBRATION", calibration });
      trace.dispatch({ type: "SET_REGION", region: { x: 0, y: 0, width: 200, height: 200 } });
      trace.dispatch({ type: "DETECTED", imageUrl: "photo", region: trace.region, svg: "",
        outline: [{ outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], holes: [] }], rawOutline: [] });
    });
  };

  it("revisits earlier steps and continues without discarding the ruler, region, or edits", () => {
    readyOutline();
    const before = { outline: trace.outline, region: trace.region, calibration: trace.calibration, history: trace.history };
    React.act(() => button("Back").click());
    expect(trace.mode).toBe("region");
    expect(button("Keep this region")).toBeDefined();
    React.act(() => button("Back").click());
    expect(button("Use this scale")).toBeDefined();
    React.act(() => button("Back").click());
    expect(button("Use this photo")).toBeDefined();
    React.act(() => button("Use this photo").click());
    React.act(() => button("Use this scale").click());
    React.act(() => button("Keep this region").click());
    expect(trace.mode).toBe("edit");
    expect(trace.outline).toBe(before.outline);
    expect(trace.region).toBe(before.region);
    expect(trace.calibration).toBe(before.calibration);
    expect(trace.history).toBe(before.history);
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("confirms Start over and keeps the trace untouched when cancelled", () => {
    readyOutline();
    const outline = trace.outline;
    const dialogButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === text)!;
    React.act(() => button("Start over").click());
    expect(startOver).not.toHaveBeenCalled();
    React.act(() => dialogButton("Keep working").click());
    expect(trace.outline).toBe(outline);
    React.act(() => button("Start over").click());
    React.act(() => dialogButton("Clear trace and start over").click());
    expect(startOver).toHaveBeenCalledOnce();
    expect(trace.imageUrl).toBeNull();
    expect(trace.outline).toEqual([]);
    expect(button("Choose a photo")).toBeDefined();
  });

  it("adjusts sensitivity and detail inline and protects manual edits on re-detection", async () => {
    readyOutline();
    const adjust = async (id: string) => React.act(async () => {
      host.querySelector(`#${id} [role="slider"]`)!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    await adjust("mobile-sensitivity");
    expect(reprocess).toHaveBeenLastCalledWith({ sensitivity: 129, includeInteriorHoles: false });
    await adjust("mobile-detail");
    expect(trace.tolerancePx).toBeCloseTo(1.3);
    expect(reprocess).toHaveBeenCalledOnce();
    React.act(() => trace.dispatch({ type: "OUTLINE_COMMITTED", outline: [...trace.outline], label: "Move contour node" }));
    const edited = trace.outline;
    await adjust("mobile-sensitivity");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Re-detect from the photo?");
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Keep my edits")!.click());
    expect(trace.sensitivity).toBe(129);
    expect(trace.outline).toBe(edited);
    expect(openSettings).not.toHaveBeenCalled();
  });
  it("offers photo selection before any controls are needed", () => {
    React.act(() => button("Choose a photo").click());
    expect(choosePhoto).toHaveBeenCalledOnce();
  });
  it("requires an explicit tap to accept a detected scale with the drawer absent", () => {
    load();
    React.act(() => trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: "photo", calibration }));
    expect(trace.calibration).toBeNull();
    React.act(() => button("Accept detected scale").click());
    expect(trace.calibration).toEqual(calibration);
    expect(trace.pendingAutoCalibration).toBeNull();
    expect(openSettings).not.toHaveBeenCalled();
  });
  it("keeps perspective correction distinct from accepting scale only", () => {
    load();
    const proposal: PerspectiveProposal = { source: "template", paper: "letter", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    React.act(() => trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: "photo", calibration, perspective: proposal }));
    React.act(() => button("Correct perspective & use scale").click());
    expect(applyPerspective).toHaveBeenCalledWith(proposal, "letter", true);
    expect(trace.calibration).toBeNull();
    React.act(() => button("Use scale without correction").click());
    expect(trace.calibration).toEqual(calibration);
  });
  it.each([false, true])("uses the aid for combined correction on mobile (requires correction: %s)", (requiresPerspectiveCorrection) => {
    load();
    const aid = { ...calibration, lengthMm: 85 };
    const proposal: PerspectiveProposal = { source: "template", paper: "letter", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    React.act(() => trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: "photo", calibration: aid,
      source: "strip", paperCalibration: calibration, perspective: proposal, requiresPerspectiveCorrection }));
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
    expect(host.querySelector('[data-testid="button-use-aid-scale"]') === null).toBe(requiresPerspectiveCorrection);
    React.act(() => button("Correct perspective & use aid scale").click());
    expect(applyPerspective).toHaveBeenCalledWith(proposal, "letter", aid);
    expect(trace.calibration).toBeNull();
    React.act(() => button("Correct perspective only").click());
    expect(applyPerspective).toHaveBeenLastCalledWith(proposal, "letter", false);
    React.act(() => button("Set manually instead").click());
    expect(trace.mode).toBe("calibrate");
    expect(trace.pendingAutoCalibration).toBeNull();
    expect(trace.pendingAidRequiresPerspective).toBe(false);
  });
  it("offers detection retry within Advanced instead of requiring a download dialog", () => {
    load();
    React.act(() => trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: "photo", calibration }));
    const retry = button("Detect references again");
    expect(retry.closest("details")).not.toBeNull();
    React.act(() => retry.click());
    expect(detectMarkers).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("confirms a manual ruler using a visible button and rejects an empty length", () => {
    load();
    React.act(() => trace.dispatch({ type: "SET_DRAFT_CALIBRATION", draftCalibration: { startX: 0, startY: 0, endX: 100, endY: 0 } }));
    const input = host.querySelector<HTMLInputElement>("#mobile-ruler-length")!;
    const setValue = (value: string) => React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    setValue("");
    expect(button("Confirm scale").disabled).toBe(true);
    setValue("75");
    expect(trace.calibration).toBeNull();
    React.act(() => button("Confirm scale").click());
    expect(trace.calibration?.lengthMm).toBe(75);
  });
  it("opens export settings once a calibrated outline is available", () => {
    load();
    React.act(() => {
      trace.dispatch({ type: "SET_CALIBRATION", calibration });
      trace.dispatch({ type: "OUTLINE_COMMITTED", outline: [{ outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], holes: [] }] });
    });
    React.act(() => button("Add to bin / export").click());
    expect(openSettings).toHaveBeenCalledWith("trace-settings-output");
  });
});
