// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Object3D, PerspectiveCamera, Sprite, Vector3, type EventDispatcher } from "three";
import { OrbitControls, TransformControls } from "three-stdlib";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";

type ControlProps = {
  object: Object3D; mode: "translate" | "rotate"; size: number;
  showX: boolean; showY: boolean; showZ?: boolean;
  onMouseDown: () => void; onObjectChange: () => void; onMouseUp: () => void;
};
const scene = vi.hoisted(() => ({ current: null as null | {
  camera: PerspectiveCamera; controls: OrbitControls; gl: { domElement: HTMLCanvasElement };
  root: Object3D; transform?: TransformControls; object?: Object3D;
} }));
vi.mock("@react-three/fiber", () => ({ useThree: (select: (state: NonNullable<typeof scene.current>) => unknown) => select(scene.current!) }));
// Only replace the WebGL renderer bridge. Pointer handling, picking, camera
// navigation and the application's preview/commit/cancel callbacks are real.
vi.mock("@react-three/drei", () => ({
  Line: () => null,
  TransformControls: React.forwardRef((props: ControlProps, ref) => {
    const state = scene.current!;
    const callbacks = React.useRef(props); callbacks.current = props;
    const control = React.useMemo(() => new TransformControls(state.camera, state.gl.domElement), []);
    Object.assign(control, { mode: props.mode, size: props.size, space: "world", showX: props.showX, showY: props.showY, showZ: props.showZ ?? true });
    React.useLayoutEffect(() => {
      state.root.add(props.object, control); control.attach(props.object);
      state.transform = control; state.object = props.object;
      return () => { control.detach(); control.removeFromParent(); props.object.removeFromParent(); };
    }, [control, props.object, state]);
    React.useImperativeHandle(ref, () => control);
    React.useEffect(() => {
      // three-stdlib's declaration omits the controller's runtime events.
      const events = control as unknown as EventDispatcher<{
        "dragging-changed": { value: boolean }; mouseDown: {}; objectChange: {}; mouseUp: {};
      }>;
      const dragging = (event: { value: unknown }) => { state.controls.enabled = !event.value; };
      const down = () => callbacks.current.onMouseDown();
      const change = () => callbacks.current.onObjectChange();
      const up = () => callbacks.current.onMouseUp();
      events.addEventListener("dragging-changed", dragging);
      events.addEventListener("mouseDown", down);
      events.addEventListener("objectChange", change);
      events.addEventListener("mouseUp", up);
      return () => {
        events.removeEventListener("dragging-changed", dragging);
        events.removeEventListener("mouseDown", down);
        events.removeEventListener("objectChange", change);
        events.removeEventListener("mouseUp", up);
      };
    }, [control, state]);
    return null;
  }),
}));
import { SelectionTransformScene } from "./pocket-transform-scene";
import { SurfaceTextTransformScene } from "./surface-text-transform-scene";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(kind: "pocket" | "text", mode: "translate" | "rotate", orbitFirst: boolean) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number; pointerType: string;
    constructor(type: string, init: PointerEventInit) {
      super(type, init); this.pointerId = init.pointerId ?? 0; this.pointerType = init.pointerType ?? "";
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  // The R3F primitive is represented by the real Object3D above.
  vi.spyOn(console, "error").mockImplementation(() => {});
  const canvas = document.createElement("canvas"), container = document.createElement("div");
  document.body.append(canvas, container);
  canvas.releasePointerCapture = vi.fn();
  Object.defineProperties(canvas, { clientWidth: { value: 390 }, clientHeight: { value: 600 } });
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 390, 600));
  const camera = new PerspectiveCamera(40, 390 / 600, 0.1, 1000);
  camera.up.set(0, 0, 1); camera.position.set(80, -110, 180);
  const orbit = new OrbitControls(camera);
  orbit.target.set(0, 0, 42); orbit.update();
  if (orbitFirst) orbit.connect(canvas);
  const state = { camera, controls: orbit, gl: { domElement: canvas }, root: new Object3D() };
  scene.current = state;
  const root = createRoot(container), onCommit = vi.fn(), onPreview = vi.fn();
  const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 6, lip: "none" });
  const cutout = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 } });
  const shape: TracedShape = { id: "s", name: "Slot", sourceMmPerPx: null, pointCount: 4, bboxMm: { minX: -5, minY: -5, maxX: 5, maxY: 5 }, outlineMm: [{ outer: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }], holes: [] }] };
  const label = surfaceTextSchema.parse({ id: "text", text: "Metric", position: { x: 0, y: 0 } });
  React.act(() => root.render(kind === "pocket"
    ? <SelectionTransformScene objects={[{ kind: "pocket", cutout, shape }]} spec={spec} mode={mode} snap={false} pivot="individual" onCommit={onCommit} onPreview={onPreview} onLimit={() => {}} touchTargets viewportHeight={600} />
    : <SurfaceTextTransformScene editor={{ label, z: 42, onCommit }} mode={mode} snap={false} onPreview={onPreview} touchTargets viewportHeight={600} />));
  if (!orbitFirst) orbit.connect(canvas);
  const update = () => { camera.updateMatrixWorld(); state.root.updateMatrixWorld(true); };
  update();
  const control = scene.current!.transform!, object = scene.current!.object!;
  const grip = () => {
    update();
    let label: Sprite | undefined;
    control.traverseVisible(child => { if (child instanceof Sprite && child.parent?.name === (mode === "translate" ? "Y" : "Z")) label = child; });
    const point = label!.getWorldPosition(new Vector3()).project(camera);
    return { x: (point.x + 1) * 195, y: (1 - point.y) * 300 };
  };
  const pointer = (type: string, pointerId: number, point: { x: number; y: number }) => {
    React.act(() => (type === "pointerdown" ? canvas : document).dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerType: "touch", pointerId, clientX: point.x, clientY: point.y,
      button: type === "pointermove" ? -1 : 0,
    })));
    update();
  };
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    React.act(() => root.unmount()); orbit.dispose(); canvas.remove(); container.remove();
  };
  cleanups.push(unmount);
  return { camera, orbit, object, control, grip, pointer, onCommit, onPreview, unmount };
}

