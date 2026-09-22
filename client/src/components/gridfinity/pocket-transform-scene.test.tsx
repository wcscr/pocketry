// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";

const scene = vi.hoisted(() => ({ control: null as Object3D | null, orbit: { enabled: true }, handlers: null as null | {
  object: Object3D; space: string; onMouseDown: () => void; onObjectChange: () => void; onMouseUp: () => void;
} }));
vi.mock("@react-three/fiber", () => ({ useThree: (select: (state: { controls: typeof scene.orbit }) => unknown) => select({ controls: scene.orbit }) }));
vi.mock("@react-three/drei", () => ({
  Line: () => null,
  TransformControls: React.forwardRef((_props: NonNullable<typeof scene.handlers>, ref) => {
    scene.handlers = _props;
    const control = React.useMemo(() => {
      const object = Object.assign(new Object3D(), { reset: vi.fn(), dispose: vi.fn() });
      for (const name of ["X", "Y", "Z", "XY", "XZ", "YZ", "E", "XYZE", "XYZ"]) {
        const child = new Object3D(); child.name = name; object.add(child);
      }
      return object;
    }, []);
    scene.control = control;
    React.useImperativeHandle(ref, () => control);
    return null;
  }),
}));
import { PocketTransformScene } from "./pocket-transform-scene";

const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, lip: "none" });
const cutout = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 } });
const shape: TracedShape = { id: "s", name: "Slot", sourceMmPerPx: null, pointCount: 4, bboxMm: { minX: -5, minY: -5, maxX: 5, maxY: 5 }, outlineMm: [{ outer: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }], holes: [] }] };
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });
function mount(mode: "translate" | "rotate" = "translate", selected = cutout) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container), onCommit = vi.fn(), onPreview = vi.fn();
  // R3F primitive is intentionally inert in this event-contract test.
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  React.act(() => root.render(<PocketTransformScene pocket={{ cutout: selected, shape }} spec={spec} mode={mode} snap={false} onCommit={onCommit} onPreview={onPreview} onLimit={vi.fn()} />));
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
  expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ position: { x: 3, y: 0 }, depth: { mode: "remaining", floorThicknessMm: 5 } }));
  React.act(() => scene.handlers!.onMouseUp());
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith("p", expect.objectContaining({ position: { x: 3, y: 0 }, depth: { mode: "remaining", floorThicknessMm: 5 } }), "translate");
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


it("keeps the gizmo on the surface throughout a pure Z drag and creates one depth undo", () => {
  const { onCommit, onPreview } = mount();
  React.act(() => scene.handlers!.onMouseDown());
  for (const z of [44, 47, 90]) React.act(() => {
    scene.handlers!.object.position.z = z;
    scene.handlers!.onObjectChange();
    expect(scene.handlers!.object.position.z).toBe(42);
  });
  expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ depth: { mode: "remaining", floorThicknessMm: 41.5 }, zOffsetMm: undefined }));
  React.act(() => scene.handlers!.onMouseUp());
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(scene.handlers!.object.position.toArray()).toEqual([0, 0, 42]);
});
it("keeps the handles in fixed XYZ through repeated rotation gestures and removes free-rotation pickers", () => {
  const tilted = { ...cutout, tilt: { xDeg: 0, yDeg: 30 } };
  const { onCommit } = mount("rotate", tilted);
  expect(scene.handlers!.space).toBe("world");
  expect(scene.control!.children.map(child => child.name)).toEqual(["X", "Y", "Z", "XY", "XZ", "YZ"]);
  expect(scene.handlers!.object.quaternion.equals(new Quaternion())).toBe(true);
  React.act(() => {
    scene.handlers!.onMouseDown();
    scene.handlers!.object.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 36);
    scene.handlers!.onObjectChange();
  });
  expect(scene.handlers!.object.quaternion.equals(new Quaternion())).toBe(true);
  React.act(() => scene.handlers!.onMouseUp());
  expect(onCommit).toHaveBeenCalledWith("p", expect.objectContaining({ tilt: { xDeg: 0, yDeg: 35 } }), "rotate");
});
