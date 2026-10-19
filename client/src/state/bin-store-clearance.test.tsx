// Prompt lifecycle is independent of experimental linked-design permissions.
vi.mock("@/state/experimental-features", () => ({ useExperimentalFeatures: () => ({ enabled: true, setEnabled: vi.fn() }) }));
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseCutoutPlacement, type CutoutPlacement } from "@shared/gridfinity/cutout";
import { NumericEditContext } from "@/components/ui/numeric-edit-context";
import { BinProvider, useBin, getCommittedBinDoc, type BinAction, type BinStore } from "./bin-store";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });
const pocket = parseCutoutPlacement({ id: "a", shapeId: "shape", position: { x: 0, y: 0 }, elevationMm: 7, depth: { mode: "mm", value: 8 } });
function mount(cutouts: CutoutPlacement[] = [pocket]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let bin!: BinStore;
  let numeric!: NonNullable<React.ContextType<typeof NumericEditContext>>;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  function Probe() { bin = useBin(); numeric = React.useContext(NumericEditContext)!; return null; }
  React.act(() => root.render(<BinProvider><Probe /></BinProvider>));
  const dispatch = (action: BinAction) => React.act(() => bin.dispatch(action));
  dispatch({ type: "ADD_PLACED", cutouts, gridX: 3, gridY: 3 });
  const rotate = (xDeg: number, yDeg = 0, extra: Partial<CutoutPlacement> = {}) => dispatch({ type: "UPDATE_CUTOUT", id: "a", patch: { tilt: { xDeg, yDeg }, ...extra } });
  cleanups.push(() => { React.act(() => root.unmount()); host.remove(); });
  return { bin: () => bin, numeric: () => numeric, dispatch, rotate };
}

it("prompts once after committed first tilt, keeping previews, Z heading and equivalent rotations silent", () => {
  const ui = mount(); const history = ui.bin().history;
  expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.dispatch({ type: "UPDATE_CUTOUT", id: "a", patch: { rotationDeg: 60 } });
  ui.rotate(360); expect(ui.bin().pendingPocketClearance).toBeNull();
  const before = ui.bin().history;
  for (const xDeg of [10, 25, 30]) {
    ui.dispatch({ type: "UPDATE_CUTOUT", id: "a", patch: { tilt: { xDeg, yDeg: 0 } }, transient: true });
    expect(ui.bin().history).toBe(before); expect(ui.bin().pendingPocketClearance).toBeNull();
  }
  ui.rotate(30, 0, { insertionMode: "axis" });
  const pending = ui.bin().pendingPocketClearance!;
  expect(pending.cutoutIds).toEqual(["a"]); expect(pending.checkpoint).toBe(ui.bin().history);
  expect(ui.bin().history.index).toBe(before.index + 1);
  ui.dispatch({ type: "DISMISS_POCKET_CLEARANCE", checkpoint: pending.checkpoint });
  ui.rotate(40); expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.rotate(0); ui.rotate(30); expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.dispatch({ type: "DISMISS_POCKET_CLEARANCE", checkpoint: history });
  expect(ui.bin().pendingPocketClearance).toBeNull();
});

it("asks again only when a committed inclination makes a valid chosen axis invalid", () => {
  const ui = mount();
  ui.rotate(30, 0, { insertionMode: "axis", insertionAxis: "z" });
  ui.dispatch({ type: "DISMISS_POCKET_CLEARANCE", checkpoint: ui.bin().history });
  ui.rotate(30, 90);
  const invalid = ui.bin().pendingPocketClearance!; expect(invalid.cutoutIds).toEqual(["a"]);
  ui.dispatch({ type: "DISMISS_POCKET_CLEARANCE", checkpoint: invalid.checkpoint });
  ui.dispatch({ type: "UPDATE_CUTOUT", id: "a", patch: { rotationDeg: 80 } });
  ui.rotate(20, 90); expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.rotate(20, 65); expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.rotate(20, 90); expect(ui.bin().pendingPocketClearance?.cutoutIds).toEqual(["a"]);
  const pending = ui.bin().pendingPocketClearance;
  ui.dispatch({ type: "DISMISS_POCKET_CLEARANCE", checkpoint: invalid.checkpoint });
  expect(ui.bin().pendingPocketClearance).toBe(pending);
});

