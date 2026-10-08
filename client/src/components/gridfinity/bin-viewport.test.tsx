// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const experimental = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/state/experimental-features", () => ({ useExperimentalFeatures: () => experimental }));
import { BufferGeometry, Object3D, PerspectiveCamera } from "three";
import { OrbitControls as OrbitController, TransformControls as TransformController } from "three-stdlib";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { OrbitControls, type OrbitControlsProps } from "@react-three/drei";

const canvasFailure = vi.hoisted(() => ({ active: false, children: null as React.ReactNode }));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => {
    if (canvasFailure.active) throw new Error("WebGL context lost");
    canvasFailure.children = children;
    return <div data-testid="canvas-stub" />;
  },
  useThree: vi.fn(),
}));

vi.mock("@react-three/drei", () => ({
  Line: () => null,
  OrbitControls: () => null,
}));

vi.mock("@/hooks/use-element-size", () => ({
  useElementSize: () => [vi.fn(), { width: 800, height: 600 }],
}));

import { BoxGeometry } from "three";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import type { PocketEditor } from "./pocket-transform-scene";
import { BinViewport, type MaterialColorTarget, type BinViewportProps } from "./bin-viewport";
import type { Outline } from "@shared/geometry/types";

const mounted: Array<() => void> = [];

afterEach(() => {
  experimental.enabled = true;
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
  floorColorLabel: "Pocket floor" | "Bin floor" = "Pocket floor",
  textGeometries: BinViewportProps["textGeometries"] = [],
  recovery: Pick<BinViewportProps, "error" | "onPositionText" | "onRetryPreview"> = { error: null },
  lidGeometry: BoxGeometry | null = null,
): HTMLElement {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  React.act(() => {
    root.render(
      <BinViewport
        geometry={null}
        lidGeometry={lidGeometry}
        textGeometries={textGeometries}
        textColor="#ff6600"
        pocketEditor={pocketEditor}
        hasPocketFloor={hasPocketFloor}
        hasStackingRim={hasStackingRim}
        binColor="#654321"
        onEditColor={onEditColor}
        pocketFloorColor="#123456"
        floorColorLabel={floorColorLabel}
        stackingRimColor="#abcdef"
        building={building}
        previewIsDraft={previewIsDraft}
        progress={progress}
        {...recovery}
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

it("keeps canvas pinch ownership and camera zoom working after a transform pointer release", () => {
  const container = renderViewport(false, 1);
  const canvas = document.createElement('canvas');
  container.querySelector('[data-testid="canvas-stub"]')!.append(canvas);
  Object.defineProperties(canvas, { clientWidth: { value: 390 }, clientHeight: { value: 600 }, releasePointerCapture: { value: vi.fn() } });
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 390, 600);
  const camera = new PerspectiveCamera(40, 390 / 600, 0.1, 100);
  camera.position.set(5, 7, 9); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const orbit = new OrbitController(camera, canvas), transform = new TransformController(camera, canvas);
  const object = new Object3D(), scene = new Object3D();
  scene.add(object, transform); transform.attach(object); scene.updateMatrixWorld(true);
  const pointer = (type: string, id: number, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 550, button: type === 'pointermove' ? -1 : 0 });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
    canvas.dispatchEvent(event);
  };
  try {
    pointer('pointerdown', 1, 100); pointer('pointerup', 1, 100);
    expect(canvas.style.touchAction).toBe(''); // Installed TransformControls clears this.
    expect(canvas.closest('[data-testid="bin-viewport"]')?.classList.contains('touch-none')).toBe(true);
    const distance = camera.position.distanceTo(orbit.target);
    pointer('pointerdown', 2, 100); pointer('pointerdown', 3, 200);
    pointer('pointermove', 3, 260);
    expect(camera.position.distanceTo(orbit.target)).toBeLessThan(distance);
    pointer('pointerup', 2, 100); pointer('pointerup', 3, 260);
    expect(object.position.toArray()).toEqual([0, 0, 0]);
    expect(container.classList.contains('touch-none')).toBe(false);
  } finally { transform.dispose(); orbit.dispose(); }
});

it.each(["mouse", "pen", "touch"])("switches %s drags from orbit to pan and back", pointerType => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const container = renderViewport(false, 1);
  const canvas = document.createElement("canvas");
  container.querySelector('[data-testid="canvas-stub"]')!.append(canvas);
  Object.defineProperties(canvas, {
    clientWidth: { value: 390 }, clientHeight: { value: 600 }, releasePointerCapture: { value: vi.fn() },
  });
  const camera = new PerspectiveCamera(40, 390 / 600, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(5, -7, 9);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const orbit = new OrbitController(camera, canvas);
  const syncControls = () => {
    // Use the viewport's actual props so the UI switch must configure the controller.
    const element = React.Children.toArray(canvasFailure.children).find(child =>
      React.isValidElement(child) && child.type === OrbitControls) as React.ReactElement<OrbitControlsProps>;
    const { mouseButtons, touches, enableDamping, dampingFactor } = element.props;
    if (mouseButtons) orbit.mouseButtons = mouseButtons;
    if (touches) orbit.touches = touches;
    orbit.enableDamping = enableDamping ?? true;
    orbit.dampingFactor = dampingFactor ?? 0.05;
  };
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: type === "pointermove" ? -1 : 0 });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
    canvas.dispatchEvent(event);
  };
  try {
    for (const panning of [false, true, false]) {
      syncControls();
      const position = camera.position.clone(), target = orbit.target.clone(), orientation = camera.quaternion.clone();
      pointer("pointerdown", 100, 300);
      pointer("pointermove", 140, 320);
      pointer("pointerup", 140, 320);
      for (let frame = 0; frame < 180; frame++) orbit.update();
      camera.updateMatrixWorld();
      if (panning) {
        expect(orbit.target.distanceTo(target)).toBeGreaterThan(0.1);
        expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-6);
        expect(camera.position.clone().sub(position).distanceTo(orbit.target.clone().sub(target))).toBeLessThan(1e-6);
      } else {
        expect(orbit.target.distanceTo(target)).toBeLessThan(1e-6);
        expect(camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.05);
      }
      const action = panning ? "Switch to orbit" : "Switch to pan";
      React.act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${action}"]`)!.click());
    }
  } finally { orbit.dispose(); }
});

