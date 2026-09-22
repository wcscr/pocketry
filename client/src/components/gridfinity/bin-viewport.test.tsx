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

import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import type { PocketEditor } from "./pocket-transform-scene";
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
  pocketEditor?: PocketEditor,
): HTMLElement {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  React.act(() => {
    root.render(
      <BinViewport
        geometry={null}
        pocketEditor={pocketEditor}
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


it("switches CAD modes without stealing field input and suspends them for the ruler", () => {
  const basic = createBasicPocket("rectangle", { x: -5, y: -8 }, { x: 5, y: 8 }, "slot")!;
  const cutout = parseCutoutPlacement({ ...basic.cutout, name: "Target", zOffsetMm: 2 });
  const editor: PocketEditor = { spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }), pockets: [{ cutout, shape: basic.shape }], selectedId: cutout.id, onSelect: vi.fn(), onCommit: vi.fn() };
  const container = renderViewport(false, 1, false, false, [basic.shape.outlineMm], editor);
  const button = (name: string) => container.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement;
  expect(container.querySelector('[data-testid="pocket-3d-transform-readout"]')?.textContent).toContain("Z 2.00 mm");
  React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" })));
  expect(button("Rotate pocket (E)").getAttribute("aria-pressed")).toBe("true");
  const input = document.createElement("input"); container.append(input); input.focus();
  React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true })));
  expect(button("Rotate pocket (E)").getAttribute("aria-pressed")).toBe("true");
  React.act(() => button("Snap transforms to 1 mm and 5 degrees").click());
  expect(button("Snap transforms to 1 mm and 5 degrees").getAttribute("aria-pressed")).toBe("true");
  React.act(() => button("Measure between contours").click());
  expect(container.querySelector('[data-testid="pocket-3d-controls"]')).toBeNull();
  React.act(() => button("Move pocket (W)").click());
  expect(container.querySelector('[data-testid="pocket-3d-controls"]')).not.toBeNull();
  expect(button("Measure between contours").getAttribute("aria-pressed")).toBe("false");
  const select = container.querySelector('[aria-label="Selected pocket in 3D"]') as HTMLSelectElement;
  React.act(() => { select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(editor.onSelect).toHaveBeenLastCalledWith(null);
});