it.each([undefined, "hole"] as const)("offers guidance for a first finite %s object tilt", role => {
  const ui = mount([{ ...pocket, role }]);
  ui.rotate(20);
  expect(ui.bin().cutouts[0].insertionMode).toBeUndefined();
  expect(ui.bin().pendingPocketClearance?.cutoutIds).toEqual(["a"]);
});

it("does not prompt when tilted objects are added/copied or legacy profile objects change", () => {
  const ui = mount([{ ...pocket, tilt: { xDeg: 30, yDeg: 0 } }]);
  expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.dispatch({ type: "DUPLICATE_CUTOUT", id: "a", newId: "copy" });
  expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.rotate(0); ui.rotate(30); expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.dispatch({ type: "UPDATE_CUTOUT", id: "copy", patch: { tilt: { xDeg: 0, yDeg: 0 } } });
  ui.dispatch({ type: "UPDATE_CUTOUT", id: "copy", patch: { tilt: { xDeg: 30, yDeg: 0 } } });
  expect(ui.bin().pendingPocketClearance).toBeNull();
  const profile = mount([{ ...pocket, profileBottom: { edge: "bottom", widthMm: 8, elevationMm: 7 } }]);
  profile.rotate(30); expect(profile.bin().pendingPocketClearance).toBeNull();
});

it.each(["commit", "selection", "cancel", "invalid"] as const)("handles numeric first-tilt completion via %s", finish => {
  const ui = mount([pocket, { ...pocket, id: "b" }]);
  const history = ui.bin().history;
  let session!: ReturnType<ReturnType<typeof ui.numeric>["begin"]>;
  React.act(() => { session = ui.numeric().begin("rotation"); });
  React.act(() => session.preview(true, () => ui.bin().dispatch({ type: "UPDATE_CUTOUT", id: "a", patch: { tilt: { xDeg: 30, yDeg: 0 } } })));
  expect(ui.bin().pendingPocketClearance).toBeNull(); expect(ui.bin().history).toBe(history);
  if (finish === "invalid") React.act(() => session.preview(false));
  if (finish === "selection") ui.dispatch({ type: "SELECT_CUTOUT", id: "b" });
  else if (finish === "cancel") React.act(() => session.cancel(() => {}));
  else React.act(() => session.commit(() => {}));
  const committed = finish === "commit" || finish === "selection";
  expect(ui.bin().history.index).toBe(history.index + (committed ? 1 : 0));
  expect(ui.bin().pendingPocketClearance?.cutoutIds ?? []).toEqual(committed ? ["a"] : []);
  React.act(() => session.commit(() => ui.bin().dispatch({ type: "UPDATE_CUTOUT", id: "a", patch: { tilt: { xDeg: 60, yDeg: 0 } } })));
  expect(ui.bin().history.index).toBe(history.index + (committed ? 1 : 0));
});

it.each(["release", "selection", "cancel"] as const)("handles gizmo-style preview via %s", finish => {
  const ui = mount(); const history = ui.bin().history;
  const edits = { cutouts: [{ ...pocket, tilt: { xDeg: 20, yDeg: 10 } }], fingerHoles: [] };
  ui.dispatch({ type: "UPDATE_OBJECTS", edits, transient: true, historyLabel: "Rotate" });
  expect(ui.bin().pendingPocketClearance).toBeNull();
  if (finish === "release") ui.dispatch({ type: "UPDATE_OBJECTS", edits, historyLabel: "Rotate" });
  else if (finish === "selection") ui.dispatch({ type: "SET_SELECTION", selection: [] });
  else ui.dispatch({ type: "CANCEL_PREVIEW", expectedHistory: history });
  expect(ui.bin().pendingPocketClearance?.cutoutIds ?? []).toEqual(finish === "cancel" ? [] : ["a"]);
  expect(ui.bin().history.index).toBe(history.index + (finish === "cancel" ? 0 : 1));
});

