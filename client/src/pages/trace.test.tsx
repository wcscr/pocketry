// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelProvider } from "@/components/layout/panel-context";
import { TraceProvider, useTrace } from "@/state/trace-store";

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
  TraceControlsPanel: () => <div>Trace controls</div>,
}));

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
    });

    expect(downloadCalibrationTemplateMock).toHaveBeenNthCalledWith(1, "a4");
    expect(downloadCalibrationTemplateMock).toHaveBeenNthCalledWith(2, "letter");
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
