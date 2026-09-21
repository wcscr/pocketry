// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import type { TraceControlsPanelProps } from "@/components/trace/trace-controls-panel";
import { initialTraceState, TraceProvider, useTrace } from "@/state/trace-store";
import { downloadBlob } from "@/lib/download";
import { loadTraceDraft, saveTraceDraft, traceDraftSnapshot } from "@/lib/trace-draft";
import type { TraceDraft } from "@shared/trace-draft";
import { generateSTL } from "@/lib/export/stl";
import { parseProjectDoc } from "@shared/gridfinity/project";
import type { Outline } from "@shared/geometry/types";

import TracePage from "./trace";

const {
  decodeImageFileMock,
  downloadCalibrationTemplateMock,
  getImageDataMock,
  processImageMock,
  getDetectionFrameMock,
  correctPerspectiveMock,
} = vi.hoisted(() => ({
    decodeImageFileMock: vi.fn(),
    downloadCalibrationTemplateMock: vi.fn(),
    getImageDataMock: vi.fn(),
    processImageMock: vi.fn(),
    getDetectionFrameMock: vi.fn(),
    correctPerspectiveMock: vi.fn(),
  }));

vi.mock("@/components/layout/mobile-canvas-overlay", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/layout/mobile-canvas-overlay")>(),
  MobileCanvasOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/layout/workspace-layout", () => ({
  WorkspaceLayout: ({
    panel,
    canvas,
    mobileActions,
    panelOpen,
  }: {
    panel: React.ReactNode;
    canvas: React.ReactNode;
    mobileActions?: React.ReactNode;
    panelOpen: boolean;
  }) => (
    <>
      {(!window.matchMedia("(max-width: 767px)").matches || panelOpen) && panel}
      {canvas}
      {window.matchMedia("(max-width: 767px)").matches && mobileActions}
    </>
  ),
}));

vi.mock("@/components/trace/trace-controls-panel", () => ({
  TraceControlsPanel: ({ onExport, onApplyPerspective }: TraceControlsPanelProps) => <>
    <button onClick={onExport} data-testid="export-trace">Export trace</button>
    <button data-testid="perspective-only" onClick={() => onApplyPerspective({ source: "manual", paper: "letter",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    }, "letter", false)}>Correct perspective only</button>
  </>,
}));

vi.mock("@/lib/calibrate/perspective", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/calibrate/perspective")>(),
  correctPerspective: correctPerspectiveMock,
}));

vi.mock("@/lib/trace-draft", async (original) => ({
  ...await original<typeof import("@/lib/trace-draft")>(),
  loadTraceDraft: vi.fn(), saveTraceDraft: vi.fn(),
}));

vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));
vi.mock("@/lib/export/stl", () => ({ generateSTL: vi.fn() }));

const exportOutline: Outline = [{ outer: [{ x: 10, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 60 }, { x: 10, y: 60 }], holes: [] }];

function SeedExportOutline({ format, calibrated = true }: { format: "svg" | "dxf" | "dwg" | "stl"; calibrated?: boolean }): null {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({ type: "SOURCE_LOADED", imageUrl: "data:image/png;base64,source", fileName: "Test tool" });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 800, height: 600 } });
    dispatch({ type: "OUTLINE_COMMITTED", outline: exportOutline });
    if (calibrated) dispatch({ type: "SET_CALIBRATION", calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 } });
    dispatch({ type: "SET_EXPORT_FORMAT", exportFormat: format });
  }, [dispatch, format, calibrated]);
  return null;
}

vi.mock("@/components/trace/trace-canvas", () => ({
  TraceCanvas: ({
    emptyState,
    onReprocess,
  }: {
    emptyState?: React.ReactNode;
    onReprocess: () => void;
  }) => (
    <>
      {emptyState}
      <button data-testid="run-detection" onClick={onReprocess}>
        Run detection
      </button>
    </>
  ),
}));

