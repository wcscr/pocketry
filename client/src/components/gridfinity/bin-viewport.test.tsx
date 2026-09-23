// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const canvasFailure = vi.hoisted(() => ({ active: false }));
vi.mock("@react-three/fiber", () => ({
  Canvas: () => { if (canvasFailure.active) throw new Error("WebGL context lost"); return <div data-testid="canvas-stub" />; },
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
import { BinViewport, type MaterialColorTarget } from "./bin-viewport";
import type { Outline } from "@shared/geometry/types";

const mounted: Array<() => void> = [];

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderViewport(
  building: boolean,
  progress: number,
  hasPocketFloor = false,
  hasStackingRim = false,
  measurementOutlines: readonly Outline[] = [],
  onEditColor: (target: MaterialColorTarget) => void = vi.fn(),
  previewIsDraft = false,
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
        binColor="#654321"
        onEditColor={onEditColor}
        pocketFloorColor="#123456"
        stackingRimColor="#abcdef"
        building={building}
        previewIsDraft={previewIsDraft}
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

it("delays transient busy UI and uses a stage label without restarting percentages", () => {
  vi.useFakeTimers();
  const container = renderViewport(true, 0.42);
  expect(container.querySelector('[data-testid="bin-preview-status"]')).toBeNull();
  React.act(() => vi.advanceTimersByTime(150));
  const status = container.querySelector('[data-testid="bin-preview-status"]');
  expect(status?.getAttribute("role")).toBe("status");
  expect(status?.textContent).toContain("Updating preview…");
  expect(status?.textContent).not.toContain("%");
});

it("hides preview progress when the geometry is current", () => {
  const container = renderViewport(false, 1);
  expect(container.querySelector('[data-testid="bin-preview-status"]')).toBeNull();
});

it.each([true, false])("labels omitted rounding on a draft with refinement running=%s", building => {
  const container = renderViewport(building, 0.4, false, false, [], vi.fn(), true);
  const status = container.querySelector('[data-testid="bin-preview-status"]');
  expect(status?.textContent).toContain("Simplified preview");
  expect(status?.textContent).toContain(building ? "refining details…" : "detailed preview unavailable");
});

it("labels the contrasting pocket-floor surface", () => {
  const container = renderViewport(false, 1, true);
  const legend = container.querySelector('[data-testid="material-color-legend"]');
  expect(legend?.textContent).toContain("Bin body");
  expect(legend?.textContent).toContain("Pocket floor");
  expect((legend?.querySelector("button span") as HTMLElement).style.backgroundColor).toBe(
    "rgb(101, 67, 33)",
  );
});

it("labels the independently colored stacking-rim crest", () => {
  const container = renderViewport(false, 1, false, true);
  const legend = container.querySelector('[data-testid="material-color-legend"]');
  expect(legend?.textContent).toContain("Bin body");
  expect(legend?.textContent).toContain("Rim top");
  expect((legend?.querySelector("button:last-child span") as HTMLElement).style.backgroundColor).toBe(
    "rgb(171, 205, 239)",
  );
});

it("opens the matching material controls from each legend entry", () => {
  const onEditColor = vi.fn();
  const container = renderViewport(false, 1, true, true, [], onEditColor);
  const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="material-color-legend"] button');
  expect([...buttons].map((button) => button.textContent?.trim())).toEqual([
    "Bin body", "Pocket floor", "Rim top",
  ]);
  for (const button of buttons) React.act(() => button.click());
  expect(onEditColor.mock.calls).toEqual([["bin"], ["pocket-floor"], ["stacking-rim"]]);
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
  const container = renderViewport(false, 1, false, false, [basic.shape.outlineMm], undefined, false, editor);
  const button = (name: string) => container.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement;
  expect(container.querySelector('[data-testid="pocket-3d-depth-readout"]')?.textContent).toContain("Depth:");
  expect(container.querySelector('[aria-label="Transform coordinate space"]')).toBeNull();
  expect(button("Snap: 1 mm moves and 5 degree rotations").getAttribute("title")).toContain("Snap off");
  expect(button("Snap: 1 mm moves and 5 degree rotations").getAttribute("title")).toContain("1 mm moves / 5° rotations");
  React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" })));
  expect(button("Rotate pocket (E)").getAttribute("aria-pressed")).toBe("true");
  const input = document.createElement("input"); container.append(input); input.focus();
  React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true })));
  expect(button("Rotate pocket (E)").getAttribute("aria-pressed")).toBe("true");
  React.act(() => button("Snap: 1 mm moves and 5 degree rotations").click());
  expect(button("Snap: 1 mm moves and 5 degree rotations").getAttribute("aria-pressed")).toBe("true");
  expect(button("Snap: 1 mm moves and 5 degree rotations").getAttribute("title")).toContain("Snap on");
  React.act(() => button("Measure between contours").click());
  expect(container.querySelector('[data-testid="pocket-3d-controls"]')).toBeNull();
  React.act(() => button("Stop measuring").click());
  expect(container.querySelector('[data-testid="pocket-3d-controls"]')).not.toBeNull();
  expect(button("Measure between contours").getAttribute("aria-pressed")).toBe("false");
  React.act(() => (Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Clear")!).click());
  expect(editor.onSelect).toHaveBeenLastCalledWith(null);
});

it("keeps the workspace usable after a lost graphics context and can retry", () => {
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  canvasFailure.active = true;
  try {
    const container = renderViewport(false, 1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your design is still open");
    canvasFailure.active = false;
    React.act(() => Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Retry 3D preview")!.click());
    expect(container.querySelector('[data-testid="canvas-stub"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally { canvasFailure.active = false; warning.mockRestore(); }
});
