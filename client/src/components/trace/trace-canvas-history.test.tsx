// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Outline } from "@shared/geometry/types";
import { mmPerPixel } from "@shared/geometry/scale";

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

function SeedMeasurementScale(): null {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,AA==",
      fileName: "tool.png",
    });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    dispatch({
      type: "SET_CALIBRATION",
      calibration: {
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 0,
        lengthMm: 50,
      },
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
      <output data-testid="scale-calibration">
        {calibration ? JSON.stringify(calibration) : "none"}
      </output>
      <output data-testid="scale-mm-per-pixel">
        {mmPerPixel(calibration)?.toFixed(6) ?? "none"}
      </output>
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

function SeedAutoScale({ existingManualScale = false }: { existingManualScale?: boolean }): JSX.Element {
  const { dispatch } = useTrace();
  React.useEffect(() => {
    dispatch({
      type: "SOURCE_LOADED",
      imageUrl: "data:image/png;base64,AA==",
      fileName: "tool.png",
    });
    dispatch({ type: "SOURCE_READY", imageSize: { width: 100, height: 100 } });
    if (existingManualScale) dispatch({
      type: "SET_CALIBRATION",
      calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 },
    });
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
  }, [dispatch, existingManualScale]);
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
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({}) }),
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
  it("leaves undo and zoom to dialogs, focused controls, and earlier handlers", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await React.act(async () => {
        root.render(<TraceProvider><SeedTrace /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>);
      });
      const outlinePath = () => host.querySelector('[data-testid="detected-contour-stroke"]')?.getAttribute("d");
      const editedPath = outlinePath();
      expect(editedPath).toBeTruthy();
      const key = (target: EventTarget, value: string, ctrlKey = false, handled = false) => {
        const event = new KeyboardEvent("keydown", { key: value, ctrlKey, bubbles: true, cancelable: true });
        if (handled) event.preventDefault();
        React.act(() => target.dispatchEvent(event));
        return event;
      };
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      document.body.appendChild(dialog);
      expect(key(window, "z", true).defaultPrevented).toBe(false);
      expect(key(window, "+").defaultPrevented).toBe(false);
      expect(outlinePath()).toBe(editedPath);
      dialog.remove();

      const button = host.querySelector('[aria-label="Set scale"]')!;
      expect(key(button, "z", true).defaultPrevented).toBe(false);
      expect(key(button, "1").defaultPrevented).toBe(false);
      key(window, "z", true, true);
      expect(outlinePath()).toBe(editedPath);

      expect(key(window, "z", true).defaultPrevented).toBe(true);
      expect(outlinePath()).not.toBe(editedPath);
      expect(key(window, "+").defaultPrevented).toBe(true);
    } finally { React.act(() => root.unmount()); }
  });

  it("opens canvas toolbar tips below the toolbar", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedTrace />
            <TooltipProvider delayDuration={0}>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const setScale = host.querySelector<HTMLButtonElement>(
        '[aria-label="Set scale"]',
      );
      await React.act(async () => {
        const hover = new MouseEvent("pointermove", { bubbles: true });
        Object.defineProperty(hover, "pointerType", { value: "mouse" });
        setScale?.dispatchEvent(hover);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(host.innerHTML).toContain('data-side="bottom"');
      expect(host.innerHTML).toContain("Set scale");
    } finally {
      React.act(() => root.unmount());
    }
  });

  it("exposes named history beside the undo and redo controls", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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
    const inlineLength = document.querySelector<HTMLInputElement>(
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
      await Promise.resolve();
    });
    await React.act(async () => {
      inlineLength?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(
      document.querySelector('[data-testid="ruler-length-inline-input"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-testid="ruler-length-label"]')?.textContent,
    ).toContain("75 mm");

    React.act(() => root.unmount());
  });

  it("hides an accepted sheet ruler before region selection", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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

  it("keeps detected reference previews read-only when a manual scale remains accepted", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await React.act(async () => root.render(
        <TraceProvider><SeedAutoScale existingManualScale /><ScaleStateProbe />
          <TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider>
        </TraceProvider>,
      ));
      expect(host.querySelector('[data-testid="scale-mm-per-pixel"]')?.textContent).toBe("0.500000");
      expect(host.querySelector('[data-testid="ruler-length-label"]')?.textContent).toContain("250 mm");
      expect(host.querySelectorAll("[data-ruler-handle]")).toHaveLength(0);
      React.act(() => host.querySelector('[data-testid="ruler-length-label"]')?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }),
      ));
      expect(document.querySelector('[data-testid="ruler-length-inline-input"]')).toBeNull();
      expect(host.querySelector('[data-testid="scale-mm-per-pixel"]')?.textContent).toBe("0.500000");
    } finally { React.act(() => root.unmount()); }
  });

  it("replaces completed ruler points instead of restoring the old ruler", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedTrace />
            <ScaleStateProbe />
            <TooltipProvider>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const canvas = host.querySelector("svg");
      const setScale = host.querySelector<HTMLButtonElement>(
        '[aria-label="Set scale"]',
      );
      expect(canvas).not.toBeNull();
      expect(setScale).not.toBeNull();
      expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(2);

      await React.act(async () => {
        setScale?.click();
      });
      expect(host.querySelector('[data-testid="scale-mode"]')?.textContent).toBe(
        "calibrate",
      );
      expect(host.querySelectorAll('[data-testid="ruler-marker"]')).toHaveLength(0);

      for (const [clientX, clientY] of [
        [20, 30],
        [75, 85],
      ]) {
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

      expect(host.querySelector('[data-testid="scale-mode"]')?.textContent).toBe(
        "pan",
      );
      expect(
        host.querySelector('[data-testid="scale-committed"]')?.textContent,
      ).toBe("pending");
      expect(host.querySelector('[data-testid="scale-draft"]')?.textContent).toBe(
        JSON.stringify({ startX: 20, startY: 30, endX: 75, endY: 85 }),
      );
      const line = host.querySelector('[data-testid="ruler-line"]');
      expect(line?.getAttribute("x1")).toBe("20");
      expect(line?.getAttribute("y1")).toBe("30");
      expect(line?.getAttribute("x2")).toBe("75");
      expect(line?.getAttribute("y2")).toBe("85");
      expect(line?.getAttribute("data-ruler-preview")).toBe("true");
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });

  it("measures between two points without changing the accepted scale", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedMeasurementScale />
            <ScaleStateProbe />
            <TooltipProvider>
              <TraceCanvas onReprocess={() => {}} />
            </TooltipProvider>
          </TraceProvider>,
        );
        await Promise.resolve();
      });

      const canvas = host.querySelector("svg");
      const measure = host.querySelector<HTMLButtonElement>(
        '[aria-label="Measure distance"]',
      );
      expect(canvas).not.toBeNull();
      expect(measure?.disabled).toBe(false);

      await React.act(async () => measure?.click());
      expect(host.querySelector('[data-testid="scale-mode"]')?.textContent).toBe(
        "measure",
      );
      expect(host.querySelector('[data-testid="ruler-overlay"]')).toBeNull();

      await React.act(async () => {
        canvas?.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 20,
            clientY: 30,
          }),
        );
      });
      await React.act(async () => {
        canvas?.dispatchEvent(
          new MouseEvent("pointermove", {
            bubbles: true,
            clientX: 60,
            clientY: 30,
          }),
        );
      });

      expect(
        host.querySelectorAll('[data-testid="measurement-marker"]'),
      ).toHaveLength(2);
      expect(
        host
          .querySelector('[data-testid="measurement-line"]')
          ?.getAttribute("data-measurement-preview"),
      ).toBe("true");
      expect(
        host.querySelector('[data-testid="measurement-length-label"]')
          ?.textContent,
      ).toContain("20 mm");

      await React.act(async () => {
        canvas?.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 60,
            clientY: 30,
          }),
        );
      });
      expect(
        host
          .querySelector('[data-testid="measurement-line"]')
          ?.getAttribute("data-measurement-preview"),
      ).toBeNull();
      expect(
        host.querySelector('[data-testid="scale-calibration"]')?.textContent,
      ).toBe(
        JSON.stringify({
          startX: 0,
          startY: 0,
          endX: 100,
          endY: 0,
          lengthMm: 50,
        }),
      );

      await React.act(async () => {
        host.querySelector<HTMLButtonElement>('[aria-label="Select"]')?.click();
      });
      expect(
        host.querySelector('[data-testid="measurement-overlay"]'),
      ).toBeNull();
      expect(
        host.querySelector('[data-testid="ruler-overlay"]'),
      ).not.toBeNull();
      expect(
        host.querySelector('[data-testid="scale-mm-per-pixel"]')?.textContent,
      ).toBe("0.500000");
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });

  it("extends the draft ruler to follow the pointer after its first marker", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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
      expect(host.querySelector('[data-testid="ruler-length-label"]')).toBeNull();
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
      expect(
        host.querySelector('[data-testid="ruler-length-label"]')?.textContent,
      ).toContain("100 mm");
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });

  it("drags either completed ruler endpoint and recalculates the scale", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceProvider>
            <SeedTrace />
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
      Object.defineProperties(canvas!, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        hasPointerCapture: { configurable: true, value: () => false },
        releasePointerCapture: { configurable: true, value: vi.fn() },
      });

      const startHandle = host.querySelector(
        '[data-ruler-handle="start"] [data-testid="ruler-handle-hit-area"]',
      );
      expect(startHandle).not.toBeNull();
      expect(host.querySelector('[data-testid="scale-mm-per-pixel"]')?.textContent).toBe(
        "0.441942",
      );

      await React.act(async () => {
        startHandle?.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 10,
            clientY: 10,
          }),
        );
        canvas?.dispatchEvent(
          new MouseEvent("pointermove", {
            bubbles: true,
            button: 0,
            clientX: 25,
            clientY: 30,
          }),
        );
        canvas?.dispatchEvent(
          new MouseEvent("pointerup", {
            bubbles: true,
            button: 0,
            clientX: 25,
            clientY: 30,
          }),
        );
      });

      expect(host.querySelector('[data-testid="scale-calibration"]')?.textContent).toBe(
        JSON.stringify({
          startX: 25,
          startY: 30,
          endX: 90,
          endY: 90,
          lengthMm: 50,
        }),
      );
      expect(host.querySelector('[data-testid="scale-mm-per-pixel"]')?.textContent).toBe(
        "0.565233",
      );
      expect(host.querySelector('[data-testid="ruler-line"]')?.getAttribute("x1")).toBe(
        "25",
      );
      expect(host.querySelector('[data-testid="ruler-line"]')?.getAttribute("y1")).toBe(
        "30",
      );

      const endHandle = host.querySelector(
        '[data-ruler-handle="end"] [data-testid="ruler-handle-hit-area"]',
      );
      await React.act(async () => {
        endHandle?.dispatchEvent(
          new MouseEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 90,
            clientY: 90,
          }),
        );
        canvas?.dispatchEvent(
          new MouseEvent("pointermove", {
            bubbles: true,
            button: 0,
            clientX: 130,
            clientY: -20,
          }),
        );
        canvas?.dispatchEvent(
          new MouseEvent("pointerup", {
            bubbles: true,
            button: 0,
            clientX: 130,
            clientY: -20,
          }),
        );
      });

      expect(host.querySelector('[data-testid="scale-calibration"]')?.textContent).toBe(
        JSON.stringify({
          startX: 25,
          startY: 30,
          endX: 99,
          endY: 0,
          lengthMm: 50,
        }),
      );
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });

  it("places four manual perspective corners and closes the correction quad", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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

describe("touch-accessible trace tools", () => {
  it("uses mobile point tools, shows a magnifier, and gives pinch priority over a point drag", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    let trace: ReturnType<typeof useTrace>;
    function Probe(): null { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      const svg = host.querySelector("svg")!;
      const pointer = (type: string, x: number, y: number, id = 1) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperties(event, { pointerType: { value: "touch" }, pointerId: { value: id } });
        svg.dispatchEvent(event);
      });
      React.act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit contours"]')!.click());
      const historyIndex = trace!.history.index;
      pointer("pointerdown", 10, 10); pointer("pointermove", 25, 25);
      expect(trace!.outline[0].outer[0]).toEqual({ x: 25, y: 25 });
      const magnifier = host.querySelector('[data-testid="contour-magnifier"]')!;
      expect(magnifier.querySelector('use')!.getAttribute('href')).toBe(`#${svg.querySelector('g')!.id}`);
      pointer("pointerdown", 90, 90, 2);
      expect(trace!.outline).toEqual(edited);
      expect(host.querySelector('[data-testid="contour-magnifier"]')).toBeNull();
      pointer("pointermove", 110, 110, 2); pointer("pointerup", 110, 110, 2); pointer("pointerup", 25, 25);
      expect(trace!.history.index).toBe(historyIndex);
      pointer("pointerdown", 10, 10); pointer("pointermove", 20, 20); pointer("pointerup", 20, 20);
      expect(trace!.history.index).toBe(historyIndex + 1);
      React.act(() => trace!.undo()); expect(trace!.outline).toEqual(edited);
      pointer("pointerdown", 50, 10); pointer("pointerup", 50, 10);
      expect(trace!.outline[0].outer).toHaveLength(6);
      pointer("pointerdown", 50, 10);
      expect(trace!.outline[0].outer).toHaveLength(6);
      pointer("pointerup", 50, 10);
      expect(trace!.outline[0].outer).toHaveLength(6);
      expect(host.querySelectorAll('[data-point-selected="true"]')).toHaveLength(1);
      React.act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Delete point")!.click());
      expect(trace!.outline[0].outer).toHaveLength(5);
      React.act(() => trace!.dispatch({ type: "SET_MODE", mode: "pan" }));
      expect(host.querySelector('[aria-label="Contour editing tools"]')).toBeNull();
      pointer("pointerdown", 10, 10); pointer("pointermove", 35, 35); pointer("pointerup", 35, 35);
      expect(trace!.outline).toEqual(edited);
    } finally { React.act(() => root.unmount()); restoreSvgCoordinates(); }
  });

  it("removes points by tapping, preserves a minimum triangle, and supports undo", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const restoreSvgCoordinates = installIdentitySvgCoordinates();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let trace: ReturnType<typeof useTrace>;
    function Probe(): null { trace = useTrace(); return null; }
    try {
      await React.act(async () => root.render(<TraceProvider><SeedTrace /><Probe /><TooltipProvider><TraceCanvas onReprocess={() => {}} /></TooltipProvider></TraceProvider>));
      const svg = host.querySelector('svg[data-testid="trace-scene"]') ?? host.querySelector("svg");
      React.act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit contours"]')!.click());
      const tools = host.querySelector('[aria-label="Contour editing tools"]')!;
      const buttons = tools.querySelectorAll<HTMLButtonElement>('button');
      expect(tools.textContent).toContain("Contour 1");
      expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
      React.act(() => buttons[0].click());
      expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
      const remove = (x: number, y: number) => React.act(() => {
        const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperties(event, { pointerType: { value: "touch" }, pointerId: { value: 1 } });
        svg!.dispatchEvent(event);
      });
      remove(10, 10);
      expect(trace!.outline[0].outer).toHaveLength(4);
      expect(trace!.history.stack[trace!.history.index].label).toBe("Remove contour node");
      remove(90, 10);
      expect(trace!.outline[0].outer).toHaveLength(3);
      remove(90, 90);
      expect(trace!.outline[0].outer).toHaveLength(3);
      React.act(() => trace!.undo());
      expect(trace!.outline[0].outer).toHaveLength(4);
      React.act(() => trace!.undo());
      expect(trace!.outline).toEqual(edited);
      remove(500, 500);
      expect(trace!.outline).toEqual(edited);
      React.act(() => buttons[0].click());
      expect(trace!.mode).toBe("edit");
      expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
      React.act(() => trace!.dispatch({ type: "SET_MODE", mode: "pan" }));
      expect(trace!.selection).not.toBeNull();
      expect(host.querySelector('[aria-label="Contour editing tools"]')).toBeNull();
      React.act(() => trace!.dispatch({ type: "SET_MODE", mode: "edit" }));
      React.act(() => trace!.dispatch({ type: "SELECT_RING", selection: null }));
      expect(host.querySelector('[aria-label="Contour editing tools"]')).toBeNull();
    } finally {
      React.act(() => root.unmount());
      restoreSvgCoordinates();
    }
  });
});
