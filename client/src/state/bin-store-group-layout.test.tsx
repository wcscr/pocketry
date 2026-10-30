import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { BinProvider, useBin, getCommittedBinDoc, type BinAction, type BinStore } from "./bin-store";
import { parseBinSpec } from "@shared/gridfinity/types";
import { fingerHoleSchema } from "@shared/gridfinity/cutout";
import { objectGroupErrors } from "@shared/gridfinity/object-groups";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { createPlacementGroup, transformObjects, type EditableObject } from "@/lib/gridfinity/object-arrangement";
import { objectTransformOffsets } from "@/lib/gridfinity/object-transform-offsets";
import { fitRectangularBinToPlacements } from "@/lib/gridfinity/autoplace";

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });
const kinds = ["pockets", "fingers", "mixed"] as const;

function mount(kind: typeof kinds[number], count = 2) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let state!: BinStore;
  function Probe() { state = useBin(); return null; }
  React.act(() => root.render(<BinProvider><Probe /></BinProvider>));
  cleanup.push(() => React.act(() => root.unmount()));
  const send = (action: BinAction) => React.act(() => state.dispatch(action));
  const basic = createBasicPocket("square", { x: -4, y: -4 }, { x: 4, y: 4 }, "tool")!;
  const indices = Array.from({ length: count }, (_, i) => i);
  const pocketIndices = indices.filter(i => kind === "pockets" || kind === "mixed" && i === 0);
  const fingerIndices = indices.filter(i => !pocketIndices.includes(i));
  const cutouts = pocketIndices.map(i => ({ ...basic.cutout, id: `p${i}`, position: { x: i * 30 - 15, y: 0 }, depth: { mode: "mm" as const, value: 10 } }));
  const fingerHoles = fingerIndices.map(i => fingerHoleSchema.parse({ id: `f${i}`, center: { x: i * 30 - 15, y: 0 }, diameterMm: 8, depthMm: 4, kind: "straight" }));
  send({ type: "HYDRATE", spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 8 }), cutouts, fingerHoles });
  send({ type: "SET_EDITING_CAPABILITY", enabled: true });
  const objects = (): EditableObject[] => [
    ...state.cutouts.map(cutout => ({ kind: "pocket" as const, cutout, shape: basic.shape })),
    ...state.fingerHoles.map(hole => ({ kind: "finger" as const, hole })),
  ];
  send({ type: "SET_SELECTION", selection: [
    ...cutouts.map(c => ({ kind: "pocket" as const, id: c.id })),
    ...fingerHoles.map(h => ({ kind: "finger" as const, id: h.id })),
  ] });
  send({ type: "GROUP_SELECTION", group: createPlacementGroup(objects(), state.spec, "group") });
  const saved = () => parseProjectDoc(JSON.parse(JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION,
    ...getCommittedBinDoc(state), shapes: [basic.shape], history: state.history, transformOrigins: state.transformOrigins })))!;
  const group = () => [...state.cutouts, ...state.fingerHoles][0].placementGroup!;
  return { state: () => state, send, objects, saved, group, shape: basic.shape };
}

