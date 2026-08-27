// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@react-three/fiber", () => ({
  Canvas: () => <div data-testid="canvas-stub" />,
  useThree: vi.fn(),
}));

vi.mock("@react-three/drei", () => ({
  Line: () => null,
  OrbitControls: () => null,
}));

vi.mock("@/hooks/use-element-size", () => ({
  useElementSize: () => [vi.fn(), { width: 800, height: 600 }],
}));

import { BinViewport } from "./bin-viewport";
import type { Outline } from "@shared/geometry/types";

const mounted: Array<() => void> = [];

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  vi.unstubAllGlobals();
});

function renderViewport(
  building: boolean,
  progress: number,
  hasPocketFloor = false,
  hasStackingRim = false,
  measurementOutlines: readonly Outline[] = [],
): HTMLElement {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  React.act(() => {
    root.render(
      <BinViewport
        geometry={null}
        hasPocketFloor={hasPocketFloor}
        hasStackingRim={hasStackingRim}
        pocketFloorColor="#123456"
        stackingRimColor="#abcdef"
        building={building}
        progress={progress}
        error={null}
        fitSize={{ widthMm: 84, lengthMm: 84, heightMm: 45.6 }}
        measurementOutlines={measurementOutlines}
        measurementPlaneZMm={42}
      />,
    );
  });
  mounted.push(() => {
    React.act(() => root.unmount());
    container.remove();
  });
  return container;
}

it("shows prominent live progress while the preview updates", () => {
  const container = renderViewport(true, 0.42);
  const status = container.querySelector('[data-testid="bin-preview-status"]');
  expect(status?.getAttribute("role")).toBe("status");
  expect(status?.textContent).toContain("Updating 3D preview… 42%");
});

it("hides preview progress when the geometry is current", () => {
  const container = renderViewport(false, 1);
  expect(container.querySelector('[data-testid="bin-preview-status"]')).toBeNull();
});

it("labels the contrasting pocket-floor surface", () => {
  const container = renderViewport(false, 1, true);
  expect(container.querySelector('[data-testid="material-color-legend"]')?.textContent).toContain(
    "Pocket floor",
  );
});

it("labels the independently colored stacking-rim crest", () => {
  const container = renderViewport(false, 1, false, true);
  const legend = container.querySelector('[data-testid="material-color-legend"]');
  expect(legend?.textContent).toContain("Rim top");
  expect((legend?.querySelector("span span") as HTMLElement).style.backgroundColor).toBe(
    "rgb(171, 205, 239)",
  );
});

it("offers a top-plane ruler in 3D and recommends Layout for precision", () => {
  const outline: Outline = [
    {
      outer: [
        { x: -10, y: -5 },
        { x: 10, y: -5 },
        { x: 10, y: 5 },
        { x: -10, y: 5 },
      ],
      holes: [],
    },
  ];
  const container = renderViewport(false, 1, false, false, [outline]);
  const ruler = container.querySelector(
    '[data-testid="button-3d-ruler"]',
  ) as HTMLButtonElement;
  expect(ruler.disabled).toBe(false);
  React.act(() => ruler.click());
  expect(ruler.getAttribute("aria-pressed")).toBe("true");
  const status = container.querySelector('[data-testid="bin-3d-ruler-status"]');
  expect(status?.textContent).toContain("top plane");
  expect(status?.textContent).toContain(
    "For the most accurate dimension check, use the ruler in Layout.",
  );
});
