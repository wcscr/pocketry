// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { BufferGeometry, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, Sprite, Vector3 } from "three";
import { styleTransformGizmo } from "./transform-gizmo-style";

afterEach(() => vi.restoreAllMocks());

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