it.each(kinds)("rebases %s during footprint normalization and keeps rotation, offsets, history and saved projects valid", kind => {
  const ui = mount(kind);
  ui.send({ type: "UPDATE_OBJECTS", edits: transformObjects(ui.objects(), ui.state().spec, new Vector3(3, -4, 0))!, historyLabel: "Move group" });
  // Coordinate-system changes remain available for saved groups with Experimental off.
  ui.send({ type: "SET_EDITING_CAPABILITY", enabled: false });
  const before = getCommittedBinDoc(ui.state()), frame = ui.group();
  const offsets = objectTransformOffsets(ui.objects()[0], ui.state().spec, undefined, "translate");
  const delta = { x: 21, y: -7 };
  ui.send({ type: "REPLACE_LAYOUT", gridX: 5, gridY: 4,
    cutouts: before.cutouts.map(c => ({ ...c, position: { x: c.position.x + delta.x, y: c.position.y + delta.y } })),
    fingerHoles: before.fingerHoles.map(h => ({ ...h, center: { x: h.center.x + delta.x, y: h.center.y + delta.y } })),
    historyLabel: "Add footprint cell",
  });
  expect(ui.state().editError).toBeNull();
  expect(ui.state().spec.gridX).toBe(5);
  expect(ui.group()).toEqual({ ...frame,
    pivot: { ...frame.pivot, x: frame.pivot.x + delta.x, y: frame.pivot.y + delta.y },
    origin: { ...frame.origin, x: frame.origin.x + delta.x, y: frame.origin.y + delta.y },
  });
  expect(objectTransformOffsets(ui.objects()[0], ui.state().spec, undefined, "translate")).toEqual(offsets);
  const normalized = getCommittedBinDoc(ui.state());
  ui.send({ type: "UPDATE_OBJECTS", edits: transformObjects(ui.objects(), ui.state().spec, new Vector3(),
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2))!, historyLabel: "Rotate group" });
  const points = [...ui.state().cutouts.map(c => c.position), ...ui.state().fingerHoles.map(h => h.center)];
  expect(points.reduce((sum, p) => sum + p.x, 0) / points.length).toBeCloseTo(frame.pivot.x + delta.x);
  expect(points.reduce((sum, p) => sum + p.y, 0) / points.length).toBeCloseTo(frame.pivot.y + delta.y);
  expect(objectGroupErrors(ui.state())).toEqual([]);
  const saved = ui.saved();
  expect(saved).not.toBeNull();
  ui.send({ type: "HYDRATE", ...saved });
  ui.send({ type: "UNDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(JSON.parse(JSON.stringify(normalized)));
  ui.send({ type: "UNDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(JSON.parse(JSON.stringify(before)));
  ui.send({ type: "REDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(JSON.parse(JSON.stringify(normalized)));
});

it.each(kinds)("allows Fit bin to contents for %s and moves both group frame points", kind => {
  const ui = mount(kind);
  ui.send({ type: "UPDATE_OBJECTS", edits: transformObjects(ui.objects(), ui.state().spec, new Vector3(25, 12, 0))!, historyLabel: "Move group" });
  const frame = ui.group();
  const fitted = fitRectangularBinToPlacements(ui.state().cutouts, new Map([[ui.shape.id, ui.shape]]), ui.state().spec, ui.state().fingerHoles);
  ui.send({ type: "REPLACE_LAYOUT", ...fitted, historyLabel: "Fit bin to contents" });
  expect(ui.state().editError).toBeNull();
  expect(ui.state().spec.gridX).toBeLessThan(4);
  expect(ui.group().pivot.x).toBeCloseTo(frame.pivot.x - 25);
  expect(ui.group().pivot.y).toBeCloseTo(frame.pivot.y - 12);
  expect(ui.group().origin.x).toBeCloseTo(frame.origin.x - 25);
  expect(ui.group().origin.y).toBeCloseTo(frame.origin.y - 12);
  expect(ui.saved()).not.toBeNull();
});

it("preserves surviving members through Remove & resize and prunes a singleton on the next removal", () => {
  const ui = mount("mixed", 3), before = getCommittedBinDoc(ui.state());
  const fitted = fitRectangularBinToPlacements([], new Map([[ui.shape.id, ui.shape]]), ui.state().spec, ui.state().fingerHoles);
  ui.send({ type: "REPLACE_LAYOUT", ...fitted, historyLabel: "Remove tool pocket and resize bin" });
  expect(ui.state().editError).toBeNull();
  expect(ui.state().cutouts).toHaveLength(0);
  expect(ui.state().fingerHoles).toHaveLength(2);
  expect(ui.state().fingerHoles.every(h => h.placementGroup?.id === "group")).toBe(true);
  expect(objectGroupErrors(ui.state())).toEqual([]);
  const remaining = getCommittedBinDoc(ui.state());
  ui.send({ type: "REPLACE_LAYOUT", ...fitRectangularBinToPlacements([], new Map(), ui.state().spec, ui.state().fingerHoles.slice(1)) });
  expect(ui.state().fingerHoles).toHaveLength(1);
  expect(ui.state().fingerHoles[0].placementGroup).toBeUndefined();
  expect(ui.saved()).not.toBeNull();
  ui.send({ type: "UNDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(remaining);
  ui.send({ type: "UNDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(before);
  ui.send({ type: "REDO" }); expect(getCommittedBinDoc(ui.state())).toEqual(remaining);
});

it.each(kinds)("still rejects auto-arranging %s without a document or history change", kind => {
  const ui = mount(kind), before = getCommittedBinDoc(ui.state()), history = ui.state().history;
  ui.send({ type: "REPLACE_LAYOUT", operation: "auto-arrange", cutouts: ui.state().cutouts, gridX: 2, gridY: 2 });
  expect(ui.state().editError).toContain("Ungroup");
  expect(getCommittedBinDoc(ui.state())).toBe(before);
  expect(ui.state().history).toBe(history);
});

it("rejects partial movement of a mixed group atomically", () => {
  const ui = mount("mixed"), before = getCommittedBinDoc(ui.state()), history = ui.state().history;
  ui.send({ type: "REPLACE_LAYOUT", gridX: 5, gridY: 4,
    cutouts: ui.state().cutouts.map(c => ({ ...c, position: { x: c.position.x + 21, y: c.position.y } })),
  });
  expect(ui.state().editError).toContain("Move grouped objects together");
  expect(getCommittedBinDoc(ui.state())).toBe(before);
  expect(ui.state().history).toBe(history);
});
