// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { BufferGeometry, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, OrthographicCamera, PerspectiveCamera, Sprite, Vector3 } from "three";
import { TransformControls } from "three-stdlib";
import { styleTransformGizmo } from "./transform-gizmo-style";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); });

it("keeps axis pickers while replacing overlapping diamonds and restores disposable originals", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const root = new Object3D(), visuals = new Object3D(), pickers = new Object3D();
  root.add(visuals, pickers);
  const ring = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3(1, 0, 0)]), new LineBasicMaterial()); ring.name = "X";
  const diamond = new Mesh(new OctahedronGeometry(0.04), new MeshBasicMaterial()); diamond.name = "X";
  const picker = new Mesh(new BufferGeometry(), new MeshBasicMaterial()); picker.name = "X";
  const free = new Object3D(); free.name = "E";
  visuals.add(ring, diamond); pickers.add(picker, free);
  const restore = styleTransformGizmo(root);
  expect(diamond.parent).toBeNull(); expect(ring.parent).toBeNull(); expect(free.parent).toBeNull();
  expect(picker.parent).toBe(pickers);
  const tube = visuals.children[0] as Mesh;
  expect(tube.geometry.type).toBe("TubeGeometry");
  const disposeGeometry = vi.spyOn(tube.geometry, "dispose");
  const disposeMaterial = vi.spyOn(tube.material as MeshBasicMaterial, "dispose");
  restore();
  expect(visuals.children).toEqual([ring, diamond]); expect(pickers.children).toContain(free);
  expect(disposeGeometry).toHaveBeenCalledOnce(); expect(disposeMaterial).toHaveBeenCalledOnce();
});

it("places readable labels beyond move arrows and releases their textures", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const root = new Object3D();
  const line = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3(1, 0, 0)]), new LineBasicMaterial()); line.name = "X"; root.add(line);
  const restore = styleTransformGizmo(root);
  const label = root.children[0].children[0] as Sprite;
  expect(label.position.x).toBeCloseTo(1.2); expect(label.renderOrder).toBe(Infinity);
  const dispose = vi.spyOn(label.material.map!, "dispose");
  restore(); expect(dispose).toHaveBeenCalledOnce();
});

/** Exercise the installed controller's real pointer/raycast path without WebGL. */
function mountGizmo(mode: "translate" | "rotate" = "translate", flipped = false, orthographic = false) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const canvas = document.createElement("canvas"); document.body.append(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
  const camera = orthographic ? new OrthographicCamera(-8, 8, 6, -6, 0.1, 100) : new PerspectiveCamera(45, 4 / 3, 0.1, 100);
  camera.up.set(0, 0, 1); camera.position.set(flipped ? -5 : 5, flipped ? -7 : 7, 9); camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const root = new Object3D(), object = new Object3D(), control = new TransformControls(camera, canvas);
  root.add(object, control); control.attach(object); control.setSpace("world"); control.setMode(mode);
  const restoreStyle = styleTransformGizmo(control);
  let restored = false;
  const restore = () => { if (!restored) { restoreStyle(); restored = true; } };
  root.updateMatrixWorld(true);
  const dispatch = vi.spyOn(control, "dispatchEvent");
  cleanups.push(() => { restore(); control.dispose(); canvas.remove(); });
  const label = (axis: string) => {
    let result: Sprite | undefined;
    control.traverseVisible(child => { if (child instanceof Sprite && child.parent?.name === axis) result = child; });
    if (!result) throw new Error(`No visible ${axis} label`);
    return result;
  };
  const screen = (point: Vector3) => {
    const projected = point.clone().project(camera);
    return { x: (projected.x + 1) * 400, y: (1 - projected.y) * 300 };
  };
  const pointer = (type: "pointerdown" | "pointermove" | "pointerup", point: { x: number; y: number }, pointerType = "mouse") => {
    const event = new MouseEvent(type, { clientX: point.x, clientY: point.y, button: type === "pointermove" ? -1 : 0, bubbles: true });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    (type === "pointerdown" ? canvas : document).dispatchEvent(event);
    root.updateMatrixWorld(true);
  };
  const events = (type: string) => dispatch.mock.calls.filter(([event]) => String(event.type) === type);
  const hover = (point: { x: number; y: number }) => {
    const event = new MouseEvent("pointermove", { clientX: point.x, clientY: point.y, bubbles: true });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    canvas.dispatchEvent(event); root.updateMatrixWorld(true);
  };
  return { object, control, root, label, screen, pointer, hover, events, restore };
}

