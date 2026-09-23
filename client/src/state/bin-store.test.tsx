// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { clampFingerHoleToBin, fingerHoleSchema, parseCutoutPlacement } from "@shared/gridfinity/cutout";

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
  it("previews fill height with recoverable finger depths and commits one undoable change", () => {
    const { store, act } = mountBin();
    const hole = fingerHoleSchema.parse({ id: "fill", center: { x: 0, y: 0 }, depthMm: 30, kind: "straight" });
    act(() => store().dispatch({ type: "ADD_FINGER_HOLE", hole }));
    const steps = store().history.stack.length;
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { fillHeightPercent: 25 }, transient: true }));
    expect(store().fingerHoles[0].depthMm).toBeCloseTo(15.45, 9);
    expect(getCommittedBinDoc(store()).spec.fillHeightPercent).toBe(100);
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { fillHeightPercent: 100 }, transient: true }));
    expect(store().fingerHoles[0].depthMm).toBe(30);
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { fillHeightPercent: 50 } }));
    expect(store().history.stack).toHaveLength(steps + 1);
    expect(store().history.stack.at(-1)!.label).toBe("Change fill height");
    expect(store().fingerHoles[0].depthMm).toBeCloseTo(23.9, 9);
    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().spec.fillHeightPercent).toBe(100);
    expect(store().fingerHoles[0]).toEqual(hole);
    act(() => store().dispatch({ type: "REDO" }));
    expect(store().spec.fillHeightPercent).toBe(50);
    expect(store().fingerHoles[0].depthMm).toBeCloseTo(23.9, 9);
  });

  it("keeps a split inside one pocket across movement, duplication, base changes, undo and hydration", () => {
    const { store, act } = mountBin();
    const split = { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [
      { mode: "remaining" as const, floorThicknessMm: 7 }, { mode: "mm" as const, value: 6 },
    ] as [{ mode: "remaining"; floorThicknessMm: number }, { mode: "mm"; value: number }] };
    act(() => store().dispatch({ type: "ADD_PLACED", cutouts: [{ ...CUTOUT, split }], gridX: 3, gridY: 3 }));
    act(() => store().dispatch({ type: "UPDATE_CUTOUT", id: CUTOUT.id, patch: { position: { x: 10, y: -4 }, rotationDeg: 37, mirrored: true, scaleX: 1.4 } }));
    expect(store().cutouts[0].split).toEqual(split);
    act(() => store().dispatch({ type: "DUPLICATE_CUTOUT", id: CUTOUT.id, newId: "copy" }));
    expect(store().cutouts[1].split).toEqual(split);
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { flatBottom: true } }));
    expect(store().cutouts[0].split!.depths).toEqual([{ mode: "remaining", floorThicknessMm: 2 }, { mode: "mm", value: 6 }]);
    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().cutouts[0].split).toEqual(split);
    const doc = getCommittedBinDoc(store());
    act(() => store().dispatch({ type: "HYDRATE", ...doc }));
    expect(store().cutouts[0].split).toEqual(split);
    expect(store().canUndo).toBe(false);
  });

  it("limits added and edited finger access, and undoes each adjustment atomically", () => {
    const { store, act } = mountBin();
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 1, gridY: 1, heightUnits: 2 } }));
    const hole = fingerHoleSchema.parse({ id: "f", kind: "flat-ended-straight", center: { x: 0, y: 0 }, diameterMm: 80, lengthMm: 160, depthMm: 120 });
    act(() => store().dispatch({ type: "ADD_FINGER_HOLE", hole }));
    expect(store().fingerHoles[0]).toMatchObject({ diameterMm: 43.57, lengthMm: 43.57, depthMm: 12.8 });
    const before = store().fingerHoles[0];
    act(() => store().dispatch({ type: "UPDATE_FINGER_HOLE", id: "f", patch: { rotationDeg: 45, depthMm: 120 } }));
    expect(store().fingerHoles[0]).toEqual(clampFingerHoleToBin({ ...before, rotationDeg: 45, depthMm: 120 }, store().spec));
    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().fingerHoles[0]).toEqual(before);
  });

  it("resizes access with the bin, restores dimensions during a drag, and undoes both together", () => {
    const { store, act } = mountBin();
    const hole = fingerHoleSchema.parse({ id: "f", kind: "oblong-straight", center: { x: 0, y: 0 }, diameterMm: 60, lengthMm: 80, depthMm: 30 });
    act(() => store().dispatch({ type: "ADD_FINGER_HOLE", hole }));
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 1, gridY: 1, heightUnits: 1 }, transient: true }));
    expect(store().fingerHoles[0].depthMm).toBe(5.8);
    expect(getCommittedBinDoc(store()).fingerHoles[0]).toEqual(hole);
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 2, gridY: 2, heightUnits: 6 }, transient: true }));
    expect(store().fingerHoles[0]).toEqual(hole);
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 1, gridY: 1, heightUnits: 1 } }));
    const smallHole = store().fingerHoles[0];
    expect(smallHole.lengthMm).toBe(43.57);
    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().spec.heightUnits).toBe(6);
    expect(store().fingerHoles[0]).toEqual(hole);
    act(() => store().dispatch({ type: "REDO" }));
    expect(store().spec.heightUnits).toBe(1);
    expect(store().fingerHoles[0]).toEqual(smallHole);
  });

  it("keeps large round access through edits and hydration, and resizes it with bin width in one undo step", () => {
    const { store, act } = mountBin();
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 6, gridY: 4 } }));
    const hole = fingerHoleSchema.parse({ id: "large", kind: "deep-scoop", center: { x: 0, y: 0 }, diameterMm: 150, depthMm: 1 });
    act(() => store().dispatch({ type: "ADD_FINGER_HOLE", hole }));
    expect(store().fingerHoles[0]).toEqual(hole);
    act(() => store().dispatch({ type: "UPDATE_FINGER_HOLE", id: hole.id, patch: { diameterMm: 251.5 } }));
    expect(store().fingerHoles[0].diameterMm).toBe(251.5);
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 2 } }));
    expect(store().fingerHoles[0]).toMatchObject({ diameterMm: 83.5, depthMm: 1 });
    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().spec.gridX).toBe(6);
    expect(store().fingerHoles[0].diameterMm).toBe(251.5);
    act(() => store().dispatch({ type: "HYDRATE", ...getCommittedBinDoc(store()) }));
    expect(store().fingerHoles[0].diameterMm).toBe(251.5);
    act(() => store().dispatch({ type: "UPDATE_FINGER_HOLE", id: hole.id, patch: { kind: "oblong-deep-scoop" } }));
    expect(store().fingerHoles[0].diameterMm).toBe(80);
    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().fingerHoles[0]).toMatchObject({ kind: "deep-scoop", diameterMm: 251.5 });
  });

  it("keeps restored oversize geometry intact until a geometry edit", () => {
    const { store, act } = mountBin();
    const hole = fingerHoleSchema.parse({ id: "legacy", center: { x: 0, y: 0 }, depthMm: 120 });
    act(() => store().dispatch({ type: "HYDRATE", spec: store().spec, cutouts: [], fingerHoles: [hole] }));
    act(() => store().dispatch({ type: "UPDATE_FINGER_HOLE", id: hole.id, patch: { name: "Old access" } }));
    expect(store().fingerHoles[0].depthMm).toBe(120);
    act(() => store().dispatch({ type: "UPDATE_FINGER_HOLE", id: hole.id, patch: { depthMm: 120 } }));
    expect(store().fingerHoles[0].depthMm).toBe(40.8);
  });

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

  it("keeps finger access features independent when a tool pocket is moved or removed", () => {
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

it("uses a deeper default floor for flat bins and restores it with undo and base changes", () => {
  const { store, act } = mountBin();
  const custom = { ...CUTOUT, id: "custom", depth: { mode: "remaining" as const, floorThicknessMm: 4 } };
  const fixed = { ...CUTOUT, id: "fixed", depth: { mode: "mm" as const, value: 12 } };
  act(() => store().dispatch({ type: "ADD_PLACED", gridX: 2, gridY: 2, cutouts: [CUTOUT, custom, fixed] }));
  const original = store().cutouts;
  act(() => store().dispatch({ type: "PATCH_SPEC", patch: { flatBottom: true } }));
  expect(store().cutouts[0].depth).toEqual({ mode: "remaining", floorThicknessMm: 2 });
  expect(store().cutouts.slice(1)).toEqual([custom, fixed]);
  act(() => store().dispatch({ type: "UNDO" }));
  expect(store().spec.flatBottom).toBe(false);
  expect(store().cutouts).toEqual(original);
  act(() => store().dispatch({ type: "REDO" }));
  expect(store().cutouts[0].depth).toEqual({ mode: "remaining", floorThicknessMm: 2 });
  act(() => store().dispatch({ type: "ADD_PLACED", gridX: 2, gridY: 2, cutouts: [{ ...CUTOUT, id: "new" }] }));
  expect(store().cutouts.at(-1)!.depth).toEqual({ mode: "remaining", floorThicknessMm: 2 });
  act(() => store().dispatch({ type: "PATCH_SPEC", patch: { flatBottom: false } }));
  expect(store().cutouts[0].depth).toEqual(CUTOUT.depth);
  expect(store().cutouts.at(-1)!.depth).toEqual(CUTOUT.depth);
  expect(store().cutouts.slice(1, 3)).toEqual([custom, fixed]);
});

describe("restored project history", () => {
  it("restores the saved cursor, keeps new edits local, and preserves the retention limit", () => {
    const { store, act } = mountBin();
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 3 } }));
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridX: 4 } }));
    act(() => store().dispatch({ type: "UNDO" }));
    const saved = structuredClone(store().history);
    const current = saved.stack[saved.index].doc;
    act(() => store().dispatch({ type: "HYDRATE", ...current, history: saved }));
    expect(store().history).toEqual(saved);
    expect(store().canUndo).toBe(true);
    expect(store().canRedo).toBe(true);
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridY: 3 } }));
    expect(store().canRedo).toBe(false);
    expect(saved.stack).toHaveLength(3);
    expect(saved.index).toBe(1);
    for (let index = 0; index < 60; index++) {
      act(() => store().dispatch({ type: "PATCH_SPEC", patch: { gridY: index % 2 + 2 } }));
    }
    expect(store().history.stack).toHaveLength(50);
    expect(store().history.index).toBe(49);
  });
});

