// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { BufferGeometry } from "three";
import { afterEach, expect, it, vi } from "vitest";
import type { MeshData } from "@/lib/mesh/mesh-data";

const rendered = vi.hoisted(() => ({ line: vi.fn() }));
vi.mock("@react-three/drei", () => ({ Line: (props: unknown) => { rendered.line(props); return null; }, TransformControls: () => null }));
import { ObjectSolidOutline } from "./pocket-transform-scene";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("batches the visible edges and releases preview geometry on replacement and unmount", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The R3F host elements are inert in jsdom; this tests the React lifetime.
  vi.spyOn(console, "error").mockImplementation(() => {});
  const disposed: BufferGeometry[] = [];
  const dispose = BufferGeometry.prototype.dispose;
  vi.spyOn(BufferGeometry.prototype, "dispose").mockImplementation(function (this: BufferGeometry) {
    disposed.push(this); dispose.call(this);
  });
  const mesh: MeshData = { positions:new Float32Array([0,0,0, 8,0,0, 0,6,0, 0,0,10]),
    indices:new Uint32Array([0,2,1, 0,1,3, 0,3,2, 1,2,3]), normals:null };
  const container = document.createElement("div"), root = createRoot(container);
  try {
    React.act(() => root.render(<ObjectSolidOutline mesh={mesh} />));
    expect(container.querySelectorAll("mesh")).toHaveLength(1);
    expect(container.querySelector("meshbasicmaterial")?.getAttribute("opacity")).toBe("0.08");
    expect(rendered.line).toHaveBeenLastCalledWith(expect.objectContaining({segments:true,points:expect.any(Array)}));
    expect(rendered.line.mock.lastCall![0].points).toHaveLength(12);
    // Edge extraction disposes its two temporary geometries immediately.
    expect(disposed).toHaveLength(2);
    React.act(() => root.render(<ObjectSolidOutline mesh={{...mesh}} />));
    expect(disposed).toHaveLength(5);
  } finally {
    React.act(() => root.unmount());
  }
  expect(disposed).toHaveLength(6);
  expect(new Set(disposed).size).toBe(6);
});
