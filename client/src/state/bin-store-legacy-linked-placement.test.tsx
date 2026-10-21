import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { BinProvider, useBin, getCommittedBinDoc, type BinAction, type BinStore } from "./bin-store";
import { parseBinSpec } from "@shared/gridfinity/types";
import { type CutoutPlacement } from "@shared/gridfinity/cutout";
import { designLinkErrors } from "@shared/gridfinity/design-links";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { resetPocketPlane, rigidPocket, rigidPocketVertices } from "@shared/gridfinity/rigid-pocket";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { arrangeObjects, createPlacementGroup, transformObjects, type ObjectEdits } from "@/lib/gridfinity/object-arrangement";
import { objectTransformOffsets, setObjectTransformOffsets } from "@/lib/gridfinity/object-transform-offsets";
import { pocketTransformWires } from "@/lib/gridfinity/pocket-transform";

const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 8 });
const basic = createBasicPocket("rectangle", { x: -4, y: -7 }, { x: 4, y: 7 }, "tool")!;
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });

const depthCases: { name: string; patch: Partial<CutoutPlacement> }[] = [
  { name: "fixed depth", patch: { depth: { mode: "mm", value: 10 } } },
  { name: "remaining floor", patch: { depth: { mode: "remaining", floorThicknessMm: 8 } } },
  { name: "through", patch: { depth: { mode: "through" } } },
  { name: "split depth", patch: { depth: { mode: "mm", value: 10 }, split: {
    boundary: [{ x: -4, y: 0 }, { x: 4, y: 0 }],
    depths: [{ mode: "mm", value: 10 }, { mode: "remaining", floorThicknessMm: 8 }],
  } } },
];
function legacyCutouts(patch: Partial<CutoutPlacement>): CutoutPlacement[] {
  return [-15, 15].map((x, i) => ({ ...basic.cutout, ...patch, id: `p${i}`, position: { x, y: i * 6 },
    clearanceMm: 0, rotationDeg: i * 25, tilt: { xDeg: 20, yDeg: -10 }, zOffsetMm: 2 + i,
    designLink: { id: "link", tilt: false } }));
}
function mount(cutouts: CutoutPlacement[]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let state!: BinStore;
  function Probe() { state = useBin(); return null; }
  React.act(() => root.render(<BinProvider><Probe /></BinProvider>));
  cleanup.push(() => React.act(() => root.unmount()));
  const send = (action: BinAction) => React.act(() => state.dispatch(action));
  send({ type: "SET_EDITING_CAPABILITY", enabled: true });
  send({ type: "HYDRATE", spec, cutouts });
  const objects = () => state.cutouts.map(cutout => ({ kind: "pocket" as const, cutout, shape: basic.shape }));
  const save = () => parseProjectDoc(JSON.parse(JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION,
    ...getCommittedBinDoc(state), shapes: [basic.shape], history: state.history, transformOrigins: state.transformOrigins })));
  return { state: () => state, send, objects, save };
}

