// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { TracedShape } from "@shared/gridfinity/cutout";

import { ShapeLibraryProvider, useShapeLibrary, type ShapeLibrary } from "./shape-library";

function makeShape(id: string): TracedShape {
  return {
    id,
    name: id,
    outlineMm: [
      {
        outer: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        holes: [],
      },
    ],
    bboxMm: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    pointCount: 3,
    sourceMmPerPx: 0.5,
  };
}

/** Mounts the provider and returns a live handle to the hook's value. */
function mountLibrary(): { library: () => ShapeLibrary; act: (fn: () => void) => void } {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let latest: ShapeLibrary | null = null;

  function Probe() {
    latest = useShapeLibrary();
    return null;
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  React.act(() =>
    root.render(
      <ShapeLibraryProvider>
        <Probe />
      </ShapeLibraryProvider>,
    ),
  );

  return {
    library: () => {
      if (!latest) throw new Error("probe never rendered");
      return latest;
    },
    act: (fn) => React.act(fn),
  };
}

describe("shape library", () => {
  it("adds shapes and marks them pending", () => {
    const { library, act } = mountLibrary();
    act(() => library().addShape(makeShape("a")));
    act(() => library().addShape(makeShape("b")));

    expect(library().shapes.map((s) => s.id)).toEqual(["a", "b"]);
    expect(library().pendingIds).toEqual(["a", "b"]);
  });

  it("stores contour revisions without auto-placing them", () => {
    const { library, act } = mountLibrary();
    act(() => library().storeShape(makeShape("edited")));

    expect(library().shapes.map((shape) => shape.id)).toEqual(["edited"]);
    expect(library().pendingIds).toEqual([]);
  });

  it("consumePending returns and clears exactly once", () => {
    const { library, act } = mountLibrary();
    act(() => library().addShape(makeShape("a")));

    let consumed: string[] = [];
    act(() => {
      consumed = library().consumePending();
    });
    expect(consumed).toEqual(["a"]);
    expect(library().pendingIds).toEqual([]);
    act(() => {
      consumed = library().consumePending();
    });
    expect(consumed).toEqual([]);
  });

  it("removing a shape clears its pending mark", () => {
    const { library, act } = mountLibrary();
    act(() => library().addShape(makeShape("a")));
    act(() => library().removeShape("a"));
    expect(library().shapes).toEqual([]);
    expect(library().pendingIds).toEqual([]);
  });

  it("replaceShapes hydrates without marking pending", () => {
    const { library, act } = mountLibrary();
    act(() => library().replaceShapes([makeShape("restored")]));
    expect(library().shapes.map((s) => s.id)).toEqual(["restored"]);
    expect(library().pendingIds).toEqual([]);
  });
});
