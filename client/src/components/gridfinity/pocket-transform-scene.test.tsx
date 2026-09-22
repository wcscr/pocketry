// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Object3D } from "three";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";

const scene = vi.hoisted(() => ({ orbit: { enabled: true }, handlers: null as null | {
  object: Object3D; onMouseDown: () => void; onObjectChange: () => void; onMouseUp: () => void;
} }));
vi.mock("@react-three/fiber", () => ({ useThree: (select: (state: { controls: typeof scene.orbit }) => unknown) => select({ controls: scene.orbit }) }));
vi.mock("@react-three/drei", () => ({
  Line: () => null,
  TransformControls: React.forwardRef((_props: NonNullable<typeof scene.handlers>, ref) => {
    scene.handlers = _props;
    React.useImperativeHandle(ref, () => ({ reset: vi.fn(), dispose: vi.fn() }));
    return null;
  }),
}));
import { PocketTransformScene } from "./pocket-transform-scene";

const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, lip: "none" });
const cutout = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 } });
const shape: TracedShape = { id: "s", name: "Slot", sourceMmPerPx: null, pointCount: 4, bboxMm: { minX: -5, minY: -5, maxX: 5, maxY: 5 }, outlineMm: [{ outer: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }], holes: [] }] };
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });
function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container), onCommit = vi.fn(), onPreview = vi.fn();
  // R3F primitive is intentionally inert in this event-contract test.
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  React.act(() => root.render(<PocketTransformScene pocket={{ cutout, shape }} spec={spec} mode="translate" space="world" snap={false} onCommit={onCommit} onPreview={onPreview} onLimit={vi.fn()} />));
  warning.mockRestore();
  const unmount = () => React.act(() => root.unmount());
  cleanups.push(() => { unmount(); container.remove(); });
  return { onCommit, onPreview, unmount };
}
function drag() {
  React.act(() => scene.handlers!.onMouseDown());
  for (const x of [1, 2, 3]) React.act(() => {
    scene.handlers!.object.position.x = x;
    scene.handlers!.object.position.z = 40;
    scene.handlers!.onObjectChange();
  });
}
it("previews locally and commits one complete XYZ move on release", () => {
  const { onCommit, onPreview } = mount(); drag();
  expect(onCommit).not.toHaveBeenCalled();
  expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ position: { x: 3, y: 0 }, zOffsetMm: -2 }));
  React.act(() => scene.handlers!.onMouseUp());
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith("p", expect.objectContaining({ position: { x: 3, y: 0 }, zOffsetMm: -2 }), "translate");
  expect(onPreview).toHaveBeenLastCalledWith(null);
});
it.each(["Escape", "blur", "pointercancel"])("cancels %s without persisting and restores orbit and original pose", event => {
  const { onCommit, onPreview } = mount(); drag(); scene.orbit.enabled = false;
  React.act(() => window.dispatchEvent(event === "Escape" ? new KeyboardEvent("keydown", { key: "Escape" }) : new Event(event)));
  expect(scene.orbit.enabled).toBe(true);
  expect(scene.handlers!.object.position.toArray()).toEqual([0, 0, 42]);
  React.act(() => scene.handlers!.onMouseUp());
  expect(onCommit).not.toHaveBeenCalled(); expect(onPreview).toHaveBeenLastCalledWith(null);
});
it("does not create history for a click or a drag that returns to its starting point", () => {
  const { onCommit } = mount();
  React.act(() => { scene.handlers!.onMouseDown(); scene.handlers!.onObjectChange(); scene.handlers!.onMouseUp(); });
  expect(onCommit).not.toHaveBeenCalled();
});
it("abandons a gesture when the view unmounts", () => {
  const { onCommit, unmount } = mount(); drag(); unmount();
  expect(onCommit).not.toHaveBeenCalled();
});