const operations = ["Move X field", "Move Z field", "rotate", "align", "measurement tilt", "reset plane"] as const;
for (const { name, patch } of depthCases) {
  it.each(operations)(`keeps legacy linked ${name} and undo history valid after %s`, operation => {
    const ui = mount(legacyCutouts(patch)), before = getCommittedBinDoc(ui.state());
    const all = ui.objects(), source = all[0], peer = before.cutouts[1];
    expect(ui.save()).not.toBeNull();
    let edits: ObjectEdits | null;
    switch (operation) {
      case "Move X field":
      case "Move Z field":
        edits = setObjectTransformOffsets([source], spec, ui.state().transformOrigins, "translate",
          operation === "Move X field" ? [1, undefined, undefined] : [undefined, undefined, 1], "individual", all, [basic.shape]);
        break;
      case "rotate":
        edits = transformObjects([source], spec, new Vector3(), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4), "individual", all);
        break;
      case "align":
        edits = arrangeObjects(all, "y", "center", "active");
        break;
      case "measurement tilt":
        edits = { cutouts: [{ ...rigidPocket(source.cutout, basic.shape, spec), tilt: { xDeg: 30, yDeg: -10 } }], fingerHoles: [], placementOnly: true };
        break;
      case "reset plane":
        edits = { cutouts: [resetPocketPlane(source.cutout, basic.shape, spec)], fingerHoles: [], placementOnly: true };
        break;
    }
    expect(edits).not.toBeNull();
    ui.send({ type: "UPDATE_OBJECTS", edits: edits!, historyLabel: operation });
    expect(ui.state().editError).toBeNull();
    expect(ui.state().history.index).toBe(1);
    expect(ui.state().cutouts[1]).toEqual(peer);
    expect(designLinkErrors(ui.state())).toEqual([]);
    const after = getCommittedBinDoc(ui.state());
    const saved = ui.save();
    expect(saved).not.toBeNull();
    ui.send({ type: "HYDRATE", ...saved! });
    ui.send({ type: "UNDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(before);
    ui.send({ type: "REDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(after);
    expect(ui.save()).not.toBeNull();
    if (operation === "Move X field") {
      const originalWires = pocketTransformWires(source, spec).flat();
      const movedWires = pocketTransformWires({ ...source, cutout: after.cutouts[0] }, spec).flat();
      movedWires.forEach((point, i) => point.forEach((value, axis) =>
        expect(value).toBeCloseTo(originalWires[i][axis] + (axis === 0 ? 1 : 0), 7)));
    }
    if (operation === "Move Z field") {
      const vertices = (cutout: CutoutPlacement) => rigidPocketVertices(basic.shape.outlineMm, rigidPocket(cutout, basic.shape, spec));
      const originalVertices = vertices(source.cutout);
      vertices(after.cutouts[0]).forEach((point, i) => {
        expect(point.x).toBeCloseTo(originalVertices[i].x, 7);
        expect(point.y).toBeCloseTo(originalVertices[i].y, 7);
        expect(point.z).toBeCloseTo(originalVertices[i].z + 1, 7);
      });
    }
  });

  it(`keeps an outside linked ${name} copy unchanged during group movement and rotation`, () => {
    const linked = legacyCutouts(patch);
    const ui = mount([...linked, { ...linked[0], id: "independent", designLink: undefined, position: { x: 0, y: 25 } }]);
    ui.send({ type: "SET_SELECTION", selection: [{ kind: "pocket", id: "p0" }, { kind: "pocket", id: "independent" }] });
    const selected = () => ui.objects().filter(o => o.cutout.id !== "p1");
    ui.send({ type: "GROUP_SELECTION", group: createPlacementGroup(selected(), spec, "group") });
    const before = getCommittedBinDoc(ui.state()), frame = before.cutouts[0].placementGroup!;
    const delta = new Vector3(2, -3, 1), rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4);
    const source = rigidPocket(before.cutouts[0], basic.shape, spec);
    const originalVertices = rigidPocketVertices(basic.shape.outlineMm, source);
    const edits = transformObjects(selected(), spec, delta, rotation, "individual", ui.objects());
    expect(edits).not.toBeNull();
    ui.send({ type: "UPDATE_OBJECTS", edits: edits!, historyLabel: "Move and rotate group" });
    expect(ui.state().editError).toBeNull();
    expect(ui.state().cutouts[1]).toEqual(before.cutouts[1]);
    expect(designLinkErrors(ui.state())).toEqual([]);
    const pivot = new Vector3(frame.pivot.x, frame.pivot.y, frame.pivot.z);
    rigidPocketVertices(basic.shape.outlineMm, ui.state().cutouts[0]).forEach((point, i) => {
      const original = originalVertices[i];
      const expected = new Vector3(original.x, original.y, original.z).sub(pivot).applyQuaternion(rotation).add(pivot).add(delta);
      expect(point.x).toBeCloseTo(expected.x, 5); expect(point.y).toBeCloseTo(expected.y, 5); expect(point.z).toBeCloseTo(expected.z, 5);
    });
    const after = getCommittedBinDoc(ui.state()), saved = ui.save();
    expect(saved).not.toBeNull();
    ui.send({ type: "HYDRATE", ...saved! });
    ui.send({ type: "UNDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(before);
    ui.send({ type: "REDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(after);
  });
}

it("rejects a placement command that rewrites shared depth before preview or history can become invalid", () => {
  const ui = mount(legacyCutouts(depthCases[0].patch));
  const before = getCommittedBinDoc(ui.state()), history = ui.state().history;
  const edits: ObjectEdits = { cutouts: [{ ...before.cutouts[0], depth: { mode: "mm", value: 8 }, zOffsetMm: undefined }], fingerHoles: [], placementOnly: true };
  for (const transient of [true, false]) {
    ui.send({ type: "UPDATE_OBJECTS", edits, transient, historyLabel: "Invalid legacy conversion" });
    expect(ui.state().cutouts).toEqual(before.cutouts);
    expect(ui.state().history).toBe(history);
    expect(ui.state().editError).toBeTruthy();
    expect(ui.save()).not.toBeNull();
  }
});

it("measures linked legacy offsets from the same anchor when the saved origin predates linking", () => {
  const linked = legacyCutouts(depthCases[0].patch);
  const ui = mount(linked);
  const origins = { pockets: linked.map(cutout => ({ cutout: { ...cutout, designLink: undefined }, spec })), fingerHoles: [] };
  ui.send({ type: "HYDRATE", spec, cutouts: linked, transformOrigins: origins });
  const all = ui.objects();
  expect(objectTransformOffsets(all[0], spec, origins, "translate", [basic.shape])).toEqual([0, 0, 0]);
  const edits = setObjectTransformOffsets([all[0]], spec, origins, "translate", [1, undefined, 1], "individual", all, [basic.shape]);
  expect(edits).not.toBeNull();
  ui.send({ type: "UPDATE_OBJECTS", edits: edits!, historyLabel: "Move linked pocket" });
  expect(ui.state().cutouts[0].position.x).toBe(linked[0].position.x + 1);
  expect(ui.state().cutouts[0].elevationMm).toBeCloseTo(rigidPocket(linked[0], basic.shape, spec).elevationMm! + 1, 7);
  expect(ui.state().cutouts[1]).toEqual(linked[1]);
  expect(ui.save()).not.toBeNull();
});

it("keeps creation offsets stable through linking, rigid conversion, unlinking and another move/reset", () => {
  const legacy = legacyCutouts(depthCases[0].patch).map(c => ({ ...c, designLink: undefined }));
  const ui = mount(legacy);
  const offsets = () => objectTransformOffsets(ui.objects()[0], spec, ui.state().transformOrigins, "translate", [basic.shape]);
  const move = (values: readonly (number | undefined)[]) => {
    const all = ui.objects();
    const edits = setObjectTransformOffsets([all[0]], spec, ui.state().transformOrigins, "translate", values, "individual", all, [basic.shape]);
    expect(edits).not.toBeNull();
    ui.send({ type: "UPDATE_OBJECTS", edits: edits!, historyLabel: "Move pocket" });
  };
  ui.send({ type: "LINK_DESIGNS", kind: "pocket", ids: legacy.map(c => c.id), sourceId: legacy[0].id, linkId: "linked", tilt: false });
  const linkedPeer = ui.state().cutouts[1];
  expect(offsets()).toEqual([0, 0, 0]);
  move([undefined, undefined, 1]);
  expect(offsets()).toEqual([0, 0, 1]);
  const linkedPose = ui.state().cutouts[0];
  ui.send({ type: "UNLINK_DESIGNS", kind: "pocket", ids: [legacy[0].id] });
  expect(ui.state().cutouts[0]).toEqual({ ...linkedPose, designLink: undefined });
  expect(offsets()).toEqual([0, 0, 1]);
  move([2, undefined, 3]); expect(offsets()).toEqual([2, 0, 3]);
  const saved = ui.save(); expect(saved).not.toBeNull();
  ui.send({ type: "HYDRATE", ...saved! });
  expect(offsets()).toEqual([2, 0, 3]);
  move([0, 0, 0]); expect(offsets()).toEqual([0, 0, 0]);
  expect(ui.state().cutouts[0].position).toEqual(legacy[0].position);
  expect(ui.state().cutouts[0].depth).toEqual(legacy[0].depth);
  expect(ui.state().cutouts[0].elevationMm).toBeCloseTo(rigidPocket(legacy[0], basic.shape, spec).elevationMm!, 7);
  expect(ui.state().cutouts[1]).toEqual(linkedPeer);
  ui.send({ type: "UNDO" }); expect(offsets()).toEqual([2, 0, 3]);
  ui.send({ type: "REDO" }); expect(offsets()).toEqual([0, 0, 0]);
  expect(ui.save()).not.toBeNull();
});

it.each(["XY", "Z", "rotation"] as const)("preserves an unlinked tilted legacy pocket's authored solid and offsets during %s placement", operation => {
  const legacy = legacyCutouts(depthCases[0].patch).map(c => ({ ...c, designLink: undefined }));
  const ui = mount(legacy), all = ui.objects(), source = all[0];
  const delta = operation === "XY" ? new Vector3(2, -3, 0) : operation === "Z" ? new Vector3(0, 0, 1) : new Vector3();
  const rotation = operation === "rotation" ? new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4) : new Quaternion();
  const edits = transformObjects([source], spec, delta, rotation, "individual", all);
  expect(edits).not.toBeNull();
  ui.send({ type: "UPDATE_OBJECTS", edits: edits!, historyLabel: `Move ${operation}` });
  const next = ui.state().cutouts[0];
  expect(next.depth).toEqual(source.cutout.depth);
  expect(ui.state().cutouts[1]).toEqual(legacy[1]);
  const offsets = objectTransformOffsets(ui.objects()[0], spec, ui.state().transformOrigins, "translate", [basic.shape]);
  offsets.forEach((value, axis) => expect(value).toBeCloseTo(delta.toArray()[axis], 7));
  if (operation === "XY") {
    const original = pocketTransformWires(source, spec).flat();
    pocketTransformWires({ ...source, cutout: next }, spec).flat().forEach((point, i) => point.forEach((value, axis) =>
      expect(value).toBeCloseTo(original[i][axis] + delta.toArray()[axis], 7)));
  } else {
    const original = rigidPocketVertices(basic.shape.outlineMm, rigidPocket(source.cutout, basic.shape, spec));
    rigidPocketVertices(basic.shape.outlineMm, next).forEach((point, i) => {
      const vertex = original[i];
      const expected = new Vector3(vertex.x - source.cutout.position.x, vertex.y - source.cutout.position.y, vertex.z)
        .applyQuaternion(rotation).add(new Vector3(source.cutout.position.x, source.cutout.position.y, 0)).add(delta);
      expect(point.x).toBeCloseTo(expected.x, 7); expect(point.y).toBeCloseTo(expected.y, 7); expect(point.z).toBeCloseTo(expected.z, 7);
    });
  }
  expect(ui.save()).not.toBeNull();
});

for (const { name, patch } of depthCases.filter(test => test.name !== "through")) {
  it.each([false, true])(`reports and resets saved legacy ${name} Z offsets from their creation pose (linked: %s)`, linked => {
    const cutouts = legacyCutouts(patch).map(c => ({ ...c, designLink: linked ? c.designLink : undefined }));
    const ui = mount(cutouts);
    const origins = { pockets: cutouts.map(cutout => ({ cutout: { ...cutout, zOffsetMm: 0 }, spec })), fingerHoles: [] };
    ui.send({ type: "HYDRATE", spec, cutouts, transformOrigins: origins });
    const offsets = () => objectTransformOffsets(ui.objects()[0], spec, ui.state().transformOrigins, "translate", [basic.shape]);
    expect(offsets()).toEqual([0, 0, 2]);
    const all = ui.objects();
    const edits = setObjectTransformOffsets([all[0]], spec, origins, "translate", [undefined, undefined, 0], "individual", all, [basic.shape]);
    expect(edits).not.toBeNull();
    ui.send({ type: "UPDATE_OBJECTS", edits: edits!, historyLabel: "Reset legacy Z" });
    expect(offsets()[2]).toBeCloseTo(0, 7);
    expect(ui.state().cutouts[0].position).toEqual(cutouts[0].position);
    expect(ui.state().cutouts[1]).toEqual(cutouts[1]);
    const saved = ui.save(); expect(saved).not.toBeNull();
    ui.send({ type: "HYDRATE", ...saved! });
    expect(offsets()[2]).toBeCloseTo(0, 7);
    ui.send({ type: "UNDO" }); expect(offsets()[2]).toBeCloseTo(2, 7);
    ui.send({ type: "REDO" }); expect(offsets()[2]).toBeCloseTo(0, 7);
  });
}

it.each([false, true])("does not interpret an unbounded legacy through shaft as a finite Z displacement (linked: %s)", linked => {
  const cutouts = legacyCutouts({ depth: { mode: "through" } }).map(c => ({ ...c, designLink: linked ? c.designLink : undefined }));
  const ui = mount(cutouts);
  const origins = { pockets: cutouts.map(cutout => ({ cutout: { ...cutout, zOffsetMm: 0 }, spec })), fingerHoles: [] };
  const all = ui.objects();
  expect(objectTransformOffsets(all[0], spec, origins, "translate", [basic.shape])).toEqual([0, 0, 0]);
  const edits = setObjectTransformOffsets([all[0]], spec, origins, "translate", [undefined, undefined, 0], "individual", all, [basic.shape]);
  expect(edits?.cutouts[0]).toEqual(cutouts[0]);
});

it.each(["mm", "remaining"] as const)("combines a saved legacy %s depth edit with the old Z offset when resetting", mode => {
  const depth: CutoutPlacement["depth"] = mode === "mm" ? { mode, value: 10 } : { mode, floorThicknessMm: 8 };
  const originalDepth: CutoutPlacement["depth"] = mode === "mm" ? { mode, value: 12 } : { mode, floorThicknessMm: 6 };
  const cutouts = legacyCutouts({ depth }), ui = mount(cutouts);
  const origins = { pockets: cutouts.map(cutout => ({ cutout: { ...cutout, depth: originalDepth, zOffsetMm: 0 }, spec })), fingerHoles: [] };
  ui.send({ type: "HYDRATE", spec, cutouts, transformOrigins: origins });
  const all = ui.objects(), originalFloor = rigidPocket(origins.pockets[0].cutout, basic.shape, spec).elevationMm!;
  const currentFloor = rigidPocket(cutouts[0], basic.shape, spec).elevationMm!;
  const offsets = objectTransformOffsets(all[0], spec, origins, "translate", [basic.shape]);
  expect(offsets[2]).toBeCloseTo(currentFloor - originalFloor, 7);
  const edits = setObjectTransformOffsets([all[0]], spec, origins, "translate", [undefined, undefined, 0], "individual", all, [basic.shape]);
  expect(edits).not.toBeNull();
  ui.send({ type: "UPDATE_OBJECTS", edits: edits!, historyLabel: "Reset Z after a depth edit" });
  expect(ui.state().cutouts[0].elevationMm).toBeCloseTo(originalFloor, 7);
  expect(ui.state().cutouts[0].depth).toMatchObject(depth);
  expect(ui.state().cutouts[0].position).toEqual(cutouts[0].position);
  expect(ui.state().cutouts[1]).toEqual(cutouts[1]);
  expect(ui.save()).not.toBeNull();
});