it("selects mixed objects additively, commits them atomically, and restores the whole document with one undo", () => {
  const { store, act } = mountBin();
  const hole = fingerHoleSchema.parse({ id: "f1", center: { x: 20, y: 0 }, diameterMm: 8, depthMm: 5 });
  act(() => { store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT, { ...CUTOUT, id: "c2" }], gridX: 4, gridY: 4 }); store().dispatch({ type: "ADD_FINGER_HOLE", hole }); });
  act(() => store().dispatch({ type: "SELECT_CUTOUT", id: "c1", additive: true }));
  expect(store().selection).toEqual([{ kind: "finger", id: "f1" }, { kind: "pocket", id: "c1" }]);
  const before = getCommittedBinDoc(store()), index = store().history.index;
  const edits = { cutouts: [{ ...CUTOUT, position: { x: 4, y: 9 } }], fingerHoles: [{ ...hole, center: { x: 24, y: 9 } }] };
  act(() => store().dispatch({ type: "UPDATE_OBJECTS", edits, historyLabel: "Move selection" }));
  expect(store().history.index).toBe(index + 1); expect(store().cutouts[1]).toEqual(before.cutouts[1]);
  act(() => store().dispatch({ type: "UNDO" })); expect(getCommittedBinDoc(store())).toEqual(before);
  expect(store().selection).toHaveLength(2);
  act(() => store().dispatch({ type: "REDO" })); expect(store().fingerHoles[0].center).toEqual({ x: 24, y: 9 });
  act(() => store().dispatch({ type: "SELECT_CUTOUT", id: "c1", additive: true }));
  expect(store().selection).toEqual([{ kind: "finger", id: "f1" }]); expect(store().selectedFingerHoleId).toBe("f1");
  act(() => store().dispatch({ type: "REMOVE_FINGER_HOLE", id: "f1" })); expect(store().selection).toEqual([]);
});