it("collects linked and independent rotated objects once and applies choices through ordinary linked edits", () => {
  const linked = { ...pocket, designLink: { id: "link", tilt: true }, insertionMode: "axis" as const };
  const ui = mount([linked, { ...linked, id: "b" }, { ...pocket, id: "hole", role: "hole" }, { ...pocket, id: "untouched" }]);
  ui.dispatch({ type: "UPDATE_OBJECTS", edits: { cutouts: [
    { ...linked, tilt: { xDeg: 30, yDeg: 0 } }, { ...ui.bin().cutouts[2], tilt: { xDeg: 20, yDeg: 0 } }], fingerHoles: [] }, historyLabel: "Rotate selection" });
  const pending = ui.bin().pendingPocketClearance!;
  expect(pending.cutoutIds).toEqual(["a", "b", "hole"]);
  const before = getCommittedBinDoc(ui.bin());
  ui.dispatch({ type: "APPLY_POCKET_CLEARANCE", checkpoint: pending.checkpoint, edits: {
    cutouts: [{ ...ui.bin().cutouts[0], insertionMode: "vertical", insertionAxis: "x" }], fingerHoles: [] } });
  expect(ui.bin().cutouts.slice(0, 2).map(c => c.insertionMode)).toEqual(["vertical", "vertical"]);
  expect(ui.bin().pendingPocketClearance).toBeNull();
  expect(ui.bin().history.index).toBe(pending.checkpoint.index + 1);
  expect(ui.bin().history.stack.at(-1)?.label).toBe("Confirm pocket depth and clearance");
  ui.dispatch({ type: "UNDO" }); expect(getCommittedBinDoc(ui.bin())).toEqual(before); expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.dispatch({ type: "REDO" }); expect(ui.bin().pendingPocketClearance).toBeNull();
  expect(JSON.stringify(ui.bin().history)).not.toContain("clearancePromptedIds");
  expect(JSON.stringify(ui.bin().history)).not.toContain("pendingPocketClearance");
});

it.each(["commit", "undo", "hydrate", "remove"] as const)("ignores a stale dialog response after %s", change => {
  const ui = mount(); ui.rotate(30);
  const pending = ui.bin().pendingPocketClearance!;
  const edits = { cutouts: [{ ...ui.bin().cutouts[0], insertionMode: "vertical" as const }], fingerHoles: [] };
  if (change === "commit") ui.dispatch({ type: "PATCH_SPEC", patch: { heightUnits: 8 } });
  else if (change === "undo") ui.dispatch({ type: "UNDO" });
  else if (change === "hydrate") ui.dispatch({ type: "HYDRATE", ...getCommittedBinDoc(ui.bin()) });
  else ui.dispatch({ type: "REMOVE_CUTOUT", id: "a" });
  expect(ui.bin().pendingPocketClearance).toBeNull();
  const history = ui.bin().history, doc = getCommittedBinDoc(ui.bin());
  ui.dispatch({ type: "APPLY_POCKET_CLEARANCE", checkpoint: pending.checkpoint, edits });
  expect(ui.bin().history).toBe(history); expect(getCommittedBinDoc(ui.bin())).toBe(doc);
});