it("offers working placement and retry actions when a text preview fails", () => {
  const onPositionText = vi.fn();
  const onRetryPreview = vi.fn();
  const error = 'Text “Wiha” must fit on the flat surface, clear of pockets and openings.';
  const container = renderViewport(false, 1, false, false, [], vi.fn(), false, undefined, "Pocket floor", [],
    { error, onPositionText, onRetryPreview });
  expect(container.textContent).toContain(error);
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
  React.act(() => buttons.find(button => button.textContent === "Position text in Layout")!.click());
  React.act(() => buttons.find(button => button.textContent === "Retry preview")!.click());
  expect(onPositionText).toHaveBeenCalledOnce();
  expect(onRetryPreview).toHaveBeenCalledOnce();
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

it("offers one shared text color control even without floor or rim colors", () => {
  const onEditColor = vi.fn();
  const label = surfaceTextSchema.parse({ id: "metric", text: "METRIC", position: { x: 0, y: 0 } });
  const geometry = new BufferGeometry();
  const container = renderViewport(false, 1, false, false, [], onEditColor, false, undefined, "Pocket floor", [
    { label, geometry }, { label: { ...label, id: "sae", text: "SAE" }, geometry },
  ]);
  expect(container.querySelectorAll('button[title="Edit text color"]')).toHaveLength(1);
  const button = container.querySelector<HTMLButtonElement>('button[title="Edit text color"]')!;
  expect(button.querySelector<HTMLElement>("span")!.style.backgroundColor).toBe("rgb(255, 102, 0)");
  React.act(() => button.click());
  expect(onEditColor).toHaveBeenCalledWith("text");
  geometry.dispose();
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

it("uses the shared floor color and editor target for a hollow bin's floor", () => {
  const onEditColor = vi.fn();
  const container = renderViewport(false, 1, true, false, [], onEditColor, false, undefined, "Bin floor");
  const button = container.querySelector<HTMLButtonElement>('button[title="Edit bin floor color"]')!;
  expect(button.textContent).toContain("Bin floor");
  expect(button.querySelector<HTMLElement>("span")!.style.backgroundColor).toBe("rgb(18, 52, 86)");
  React.act(() => button.click());
  expect(onEditColor).toHaveBeenCalledWith("pocket-floor");
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


it("keeps the compact raised, closed, and hidden lid controls", () => {
  const lid = new BoxGeometry(40, 40, 7);
  lid.computeBoundingBox();
  const container = renderViewport(false, 1, false, false, [], undefined, false, undefined, "Pocket floor", [], { error: null }, lid);
  for (const mode of ["closed", "hidden", "raised"]) {
    const button = container.querySelector<HTMLButtonElement>(`[data-testid="button-lid-${mode}"]`)!;
    React.act(() => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
  }
  expect(container.querySelector('[aria-label="Show parts"]')).toBeNull();
  lid.dispose();
});

it("switches CAD modes without stealing field input and suspends them for the ruler", () => {
  const basic = createBasicPocket("rectangle", { x: -5, y: -8 }, { x: 5, y: 8 }, "slot")!;
  const cutout = parseCutoutPlacement({ ...basic.cutout, name: "Target", zOffsetMm: 2 });
  const editor: PocketEditor = { spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }), pockets: [{ cutout, shape: basic.shape }], selectedId: cutout.id, onSelect: vi.fn(), onCommit: vi.fn() };
  const container = renderViewport(false, 1, false, false, [basic.shape.outlineMm], undefined, false, editor);
  const button = (name: string) => container.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement;
  expect(container.querySelector('[data-testid="pocket-3d-controls"]')).toBeNull();
  React.act(() => button("Object controls").click());
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
  React.act(() => button("Close object controls").click());
  expect(container.querySelector('[data-testid="pocket-3d-controls"]')).toBeNull();
  React.act(() => button("Object controls").click());
  expect(container.querySelector('[data-testid="pocket-3d-controls"]')).not.toBeNull();
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

it("returns to the requested transform tab even when its mode was already active", () => {
  const basic = createBasicPocket("rectangle", { x: -5, y: -8 }, { x: 5, y: 8 }, "shortcut")!;
  const editor: PocketEditor = { spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }),
    pockets: [basic], selectedId: basic.cutout.id, onSelect: vi.fn(), onCommit: vi.fn(), linkControls: <span>Link actions</span> };
  const container = renderViewport(false, 1, false, false, [], undefined, false, editor);
  const button = (name: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
  for (const [key, mode] of [["w", "Move pocket (W)"], ["e", "Rotate pocket (E)"]] as const) {
    React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key })));
    for (const tab of ["Link and unlink designs", "Align and distribute objects"]) {
      React.act(() => button(tab).click());
      React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key })));
      expect(button(mode).getAttribute("aria-pressed")).toBe("true");
    }
  }
});


it("keeps linking experimental while arrangement and Select All remain standard", () => {
  experimental.enabled = false;
  const basic = createBasicPocket("rectangle", { x: -5, y: -8 }, { x: 5, y: 8 }, "gating")!;
  const onSelectionChange = vi.fn();
  const editor: PocketEditor = { spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }), pockets: [basic],
    selectedId: basic.cutout.id, onSelect: vi.fn(), onCommit: vi.fn(), onSelectionChange, linkControls: <span>Link actions</span> };
  const container = renderViewport(false, 1, false, false, [], undefined, false, editor);
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Object controls"]')!.click());
  expect(container.querySelector('[aria-label="Link and unlink designs"]')).toBeNull();
  expect(container.querySelector('[aria-label="Align and distribute objects"]')).not.toBeNull();
  expect(container.textContent).toContain("Select all");
  React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true })));
  expect(onSelectionChange).toHaveBeenCalledWith([{kind:"pocket",id:basic.cutout.id}]);
  expect(container.querySelector('[aria-label="Move pocket (W)"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Rotate pocket (E)"]')).not.toBeNull();
});
