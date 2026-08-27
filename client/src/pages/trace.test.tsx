// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelProvider } from "@/components/layout/panel-context";
import { TraceProvider, useTrace } from "@/state/trace-store";

import TracePage from "./trace";

const { getImageDataMock, processImageMock } = vi.hoisted(() => ({
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
  TraceCanvas: ({ onReprocess }: { onReprocess: () => void }) => (
    <button data-testid="run-detection" onClick={onReprocess}>
      Run detection
    </button>
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
    useImageSource: (url: string | null) => (url ? ready : empty),
  };
});

vi.mock("@/lib/image-processor", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/image-processor")>();
  return { ...original, processImage: processImageMock };
});

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