vi.mock("@/components/trace/use-image-source", () => {
  const empty = {
    source: { status: "empty" as const },
    getImageData: getImageDataMock,
    getDetectionFrame: getDetectionFrameMock,
  };
  const ready = {
    source: {
      status: "ready" as const,
      url: "data:image/png;base64,source",
      fileName: "source",
      size: { width: 800, height: 600 },
      naturalSize: { width: 800, height: 600 },
    },
    getImageData: getImageDataMock,
    getDetectionFrame: getDetectionFrameMock,
  };
  const readySources = new Map<string, typeof ready>();

  return {
    decodeImageFile: decodeImageFileMock,
    fitWithin: () => ({ width: 800, height: 600 }),
    IMAGE_CANVAS_MAX: { width: 800, height: 600 },
    useImageSource: (url: string | null) => {
      if (!url) return empty;
      if (!readySources.has(url)) readySources.set(url, { ...ready, source: { ...ready.source, url } });
      return readySources.get(url)!;
    },
  };
});

vi.mock("@/lib/image-processor", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/image-processor")>();
  return { ...original, processImage: processImageMock };
});

vi.mock("@/lib/calibrate/download-template", () => ({
  downloadCalibrationTemplate: downloadCalibrationTemplateMock,
}));

function WorkflowController(): JSX.Element {
  const { dispatch } = useTrace();

  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,source",
      fileName: "source",
    });
  }, [dispatch]);

  return (
    <button
      data-testid="set-region"
      onClick={() =>
        dispatch({
          type: "SET_REGION",
          region: { x: 10, y: 20, width: 300, height: 200 },
        })
      }
    >
      Set region
    </button>
  );
}

function SeedReadySource(): null {
  const { dispatch } = useTrace();

  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,original",
      fileName: "original",
    });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 400, height: 300 } });
  }, [dispatch]);
  return null;
}

function SourceStateProbe(): JSX.Element {
  const { imageSize, imageUrl } = useTrace();
  return (
    <output data-testid="source-state">
      {imageUrl ?? "none"}|{imageSize.width}x{imageSize.height}
    </output>
  );
}

