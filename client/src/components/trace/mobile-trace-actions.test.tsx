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
const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 };
function Harness(): JSX.Element {
  trace = useTrace();
  return <MobileTraceActions onChoosePhoto={choosePhoto} onOpenSettings={openSettings} onApplyPerspective={applyPerspective} />;
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
    expect(applyPerspective).toHaveBeenCalledWith(proposal, "letter");
    expect(trace.calibration).toBeNull();
    React.act(() => button("Use scale only").click());
    expect(trace.calibration).toEqual(calibration);
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
