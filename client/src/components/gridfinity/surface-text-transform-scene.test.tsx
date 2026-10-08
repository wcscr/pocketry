// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";

const scene = vi.hoisted(() => ({ control: null as Object3D | null, orbit: { enabled: true }, handlers: null as null | {
  object: Object3D; space: string; showX: boolean; showY: boolean; showZ: boolean; onMouseDown: () => void; onObjectChange: () => void; onMouseUp: () => void;
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
import { SurfaceTextTransformScene } from "./surface-text-transform-scene";
const label = surfaceTextSchema.parse({ id: "text", name: "Socket label", text: "METRIC", position: { x: 2, y: 4 }, rotationDeg: 170 });
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(mode: "translate" | "rotate" = "translate") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container), onCommit = vi.fn(), onPreview = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const render = (next = label) => React.act(() => root.render(<SurfaceTextTransformScene editor={{ label: next, z: 42, onCommit }} mode={mode} snap={false} onPreview={onPreview} />));
  render();
  const unmount = () => React.act(() => root.unmount());
  cleanups.push(() => { unmount(); container.remove(); });
  return { onCommit, onPreview, render, unmount };
}
function move() {
  React.act(() => scene.handlers!.onMouseDown());
  for (const x of [3, 5, 9]) React.act(() => {
    scene.handlers!.object.position.set(x, -6, 70);
    scene.handlers!.onObjectChange();
  });
}
it("keeps text on the surface, previews XY locally, and commits once on release", () => {
  const { onCommit, onPreview } = mount();
  expect([scene.handlers!.showX, scene.handlers!.showY, scene.handlers!.showZ]).toEqual([true, true, false]);
  move();
  expect(onCommit).not.toHaveBeenCalled();
  expect(scene.handlers!.object.position.toArray()).toEqual([9, -6, 42]);
  expect(onPreview).toHaveBeenLastCalledWith({ ...label, position: { x: 9, y: -6 } });
  React.act(() => scene.handlers!.onMouseUp());
  expect(onCommit).toHaveBeenCalledExactlyOnceWith({ ...label, position: { x: 9, y: -6 } }, "translate");
  expect(onPreview).toHaveBeenLastCalledWith(null);
});
it("exposes only Z rotation and wraps across 180 degrees without changing name or wording", () => {
  const { onCommit } = mount("rotate");
  expect([scene.handlers!.showX, scene.handlers!.showY, scene.handlers!.showZ]).toEqual([false, false, true]);
  React.act(() => {
    scene.handlers!.onMouseDown();
    scene.handlers!.object.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 6);
    scene.handlers!.onObjectChange();
    scene.handlers!.onMouseUp();
  });
  expect(onCommit).toHaveBeenCalledExactlyOnceWith({ ...label, rotationDeg: -160 }, "rotate");
  expect(scene.handlers!.object.quaternion.equals(new Quaternion())).toBe(true);
});
it.each(["Escape", "blur", "pointercancel", "replacement", "unmount"])("cancels %s without a document edit", event => {
  const { onCommit, onPreview, render, unmount } = mount(); move(); scene.orbit.enabled = false;
  if (event === "unmount") unmount();
  else if (event === "replacement") render({ ...label, id: "other" });
  else React.act(() => window.dispatchEvent(event === "Escape" ? new KeyboardEvent("keydown", { key: "Escape" }) : new Event(event)));
  expect(scene.orbit.enabled).toBe(true);
  expect(onPreview).toHaveBeenLastCalledWith(null);
  React.act(() => scene.handlers!.onMouseUp());
  expect(onCommit).not.toHaveBeenCalled();
});
it("does not commit a click or move back to the starting point", () => {
  const { onCommit } = mount();
  React.act(() => { scene.handlers!.onMouseDown(); scene.handlers!.onObjectChange(); scene.handlers!.onMouseUp(); });
  move();
  React.act(() => { scene.handlers!.object.position.set(2, 4, 42); scene.handlers!.onObjectChange(); scene.handlers!.onMouseUp(); });
  expect(onCommit).not.toHaveBeenCalled();
});