describe("Trace detection workflow", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.mocked(generateSTL).mockResolvedValue(new ArrayBuffer(100));
    vi.mocked(loadTraceDraft).mockResolvedValue(null);
    vi.mocked(saveTraceDraft).mockResolvedValue();
    getDetectionFrameMock.mockReturnValue(null);
    getImageDataMock.mockReturnValue({
      width: 300,
      height: 200,
      data: new Uint8ClampedArray(300 * 200 * 4),
      colorSpace: "srgb",
    } as ImageData);
    processImageMock.mockResolvedValue({
      outline: [],
      rawOutline: [],
      svg: "<svg />",
    });

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  it("advances an accepted mobile scale to region drawing while the controls are unmounted", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
    let current: ReturnType<typeof useTrace>;
    function MobileSeed(): null {
      current = useTrace();
      React.useEffect(() => {
        current.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "tool" });
        current.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: "photo", calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 } });
      }, []);
      return null;
    }
    await React.act(async () => root.render(<PanelProvider><TraceProvider><MobileSeed /><TracePage /></TraceProvider></PanelProvider>));
    expect(host.querySelector('[data-testid="export-trace"]')).toBeNull();
    await React.act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Accept detected scale")!.click());
    expect(current!.mode).toBe("region");
    expect(current!.calibration?.lengthMm).toBe(50);
    expect(host.querySelector('[data-testid="export-trace"]')).toBeNull();
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true, writable: true });
  });

  it.each([true, false])("closes the mobile drawer only after successful perspective-only correction (success=%s)", async (success) => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
    let current!: ReturnType<typeof useTrace>;
    let panel!: ReturnType<typeof usePanelState>;
    function Probe(): null { current = useTrace(); panel = usePanelState(); return null; }
    await React.act(async () => root.render(<PanelProvider><TraceProvider><Probe /><SeedExportOutline format="svg" calibrated={false} /><TracePage /></TraceProvider></PanelProvider>));
    getDetectionFrameMock.mockReturnValue({ imageData: getImageDataMock(), sourceImageUrl: "data:image/png;base64,source", toWorking: { x: 1, y: 1 } });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ putImageData: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,corrected");
    if (success) correctPerspectiveMock.mockResolvedValueOnce({ imageData: getImageDataMock(), width: 300, height: 200, calibration: null, pxPerMm: 1, reprojectionErrorPx: 0 });
    else correctPerspectiveMock.mockRejectedValueOnce(new Error("Invalid corners"));
    await React.act(async () => panel.setPanelOpen(true));
    await React.act(async () => host.querySelector<HTMLButtonElement>('[data-testid="perspective-only"]')!.click());
    expect(correctPerspectiveMock).not.toHaveBeenCalled();
    await React.act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Correct and clear trace")!.click());
    expect(panel.panelOpen).toBe(!success);
    expect(current.calibration).toBeNull();
    if (success) {
      expect(current.mode).toBe("calibrate");
      expect(current.imageUrl).toBe("data:image/png;base64,corrected");
      expect(host.textContent).toContain("Tap two points a known distance apart");
      expect(host.querySelector('[data-testid="perspective-only"]')).toBeNull();
    } else {
      expect(current.imageUrl).toBe("data:image/png;base64,source");
      expect(host.querySelector('[data-testid="perspective-only"]')).not.toBeNull();
    }
  });

  it("keeps Start over empty when pending detection and photo decoding finish later", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    let finishDetection!: (result: { outline: Outline; rawOutline: Outline; svg: string }) => void;
    let finishPhoto!: (result: { imageUrl: string; naturalSize: { width: number; height: number } }) => void;
    processImageMock.mockReturnValue(new Promise(resolve => { finishDetection = resolve; }));
    decodeImageFileMock.mockReturnValue(new Promise(resolve => { finishPhoto = resolve; }));
    let current: ReturnType<typeof useTrace>;
    function Probe() { current = useTrace(); const { traceRestart } = usePanelState(); return <button onClick={() => traceRestart?.()}>Start over</button>; }
    await React.act(async () => root.render(<PanelProvider><TraceProvider><WorkflowController /><Probe /><TracePage /></TraceProvider></PanelProvider>));
    await React.act(async () => host.querySelector<HTMLButtonElement>('[data-testid="set-region"]')!.click());
    await React.act(async () => host.querySelector<HTMLButtonElement>('[data-testid="run-detection"]')!.click());
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["replacement"], "replacement.png", { type: "image/png" })] });
    await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(current!.processing).toBe(true);
    await React.act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === "Start over")!.click());
    await React.act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Clear trace and start over")!.click());
    expect(current!.imageUrl).toBeNull();
    await React.act(async () => {
      finishDetection({ outline: exportOutline, rawOutline: exportOutline, svg: "<svg/>" });
      finishPhoto({ imageUrl: "data:image/png;base64,replacement", naturalSize: { width: 800, height: 600 } });
    });
    expect(current!.imageUrl).toBeNull();
    expect(current!.outline).toEqual([]);
    expect(current!.processing).toBe(false);
  });

  afterEach(() => {
    React.act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true, writable: true });
  });

  it.each((["svg", "dxf", "dwg", "stl"] as const).flatMap((format) => [false, true].map((includeProject) => ({ format, includeProject }))))(
    "exports Trace $format with JSON only when requested ($includeProject)",
    async ({ format, includeProject }) => {
      await React.act(async () => root.render(<PanelProvider><TraceProvider><SeedExportOutline format={format} /><TracePage /></TraceProvider></PanelProvider>));
      // The existing DWG explanation is separate from the export request.
      if (format === "dwg") React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Close")!.click());
      React.act(() => host.querySelector<HTMLButtonElement>('[data-testid="export-trace"]')!.click());
      const checkbox = document.querySelector<HTMLButtonElement>('[data-testid="checkbox-export-project"]')!;
      expect(checkbox.getAttribute("aria-checked")).toBe("false");
      expect(downloadBlob).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Outline size: 30 × 20 mm (width × height)");
      expect(document.body.textContent).toContain("Scale: Manual ruler");
      if (format === "stl") expect(document.body.textContent).toContain("extrusion");
      if (includeProject) React.act(() => checkbox.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-export"]')!.click());
      expect(downloadBlob).toHaveBeenCalledTimes(includeProject ? 2 : 1);
      const [model, filename] = vi.mocked(downloadBlob).mock.calls.at(-1)!;
      expect(model.size).toBeGreaterThan(0);
      expect(filename).toBe(`${format === "stl" ? "model" : "outline"}_Test-tool.${format}`);
      if (includeProject) {
        const [backup, backupName] = vi.mocked(downloadBlob).mock.calls[0];
        expect(backupName).toBe(filename.replace(/\.[^.]+$/, ".pocketry.json"));
        const json = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(backup); });
        const project = parseProjectDoc(JSON.parse(json));
        expect(project?.shapes[0].bboxMm).toEqual({ minX: -15, maxX: 15, minY: -10, maxY: 10 });
        expect(project?.shapes[0].sourceMmPerPx).toBe(0.5);
        expect(project?.cutouts[0].shapeId).toBe(project?.shapes[0].id);
      }
    },
  );

  it("keeps uncalibrated outlines exportable but requires a scale for a Pocketry project", async () => {
    await React.act(async () => root.render(<PanelProvider><TraceProvider><SeedExportOutline format="svg" calibrated={false} /><TracePage /></TraceProvider></PanelProvider>));
    React.act(() => host.querySelector<HTMLButtonElement>('[data-testid="export-trace"]')!.click());
    expect(document.querySelector<HTMLButtonElement>('[data-testid="checkbox-export-project"]')!.disabled).toBe(true);
    expect(document.body.textContent).toContain("Set the scale to include an editable Pocketry project.");
    expect(document.body.textContent).toContain("Unscaled SVG outline: 60 × 40 image pixels. No physical size is defined.");
    expect(document.querySelector('[data-testid="button-confirm-export"]')?.textContent).toBe("Download SVG (pixels)");
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-export"]')!.click());
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toMatch(/\.svg$/);
  });

  it.each(["stl", "dxf", "dwg"] as const)("blocks uncalibrated %s even when a caller bypasses the disabled UI", async (format) => {
    await React.act(async () => root.render(<PanelProvider><TraceProvider><SeedExportOutline format={format} calibrated={false} /><TracePage /></TraceProvider></PanelProvider>));
    if (format === "dwg") React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Got it")!.click());
    React.act(() => host.querySelector<HTMLButtonElement>('[data-testid="export-trace"]')!.click());
    expect(document.querySelector('[data-testid="button-confirm-export"]')).toBeNull();
    expect(generateSTL).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("rechecks physical scale when confirming an already-open export", async () => {
    let current!: ReturnType<typeof useTrace>;
    function Probe(): null { current = useTrace(); return null; }
    await React.act(async () => root.render(<PanelProvider><TraceProvider><Probe /><SeedExportOutline format="stl" /><TracePage /></TraceProvider></PanelProvider>));
    React.act(() => host.querySelector<HTMLButtonElement>('[data-testid="export-trace"]')!.click());
    React.act(() => current.dispatch({ type: "SET_CALIBRATION", calibration: null }));
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-export"]')!.click());
    expect(generateSTL).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("keeps the edited trace and mode when scale first appears with existing geometry", async () => {
    let current!: ReturnType<typeof useTrace>;
    function Probe(): null { current = useTrace(); return null; }
    await React.act(async () => root.render(<PanelProvider><TraceProvider><Probe /><SeedExportOutline format="svg" calibrated={false} /><TracePage /></TraceProvider></PanelProvider>));
    const outline = current.outline;
    await React.act(async () => {
      current.dispatch({ type: "SET_MODE", mode: "edit" });
      current.dispatch({ type: "SET_CALIBRATION", calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 } });
    });
    expect(current.mode).toBe("edit");
    expect(current.outline).toBe(outline);
  });

  it("can cancel perspective reapplication without losing contours or history", async () => {
    let current!: ReturnType<typeof useTrace>;
    function Probe(): null { current = useTrace(); return null; }
    await React.act(async () => root.render(<PanelProvider><TraceProvider><Probe /><SeedExportOutline format="svg" /><TracePage /></TraceProvider></PanelProvider>));
    const before = { outline: current.outline, history: current.history, calibration: current.calibration };
    await React.act(async () => host.querySelector<HTMLButtonElement>('[data-testid="perspective-only"]')!.click());
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Your region, contours and edit history will be cleared");
    expect(correctPerspectiveMock).not.toHaveBeenCalled();
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Keep working")!.click());
    expect(current.outline).toBe(before.outline);
    expect(current.history).toBe(before.history);
    expect(current.calibration).toBe(before.calibration);
    expect(correctPerspectiveMock).not.toHaveBeenCalled();
  });

  it("requires confirmation for work added while a replacement photo is decoding", async () => {
    let current!: ReturnType<typeof useTrace>;
    let finish!: (result: { imageUrl: string; naturalSize: { width: number; height: number } }) => void;
    decodeImageFileMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    function Probe(): null { current = useTrace(); return null; }
    await React.act(async () => root.render(<PanelProvider><TraceProvider><Probe /><SeedReadySource /><TracePage /></TraceProvider></PanelProvider>));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["replacement"], "replacement.png", { type: "image/png" })] });
    await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    React.act(() => current.dispatch({ type: "OUTLINE_COMMITTED", outline: exportOutline }));
    const before = current.history;
    await React.act(async () => finish({ imageUrl: "replacement", naturalSize: { width: 800, height: 600 } }));
    expect(current.imageUrl).toBe("data:image/png;base64,original");
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Replace this photo and clear its trace?");
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Keep working")!.click());
    expect(current.history).toBe(before);
    expect(current.outline).toEqual(exportOutline);
    decodeImageFileMock.mockResolvedValueOnce({ imageUrl: "replacement", naturalSize: { width: 800, height: 600 } });
    await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Replace photo and clear trace")!.click());
    expect(current.imageUrl).toBe("replacement");
    expect(current.outline).toEqual([]);
    expect(current.history.stack).toHaveLength(1);
  });

  it("leaves edited work untouched when a replacement cannot be decoded", async () => {
    let current!: ReturnType<typeof useTrace>;
    function Probe(): null { current = useTrace(); return null; }
    await React.act(async () => root.render(<PanelProvider><TraceProvider><Probe /><SeedExportOutline format="svg" /><TracePage /></TraceProvider></PanelProvider>));
    const before = { outline: current.outline, history: current.history, calibration: current.calibration };
    decodeImageFileMock.mockRejectedValueOnce(new Error("Unsupported image"));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["bad"], "bad.png", { type: "image/png" })] });
    await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(current.outline).toBe(before.outline);
    expect(current.history).toBe(before.history);
    expect(current.calibration).toBe(before.calibration);
  });

  it.each([true, false])("waits for recovery before reviewing a chosen photo (valid=%s)", async (valid) => {
    let finishRecovery!: (draft: TraceDraft) => void;
    vi.mocked(loadTraceDraft).mockReturnValueOnce(new Promise(resolve => { finishRecovery = resolve; }));
    let current!: ReturnType<typeof useTrace>;
    function Probe(): null { current = useTrace(); return null; }
    const recovered = traceDraftSnapshot({ ...initialTraceState, imageUrl: "data:image/png;base64,recovered", fileName: "Recovered", imageSize: { width: 800, height: 600 }, outline: exportOutline })!;
    if (valid) decodeImageFileMock.mockResolvedValueOnce({ imageUrl: "replacement", naturalSize: { width: 800, height: 600 } });
    else decodeImageFileMock.mockRejectedValueOnce(new Error("Invalid photo"));
    await React.act(async () => root.render(<PanelProvider><TraceProvider persist><Probe /><TracePage /></TraceProvider></PanelProvider>));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["replacement"], "replacement.png", { type: "image/png" })] });
    await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(decodeImageFileMock).not.toHaveBeenCalled();
    await React.act(async () => finishRecovery(recovered));
    expect(decodeImageFileMock).toHaveBeenCalledOnce();
    expect(current.imageUrl).toBe(recovered.state.imageUrl);
    expect(current.outline).toEqual(exportOutline);
    if (valid) {
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Replace this photo");
      React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Replace photo and clear trace")!.click());
      expect(current.imageUrl).toBe("replacement");
    } else expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it.each([false, true])("keeps save failures visible over the canvas with controls closed (mobile=%s)", async mobile => {
    vi.stubGlobal("matchMedia", () => ({ matches: mobile, addEventListener: () => {}, removeEventListener: () => {} }));
    Object.defineProperty(window, "innerWidth", { value: mobile ? 390 : 1440, configurable: true, writable: true });
    vi.mocked(saveTraceDraft).mockRejectedValue(new Error("Storage full"));
    await React.act(async () => root.render(<PanelProvider><TraceProvider persist><SeedExportOutline format="svg" /><TracePage /></TraceProvider></PanelProvider>));
    await React.act(async () => new Promise(resolve => setTimeout(resolve, 250)));
    expect(host.querySelector('[data-testid="trace-save-error"]')?.textContent).toContain("Keep this page open");
  });

  it("cancels Trace export without building or downloading", async () => {
    await React.act(async () => root.render(<PanelProvider><TraceProvider><SeedExportOutline format="stl" /><TracePage /></TraceProvider></PanelProvider>));
    React.act(() => host.querySelector<HTMLButtonElement>('[data-testid="export-trace"]')!.click());
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Cancel")!.click());
    expect(generateSTL).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("downloads neither file when Trace STL generation fails", async () => {
    vi.mocked(generateSTL).mockRejectedValueOnce(new Error("Mesh failed"));
    await React.act(async () => root.render(<PanelProvider><TraceProvider><SeedExportOutline format="stl" /><TracePage /></TraceProvider></PanelProvider>));
    React.act(() => host.querySelector<HTMLButtonElement>('[data-testid="export-trace"]')!.click());
    React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="checkbox-export-project"]')!.click());
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-export"]')!.click());
    expect(generateSTL).toHaveBeenCalledTimes(1);
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("keeps downloads behind one link above the empty drop zone", async () => {
    await React.act(async () => {
      root.render(<PanelProvider><TraceProvider><TracePage /></TraceProvider></PanelProvider>);
    });
    expect(host.textContent).toContain("Photograph the tool on a calibration sheet or a plain, contrasting background");
    expect(host.textContent).not.toContain("Paper sheets and");
    expect(host.querySelector('[aria-label="Download a measurement aid as 3MF"]')).toBeNull();
    expect(host.textContent).not.toContain("A4 PDF");
    expect([...host.querySelectorAll("button")].filter((button) => button.textContent === "Download printable calibration templates")).toHaveLength(1);
  });

  it("keeps the current photo visible until its replacement is decoded", async () => {
    let resolveReplacement:
      | ((value: {
          imageUrl: string;
          naturalSize: { width: number; height: number };
        }) => void)
      | undefined;
    decodeImageFileMock.mockReturnValue(
      new Promise((resolve) => {
        resolveReplacement = resolve;
      }),
    );

    await React.act(async () => {
      root.render(
        <PanelProvider>
          <TraceProvider>
            <SeedReadySource />
            <SourceStateProbe />
            <TracePage />
          </TraceProvider>
        </PanelProvider>,
      );
      await Promise.resolve();
    });

    const file = new File(["replacement"], "replacement.png", {
      type: "image/png",
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });

    await React.act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(decodeImageFileMock).toHaveBeenCalledWith(file);
    expect(host.querySelector('[data-testid="source-state"]')?.textContent).toBe(
      "data:image/png;base64,original|800x600",
    );

    await React.act(async () => {
      resolveReplacement?.({
        imageUrl: "data:image/png;base64,replacement",
        naturalSize: { width: 1600, height: 1200 },
      });
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="source-state"]')?.textContent).toBe(
      "data:image/png;base64,replacement|800x600",
    );
  });

  it("waits for a detection region instead of tracing immediately on image load", async () => {
    await React.act(async () => {
      root.render(
        <PanelProvider>
          <TraceProvider>
            <WorkflowController />
            <TracePage />
          </TraceProvider>
        </PanelProvider>,
      );
      await Promise.resolve();
    });

    expect(processImageMock).not.toHaveBeenCalled();
    expect(getImageDataMock).not.toHaveBeenCalled();

    await React.act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="set-region"]')?.click();
      await Promise.resolve();
    });
    await React.act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="run-detection"]')
        ?.click();
      await Promise.resolve();
    });

    expect(getImageDataMock).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
    expect(processImageMock).toHaveBeenCalledTimes(1);
  });
});