it("keeps selection transient, ignores missing IDs and avoids empty batch undo entries", () => {
  const { store, act } = mountBin();
  act(() => store().dispatch({ type: "ADD_PLACED", cutouts: [CUTOUT], gridX: 2, gridY: 2 }));
  const index = store().history.index;
  act(() => store().dispatch({ type: "SET_SELECTION", selection: [{ kind: "pocket", id: "c1" }, { kind: "pocket", id: "c1" }, { kind: "finger", id: "missing" }] }));
  expect(store().selection).toEqual([{ kind: "pocket", id: "c1" }]); expect(store().history.index).toBe(index);
  act(() => store().dispatch({ type: "UPDATE_OBJECTS", edits: { cutouts: [], fingerHoles: [] }, historyLabel: "No change" }));
  expect(store().history.index).toBe(index);
  act(() => store().dispatch({ type: "HYDRATE", ...getCommittedBinDoc(store()) })); expect(store().selection).toEqual([]);
});

describe("linked design transactions", () => {
  function setup() {
    const test = mountBin();
    test.act(() => test.store().dispatch({ type: "ADD_PLACED", cutouts: [
      { ...CUTOUT, name: "First", position: { x: -15, y: 0 } },
      { ...CUTOUT, id: "c2", name: "Second", position: { x: 15, y: 0 }, scaleX: 2, rotationDeg: 90 },
      { ...CUTOUT, id: "c3", name: "Unlinked" },
    ], gridX: 3, gridY: 3 }));
    return test;
  }
  it("links existing pockets from the chosen source, with one reversible step", () => {
    const { store, act } = setup(), old = getCommittedBinDoc(store()), index = store().history.index;
    act(() => store().dispatch({ type: "LINK_DESIGNS", kind: "pocket", ids: ["c1", "c2"], sourceId: "c2", linkId: "g", tilt: false }));
    expect(store().history.index).toBe(index + 1);
    expect(store().cutouts.slice(0, 2).map(c => c.scaleX)).toEqual([2, 2]);
    expect(store().cutouts.map(c => c.name)).toEqual(["First", "Second", "Unlinked"]);
    expect(store().cutouts[0].position).toEqual({ x: -15, y: 0 });
    expect(store().cutouts[1].rotationDeg).toBe(90);
    const linked = getCommittedBinDoc(store());
    act(() => store().dispatch({ type: "UNDO" })); expect(getCommittedBinDoc(store())).toEqual(old);
    act(() => store().dispatch({ type: "REDO" })); expect(getCommittedBinDoc(store())).toEqual(linked);
  });
  it("propagates edits from either member and stores one final snapshot for a transient gesture", () => {
    const { store, act } = setup();
    act(() => store().dispatch({ type: "LINK_DESIGNS", kind: "pocket", ids: ["c1", "c2"], sourceId: "c1", linkId: "g", tilt: false }));
    const index = store().history.index;
    act(() => store().dispatch({ type: "UPDATE_CUTOUT", id: "c2", patch: { scaleX: 1.5, position: { x: 25, y: 0 } }, transient: true }));
    expect(store().cutouts.slice(0, 2).map(c => c.scaleX)).toEqual([1.5, 1.5]);
    expect(store().cutouts[0].position.x).toBe(-15); expect(store().history.index).toBe(index);
    act(() => store().dispatch({ type: "UPDATE_CUTOUT", id: "c2", patch: { scaleX: 1.5 } }));
    expect(store().history.index).toBe(index + 1);
    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().cutouts.slice(0, 2).map(c => c.scaleX)).toEqual([1, 1]);
  });
  it("duplicates linked or independent, unlinks without changing geometry, and survives source deletion", () => {
    const { store, act } = setup();
    act(() => store().dispatch({ type: "DUPLICATE_LINKED", kind: "pocket", id: "c1", newId: "linked", linkId: "g" }));
    act(() => store().dispatch({ type: "DUPLICATE_CUTOUT", id: "c1", newId: "ordinary" }));
    expect(store().cutouts.find(c => c.id === "ordinary")!.designLink).toBeUndefined();
    act(() => store().dispatch({ type: "REMOVE_CUTOUT", id: "c1" }));
    act(() => store().dispatch({ type: "UPDATE_CUTOUT", id: "linked", patch: { clearanceMm: 0.75 } }));
    const linked = store().cutouts.find(c => c.id === "linked")!;
    expect(linked.clearanceMm).toBe(0.75);
    act(() => store().dispatch({ type: "UNLINK_DESIGNS", kind: "pocket", ids: ["linked"] }));
    expect(store().cutouts.find(c => c.id === "linked")).toEqual({ ...linked, designLink: undefined });
    act(() => store().dispatch({ type: "UNDO" })); expect(store().cutouts.find(c => c.id === "linked")).toEqual(linked);
  });
  it("supports opt-in tilt while names, Z heading and XY placement stay local", () => {
    const { store, act } = setup();
    act(() => store().dispatch({ type: "LINK_DESIGNS", kind: "pocket", ids: ["c1", "c2"], sourceId: "c1", linkId: "g", tilt: false }));
    act(() => store().dispatch({ type: "UPDATE_CUTOUT", id: "c1", patch: { tilt: { xDeg: 10, yDeg: 20 }, name: "A", rotationDeg: 45 } }));
    expect(store().cutouts[1].tilt).toBeUndefined();
    act(() => store().dispatch({ type: "SET_LINKED_TILT", id: "c1", enabled: true }));
    expect(store().cutouts[1].tilt).toEqual({ xDeg: 10, yDeg: 20 });
    expect(store().cutouts[1]).toMatchObject({ name: "Second", rotationDeg: 90 });
    act(() => store().dispatch({ type: "SET_LINKED_TILT", id: "c1", enabled: false }));
    act(() => store().dispatch({ type: "UPDATE_CUTOUT", id: "c1", patch: { tilt: { xDeg: 0, yDeg: 0 } } }));
    expect(store().cutouts[1].tilt).toEqual({ xDeg: 10, yDeg: 20 });
  });
  it("keeps linked thumb designs identical through size, bottom and bin-height edits", () => {
    const { store, act } = setup();
    const hole = fingerHoleSchema.parse({ id: "f1", center: { x: -10, y: 0 }, kind: "oblong-straight", diameterMm: 20, lengthMm: 50, depthMm: 30 });
    act(() => store().dispatch({ type: "ADD_FINGER_HOLE", hole }));
    act(() => store().dispatch({ type: "DUPLICATE_LINKED", kind: "finger", id: "f1", newId: "f2", linkId: "fg" }));
    act(() => store().dispatch({ type: "UPDATE_FINGER_HOLE", id: "f2", patch: { kind: "oblong-deep-scoop", diameterMm: 30 } }));
    expect(store().fingerHoles.every(h => h.kind === "oblong-deep-scoop" && h.diameterMm === 30)).toBe(true);
    act(() => store().dispatch({ type: "PATCH_SPEC", patch: { heightUnits: 2 } }));
    expect(store().fingerHoles.map(h => h.depthMm)).toEqual([12.8, 12.8]);
    act(() => store().dispatch({ type: "UNDO" }));
    expect(store().fingerHoles.map(h => h.depthMm)).toEqual([30, 30]);
  });
  it("propagates batch depth edits once and rejects conflicting design edits without changing history", () => {
    const { store, act } = setup();
    act(() => store().dispatch({ type: "LINK_DESIGNS", kind: "pocket", ids: ["c1", "c2"], sourceId: "c1", linkId: "g", tilt: false }));
    const index = store().history.index;
    act(() => store().dispatch({ type: "UPDATE_OBJECTS", edits: { cutouts: store().cutouts.slice(0, 2).map(c => ({ ...c, depth: { mode: "mm", value: 15 } })), fingerHoles: [] }, historyLabel: "Move Z" }));
    expect(store().history.index).toBe(index + 1);
    expect(store().cutouts.slice(0, 2).map(c => c.depth)).toEqual([{ mode: "mm", value: 15 }, { mode: "mm", value: 15 }]);
    const committed = getCommittedBinDoc(store());
    act(() => store().dispatch({ type: "UPDATE_OBJECTS", edits: { cutouts: store().cutouts.slice(0, 2).map((c, i) => ({ ...c, scaleX: i + 2 })), fingerHoles: [] }, historyLabel: "Conflict" }));
    expect(getCommittedBinDoc(store())).toBe(committed); expect(store().editError).toContain("different design changes");
  });
});
