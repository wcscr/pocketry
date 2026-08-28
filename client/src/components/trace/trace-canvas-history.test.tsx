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

function ScaleStateProbe(): JSX.Element {
  const { mode, calibration, draftCalibration } = useTrace();
  return (
    <>
      <output data-testid="scale-mode">{mode}</output>
      <output data-testid="scale-committed">
        {calibration ? "committed" : "pending"}
      </output>
      <output data-testid="scale-draft">{JSON.stringify(draftCalibration)}</output>
    </>
  );
}

function SeedPerspectiveSelection(): null {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,AA==",
      fileName: "tool.png",
    });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    dispatch({ type: "START_PERSPECTIVE_SELECTION" });
  }, [dispatch]);
  return null;
}

function SeedAutoScale(): JSX.Element {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,AA==",
      fileName: "tool.png",
    });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    dispatch({
      type: "AUTO_CALIBRATION_DETECTED",
      sourceImageUrl: "data:image/png;base64,AA==",
      calibration: {
        startX: 10,
        startY: 10,
        endX: 90,
        endY: 90,
        lengthMm: 250,
      },
    });
  }, [dispatch]);
  return (
    <button type="button" onClick={() => dispatch({ type: "ACCEPT_AUTO_CALIBRATION" })}>
      Accept auto scale
    </button>
  );
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
    expect(
      host.querySelector('[data-testid="ruler-length-label"]')?.textContent,
    ).toContain("50 mm");

    await React.act(async () => {
      host
        .querySelector<SVGGElement>('[data-testid="ruler-length-label"]')
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await Promise.resolve();
    });
    const inlineLength = host.querySelector<HTMLInputElement>(
      '[data-testid="ruler-length-inline-input"]',
    );
    expect(inlineLength).not.toBeNull();
    expect(document.activeElement).toBe(inlineLength);

    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(inlineLength, "75");
      inlineLength?.dispatchEvent(new Event("input", { bubbles: true }));
      inlineLength?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(
      host.querySelector('[data-testid="ruler-length-inline-input"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="ruler-length-label"]')?.textContent,
    ).toContain("75 mm");

    React.act(() => root.unmount());
  });

  it("hides an accepted sheet ruler before region selection", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await React.act(async () => {
      root.render(
        <TraceProvider>
          <SeedAutoScale />
          <TooltipProvider>
            <TraceCanvas onReprocess={() => {}} />
          </TooltipProvider>
        </TraceProvider>,
      );
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="ruler-line"]')).not.toBeNull();
    React.act(() =>
      host
        .querySelector<HTMLButtonElement>("button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(host.querySelector('[data-testid="ruler-line"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(0);

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
            <ScaleStateProbe />
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
      expect(host.querySelector('[data-testid="scale-mode"]')?.textContent).toBe(
        "calibrate",
      );
      expect(host.querySelector('[data-testid="scale-draft"]')?.textContent).toBe(
        JSON.stringify({ startX: 10, startY: 20 }),
      );
      expect(
        host.querySelector('[data-testid="scale-committed"]')?.textContent,
      ).toBe("pending");

      await React.act(async () => {
        canvas?.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 70,
            clientY: 80,
          }),
        );
      });

      expect(host.querySelector('[data-testid="scale-mode"]')?.textContent).toBe(
        "pan",
      );
      expect(
        host.querySelector('[data-testid="scale-committed"]')?.textContent,
      ).toBe("pending");
      expect(host.querySelector('[data-testid="scale-draft"]')?.textContent).toBe(
        JSON.stringify({ startX: 10, startY: 20, endX: 70, endY: 80 }),
      );
      expect(
        host.querySelector('[data-testid="ruler-line"]')?.getAttribute(
          "data-ruler-preview",
        ),
      ).toBe("true");
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });

  it("places four manual perspective corners and closes the correction quad", async () => {
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
            <SeedPerspectiveSelection />
            <TooltipProvider>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const canvas = host.querySelector("svg");
      expect(canvas).not.toBeNull();
      const points = [
        [10, 10],
        [90, 12],
        [88, 90],
        [12, 88],
      ];
      for (const [clientX, clientY] of points) {
        await React.act(async () => {
          canvas?.dispatchEvent(
            new MouseEvent("pointerdown", {
              bubbles: true,
              button: 0,
              clientX,
              clientY,
            }),
          );
        });
      }

      expect(host.querySelectorAll('[data-testid="perspective-marker"]')).toHaveLength(
        4,
      );
      expect(host.querySelectorAll("[data-perspective-handle]")).toHaveLength(4);
      expect(
        host.querySelector('[data-testid="perspective-outline"]')?.getAttribute("d"),
      ).toContain("Z");
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });
});