it("dismisses unchanged choices without an undo step and rejects a reply during a live field edit", () => {
  const ui = mount(); ui.rotate(30);
  const checkpoint = ui.bin().history;
  ui.dispatch({ type: "APPLY_POCKET_CLEARANCE", checkpoint, edits: { cutouts: ui.bin().cutouts, fingerHoles: [] } });
  expect(ui.bin().pendingPocketClearance).toBeNull(); expect(ui.bin().history).toBe(checkpoint);
  ui.rotate(30, 0, { insertionMode: "axis" }); ui.rotate(30, 90);
  const pending = ui.bin().pendingPocketClearance!;
  ui.dispatch({ type: "BEGIN_FIELD_EDIT", owner: "another", token: "another" });
  ui.dispatch({ type: "APPLY_POCKET_CLEARANCE", checkpoint: pending.checkpoint, edits: { cutouts: [{ ...ui.bin().cutouts[0], insertionMode: "vertical" }], fingerHoles: [] } });
  expect(ui.bin().pendingPocketClearance).toBe(pending); expect(ui.bin().history).toBe(pending.checkpoint);
});

it.each(["current", "history", "origin"] as const)("seeds first-tilt guidance from loaded %s without replaying it", source => {
  const ui = mount();
  const tilted = { ...pocket, tilt: { xDeg: 30, yDeg: 0 } };
  const doc = { ...getCommittedBinDoc(ui.bin()), cutouts: [source === "current" ? tilted : pocket] };
  ui.dispatch({ type: "HYDRATE", ...doc,
    history: source === "history" ? { index: 1, stack: [{ doc: { ...doc, cutouts: [tilted] }, label: "Tilt" }, { doc, label: "Reset" }] } : undefined,
    transformOrigins: source === "origin" ? { pockets: [{ cutout: tilted, spec: doc.spec }], fingerHoles: [] } : undefined });
  expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.rotate(0); ui.rotate(30); expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.dispatch({ type: "HYDRATE", ...doc, cutouts: [pocket] });
  ui.rotate(30); expect(ui.bin().pendingPocketClearance?.cutoutIds).toEqual(["a"]);
});

it("retains first-tilt acknowledgment through undo and rejects opted-out linked clearance edits", () => {
  const ui = mount([{ ...pocket, designLink: { id: "link", tilt: false } }, { ...pocket, id: "b", designLink: { id: "link", tilt: false } }]);
  ui.rotate(30);
  ui.dispatch({ type: "UNDO" }); ui.rotate(30);
  expect(ui.bin().pendingPocketClearance).toBeNull();
  ui.rotate(30, 0, { insertionMode: "axis" }); ui.rotate(30, 90);
  const pending = ui.bin().pendingPocketClearance!;
  ui.dispatch({ type: "SET_EDITING_CAPABILITY", enabled: false });
  const doc = getCommittedBinDoc(ui.bin());
  ui.dispatch({ type: "APPLY_POCKET_CLEARANCE", checkpoint: pending.checkpoint, edits: { cutouts: [{ ...ui.bin().cutouts[0], insertionMode: "vertical" }], fingerHoles: [] } });
  expect(getCommittedBinDoc(ui.bin())).toBe(doc); expect(ui.bin().editError).toContain("Enable experimental tools");
  expect(ui.bin().pendingPocketClearance).toBe(pending);
});

it.each([undefined, "vertical"] as const)("retains first-tilt dismissal after choosing %s and ignores its dormant invalid axis", insertionMode => {
  const ui = mount();
  ui.rotate(30, 0, { insertionMode: "axis" });
  const checkpoint = ui.bin().history;
  ui.dispatch({ type: "APPLY_POCKET_CLEARANCE", checkpoint, edits: { cutouts: [
    { ...ui.bin().cutouts[0], insertionMode, insertionAxis: "x" }], fingerHoles: [] } });
  expect(ui.bin().pendingPocketClearance).toBeNull();
  expect(ui.bin().cutouts[0]).toMatchObject({ insertionMode, insertionAxis: "x" });
  ui.rotate(0); ui.rotate(45);
  expect(ui.bin().pendingPocketClearance).toBeNull();
  expect(ui.bin().cutouts[0].insertionMode).toBe(insertionMode);
});
