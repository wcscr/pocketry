// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { parseCutoutPlacement } from "@shared/gridfinity/cutout";

import {
  BinProvider,
  getCommittedBinDoc,
  useBin,
  type BinStore,
} from "./bin-store";

function mountBin(): { store: () => BinStore; act: (fn: () => void) => void } {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let latest: BinStore | null = null;

  function Probe() {
    latest = useBin();
    return null;
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  React.act(() =>
    root.render(
      <BinProvider>
        <Probe />
      </BinProvider>,
    ),
  );
  return {
    store: () => {
      if (!latest) throw new Error("probe never rendered");
      return latest;
    },
    act: (fn) => React.act(fn),
  };
}

const CUTOUT = parseCutoutPlacement({
  id: "c1",
  shapeId: "s1",
  position: { x: 0, y: 0 },
});

describe("bin store", () => {
  it("starts solid (the pocket workflow default) and unhydrated", () => {
    const { store } = mountBin();
    expect(store().spec.fill).toBe("solid");
    expect(store().hydrated).toBe(false);
    expect(store().viewMode).toBe("3d");
    expect(store().editorMode).toBe("placement");
  });

  it("keeps contour editing transient and exits it when returning to 3D", () => {
    const { store, act } = mountBin();
    act(() => store().dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" }));
    act(() =>
      store().dispatch({ type: "SET_EDITOR_MODE", editorMode: "contour" }),
    );
    expect(store().editorMode).toBe("contour");
    expect(store().canUndo).toBe(false);

    act(() => store().dispatch({ type: "SET_VIEW_MODE", viewMode: "3d" }));
    expect(store().editorMode).toBe("placement");
  });

  it("ADD_PLACED appends cutouts, resizes the grid, selects the newest", () => {
    const { store, act } = mountBin();
    act(() =>
      store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT], gridX: 3, gridY: 2 }),
    );
    expect(store().cutouts).toHaveLength(1);
    expect(store().spec.gridX).toBe(3);
    expect(store().spec.gridY).toBe(2);
    expect(store().selectedCutoutId).toBe("c1");
  });

  it("UPDATE_CUTOUT patches without changing identity", () => {
    const { store, act } = mountBin();
    act(() =>
      store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT], gridX: 2, gridY: 2 }),
    );
    act(() =>
      store().dispatch({
        type: "UPDATE_CUTOUT",
        id: "c1",
        patch: { rotationDeg: 90, id: "evil" } as never,
      }),
    );
    expect(store().cutouts[0].id).toBe("c1");
    expect(store().cutouts[0].rotationDeg).toBe(90);
  });

  it("requests confirmation before removal and clears a matching selection", () => {
    const { store, act } = mountBin();
    act(() =>
      store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT], gridX: 2, gridY: 2 }),
    );
    act(() => store().dispatch({ type: "REQUEST_REMOVE_CUTOUT", id: "c1" }));
    expect(store().cutouts).toHaveLength(1);
    expect(store().pendingRemovalId).toBe("c1");

    act(() => store().dispatch({ type: "CANCEL_REMOVE_CUTOUT" }));
    expect(store().pendingRemovalId).toBeNull();

    act(() => store().dispatch({ type: "REQUEST_REMOVE_CUTOUT", id: "c1" }));
    act(() => store().dispatch({ type: "REMOVE_CUTOUT", id: "c1" }));
    expect(store().cutouts).toEqual([]);
    expect(store().selectedCutoutId).toBeNull();
    expect(store().pendingRemovalId).toBeNull();
  });

  it("HYDRATE restores spec and cutouts, clears stale selection, and marks hydrated", () => {
    const { store, act } = mountBin();
    act(() =>
      store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT], gridX: 2, gridY: 2 }),
    );
    expect(store().selectedCutoutId).toBe("c1");
    act(() =>
      store().dispatch({
        type: "HYDRATE",
        spec: { ...store().spec, gridX: 4 },
        cutouts: [CUTOUT],
        fingerHoles: [],
      }),
    );
    expect(store().hydrated).toBe(true);
    expect(store().spec.gridX).toBe(4);
    expect(store().cutouts).toHaveLength(1);
    expect(store().selectedCutoutId).toBeNull();
    expect(store().editorMode).toBe("placement");
  });

  it("PATCH_SPEC revalidates through the schema", () => {
    const { store, act } = mountBin();
    expect(() =>
      act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 99 } })),
    ).toThrow();
  });

  it("stores a custom footprint in history and resets it on rectangular resize", () => {
    const { store, act } = mountBin();
    act(() => store().dispatch({
      type: "PATCH_SPEC",
      patch: {
        footprint: {
          kind: "custom",
          cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
        },
      },
      historyLabel: "Remove footprint cell",
    }));
    expect(store().spec.footprint.kind).toBe("custom");
    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().spec.footprint).toEqual({ kind: "rectangle" });
    act(() => store().dispatch({ type: "REDO" }));
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 3 } }));
    expect(store().spec.footprint).toEqual({ kind: "rectangle" });
  });
});

