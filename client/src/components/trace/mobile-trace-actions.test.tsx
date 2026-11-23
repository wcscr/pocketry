// @vitest-environment jsdom
import * as React from "react";
import { ExperimentalFeaturesProvider } from "@/state/experimental-features";
import { setExperimentalTools } from "./trace-experimental.test-support";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import type { PerspectiveProposal } from "@/lib/calibrate/perspective";
import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import { MobileCanvasOverlayContext } from "@/components/layout/mobile-canvas-overlay";
import { MobileTraceActions } from "./mobile-trace-actions";

let trace: TraceStore;
let host: HTMLDivElement;
let overlay: HTMLDivElement;
let root: Root;
const openSettings = vi.fn();
const addToBin = vi.fn();
const exportOutline = vi.fn();
const choosePhoto = vi.fn();
const applyPerspective = vi.fn();
const startOver = vi.fn();
const reprocess = vi.fn();
const detectMarkers = vi.fn();
const correctOutline = vi.fn();
const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 };
function Harness(): JSX.Element {
  trace = useTrace();
  const { traceRestart } = usePanelState();
  return <><button onClick={() => traceRestart?.()}>Start over</button><MobileTraceActions onExport={exportOutline} onAddToBin={addToBin} onChoosePhoto={choosePhoto} onOpenSettings={openSettings} onApplyPerspective={applyPerspective}
    onReprocess={reprocess} onDetectMarkers={detectMarkers} onCorrectOutline={correctOutline} onStartOver={() => { startOver(); trace.dispatch({ type: "SOURCE_CLEARED" }); }} /></>;
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
  overlay = document.createElement("div"); document.body.append(overlay);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  React.act(() => root.render(<MobileCanvasOverlayContext.Provider value={overlay}><PanelProvider><TraceProvider><ExperimentalFeaturesProvider><Harness /></ExperimentalFeaturesProvider></TraceProvider></PanelProvider></MobileCanvasOverlayContext.Provider>));
});
afterEach(() => {
  setExperimentalTools(false);
  React.act(() => root.unmount());
  host.remove(); overlay.remove();
  vi.unstubAllGlobals();
});
describe("Mobile trace progression", () => {
  const readyOutline = (estimatedEdgeRegions?: TraceStore["estimatedEdgeRegions"]) => {
    load();
    React.act(() => {
      trace.dispatch({ type: "SET_CALIBRATION", calibration });
      trace.dispatch({ type: "SET_REGION", region: { x: 0, y: 0, width: 200, height: 200 } });
      trace.dispatch({ type: "DETECTED", imageUrl: "photo", region: trace.region, svg: "", estimatedEdgeRegions,
        outline: [{ outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], holes: [] }], rawOutline: [] });
    });
  };

  it("leaves estimated-edge review and point-editing guidance to their own controls", () => {
    readyOutline([[{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 50 }]]);
    expect(overlay.textContent).toBe("");
    React.act(() => trace.dispatch({ type: "SET_MODE", mode: "edit" }));
    expect(overlay.textContent).toBe("");
    React.act(() => trace.dispatch({ type: "SET_MODE", mode: "navigate" }));
    expect(overlay.textContent).toContain("Drag to pan.");
  });

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

  it("cancels or confirms a replacement ruler without offering the old scale as the new one", () => {
    readyOutline();
    const before = trace;
    React.act(() => trace.dispatch({ type: "SET_MODE", mode: "calibrate" }));
    expect(button("Cancel ruler")).toBeDefined();
    expect(host.textContent).not.toContain("Use this scale");
    expect(host.textContent).not.toContain("Add to bin");
    const completeRuler = () => React.act(() => {
      trace.dispatch({ type: "SET_DRAFT_CALIBRATION", draftCalibration: { startX: 10, startY: 20, endX: 70, endY: 20 } });
      trace.dispatch({ type: "SET_MODE", mode: "pan" });
      trace.dispatch({ type: "SET_RULER_LENGTH_INPUT", value: "75" });
    });
    completeRuler();
    expect(trace.calibration).toBe(before.calibration);
    expect(button("Confirm scale").disabled).toBe(false);
    React.act(() => button("Cancel ruler").click());
    expect(trace.calibration).toBe(before.calibration);
    expect(trace.draftCalibration).toBeNull();
    expect(trace.outline).toBe(before.outline);
    expect(trace.history).toBe(before.history);
    expect(button("Add to bin")).toBeDefined();
    React.act(() => trace.dispatch({ type: "SET_MODE", mode: "calibrate" }));
    completeRuler();
    React.act(() => button("Confirm scale").click());
    expect(trace.calibration).toEqual({ startX: 10, startY: 20, endX: 70, endY: 20, lengthMm: 75 });
    expect(trace.draftCalibration).toBeNull();
    expect(trace.outline).toBe(before.outline);
  });

  it.each([false, true])("keeps completed corners available for review (existing scale: %s)", existingScale => {
    load();
    if (existingScale) React.act(() => trace.dispatch({ type: "SET_CALIBRATION", calibration }));
    React.act(() => trace.dispatch({ type: "START_PERSPECTIVE_SELECTION" }));
    for (const point of [{ x: 10, y: 10 }, { x: 500, y: 10 }, { x: 500, y: 400 }, { x: 10, y: 400 }]) {
      React.act(() => trace.dispatch({ type: "ADD_PERSPECTIVE_POINT", point }));
    }
    React.act(() => button("Review corners").click());
    expect(openSettings).toHaveBeenCalledWith("trace-settings-scale");
    expect(trace.manualPerspectivePoints).toHaveLength(4);
    expect(trace.mode).toBe("pan");
    React.act(() => trace.dispatch({ type: "SET_MODE", mode: "calibrate" }));
    expect(trace.manualPerspectivePoints).toHaveLength(0);
    expect(button("Set scale")).toBeDefined();
  });

  it("confirms Start over and keeps the trace untouched when cancelled", () => {
    readyOutline();
    const outline = trace.outline;
    const dialogButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === text)!;
    React.act(() => button("Start over").click());
    expect(startOver).not.toHaveBeenCalled();
    React.act(() => dialogButton("Keep working").click());
    expect(trace.outline).toBe(outline);
    React.act(() => button("Start over").click());
    React.act(() => dialogButton("Clear trace for new photo").click());
    expect(startOver).toHaveBeenCalledOnce();
    expect(trace.imageUrl).toBeNull();
    expect(trace.outline).toEqual([]);
    expect(button("Choose a photo")).toBeDefined();
  });

  it("opens Symmetry & straighten from Adjust by default", () => {
    readyOutline();
    React.act(() => button("Adjust").click());
    expect(host.querySelector("#mobile-detail")).toBeNull();
    const tray = host.querySelector<HTMLElement>(".mobile-adjustment-tray")!;
    expect(tray.className).toContain("max-h-[min(206px,36dvh)]");
    expect(tray.className).toContain("overscroll-contain");
    React.act(() => button("Symmetry & straighten").click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.querySelector("h2")?.textContent).toBe("Symmetry & straighten");
    expect(dialog?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Straighten only");
  });

  it("keeps Adjust open on cancel and returns to the canvas when correction is enabled", () => {
    readyOutline();
    React.act(() => button("Adjust").click());
    const dialogButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find(button => button.textContent === text)!;
    React.act(() => button("Correct outline").click());
    React.act(() => dialogButton("Cancel").click());
    expect(button("Done").getAttribute("aria-expanded")).toBe("true");
    expect(correctOutline).not.toHaveBeenCalled();
    React.act(() => button("Correct outline").click());
    React.act(() => dialogButton("Enable and open brushes").click());
    expect(button("Adjust").getAttribute("aria-expanded")).toBe("false");
    expect(correctOutline).toHaveBeenCalledOnce();
    React.act(() => button("Adjust").click());
    React.act(() => button("Correct outline").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(button("Adjust").getAttribute("aria-expanded")).toBe("false");
    expect(correctOutline).toHaveBeenCalledTimes(2);
  });

  it("uses the dock button to close Adjust and keeps All properties in the tray", () => {
    readyOutline();
    React.act(() => button("Adjust").click());
    const done = button("Done");
    expect(document.getElementById(done.getAttribute("aria-controls")!)?.getAttribute("aria-label")).toBe("Adjust outline");
    React.act(() => done.click());
    expect(button("Adjust").getAttribute("aria-expanded")).toBe("false");
    React.act(() => button("Adjust").click());
    React.act(() => button("All properties").click());
    expect(openSettings).toHaveBeenCalledWith("trace-settings-detect");
    expect(button("Adjust").getAttribute("aria-expanded")).toBe("false");
  });

  it("preserves sensitivity during vertical touch swipes while keeping horizontal touch dragging usable", () => {
    readyOutline();
    React.act(() => button("Adjust").click());
    const slider = host.querySelector<HTMLElement>("#mobile-sensitivity")!;
    const thumb = slider.querySelector<HTMLElement>('[role="slider"]')!;
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      x: 16, y: 520, left: 16, top: 520, width: 358, height: 32, right: 374, bottom: 552, toJSON: () => ({}),
    } as DOMRect);
    const pointer = (el: Element, type: string, x: number, y: number) => React.act(() => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "touch" }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
      el.dispatchEvent(event);
    });

    // Vertical swipe starting on the track (reproducing issue #252).
    pointer(slider, "pointerdown", 242, 536);
    pointer(slider, "pointermove", 242, 446);
    pointer(slider, "pointerup", 242, 446);
    expect(thumb.getAttribute("aria-valuenow")).toBe("0");
    expect(reprocess).not.toHaveBeenCalled();

    // Vertical swipe starting on the thumb.
    pointer(thumb, "pointerdown", 195, 536);
    pointer(slider, "pointermove", 196, 460);
    pointer(slider, "pointerup", 196, 460);
    expect(thumb.getAttribute("aria-valuenow")).toBe("0");
    expect(reprocess).not.toHaveBeenCalled();

    // Intentional horizontal touch drag adjusts and commits sensitivity once.
    pointer(thumb, "pointerdown", 195, 536);
    pointer(slider, "pointermove", 242, 536);
    expect(reprocess).not.toHaveBeenCalled();
    pointer(slider, "pointerup", 242, 536);
    expect(reprocess).toHaveBeenCalledOnce();
    expect(Number(thumb.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  });

  it("limits touch scroll gesture interception to Sensitivity and leaves Simplification unchanged", () => {
    setExperimentalTools(true);
    readyOutline();
    React.act(() => button("Adjust").click());
    const sensitivitySlider = host.querySelector<HTMLElement>("#mobile-sensitivity")!;
    const simplificationSlider = host.querySelector<HTMLElement>("#mobile-detail")!;
    expect(sensitivitySlider.className).toContain("touch-pan-y");
    expect(sensitivitySlider.className).not.toContain("touch-none");
    expect(simplificationSlider.className).toContain("touch-none");
    expect(simplificationSlider.className).not.toContain("touch-pan-y");
  });

  it("adjusts sensitivity and detail inline and protects manual edits on re-detection", async () => {
    setExperimentalTools(true);
    readyOutline();
    const adjust = async (id: string) => React.act(async () => {
      host.querySelector(`#${id} [role="slider"]`)!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    React.act(() => button("Adjust").click());
    await adjust("mobile-sensitivity");
    expect(reprocess).toHaveBeenLastCalledWith({ sensitivity: 127, includeInteriorHoles: false });
    await adjust("mobile-detail");
    expect(trace.tolerancePx).toBeCloseTo(1.3);
    expect(reprocess).toHaveBeenCalledOnce();
    React.act(() => trace.dispatch({ type: "OUTLINE_COMMITTED", outline: [...trace.outline], label: "Move contour node" }));
    const edited = trace.outline;
    await adjust("mobile-sensitivity");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Re-detect from the photo?");
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Keep my edits")!.click());
    expect(trace.sensitivity).toBe(128); // The mocked re-detection has not committed a result.
    expect(trace.outline).toBe(edited);
    expect(openSettings).not.toHaveBeenCalled();
  });
  it("opens Region settings from Adjust while drawing the crop", () => {
    load();
    React.act(() => trace.dispatch({ type: "SET_CALIBRATION", calibration }));
    React.act(() => button("Adjust").click());
    expect(openSettings).toHaveBeenCalledWith("trace-settings-crop");
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
  it("reviews a new reference over an accepted scale and dismisses back to the existing trace", () => {
    readyOutline();
    const original = { calibration: trace.calibration, outline: trace.outline, history: trace.history, region: trace.region };
    const proposed = { ...calibration, lengthMm: 85 };
    React.act(() => trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: "photo", calibration: proposed, source: "strip" }));
    expect(trace.calibration).toBe(original.calibration);
    expect(host.querySelector('[data-testid="trace-current-step"]')?.textContent).toContain("scale");
    expect(button("Accept detected scale")).toBeDefined();
    expect([...host.querySelectorAll("button")].some(button => button.textContent === "Add to bin")).toBe(false);
    React.act(() => button("Dismiss detected scale").click());
    expect(button("Add to bin")).toBeDefined();
    expect(trace.calibration).toBe(original.calibration);
    expect(trace.calibrationSource).toBe("manual");
    expect(trace.outline).toBe(original.outline);
    expect(trace.history).toBe(original.history);
    expect(trace.region).toBe(original.region);
  });
  it("returns to the existing outline after accepting a replacement scale", () => {
    readyOutline();
    const outline = trace.outline;
    const history = trace.history;
    const proposed = { ...calibration, lengthMm: 85 };
    React.act(() => trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: "photo", calibration: proposed, source: "strip" }));
    React.act(() => button("Accept detected scale").click());
    expect(trace.calibration).toBe(proposed);
    expect(trace.calibrationSource).toBe("strip");
    expect(trace.mode).toBe("pan");
    expect(trace.outline).toBe(outline);
    expect(trace.history).toBe(history);
    expect(button("Add to bin")).toBeDefined();
  });
  it("lets Back leave reference review for the photo without discarding the accepted scale", () => {
    readyOutline();
    const original = trace.calibration;
    React.act(() => button("Back").click());
    React.act(() => button("Back").click());
    React.act(() => button("Back").click());
    expect(button("Use this photo")).toBeDefined();
    React.act(() => trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: "photo", calibration: { ...calibration, lengthMm: 85 } }));
    expect(button("Accept detected scale")).toBeDefined();
    React.act(() => button("Back").click());
    expect(trace.pendingAutoCalibration).toBeNull();
    expect(trace.calibration).toBe(original);
    expect(button("Use this photo")).toBeDefined();
  });
  it("does not offer draft confirmation while reviewing a reference, then restores the manual draft on dismissal", () => {
    load();
    const draft = { startX: 0, startY: 0, endX: 100, endY: 0 };
    React.act(() => {
      trace.dispatch({ type: "SET_DRAFT_CALIBRATION", draftCalibration: draft });
      trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: "photo", calibration });
    });
    expect(host.querySelector("#mobile-ruler-length")).toBeNull();
    React.act(() => button("Dismiss detected scale").click());
    expect(host.querySelector("#mobile-ruler-length")).not.toBeNull();
    expect(trace.draftCalibration).toBe(draft);
    expect(button("Confirm scale")).toBeDefined();
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
    expect(trace.mode).toBe("region");
    expect(host.querySelector("#mobile-ruler-length")).toBeNull();
  });
  it("keeps a dismissed outline hint hidden when switching between editing and navigation", () => {
    load();
    React.act(() => {
      trace.dispatch({ type: "SET_CALIBRATION", calibration });
      trace.dispatch({ type: "OUTLINE_COMMITTED", outline: [{ outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], holes: [] }] });
      trace.dispatch({ type: "SET_MODE", mode: "navigate" });
    });
    React.act(() => overlay.querySelector<HTMLButtonElement>('[aria-label="Dismiss hint"]')!.click());
    React.act(() => trace.dispatch({ type: "SET_MODE", mode: "edit" }));
    expect(overlay.querySelector("button")).toBeNull();
    React.act(() => trace.dispatch({ type: "SET_MODE", mode: "navigate" }));
    expect(overlay.querySelector('[aria-label="Dismiss hint"]')).toBeNull();
    expect(overlay.querySelector('[aria-label="Show current hint"]')).not.toBeNull();
  });
  it("opens the shared export prompt from outline adjustments", () => {
    readyOutline();
    React.act(() => button("Adjust").click());
    React.act(() => button("Export Tool Outline").click());
    expect(exportOutline).toHaveBeenCalledOnce();
    expect(openSettings).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="mobile-adjustment-tray"]')).toBeNull();
  });
  it("opens naming directly once a calibrated outline is available", () => {
    load();
    React.act(() => {
      trace.dispatch({ type: "SET_CALIBRATION", calibration });
      trace.dispatch({ type: "OUTLINE_COMMITTED", outline: [{ outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], holes: [] }] });
    });
    React.act(() => button("Add to bin").click());
    expect(addToBin).toHaveBeenCalledOnce();
    expect(openSettings).not.toHaveBeenCalled();
  });
});
