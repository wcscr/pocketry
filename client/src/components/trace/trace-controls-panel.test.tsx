// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Calibration } from "@shared/geometry/scale";

import { TooltipProvider } from "@/components/ui/tooltip";
import { downloadBlob } from "@/lib/download";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { TraceProvider, useTrace } from "@/state/trace-store";

import { TraceControlsPanel } from "./trace-controls-panel";

vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));

const CALIBRATION: Calibration = {
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 0,
  lengthMm: 50,
};

const applyPerspective = vi.fn();
const rotateImage = vi.fn();

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Harness(): JSX.Element {
  const { dispatch } = useTrace();
  return (
    <>
      <button
        data-testid="load-source"
        onClick={() => {
          dispatch({
            type: "SOURCE_LOADED",
            imageUrl: "data:image/png;base64,new-source",
            fileName: "new-source",
          });
          dispatch({
            type: "SOURCE_READY",
            imageSize: { width: 800, height: 600 },
          });
        }}
      >
        Load source
      </button>
      <button
        data-testid="detect-auto-scale"
        onClick={() =>
          dispatch({
            type: "AUTO_CALIBRATION_DETECTED",
            sourceImageUrl: "data:image/png;base64,new-source",
            calibration: CALIBRATION,
          })
        }
      >
        Detect auto scale
      </button>
      <button
        data-testid="detect-auto-perspective"
        onClick={() =>
          dispatch({
            type: "AUTO_CALIBRATION_DETECTED",
            sourceImageUrl: "data:image/png;base64,new-source",
            calibration: CALIBRATION,
            perspective: {
              source: "template",
              paper: "letter",
              points: [
                { x: 10, y: 10 },
                { x: 110, y: 12 },
                { x: 108, y: 140 },
                { x: 12, y: 138 },
              ],
            },
          })
        }
      >
        Detect auto perspective
      </button>
      <button
        data-testid="complete-perspective-points"
        onClick={() => {
          for (const point of [
            { x: 10, y: 10 },
            { x: 790, y: 12 },
            { x: 788, y: 590 },
            { x: 12, y: 588 },
          ]) {
            dispatch({ type: "ADD_PERSPECTIVE_POINT", point });
          }
        }}
      >
        Complete perspective points
      </button>
      <button
        data-testid="complete-manual-scale"
        onClick={() => {
          dispatch({ type: "SET_MODE", mode: "calibrate" });
          dispatch({
            type: "SET_DRAFT_CALIBRATION",
            draftCalibration: {
              startX: CALIBRATION.startX,
              startY: CALIBRATION.startY,
              endX: CALIBRATION.endX,
              endY: CALIBRATION.endY,
            },
          });
          dispatch({ type: "SET_MODE", mode: "pan" });
        }}
      >
        Place manual ruler
      </button>
      <button
        data-testid="commit-region"
        onClick={() => {
          dispatch({
            type: "SET_REGION",
            region: { x: 10, y: 20, width: 300, height: 200 },
          });
          dispatch({ type: "REGION_COMMITTED" });
        }}
      >
        Commit region
      </button>
      <TraceControlsPanel
        onReplaceImage={() => {}}
        onRotateImage={rotateImage}
        onExport={() => {}}
        onReprocess={() => {}}
        onDetectMarkers={() => {}}
        onApplyPerspective={applyPerspective}
      />
    </>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  applyPerspective.mockReset();
  rotateImage.mockReset();
  vi.mocked(downloadBlob).mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(
    (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
    (handle: number) => window.clearTimeout(handle),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  React.act(() => {
    root.render(
      <TooltipProvider>
        <ShapeLibraryProvider>
          <TraceProvider>
            <Harness />
          </TraceProvider>
        </ShapeLibraryProvider>
      </TooltipProvider>,
    );
  });
});

afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function click(testId: string): Promise<void> {
  await React.act(async () => {
    host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  });
}

async function changeNumber(id: string, value: string): Promise<void> {
  await React.act(async () => {
    const input = host.querySelector<HTMLInputElement>(`#${id}`);
    expect(input).not.toBeNull();
    input!.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  });
}

async function blurNumber(id: string): Promise<void> {
  await React.act(async () => {
    host.querySelector<HTMLInputElement>(`#${id}`)?.blur();
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  });
}

function section(id: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`#trace-settings-${id}`);
}

function sectionTrigger(id: string): HTMLButtonElement | null {
  return (
    section(id)?.querySelector<HTMLButtonElement>("[data-panel-section-trigger]") ??
    null
  );
}

async function clickSection(id: string): Promise<void> {
  await React.act(async () => {
    sectionTrigger(id)?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  });
}

describe("TraceControlsPanel guided workflow", () => {
  it("collapses every section, opens Scale, and pulses its action after source load", async () => {
    expect(host.textContent).toContain("Choose or drop an image");
    expect(host.querySelector('[data-testid="button-source-image"]')).toBeNull();
    expect(sectionTrigger("scale")?.disabled).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>(
        '[data-testid="trace-settings-jump-scale"]',
      )?.disabled,
    ).toBe(true);
    await click("load-source");

    expect(
      Array.from(
        host.querySelectorAll<HTMLElement>('[id^="trace-settings-"]'),
        (element) => element.id,
      ),
    ).toEqual([
      "trace-settings-source",
      "trace-settings-scale",
      "trace-settings-crop",
      "trace-settings-detect",
      "trace-settings-output",
    ]);

    for (const id of ["source", "detect", "crop", "output"]) {
      expect(section(id)?.dataset.state).toBe("closed");
    }
    expect(section("scale")?.dataset.state).toBe("open");
    expect(section("source")?.textContent).toContain("new-source");
    expect(sectionTrigger("scale")?.disabled).toBe(false);
    for (const id of ["crop", "detect", "output"]) {
      expect(sectionTrigger(id)?.disabled).toBe(true);
    }
    expect(document.activeElement).toBe(sectionTrigger("scale"));
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="button-set-scale"]')
        ?.className,
    ).toContain("animate-pulse");

    await click("button-set-scale");
    expect(
      host.querySelector('[data-testid="button-set-scale"]')?.textContent,
    ).toBe("Placing ruler");
    expect(
      host.querySelector('[data-testid="manual-scale-guidance"]')?.textContent,
    ).toContain("Auto Calibration Unsuccessful:");
    expect(
      host.querySelector('[data-testid="manual-scale-guidance"]')?.textContent,
    ).toContain("Select two points on the image that are a known distance apart");
    expect(
      host.querySelector('[data-testid="manual-scale-guidance"]')?.textContent,
    ).toContain("Zoom in first for more precise placement");

    expect(host.textContent).toContain("Calibration sheet options");
    expect(host.textContent).not.toContain("Print the current v2 sheet once");

    await click("button-calibration-sheet-options");
    expect(document.body.textContent).toContain("Print the current v2 sheet once");
    expect(
      document.body.querySelector('[data-testid="button-template-letter"]'),
    ).not.toBeNull();
  });

  it("offers clockwise and counterclockwise rotation for a loaded source", async () => {
    await click("load-source");
    await clickSection("source");

    expect(section("source")?.textContent).toContain("Rotate left 90°");
    expect(section("source")?.textContent).toContain("Rotate right 90°");
    await click("button-rotate-image-counterclockwise");
    await click("button-rotate-image-clockwise");
    expect(rotateImage).toHaveBeenNthCalledWith(1, "counterclockwise");
    expect(rotateImage).toHaveBeenNthCalledWith(2, "clockwise");
  });

  it("makes an auto-detected sheet scale explicit and waits for acceptance", async () => {
    await click("load-source");
    await click("detect-auto-scale");

    expect(section("scale")?.dataset.state).toBe("open");
    expect(host.textContent).toContain("Scale detected from the sheet");
    expect(host.textContent).toContain("0.500 mm/px");
    const accept = host.querySelector<HTMLButtonElement>(
      '[data-testid="button-accept-auto-scale"]',
    );
    expect(document.activeElement).toBe(accept);

    await click("button-accept-auto-scale");

    expect(section("scale")?.dataset.state).toBe("closed");
    expect(section("crop")?.dataset.state).toBe("open");
    expect(
      host
        .querySelector<HTMLButtonElement>('[data-testid="button-set-region"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    const regionTrigger = sectionTrigger("crop");
    expect(document.activeElement).toBe(regionTrigger);
    expect(regionTrigger?.className).toContain(
      "animate-[pulse_1s_ease-in-out_3]",
    );
  });

  it("offers automatic and manual perspective correction paths", async () => {
    await click("load-source");
    await click("detect-auto-perspective");

    const automaticCorrection = host.querySelector<HTMLButtonElement>(
      '[data-testid="button-apply-auto-perspective"]',
    );
    expect(automaticCorrection).not.toBeNull();
    expect(automaticCorrection?.disabled).toBe(false);
    expect(automaticCorrection?.className).toContain("whitespace-normal");
    expect(automaticCorrection?.className).toContain("min-h-9");
    expect(automaticCorrection?.className).toContain(
      "text-[clamp(0.75rem,4cqw,0.875rem)]",
    );
    expect(
      host.querySelector('[data-testid="trace-settings-index"]')?.parentElement
        ?.className,
    ).toContain("[container-type:inline-size]");
    expect(section("scale")?.textContent).toContain(
      "US Letter template detected automatically",
    );
    await click("button-apply-auto-perspective");
    expect(applyPerspective).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "template" }),
      "letter",
    );

    await click("link-print-template-letter");
    expect(downloadBlob).toHaveBeenLastCalledWith(
      expect.any(Blob),
      "pocketry-calibration-v2-letter.pdf",
    );
    const downloadedPdf = vi.mocked(downloadBlob).mock.calls.at(-1)![0];
    expect(downloadedPdf.type).toBe("application/pdf");
    expect(
      new TextDecoder().decode(await downloadedPdf.arrayBuffer()).startsWith("%PDF-1.4"),
    ).toBe(true);
    await click("button-select-perspective-points");
    expect(host.textContent).toContain("corner 1 of 4");
    await click("complete-perspective-points");
    expect(host.textContent).toContain("Four corners selected");
    await click("button-apply-manual-perspective");
    expect(applyPerspective).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "manual" }),
      "letter",
    );
  });

  it("guides manual scale through region selection into Tool Detection", async () => {
    await click("load-source");
    await click("complete-manual-scale");

    expect(section("scale")?.dataset.state).toBe("open");
    expect(section("crop")?.dataset.state).toBe("closed");
    expect(sectionTrigger("crop")?.disabled).toBe(true);
    expect(document.activeElement).toBe(
      host.querySelector<HTMLInputElement>("#ruler-length"),
    );
    expect(
      host.querySelector('[data-testid="reference-length-setting"]')?.className,
    ).toContain("ring-2");
    expect(section("scale")?.textContent).toContain(
      "Ruler placed. Enter its real length",
    );

    await changeNumber("ruler-length", "50");
    expect(section("scale")?.dataset.state).toBe("open");
    expect(sectionTrigger("crop")?.disabled).toBe(true);

    await blurNumber("ruler-length");
    expect(section("scale")?.dataset.state).toBe("closed");
    expect(section("crop")?.dataset.state).toBe("open");
    expect(section("detect")?.dataset.state).toBe("closed");
    expect(sectionTrigger("crop")?.disabled).toBe(false);
    expect(sectionTrigger("detect")?.disabled).toBe(true);
    expect(document.activeElement).toBe(sectionTrigger("crop"));

    const setRegion = host.querySelector<HTMLButtonElement>(
      '[data-testid="button-set-region"]',
    );
    const emptyClearRegion = host.querySelector<HTMLButtonElement>(
      '[data-testid="button-clear-region"]',
    );
    expect(setRegion?.textContent).toContain("Set Region");
    expect(setRegion?.getAttribute("aria-pressed")).toBe("true");
    expect(
      host.querySelector('[data-testid="detection-region-guidance"]')
        ?.textContent,
    ).toContain("Click and drag on the image");
    expect(
      host.querySelector('[data-testid="detection-region-guidance"]')
        ?.textContent,
    ).toContain("entire tool");
    expect(emptyClearRegion?.textContent).toContain("Clear Region");
    expect(emptyClearRegion?.disabled).toBe(true);
    expect(emptyClearRegion?.parentElement?.className).toContain("grid-cols-2");
    await click("button-set-region");
    expect(setRegion?.getAttribute("aria-pressed")).toBe("true");
    await click("commit-region");

    expect(section("crop")?.dataset.state).toBe("closed");
    expect(section("detect")?.dataset.state).toBe("open");
    expect(document.activeElement).toBe(sectionTrigger("detect"));
    expect(sectionTrigger("detect")?.className).toContain(
      "animate-[pulse_1s_ease-in-out_3]",
    );
    expect(
      host.querySelector('[data-testid="detection-tuning-guidance"]')
        ?.textContent,
    ).toContain("Adjust Sensitivity and Detail to fine-tune the contour");
    expect(
      host.querySelector('[data-testid="contour-editing-guidance"]')
        ?.textContent,
    ).toContain(
      "Edit the contour shape: select a shape, then move, add, or delete its detected vertices",
    );
    expect(
      host.querySelector('[data-testid="contour-editing-guidance"]')
        ?.className,
    ).toContain("text-base font-bold");
    expect(
      host.querySelector('[data-testid="detection-tuning-guidance"]')
        ?.textContent,
    ).toContain(
      "Drag a vertex to move it, click to add one, or right-click a vertex to delete it",
    );
    expect(
      host.querySelector('[data-testid="detection-tuning-guidance"]')
        ?.textContent,
    ).toContain(
      "Remove any arrant holes / contours by clicking the trash can icon below",
    );
    expect(
      host.querySelector('[data-testid="detection-tuning-guidance"]')
        ?.className,
    ).toContain("border-rose-500/60");
    expect(
      section("detect")?.querySelector("[data-testid='detection-contours']"),
    ).not.toBeNull();
    expect(section("contours")).toBeNull();
    expect(
      section("detect")?.querySelector<HTMLButtonElement>("#margin")?.textContent,
    ).toContain("1.5 mm");
    expect(section("detect")?.textContent).not.toContain(
      "Bin clearance is added on top",
    );

    await React.act(async () => {
      sectionTrigger("crop")?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    const clearRegion = host.querySelector<HTMLButtonElement>(
      '[data-testid="button-clear-region"]',
    );
    expect(clearRegion?.textContent).toContain("Clear Region");
    expect(clearRegion?.disabled).toBe(false);
    expect(clearRegion?.parentElement?.className).toContain("grid-cols-2");

    await click("button-clear-region");
    expect(section("crop")?.dataset.state).toBe("open");
    expect(sectionTrigger("detect")?.disabled).toBe(true);
    expect(host.textContent).toContain(
      "Click and drag on the image",
    );
  });

  it("keeps Scale active when Redraw ruler is clicked from the length field", async () => {
    await click("load-source");
    await click("complete-manual-scale");
    await changeNumber("ruler-length", "50");

    const input = host.querySelector<HTMLInputElement>("#ruler-length");
    const redraw = host.querySelector<HTMLButtonElement>(
      '[data-testid="button-set-scale"]',
    );
    expect(document.activeElement).toBe(input);
    expect(redraw?.textContent).toBe("Redraw ruler");

    // A real pointer click transfers focus before `click`, so the input's blur
    // fires first. The redraw intent must suppress that stale scale commit or
    // the guided workflow advances and remounts the button mid-interaction.
    await React.act(async () => {
      const pointerDown = new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
      });
      redraw?.dispatchEvent(pointerDown);
      input?.blur();
      await Promise.resolve();
    });
    await React.act(async () => {
      redraw?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      redraw?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });

    expect(section("scale")?.dataset.state).toBe("open");
    expect(section("crop")?.dataset.state).toBe("closed");
    expect(sectionTrigger("crop")?.disabled).toBe(true);
    expect(
      host.querySelector('[data-testid="button-set-scale"]')?.textContent,
    ).toBe("Placing ruler");
    expect(
      host.querySelector('[data-testid="manual-scale-guidance"]'),
    ).not.toBeNull();
  });

  it("updates the displayed manual scale when the reference length changes", async () => {
    await click("load-source");
    await click("complete-manual-scale");
    await changeNumber("ruler-length", "50");
    await blurNumber("ruler-length");

    expect(section("scale")?.textContent).toContain("0.500 mm/px");
    await React.act(async () => {
      sectionTrigger("scale")?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    await changeNumber("ruler-length", "200");
    expect(section("scale")?.textContent).toContain("2.000 mm/px");
    expect(section("scale")?.textContent).toContain("2 mm/px (0.5 px/mm)");
  });
});