it.each(["pocket", "text"] as const)("hands a %s handle drag to camera pinch without committing, in either listener/release order", kind => {
  for (const mode of ["translate", "rotate"] as const) for (const orbitFirst of [true, false]) for (const movedFirst of [false, true]) {
    const ui = mount(kind, mode, orbitFirst);
    const start = ui.grip(), original = ui.object.position.clone();
    ui.pointer("pointerdown", 1, start);
    expect(ui.orbit.enabled).toBe(false);
    const first = movedFirst ? { x: start.x + 12, y: start.y + 12 } : start;
    if (movedFirst) ui.pointer("pointermove", 1, first);
    const second = { x: first.x + 80, y: first.y + 80 };
    ui.pointer("pointerdown", 2, second);
    expect(ui.orbit.enabled).toBe(true);
    expect(ui.object.position.distanceTo(original)).toBeLessThan(1e-8);
    expect(ui.object.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(ui.onPreview).toHaveBeenLastCalledWith(null);
    const distance = ui.camera.position.distanceTo(ui.orbit.target);
    const end = { x: second.x + 35, y: second.y + 35 };
    ui.pointer("pointermove", 2, end);
    expect(ui.camera.position.distanceTo(ui.orbit.target)).toBeLessThan(distance * 0.9);
    const firstReleased = orbitFirst ? 1 : 2, remaining = orbitFirst ? 2 : 1;
    ui.pointer("pointerup", firstReleased, firstReleased === 1 ? first : end);
    ui.pointer("pointermove", remaining, { x: first.x + 30, y: first.y - 30 });
    ui.pointer("pointerup", remaining, end);
    expect(ui.onCommit).not.toHaveBeenCalled();
    expect(ui.object.position.distanceTo(original)).toBeLessThan(1e-8);
    // Canceling navigation must leave the next one-finger edit usable.
    const next = ui.grip();
    ui.pointer("pointerdown", 3, next);
    ui.pointer("pointermove", 3, { x: next.x + 14, y: next.y + 14 });
    ui.pointer("pointerup", 3, next);
    expect(ui.onCommit).toHaveBeenCalledOnce();
    ui.unmount();
  }
});

it("keeps a pinch in camera navigation when its second finger lands on a handle", () => {
  const ui = mount("pocket", "translate", true), handle = ui.grip();
  const blank = { x: 20, y: 560 };
  ui.pointer("pointerdown", 1, blank);
  const distance = ui.camera.position.distanceTo(ui.orbit.target);
  ui.pointer("pointerdown", 2, handle);
  ui.pointer("pointermove", 2, { x: handle.x + 35, y: handle.y - 35 });
  expect(ui.camera.position.distanceTo(ui.orbit.target)).toBeLessThan(distance);
  ui.pointer("pointerup", 1, blank); ui.pointer("pointerup", 2, handle);
  expect(ui.onCommit).not.toHaveBeenCalled();
  expect(ui.object.position.toArray()).toEqual([0, 0, 42]);
});

it.each(["pointercancel", "blur"])("cancels interrupted touches on %s and permits a fresh edit", interruption => {
  const ui = mount("pocket", "translate", true), start = ui.grip();
  ui.pointer("pointerdown", 1, start);
  ui.pointer("pointermove", 1, { x: start.x + 12, y: start.y + 12 });
  if (interruption === "pointercancel") ui.pointer("pointercancel", 1, start);
  else React.act(() => window.dispatchEvent(new Event("blur")));
  expect(ui.onCommit).not.toHaveBeenCalled();
  expect(ui.onPreview).toHaveBeenLastCalledWith(null);
  expect(ui.object.position.toArray()).toEqual([0, 0, 42]);
  const next = ui.grip();
  ui.pointer("pointerdown", 2, next);
  ui.pointer("pointermove", 2, { x: next.x + 14, y: next.y + 14 });
  ui.pointer("pointerup", 2, next);
  expect(ui.onCommit).toHaveBeenCalledOnce();
});

it("commits Z rotation from its badge across shallow views and zoom levels without introducing X tilt", () => {
  // The previous mesh-gated picking missed 17 of these centers and committed
  // an X tilt despite the pointer starting on the visible Z badge.
  for (const radius of [12, 40, 100, 200, 400]) for (const elevation of [15, 19, 25, 43, 58]) for (const azimuth of [1, 90, 92, 183, 270]) {
    const ui = mount("pocket", "rotate", true);
    const el = elevation * Math.PI / 180, az = azimuth * Math.PI / 180;
    ui.camera.position.set(radius * Math.cos(el) * Math.cos(az), radius * Math.cos(el) * Math.sin(az), 42 + radius * Math.sin(el));
    ui.camera.lookAt(0, 0, 42); ui.camera.updateMatrixWorld();
    const start = ui.grip();
    ui.pointer("pointerdown", 1, start);
    ui.pointer("pointermove", 1, { x: start.x + 20, y: start.y + 20 });
    ui.pointer("pointerup", 1, start);
    expect(ui.onCommit, `radius ${radius}, elevation ${elevation}, azimuth ${azimuth}`).toHaveBeenCalledOnce();
    const cutout = ui.onCommit.mock.lastCall![0].cutouts[0];
    expect(Math.abs(cutout.rotationDeg)).toBeGreaterThan(1);
    expect(cutout.tilt?.xDeg ?? 0).toBeCloseTo(0);
    expect(cutout.tilt?.yDeg ?? 0).toBeCloseTo(0);
    ui.unmount();
  }
});
