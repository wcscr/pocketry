// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelProvider } from "@/components/layout/panel-context";
import { TraceProvider, useTrace } from "@/state/trace-store";
import { downloadBlob } from "@/lib/download";
import { generateSTL } from "@/lib/export/stl";
import { parseProjectDoc } from "@shared/gridfinity/project";
import type { Outline } from "@shared/geometry/types";

import TracePage from "./trace";

const {
  decodeImageFileMock,
  downloadCalibrationTemplateMock,
  getImageDataMock,
  processImageMock,
} = vi.hoisted(() => ({
    decodeImageFileMock: vi.fn(),
    downloadCalibrationTemplateMock: vi.fn(),
    getImageDataMock: vi.fn(),
    processImageMock: vi.fn(),
  }));

vi.mock("@/components/layout/workspace-layout", () => ({
  WorkspaceLayout: ({
    panel,
    canvas,
  }: {
    panel: React.ReactNode;
    canvas: React.ReactNode;
  }) => (
    <>
      {panel}
      {canvas}
    </>
  ),
}));

vi.mock("@/components/trace/trace-controls-panel", () => ({
  TraceControlsPanel: ({ onExport }: { onExport: () => void }) => <button onClick={onExport} data-testid="export-trace">Export trace</button>,
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
    getDetectionFrame: () => null,
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
    getDetectionFrame: () => null,
  };

  return {
    decodeImageFile: decodeImageFileMock,
    fitWithin: () => ({ width: 800, height: 600 }),
    IMAGE_CANVAS_MAX: { width: 800, height: 600 },
    useImageSource: (url: string | null) => (url ? ready : empty),
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
    vi.mocked(generateSTL).mockResolvedValue(new ArrayBuffer(100));
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

  afterEach(() => {
    React.act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-export"]')!.click());
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toMatch(/\.svg$/);
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

  it("links both calibration-sheet downloads above the empty drop zone", async () => {
    await React.act(async () => {
      root.render(
        <PanelProvider>
          <TraceProvider>
            <TracePage />
          </TraceProvider>
        </PanelProvider>,
      );
    });

    expect(host.textContent).toContain(
      "Photograph the tool on the provided A4 or US Letter template or plain background",
    );
    const emphasizedOr = [...host.querySelectorAll("strong")].find(
      (candidate) => candidate.textContent === "or",
    );
    expect(emphasizedOr?.className).toContain("italic");

    await React.act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="empty-state-template-a4"]')
        ?.click();
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="empty-state-template-letter"]',
        )
        ?.click();
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="empty-state-template-a4-experimental"]',
        )
        ?.click();
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="empty-state-template-letter-experimental"]',
        )
        ?.click();
    });

    expect(downloadCalibrationTemplateMock).toHaveBeenNthCalledWith(1, "a4");
    expect(downloadCalibrationTemplateMock).toHaveBeenNthCalledWith(2, "letter");
    expect(downloadCalibrationTemplateMock).toHaveBeenNthCalledWith(
      3,
      "a4-experimental",
    );
    expect(downloadCalibrationTemplateMock).toHaveBeenNthCalledWith(
      4,
      "letter-experimental",
    );
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