describe("bin store history (G4 undo/redo)", () => {
  it("keeps named entries and can jump directly between them", () => {
    const { store, act } = mountBin();
    act(() =>
      store().dispatch({
        type: "ADD_PLACED",
        cutouts: [CUTOUT],
        gridX: 2,
        gridY: 2,
      }),
    );
    act(() =>
      store().dispatch({
        type: "UPDATE_CUTOUT",
        id: "c1",
        patch: { shapeId: "s2" },
        historyLabel: "Add contour node",
      }),
    );
    act(() =>
      store().dispatch({
        type: "UPDATE_CUTOUT",
        id: "c1",
        patch: { shapeId: "s3" },
        historyLabel: "Move contour node",
      }),
    );

    expect(store().history.stack.map((entry) => entry.label)).toEqual([
      "Start",
      "Add tool pocket",
      "Add contour node",
      "Move contour node",
    ]);
    act(() => store().dispatch({ type: "JUMP_TO_HISTORY", index: 1 }));
    expect(store().cutouts[0].shapeId).toBe("s1");
    expect(store().canRedo).toBe(true);
    act(() => store().dispatch({ type: "REDO" }));
    expect(store().cutouts[0].shapeId).toBe("s2");
  });

  it("undoes and redoes material changes in order", () => {
    const { store, act } = mountBin();
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 3 } }));
    act(() =>
      store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT], gridX: 3, gridY: 2 }),
    );
    expect(store().canUndo).toBe(true);
    expect(store().canRedo).toBe(false);

    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().cutouts).toHaveLength(0);
    expect(store().spec.gridX).toBe(3);

    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().spec.gridX).toBe(2);
    expect(store().canUndo).toBe(false);

    act(() => store().dispatch({ type: "REDO" }));
    act(() => store().dispatch({ type: "REDO" }));
    expect(store().cutouts).toHaveLength(1);
    expect(store().spec.gridX).toBe(3);
    expect(store().canRedo).toBe(false);
  });

  it("collapses a transient drag into one undo step", () => {
    const { store, act } = mountBin();
    act(() =>
      store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT], gridX: 2, gridY: 2 }),
    );
    // Drag frames: transient moves, no history.
    for (const x of [1, 2, 3, 4]) {
      act(() =>
        store().dispatch({
          type: "UPDATE_CUTOUT",
          id: "c1",
          patch: { position: { x, y: 0 } },
          transient: true,
        }),
      );
    }
    expect(store().cutouts[0].position.x).toBe(4);
    expect(getCommittedBinDoc(store()).cutouts[0].position.x).toBe(0);
    // Release commits once.
    act(() =>
      store().dispatch({
        type: "UPDATE_CUTOUT",
        id: "c1",
        patch: { position: { x: 5, y: 0 } },
      }),
    );
    expect(getCommittedBinDoc(store()).cutouts[0].position.x).toBe(5);

    act(() => store().dispatch({ type: "UNDO" }));
    // One undo returns to the pre-drag position, not to a mid-drag frame.
    expect(store().cutouts[0].position.x).toBe(0);
  });

  it("keeps the geometry document unchanged until a size slider is released", () => {
    const { store, act } = mountBin();
    act(() =>
      store().dispatch({
        type: "PATCH_SPEC",
        patch: { gridX: 5 },
        transient: true,
      }),
    );

    expect(store().spec.gridX).toBe(5);
    expect(getCommittedBinDoc(store()).spec.gridX).toBe(2);

    act(() =>
      store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 5 } }),
    );
    expect(getCommittedBinDoc(store()).spec.gridX).toBe(5);
  });

  it("a new commit after undo cuts the redo tail", () => {
    const { store, act } = mountBin();
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 3 } }));
    act(() => store().dispatch({ type: "UNDO" }));
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridY: 4 } }));
    expect(store().canRedo).toBe(false);
    expect(store().spec.gridX).toBe(2);
    expect(store().spec.gridY).toBe(4);
  });

  it("hydration resets the baseline so undo cannot reach the default doc", () => {
    const { store, act } = mountBin();
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 5 } }));
    act(() =>
      store().dispatch({
        type: "HYDRATE",
        spec: store().spec,
        cutouts: [CUTOUT],
        fingerHoles: [],
      }),
    );
    expect(store().canUndo).toBe(false);
    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().cutouts).toHaveLength(1);
  });

  it("keeps finger holes independent when a tool pocket is moved or removed", () => {
    const { store, act } = mountBin();
    act(() =>
      store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT], gridX: 2, gridY: 2 }),
    );
    act(() =>
      store().dispatch({
        type: "ADD_FINGER_HOLE",
        hole: {
          id: "f1",
          center: { x: 7, y: -3 },
          diameterMm: 18,
          depthMm: 12,
          kind: "scoop",
          topFilletMm: 0,
          bottomFilletMm: 0,
        },
      }),
    );
    act(() =>
      store().dispatch({
        type: "UPDATE_CUTOUT",
        id: "c1",
        patch: { position: { x: 20, y: 10 } },
      }),
    );
    expect(store().fingerHoles[0].center).toEqual({ x: 7, y: -3 });
    act(() => store().dispatch({ type: "REMOVE_CUTOUT", id: "c1" }));
    expect(store().cutouts).toEqual([]);
    expect(store().fingerHoles).toHaveLength(1);
    expect(store().selectedFingerHoleId).toBe("f1");
  });

  it("duplicate copies everything but identity and offsets the twin", () => {
    const { store, act } = mountBin();
    const featured = parseCutoutPlacement({
      id: "c1",
      shapeId: "s1",
      position: { x: 0, y: 0 },
      fingerHoles: [{ id: "f1", center: { x: 3, y: 0 } }],
      scoop: { center: { x: -3, y: 0 } },
    });
    act(() =>
      store().dispatch({ type: "ADD_PLACED", cutouts: [featured], gridX: 2, gridY: 2 }),
    );
    act(() => store().dispatch({ type: "DUPLICATE_CUTOUT", id: "c1", newId: "c2" }));

    expect(store().cutouts).toHaveLength(2);
    const twin = store().cutouts[1];
    expect(twin.id).toBe("c2");
    expect(twin.fingerHoles).toHaveLength(2);
    expect(twin.fingerHoles.some((hole) => hole.kind === "scoop")).toBe(true);
    expect(twin.position).toEqual({ x: 10, y: -10 });
    expect(store().selectedCutoutId).toBe("c2");

    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().cutouts).toHaveLength(1);
    // Selection of the vanished twin is dropped, not left dangling.
    expect(store().selectedCutoutId).toBeNull();
  });

  it("replace-layout (auto-arrange) is a single undoable step", () => {
    const { store, act } = mountBin();
    act(() =>
      store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT], gridX: 2, gridY: 2 }),
    );
    const rearranged = [{ ...CUTOUT, rotationDeg: 45, position: { x: 9, y: 9 } }];
    act(() =>
      store().dispatch({ type: "REPLACE_LAYOUT", cutouts: rearranged, gridX: 1, gridY: 1 }),
    );
    expect(store().spec.gridX).toBe(1);
    expect(store().cutouts[0].rotationDeg).toBe(45);
    expect(store().pendingRemovalId).toBeNull();

    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().spec.gridX).toBe(2);
    expect(store().cutouts[0].rotationDeg).toBe(0);
  });

  it("replaces a normalized footprint, shifted pockets, and label anchor atomically", () => {
    const { store, act } = mountBin();
    act(() =>
      store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT], gridX: 2, gridY: 2 }),
    );
    const shifted = [{ ...CUTOUT, position: { x: 21, y: 0 } }];
    act(() =>
      store().dispatch({
        type: "REPLACE_LAYOUT",
        cutouts: shifted,
        gridX: 3,
        gridY: 2,
        footprint: {
          kind: "custom",
          cells: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 1 },
          ],
        },
        specPatch: {
          labelTab: {
            wall: "north",
            edge: { cell: { x: 1, y: 1 }, side: "north" },
            width: "full",
          },
        },
        historyLabel: "Add footprint cell",
      }),
    );

    expect(store().spec.gridX).toBe(3);
    expect(store().spec.footprint.kind).toBe("custom");
    expect(store().spec.labelTab?.edge).toEqual({
      cell: { x: 1, y: 1 },
      side: "north",
    });
    expect(store().cutouts[0].position).toEqual({ x: 21, y: 0 });

    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().spec.gridX).toBe(2);
    expect(store().spec.labelTab).toBeNull();
    expect(store().cutouts[0].position).toEqual({ x: 0, y: 0 });
  });
});
