// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Outline } from "@shared/geometry/types";

import { TraceProvider, useTrace } from "@/state/trace-store";
import { TooltipProvider } from "@/components/ui/tooltip";

import { TraceCanvas } from "./trace-canvas";

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const detected: Outline = [
  {
    outer: [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 10, y: 90 },
    ],
    holes: [],
  },
];

const edited: Outline = [
  {
    outer: [...detected[0].outer, { x: 50, y: 95 }],
    holes: [],
  },
];

function SeedTrace(): null {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({ type: "SOURCE_LOADED", imageUrl: "data:image/png;base64,AA==", fileName: "tool.png" });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    dispatch({
      type: "DETECTED",
      imageUrl: "data:image/png;base64,AA==",
      outline: detected,
      rawOutline: detected,
      svg: "<svg/>",
      region: null,
    });
    dispatch({
      type: "OUTLINE_COMMITTED",
      outline: edited,
      label: "Add contour node",
    });
    dispatch({
      type: "SET_CALIBRATION",
      calibration: {
        startX: 10,
        startY: 10,
        endX: 90,
        endY: 90,
        lengthMm: 50,
      },
    });
    dispatch({
      type: "SET_REGION",
      region: { x: 5, y: 5, width: 90, height: 90 },
    });
  }, [dispatch]);
  return null;
}

function SeedScaleDraft(): null {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,AA==",
      fileName: "tool.png",
    });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    dispatch({ type: "SET_MODE", mode: "calibrate" });
    dispatch({
      type: "SET_DRAFT_CALIBRATION",
      draftCalibration: { startX: 10, startY: 20 },
    });
  }, [dispatch]);
  return null;
}

function installIdentitySvgCoordinates(): () => void {
  const ctmDescriptor = Object.getOwnPropertyDescriptor(
    SVGElement.prototype,
    "getScreenCTM",
  );
  const pointDescriptor = Object.getOwnPropertyDescriptor(
    SVGSVGElement.prototype,
    "createSVGPoint",
  );

  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ inverse: () => ({}) }),
  });
  Object.defineProperty(SVGSVGElement.prototype, "createSVGPoint", {
    configurable: true,
    value: () => {
      const point = {
        x: 0,
        y: 0,
        matrixTransform: () => ({ x: point.x, y: point.y }),
      };
      return point;
    },
  });

  return () => {
    if (ctmDescriptor) {
      Object.defineProperty(SVGElement.prototype, "getScreenCTM", ctmDescriptor);
    } else {
      delete (SVGElement.prototype as unknown as { getScreenCTM?: unknown })
        .getScreenCTM;
    }
    if (pointDescriptor) {
      Object.defineProperty(
        SVGSVGElement.prototype,
        "createSVGPoint",
        pointDescriptor,
      );
    } else {
      delete (SVGSVGElement.prototype as unknown as { createSVGPoint?: unknown })
        .createSVGPoint;
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("TraceCanvas edit history", () => {
  it("exposes named history beside the undo and redo controls", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await React.act(async () => {
      root.render(
        <TraceProvider>
          <SeedTrace />
          <TooltipProvider>
            <TraceCanvas onReprocess={() => {}} />
          </TooltipProvider>
        </TraceProvider>,
      );
      await Promise.resolve();
    });

    const history = host.querySelector(
      '[data-testid="button-trace-history"]',
    ) as HTMLButtonElement;
    expect(history).not.toBeNull();
    React.act(() => history.click());
    expect(document.body.textContent).toContain("Detected outline");
    expect(document.body.textContent).toContain("Add contour node");
    expect(host.querySelector('[aria-label^="Undo Add contour node"]')).not.toBeNull();

    const fill = host.querySelector('[data-testid="detected-contour-fill"]');
    const halo = host.querySelector('[data-testid="detected-contour-halo"]');
    const stroke = host.querySelector('[data-testid="detected-contour-stroke"]');
    const region = host.querySelector('[data-testid="detection-region-outline"]');
    expect(fill?.getAttribute("class")).toContain("fill-fuchsia-500/10");
    expect(halo?.getAttribute("stroke-width")).toBe("6");
    expect(halo?.getAttribute("class")).toContain("stroke-white/95");
    expect(stroke?.getAttribute("stroke-width")).toBe("2.75");
    expect(stroke?.getAttribute("class")).toContain("stroke-fuchsia-500/95");
    expect(region?.getAttribute("opacity")).toBe("0.4");
    // A completed ruler remains visible and editable after scale mode ends.
    expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(2);
    expect(host.querySelectorAll("[data-ruler-handle]")).toHaveLength(2);
    expect(host.querySelector('[data-testid="ruler-line"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="ruler-length-label"]')?.textContent).toBe(
      "50 mm",
    );

    React.act(() => root.unmount());
  });

  it("extends the draft ruler to follow the pointer after its first marker", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedScaleDraft />
            <TooltipProvider>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const canvas = host.querySelector("svg");
      expect(canvas).not.toBeNull();
      expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(1);

      await React.act(async () => {
        canvas?.dispatchEvent(
          new MouseEvent("pointermove", {
            bubbles: true,
            clientX: 70,
            clientY: 80,
          }),
        );
      });

      const line = host.querySelector('[data-testid="ruler-line"]');
      expect(line?.getAttribute("data-ruler-preview")).toBe("true");
      expect(line?.getAttribute("x2")).toBe("70");
      expect(line?.getAttribute("y2")).toBe("80");
      expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(2);
      expect(host.querySelector('[data-testid="ruler-length-label"]')?.textContent).toBe(
        "100 mm",
      );
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });
});
