// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { TraceControlsPanel } from "./trace-controls-panel";
import { TraceEditingWorkspace } from "./trace-editing-workspace";

vi.mock("@/lib/image-processor", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/image-processor")>(),
  adjustOutlineMargin: vi.fn(async (current) => current),
}));

const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 };
const outline = [{ outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], holes: [] }];
let trace: TraceStore;
let host: HTMLDivElement;
let root: Root;
let canvasMounts: number;
const exportTrace = vi.fn();
const reprocess = vi.fn();
class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
function Canvas(): JSX.Element {
  React.useEffect(() => { canvasMounts += 1; }, []);
  return <div data-testid="trace-canvas-sentinel" />;
}
function Harness({ enabled = true }: { enabled?: boolean }): JSX.Element {
  trace = useTrace();
  const [panelOpen, setPanelOpen] = React.useState(true);
  return <TraceEditingWorkspace enabled={enabled} autoSaveId="test-trace" panelOpen={panelOpen} onPanelOpenChange={setPanelOpen}
    panel={<TraceControlsPanel active onReplaceImage={() => {}} onRotateImage={() => {}} onExport={exportTrace}
      onReprocess={reprocess} onDetectMarkers={() => {}} onApplyPerspective={() => {}} />}
    canvas={<Canvas />} />;
}
const button = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
async function act(action: () => void): Promise<void> {
  await React.act(async () => { action(); await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function loadPhoto(): Promise<void> {
  await act(() => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "data:image/png;base64,test", fileName: "Tool photo" });
    trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 800, height: 600 } });
  });
}
async function finishTrace(): Promise<void> {
  await loadPhoto();
  await act(() => trace.dispatch({ type: "SET_CALIBRATION", calibration }));
  await act(() => {
    trace.dispatch({ type: "SET_REGION", region: { x: 10, y: 10, width: 200, height: 200 } });
    trace.dispatch({ type: "REGION_COMMITTED" });
    trace.dispatch({ type: "OUTLINE_COMMITTED", outline });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  canvasMounts = 0;
  exportTrace.mockReset();
  reprocess.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  React.act(() => root.render(<TooltipProvider><ShapeLibraryProvider><TraceProvider><Harness /></TraceProvider></ShapeLibraryProvider></TooltipProvider>));
});
afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("trace workflow and properties", () => {
  it("keeps simple steps left and one copy of the selected form right", async () => {
    expect(host.querySelector('[aria-label="Photo tracing workflow"]')).not.toBeNull();
    expect(button("trace-workflow-scale").disabled).toBe(true);
    expect(host.querySelector('[data-testid="trace-settings-index"]')).toBeNull();
    await loadPhoto();
    const left = host.querySelector("#workflow-panel")!;
    const right = host.querySelector("#objects-panel")!;
    expect(left.querySelector("#ruler-length")).toBeNull();
    expect(left.textContent).not.toContain("Choose a clear photo of the whole tool.");
    expect(right.querySelector("#ruler-length")).not.toBeNull();
    expect(host.querySelectorAll("#ruler-length")).toHaveLength(1);
    expect(button("trace-workflow-region").disabled).toBe(true);
    await act(() => button("trace-workflow-photo").click());
    expect(right.textContent).toContain("Tool photo");
    await act(() => host.querySelector<HTMLButtonElement>('[aria-label="About photo step"]')!.click());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Choose a clear photo of the whole tool.");
    await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(right.querySelector("#ruler-length")).toBeNull();
    expect(canvasMounts).toBe(1);
  });

  it("keeps the guided Scale step while a new photo finishes decoding", async () => {
    await act(() => trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "Manual photo" }));
    await act(() => trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 800, height: 600 } }));
    expect(button("trace-workflow-scale").getAttribute("aria-current")).toBe("step");
    expect(host.querySelector("#objects-panel #ruler-length")).not.toBeNull();
  });

  it("requires explicit auto-scale acceptance before advancing to region and outline", async () => {
    await loadPhoto();
    await act(() => trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: trace.imageUrl!, calibration }));
    expect(button("trace-workflow-scale").getAttribute("aria-current")).toBe("step");
    expect(button("trace-workflow-region").disabled).toBe(true);
    expect(trace.calibration).toBeNull();
    await act(() => button("button-accept-auto-scale").click());
    expect(trace.calibration).toEqual(calibration);
    expect(button("trace-workflow-region").getAttribute("aria-current")).toBe("step");
    expect(host.querySelector("#objects-panel #trace-settings-crop")).not.toBeNull();
    await act(() => {
      trace.dispatch({ type: "SET_REGION", region: { x: 10, y: 10, width: 200, height: 200 } });
      trace.dispatch({ type: "REGION_COMMITTED" });
    });
    expect(button("trace-workflow-outline").getAttribute("aria-current")).toBe("step");
    expect(host.querySelector("#objects-panel #include-interior-holes")).not.toBeNull();
    expect(button("trace-workflow-margin").disabled).toBe(true);
  });

  it("opens and focuses manual ruler confirmation even with the left panel collapsed", async () => {
    await loadPhoto();
    await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Collapse workflow panel"]')!.click());
    await act(() => {
      trace.dispatch({ type: "SET_MODE", mode: "calibrate" });
      trace.dispatch({ type: "SET_DRAFT_CALIBRATION", draftCalibration: { startX: 0, startY: 0, endX: 100, endY: 0 } });
      trace.dispatch({ type: "SET_MODE", mode: "pan" });
    });
    expect(document.activeElement?.id).toBe("ruler-length");
    expect(host.querySelector("#objects-panel")!.hasAttribute("hidden")).toBe(false);
    expect(trace.calibration).toBeNull();
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Confirm scale")!;
    await act(() => confirm.click());
    expect(trace.calibration).not.toBeNull();
    expect(host.querySelector("#objects-panel #trace-settings-crop")).not.toBeNull();
  });

  it("preserves geometry and canvas when revisiting steps, resizing, and exporting", async () => {
    await finishTrace();
    const before = trace.outline;
    await act(() => button("trace-workflow-photo").click());
    await act(() => button("trace-workflow-outline").click());
    expect(trace.outline).toBe(before);
    await act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
      window.dispatchEvent(new Event("resize"));
    });
    await act(() => button("trace-workflow-export").click());
    expect(host.querySelector("#objects-panel #format")).not.toBeNull();
    await act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.includes("Save STL"))!.click());
    expect(exportTrace).toHaveBeenCalledOnce();
    expect(trace.outline).toBe(before);
    expect(canvasMounts).toBe(1);
  });

  it("keeps a compact canvas accessible during ruler placement, then shows confirmation", async () => {
    await loadPhoto();
    await act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
      window.dispatchEvent(new Event("resize"));
    });
    await act(() => button("trace-workflow-scale").click());
    expect(host.querySelector("#objects-panel")!.hasAttribute("hidden")).toBe(false);
    await act(() => button("button-set-scale").click());
    expect(trace.mode).toBe("calibrate");
    expect(host.querySelector("#objects-panel")!.hasAttribute("hidden")).toBe(true);
    await act(() => {
      trace.dispatch({ type: "SET_DRAFT_CALIBRATION", draftCalibration: { startX: 0, startY: 0, endX: 100, endY: 0 } });
      trace.dispatch({ type: "SET_MODE", mode: "pan" });
    });
    expect(host.querySelector("#objects-panel")!.hasAttribute("hidden")).toBe(false);
    expect(document.activeElement?.id).toBe("ruler-length");
  });

  it("returns to correction settings after four page corners on a compact canvas", async () => {
    await loadPhoto();
    await act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
      window.dispatchEvent(new Event("resize"));
    });
    await act(() => button("button-select-perspective-points").click());
    expect(host.querySelector("#objects-panel")!.hasAttribute("hidden")).toBe(true);
    for (const point of [{ x: 10, y: 10 }, { x: 500, y: 10 }, { x: 500, y: 400 }, { x: 10, y: 400 }]) {
      await act(() => trace.dispatch({ type: "ADD_PERSPECTIVE_POINT", point }));
    }
    expect(trace.mode).toBe("pan");
    expect(host.querySelector("#objects-panel")!.hasAttribute("hidden")).toBe(false);
    expect(button("button-apply-manual-perspective")).not.toBeNull();
  });

  it("returns to an available step when clearing prerequisites", async () => {
    await finishTrace();
    await act(() => button("trace-workflow-margin").click());
    await act(() => trace.dispatch({ type: "SET_REGION", region: null }));
    expect(button("trace-workflow-region").getAttribute("aria-current")).toBe("step");
    expect(host.querySelector("#objects-panel #margin")).toBeNull();
    await act(() => trace.dispatch({ type: "SET_MODE", mode: "calibrate" }));
    expect(button("trace-workflow-scale").getAttribute("aria-current")).toBe("step");
  });

  it("keeps paper selection when changing layouts and hides unavailable controls", async () => {
    await loadPhoto();
    await act(() => trace.dispatch({ type: "SET_PERSPECTIVE_PAPER", paper: "letter" }));
    await act(() => root.render(<TooltipProvider><ShapeLibraryProvider><TraceProvider><Harness enabled={false} /></TraceProvider></ShapeLibraryProvider></TooltipProvider>));
    expect(host.querySelector("#manual-perspective-paper")?.textContent).toContain("US Letter");
    expect(host.querySelector("#include-interior-holes")).toBeNull();
    expect(host.querySelector('[role="slider"][aria-label="Sensitivity"]')).toBeNull();
    await act(() => trace.dispatch({ type: "SET_CALIBRATION", calibration }));
    await act(() => {
      trace.dispatch({ type: "SET_REGION", region: { x: 0, y: 0, width: 100, height: 100 } });
      trace.dispatch({ type: "REGION_COMMITTED" });
    });
    expect(host.querySelector("#include-interior-holes")).not.toBeNull();
  });

  it("defaults to the paper and lets Region reveal the full corrected photo without losing edits", async () => {
    await loadPhoto();
    await act(() => trace.dispatch({ type: "PERSPECTIVE_APPLIED", sourceImageUrl: trace.imageUrl!, imageUrl: "corrected",
      imageSize: { width: 800, height: 600 }, source: "template", paper: "a4", calibration,
      paperBounds: { x: 200, y: 50, width: 300, height: 450 } }));
    await act(() => {
      trace.dispatch({ type: "SET_REGION", region: { x: 250, y: 100, width: 200, height: 200 } });
      trace.dispatch({ type: "REGION_COMMITTED" });
      trace.dispatch({ type: "OUTLINE_COMMITTED", outline });
    });
    await act(() => button("trace-workflow-region").click());
    const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    const before = trace;
    await act(() => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(trace.perspectiveCorrection?.showFullPhoto).toBe(true);
    expect(trace.imageUrl).toBe(before.imageUrl);
    expect(trace.calibration).toBe(before.calibration);
    expect(trace.region).toBe(before.region);
    expect(trace.outline).toBe(before.outline);
    expect(trace.history).toBe(before.history);
    await act(() => toggle.click());
    expect(trace.perspectiveCorrection?.showFullPhoto).toBe(false);
    expect(canvasMounts).toBe(1);
    expect(reprocess).not.toHaveBeenCalled();
  });

  it("gives margin its own optional properties and resets it without re-detection", async () => {
    await finishTrace();
    expect(host.querySelector("#objects-panel #margin")).toBeNull();
    await act(() => button("trace-workflow-margin").click());
    expect(host.querySelector("#objects-panel #margin")?.textContent).toContain("0 mm — no margin");
    expect(button("button-reset-margin").disabled).toBe(true);
    await act(() => trace.dispatch({ type: "MARGIN_COMMITTED", outline, margin: 1 }));
    await act(() => button("button-reset-margin").click());
    expect(trace.margin).toBe(0);
    expect(reprocess).not.toHaveBeenCalled();
    expect(host.querySelector("#objects-panel")?.textContent).not.toContain("Bin clearance is added on top");
    await act(() => host.querySelector<HTMLButtonElement>('[aria-label="About trace margin"]')!.click());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Bin clearance is added on top");
    expect(trace.margin).toBe(0);
    await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(() => trace.dispatch({ type: "UNDO" }));
    expect(trace.margin).toBe(1);
  });

  it("restores a collapsed inspector when another workflow step is chosen", async () => {
    await finishTrace();
    await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Collapse properties panel"]')!.click());
    expect(host.querySelector("#objects-panel")!.hasAttribute("hidden")).toBe(true);
    await act(() => button("trace-workflow-export").click());
    expect(host.querySelector("#objects-panel")!.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector("#objects-panel #format")).not.toBeNull();
  });
});
