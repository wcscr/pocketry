import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { BinProvider, useBin, getCommittedBinDoc, type BinAction, type BinStore } from "./bin-store";
import { parseBinSpec } from "@shared/gridfinity/types";
import { objectGroupErrors } from "@shared/gridfinity/object-groups";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { createPlacementGroup, transformObjects } from "@/lib/gridfinity/object-arrangement";

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });
function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let state!: BinStore;
  function Probe() { state = useBin(); return null; }
  React.act(() => root.render(<BinProvider><Probe /></BinProvider>));
  cleanup.push(() => React.act(() => root.unmount()));
  const send = (action: BinAction) => React.act(() => state.dispatch(action));
  const basic = createBasicPocket("rectangle", { x: -4, y: -7 }, { x: 4, y: 7 }, "tool")!;
  const cutouts = [-15, 15].map((x, i) => ({ ...basic.cutout, id: `p${i}`, position: { x, y: i * 6 },
    depth: { mode: "mm" as const, value: 10 }, rotationDeg: i * 25 }));
  send({ type: "HYDRATE", spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 8 }), cutouts });
  const objects = () => state.cutouts.map(cutout => ({ kind: "pocket" as const, cutout, shape: basic.shape }));
  const group = () => {
    send({ type: "SET_SELECTION", selection: cutouts.map(c => ({ kind: "pocket", id: c.id })) });
    send({ type: "GROUP_SELECTION", group: createPlacementGroup(objects(), state.spec, "group") });
  };
  return { state: () => state, send, group, objects, shape: basic.shape };
}

it("groups without moving or linking geometry and selects/deselects complete groups", () => {
  const ui = mount(), before = getCommittedBinDoc(ui.state()); ui.group();
  expect(ui.state().cutouts.map(({ placementGroup, ...c }) => c)).toEqual(before.cutouts);
  expect(ui.state().history.index).toBe(1);
  ui.send({ type: "SET_SELECTION", selection: [] });
  ui.send({ type: "SELECT_CUTOUT", id: "p0" });
  expect(ui.state().selection.map(r => r.id)).toEqual(["p1", "p0"]);
  ui.send({ type: "SELECT_CUTOUT", id: "p1", additive: true });
  expect(ui.state().selection).toEqual([]);
  expect(ui.state().cutouts.every(c => !c.designLink)).toBe(true);
});

it("commits a rigid gesture once and restores group frames through undo, redo and save/load", () => {
  const ui = mount(); ui.group(); const before = getCommittedBinDoc(ui.state()), history = ui.state().history;
  const edits = transformObjects(ui.objects(), ui.state().spec, new Vector3(3, -4, 2), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2))!;
  ui.send({ type: "UPDATE_OBJECTS", edits, transient: true, historyLabel: "Rotate group" });
  expect(ui.state().history).toBe(history);
  ui.send({ type: "UPDATE_OBJECTS", edits, historyLabel: "Rotate group" });
  const after = JSON.parse(JSON.stringify(getCommittedBinDoc(ui.state()))) as ReturnType<typeof getCommittedBinDoc>;
  expect(ui.state().history.index).toBe(history.index + 1);
  expect(objectGroupErrors(after)).toEqual([]);
  const saved = parseProjectDoc(JSON.parse(JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION, ...after, shapes: [ui.shape], history: ui.state().history })))!;
  expect(saved).not.toBeNull();
  ui.send({ type: "HYDRATE", ...saved });
  expect(ui.state().cutouts).toEqual(after.cutouts);
  ui.send({ type: "UNDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(before);
  ui.send({ type: "REDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(after);
  ui.send({ type: "SELECT_CUTOUT", id: "p0" });
  ui.send({ type: "UNGROUP_SELECTION" });
  expect(ui.state().cutouts).toEqual(after.cutouts.map(c => ({ ...c, placementGroup: undefined })));
  ui.send({ type: "SELECT_CUTOUT", id: "p0" });
  ui.send({ type: "UNDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(after);
  expect(ui.state().selection).toHaveLength(2);
});

it("duplicates a group with a distinct frame and deletes only the selected group", () => {
  const ui = mount(); ui.group(); const original = ui.state().cutouts;
  ui.send({ type: "DUPLICATE_SELECTION", ids: ui.state().selection.map(source => ({ source, id: `${source.id}-copy` })) });
  const copies = ui.state().cutouts.slice(2);
  expect(copies[0].placementGroup?.id).toBeTruthy();
  expect(copies[0].placementGroup?.id).not.toBe(original[0].placementGroup?.id);
  expect(copies[0].placementGroup).toEqual(copies[1].placementGroup);
  expect(copies[0].placementGroup?.pivot.x).toBeCloseTo(original[0].placementGroup!.pivot.x + 10);
  expect(copies.map(c => c.position)).toEqual(original.map(c => ({ x: c.position.x + 10, y: c.position.y - 10 })));
  expect(objectGroupErrors(ui.state())).toEqual([]);
  ui.send({ type: "REMOVE_SELECTION" }); expect(ui.state().cutouts).toEqual(original);
  ui.send({ type: "UNDO" }); expect(ui.state().cutouts).toHaveLength(4);
});

it("prunes a one-member group and prevents single-member movement or auto-arrangement", () => {
  const ui = mount(); ui.group(); const before = getCommittedBinDoc(ui.state()), history = ui.state().history;
  ui.send({ type: "UPDATE_CUTOUT", id: "p0", patch: { position: { x: 99, y: 0 } } });
  expect(ui.state().editError).toContain("group Move and Rotate");
  expect(ui.state().history).toBe(history);
  ui.send({ type: "REPLACE_LAYOUT", cutouts: before.cutouts, gridX: 2, gridY: 2 });
  expect(ui.state().editError).toContain("Ungroup");
  expect(getCommittedBinDoc(ui.state())).toBe(before);
  ui.send({ type: "REMOVE_CUTOUT", id: "p0" });
  expect(ui.state().cutouts[0]).toEqual({ ...before.cutouts[1], placementGroup: undefined });
  ui.send({ type: "UNDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(before);
});

it("keeps grouping independent of a member's geometry edits", () => {
  const ui = mount(); ui.group(); const before = ui.state().cutouts;
  ui.send({ type: "UPDATE_CUTOUT", id: "p0", patch: { scaleX: 2 } });
  expect(ui.state().cutouts[0].scaleX).toBe(2);
  expect(ui.state().cutouts[1]).toEqual(before[1]);
  expect(ui.state().cutouts[0].placementGroup).toEqual(before[0].placementGroup);
});