it.each(["X", "Y", "Z"] as const)("starts an axis-constrained drag from the %s label, including flipped handles", axis => {
  for (const flipped of [false, true]) {
    const ui = mountGizmo("translate", flipped);
    const center = ui.label(axis).getWorldPosition(new Vector3());
    const start = ui.screen(center);
    const delta = new Vector3(); delta.setComponent(["X", "Y", "Z"].indexOf(axis), 0.8);
    const end = ui.screen(center.clone().add(delta));
    ui.hover(start);
    ui.pointer("pointerdown", start);
    expect(ui.events("mouseDown")).toHaveLength(1);
    ui.pointer("pointermove", end);
    ui.pointer("pointerup", end);
    expect(ui.object.position.distanceTo(delta)).toBeLessThan(1e-5);
    expect(ui.events("mouseUp")).toHaveLength(1);
  }
});

it("supports touch and snapping from a label in an orthographic view", () => {
  const ui = mountGizmo("translate", false, true);
  ui.control.setTranslationSnap(1);
  const center = ui.label("Y").getWorldPosition(new Vector3());
  const end = ui.screen(center.clone().add(new Vector3(0, 1.4, 0)));
  ui.pointer("pointerdown", ui.screen(center), "touch");
  ui.pointer("pointermove", end, "touch");
  ui.pointer("pointerup", end, "touch");
  expect(ui.events("mouseDown")).toHaveLength(1);
  expect(ui.object.position.x).toBe(0); expect(ui.object.position.z).toBe(0);
  expect(ui.object.position.y).toBeGreaterThan(0);
  expect(ui.object.position.y % 1).toBe(0);
});

it.each(["X", "Y", "Z"] as const)("starts rotation from the edge of the %s label", axis => {
  const ui = mountGizmo("rotate");
  const label = ui.label(axis), center = label.getWorldPosition(new Vector3());
  // The label edge extends beyond the ring's original narrow picking torus.
  const edge = center.clone().multiplyScalar(1.11);
  const start = ui.screen(edge), end = { x: start.x + 18, y: start.y + 12 };
  ui.hover(start);
  ui.pointer("pointerdown", start);
  expect(ui.events("mouseDown")).toHaveLength(1);
  ui.pointer("pointermove", end); ui.pointer("pointerup", end);
  const component = axis.toLowerCase() as "x" | "y" | "z";
  expect(Math.abs(ui.object.quaternion[component])).toBeGreaterThan(0.001);
  for (const other of ["x", "y", "z"] as const) if (other !== component) expect(ui.object.quaternion[other]).toBeCloseTo(0);
});

it("does not pick disabled axes and releases the additional hit targets on cleanup", () => {
  const ui = mountGizmo();
  const start = ui.screen(ui.label("X").getWorldPosition(new Vector3()));
  Object.assign(ui.control, { showX: false }); ui.root.updateMatrixWorld(true);
  ui.pointer("pointerdown", start); ui.pointer("pointermove", { x: start.x + 30, y: start.y }); ui.pointer("pointerup", start);
  expect(ui.events("mouseDown")).toHaveLength(0);
  expect(ui.object.position.toArray()).toEqual([0, 0, 0]);
  const targets: Mesh[] = [];
  ui.control.traverse(child => { if (child instanceof Mesh && child.geometry.type === "SphereGeometry") targets.push(child); });
  expect(targets).toHaveLength(9);
  const disposals = targets.map(target => vi.spyOn(target.geometry, "dispose"));
  ui.restore();
  expect(targets.every(target => target.parent === null)).toBe(true);
  disposals.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
});
