import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { BufferGeometry, Float32BufferAttribute, Mesh, PlaneGeometry, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { SurfaceTextMesh } from "./surface-text-mesh";

const label = surfaceTextSchema.parse({ id: "label", name: "Socket label", text: "METRIC", position: { x: 0, y: 0 } });
describe("3D surface-text selection", () => {
  it("raycasts the empty space between glyphs through an invisible full-label rectangle", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([-5, -2, 4, -3, 2, 4, 3, -2, 4, 5, 2, 4], 3));
    const tree = SurfaceTextMesh({ label, geometry, color: "#000000", selected: false, onSelect: vi.fn() });
    const hit = React.Children.toArray(tree.props.children).find(child => React.isValidElement<{ name?: string }>(child) && child.props.name === "surface-text-hit-area") as React.ReactElement<{ position: [number, number, number]; children: React.ReactElement[] }>;
    expect(hit).toBeDefined();
    const plane = new Mesh(new PlaneGeometry(...hit.props.children[0].props.args), new MeshBasicMaterial());
    plane.position.set(...hit.props.position); plane.updateMatrixWorld();
    const ray = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    expect(ray.intersectObject(plane)).toHaveLength(2);
    expect(hit.props.children[1].props).toMatchObject({ opacity: 0, depthWrite: false, colorWrite: false });
    const disabled = SurfaceTextMesh({ label, geometry, color: "#000000", selected: false });
    expect(React.Children.toArray(disabled.props.children)).toHaveLength(1);
    plane.geometry.dispose(); plane.material.dispose(); geometry.dispose();
  });

  it("shades text without changing its printable geometry", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const tree = SurfaceTextMesh({ label, geometry, color: "#000000", selected: false });
    const mesh = React.Children.toArray(tree.props.children)[0] as React.ReactElement<{
      geometry: BufferGeometry; children: React.ReactElement<{ flatShading: boolean }>;
    }>;
    expect(mesh.props.geometry).toBe(geometry);
    expect(mesh.props.children.props.flatShading).toBe(true);
    geometry.dispose();
  });

  it.each([
    { enabled: true, button: 0, delta: 0, selects: true },
    { enabled: true, button: 0, delta: 3, selects: true },
    { enabled: true, button: 0, delta: 12, selects: false },
    { enabled: true, button: 2, delta: 0, selects: false },
    { enabled: false, button: 0, delta: 0, selects: false },
  ])("selects only editable clicks and leaves camera gestures alone: %o", ({ enabled, button, delta, selects }) => {
    const onSelect = vi.fn();
    const stopPropagation = vi.fn();
    const geometry = new BufferGeometry();
    const mesh = SurfaceTextMesh({ label, geometry, color: "#111111", selected: false, onSelect: enabled ? onSelect : undefined });
    mesh.props.onClick({ button, delta, stopPropagation });
    expect(onSelect.mock.calls).toEqual(selects ? [[label.id]] : []);
    expect(stopPropagation).toHaveBeenCalledTimes(selects ? 1 : 0);
    expect(mesh.props.name).toBe("Text: Socket label");
    geometry.dispose();
  });
});
