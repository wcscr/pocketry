import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { applySensitivity } from "@/lib/detect/otsu";
import { TraceCurveSettings, TraceDetectionControls } from "./trace-detection-controls";
import { asymmetricHandle } from "@/lib/geometry/curve-symmetry.test-support";

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("makes editable curves discoverable and opt-in, with undoable conversion and recovery", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  let trace!: TraceStore; function Harness() { trace = useTrace(); return <TraceCurveSettings onReprocess={() => {}} />; }
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  try {
    await React.act(async () => root.render(<TraceProvider><Harness /></TraceProvider>));
    const toggle = () => host.querySelector<HTMLButtonElement>('#editable-curves')!;
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    React.act(() => toggle().click()); expect(trace.editableCurves).toBe(true); expect(trace.curves).toBeUndefined();
    React.act(() => trace.dispatch({ type: "CURVES_COMMITTED", curves: asymmetricHandle, label: "Curves" }));
    const curves = trace.curves, index = trace.history.index;
    React.act(() => toggle().click()); expect(trace.curves).toBeUndefined(); expect(trace.editableCurves).toBe(false); expect(trace.history.index).toBe(index + 1);
    React.act(() => trace.undo()); expect(trace.curves).toEqual(curves); expect(toggle().getAttribute("aria-checked")).toBe("true");
  } finally { React.act(() => root.unmount()); }
});

it.each(["Cancel", "Keep current outline", "Re-detect photo"])("asks before enabling curves on an existing trace: %s", async choice => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  let trace!: TraceStore; const reprocess = vi.fn();
  function Harness() { trace = useTrace(); return <TraceCurveSettings onReprocess={reprocess} />; }
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  try {
    await React.act(async () => root.render(<TraceProvider><Harness /></TraceProvider>));
    React.act(() => {
      trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "Tool" });
      trace.dispatch({ type: "SET_REGION", region: { x: 0, y: 0, width: 100, height: 100 } });
      trace.dispatch({ type: "OUTLINE_COMMITTED", outline: [{ outer: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 50, y: 90 }], holes: [] }], label: "Manual edit" });
    });
    const outline = trace.outline, history = trace.history;
    React.act(() => host.querySelector<HTMLButtonElement>("#editable-curves")!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Undo restores them");
    expect(trace.editableCurves).toBe(false); expect(reprocess).not.toHaveBeenCalled();
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent === choice)!.click());
    expect(trace.editableCurves).toBe(choice !== "Cancel");
    expect(trace.outline).toBe(outline); expect(trace.history).toBe(history);
    if (choice === "Re-detect photo") expect(reprocess).toHaveBeenCalledExactlyOnceWith({ sensitivity: 128, includeInteriorHoles: false, boundary: "teed", editableCurves: true });
    else expect(reprocess).not.toHaveBeenCalled();
  } finally { React.act(() => root.unmount()); }
});

it("defaults to tool edges, allows manual choices, and suppresses holes in tool-edge mode", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  let trace!: TraceStore;
  const reprocess = vi.fn();
  function Harness() { trace = useTrace(); return <TraceDetectionControls onReprocess={reprocess} />; }
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(<TraceProvider><Harness /></TraceProvider>));
    expect(trace.boundaryMethod).toBe("teed");
    expect(host.querySelector<HTMLSelectElement>("#outline-detection-method")!.value).toBe("teed");
    expect(host.querySelector<HTMLButtonElement>("#include-interior-holes")!.disabled).toBe(true);
    expect(reprocess).not.toHaveBeenCalled();
    await React.act(async () => { const method = host.querySelector<HTMLSelectElement>("#outline-detection-method")!;
      method.value = "color"; method.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(trace.boundaryMethod).toBe("color");
    expect(host.querySelector<HTMLButtonElement>("#include-interior-holes")!.disabled).toBe(false);
    React.act(() => trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "data:color", fileName: "other background" }));
    expect(trace.boundaryMethod).toBe("color");
    React.act(() => trace.dispatch({ type: "SET_INCLUDE_INTERIOR_HOLES", include: true }));
    await React.act(async () => { const method = host.querySelector<HTMLSelectElement>("#outline-detection-method")!;
      method.value = "teed"; method.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(trace.boundaryMethod).toBe("teed");
    expect(trace.includeInteriorHoles).toBe(false);
    expect(host.querySelector<HTMLButtonElement>("#include-interior-holes")!.disabled).toBe(true);
    expect(reprocess).toHaveBeenLastCalledWith({ sensitivity: 128, includeInteriorHoles: false, boundary: "teed" });
    React.act(() => trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "data:new", fileName: "next tool" }));
    expect(trace.boundaryMethod).toBe("teed");
    expect(trace.includeInteriorHoles).toBe(false);
  } finally { React.act(() => root.unmount()); }
});

it.each([false, true])("higher sensitivity includes more while preserving stored settings (compact=%s)", async compact => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  let trace!: TraceStore;
  const reprocess = vi.fn();
  function Harness() {
    trace = useTrace();
    return <TraceDetectionControls compact={compact} onReprocess={reprocess} />;
  }
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(<TraceProvider><Harness /></TraceProvider>));
    const slider = host.querySelector('[role="slider"][aria-label="Sensitivity"]')!;
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    expect(host.textContent).toContain("auto");
    React.act(() => trace.dispatch({ type: "SET_SENSITIVITY", sensitivity: 64 }));
    expect(slider.getAttribute("aria-valuenow")).toBe("64");
    expect(host.textContent).toContain("+64");
    expect(reprocess).not.toHaveBeenCalled();
    const key = (key: string) => React.act(async () => {
      slider.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    await key("ArrowRight");
    expect(slider.getAttribute("aria-valuenow")).toBe("65");
    expect(host.textContent).toContain("+65");
    expect(reprocess).toHaveBeenLastCalledWith({ sensitivity: 63, includeInteriorHoles: false });
    expect(applySensitivity(128, trace.sensitivity)).toBeLessThan(applySensitivity(128, 64));
    await key("ArrowLeft"); expect(trace.sensitivity).toBe(64);
    await key("Home"); expect(trace.sensitivity).toBe(255); expect(host.textContent).toContain("-127");
    await key("End"); expect(trace.sensitivity).toBe(0); expect(host.textContent).toContain("+128");
    if (!compact) {
      await React.act(async () => host.querySelector<HTMLButtonElement>('[aria-label="About sensitivity"]')!.focus());
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Higher includes more of the image");
    }
  } finally { React.act(() => root.unmount()); }
});

it.each([false, true])("names point reduction consistently in drawer and compact controls (compact=%s)", async (compact) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await React.act(async () => {
      root.render(<TraceProvider><TraceDetectionControls compact={compact} onReprocess={() => {}} /></TraceProvider>);
    });
    const slider = host.querySelector(`[id="${compact ? "mobile-detail" : "detail"}"]`);
    expect(slider?.getAttribute("aria-label")).toBe("Simplification");
    expect(host.textContent).not.toContain("Higher values use fewer points and may omit small features");
    if (!compact) {
      await React.act(async () => host.querySelector<HTMLButtonElement>('[aria-label="About simplification"]')!.focus());
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Higher values use fewer points and may omit small features");
      React.act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    }
  } finally { React.act(() => root.unmount()); }
});
