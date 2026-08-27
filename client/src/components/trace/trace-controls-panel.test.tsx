// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Calibration } from "@shared/geometry/scale";

import { TooltipProvider } from "@/components/ui/tooltip";
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
          dispatch({ type: "AUTO_CALIBRATION_DETECTED", calibration: CALIBRATION })
        }
      >
        Detect auto scale
      </button>
      <button
        data-testid="detect-auto-perspective"
        onClick={() =>
          dispatch({
            type: "AUTO_CALIBRATION_DETECTED",
            calibration: CALIBRATION,
            perspective: {
              source: "template",
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
        onClick={() => dispatch({ type: "SET_CALIBRATION", calibration: CALIBRATION })}
      >
        Complete manual scale
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

function section(id: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`#trace-settings-${id}`);
}

function sectionTrigger(id: string): HTMLButtonElement | null {
  return (
    section(id)?.querySelector<HTMLButtonElement>("[data-panel-section-trigger]") ??
    null
  );
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
      "trace-settings-contours",
      "trace-settings-output",
    ]);

    for (const id of ["source", "detect", "contours", "crop", "output"]) {
      expect(section(id)?.dataset.state).toBe("closed");
    }
    expect(section("scale")?.dataset.state).toBe("open");
    expect(section("source")?.textContent).toContain("new-source");
    expect(sectionTrigger("scale")?.disabled).toBe(false);
    for (const id of ["crop", "detect", "contours", "output"]) {
      expect(sectionTrigger(id)?.disabled).toBe(true);
    }
    expect(document.activeElement).toBe(sectionTrigger("scale"));
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="button-set-scale"]')
        ?.className,
    ).toContain("animate-pulse");

    expect(host.textContent).toContain("Calibration sheet options");
    expect(host.textContent).not.toContain("Print the sheet once");

    await click("button-calibration-sheet-options");
    expect(document.body.textContent).toContain("Print the sheet once");
    expect(
      document.body.querySelector('[data-testid="button-template-letter"]'),
    ).not.toBeNull();
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
    expect(automaticCorrection?.disabled).toBe(true);
    expect(section("scale")?.textContent).toContain("Choose A4 or US Letter");

    await click("button-calibration-sheet-options");
    await React.act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[data-testid="button-template-letter"]')!
        .click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });

    expect(automaticCorrection?.disabled).toBe(false);
    await click("button-apply-auto-perspective");
    expect(applyPerspective).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "template" }),
      "letter",
    );

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
      "Detection starts when you finish",
    );
  });

  it("updates the displayed manual scale when the reference length changes", async () => {
    await click("load-source");
    await click("complete-manual-scale");

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
