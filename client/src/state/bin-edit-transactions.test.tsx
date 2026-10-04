import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseCutoutPlacement, fingerHoleSchema } from "@shared/gridfinity/cutout";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { NumericEditContext, type NumericEditSession } from "@/components/ui/numeric-edit-context";
import { ExperimentalFeaturesProvider, useExperimentalFeatures } from "./experimental-features";
import { BinProvider, useBin, getCommittedBinDoc, type BinStore, type BinAction } from "./bin-store";

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); localStorage.clear(); vi.unstubAllGlobals(); });
function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let bin!: BinStore;
  let preferences!: ReturnType<typeof useExperimentalFeatures>;
  let edits!: React.ContextType<typeof NumericEditContext>;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  function Probe() {
    bin = useBin(); preferences = useExperimentalFeatures(); edits = React.useContext(NumericEditContext);
    return <DraftNumberInput aria-label="Fill" value={bin.spec.fillHeightPercent} min={1} max={100}
      onValueChange={fillHeightPercent => bin.dispatch({ type: "PATCH_SPEC", patch: { fillHeightPercent }, transient: true })}
      onValueCommit={fillHeightPercent => bin.dispatch({ type: "PATCH_SPEC", patch: { fillHeightPercent } })} />;
  }
  React.act(() => root.render(<ExperimentalFeaturesProvider><BinProvider><Probe /></BinProvider></ExperimentalFeaturesProvider>));
  const dispatch = (action: BinAction) => React.act(() => bin.dispatch(action));
  const enable = (enabled: boolean) => React.act(() => preferences.setEnabled(enabled));
  const input = host.querySelector("input")!;
  const fill = (value: string) => React.act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const key = (key: string) => React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  cleanup.push(() => { React.act(() => root.unmount()); host.remove(); });
  return { bin: () => bin, preferences: () => preferences, edits: () => edits!, dispatch, enable, fill, key, input, host };
}
const pocket = parseCutoutPlacement({ id: "a", shapeId: "shape", position: { x: 0, y: 0 }, depth: { mode: "mm", value: 20 }, designLink: { id: "shared", tilt: true } });
function linkedFixture(ui: ReturnType<typeof mount>) {
  ui.dispatch({ type: "HYDRATE", spec: ui.bin().spec, cutouts: [pocket, { ...pocket, id: "b", position: { x: 20, y: 0 } }],
    fingerHoles: ["f", "g"].map(id => fingerHoleSchema.parse({ id, center: { x: 0, y: 0 }, depthMm: 20, diameterMm: 20, designLink: { id: "fingers" } })) });
}

it("Escape rolls back linked depths and dependent floors without touching redo or committed exports", () => {
  const ui = mount(); ui.enable(true); linkedFixture(ui);
  ui.dispatch({ type: "PATCH_SPEC", patch: { heightUnits: 7 } }); ui.dispatch({ type: "UNDO" });
  const before = getCommittedBinDoc(ui.bin()), history = ui.bin().history;
  ui.fill("75");
  expect(ui.bin().cutouts[0].depth).not.toEqual(before.cutouts[0].depth);
  expect(getCommittedBinDoc(ui.bin())).toBe(before);
  ui.key("Escape");
  expect(getCommittedBinDoc(ui.bin())).toBe(before);
  expect(ui.bin().cutouts).toEqual(before.cutouts);
  expect(ui.bin().fingerHoles).toEqual(before.fingerHoles);
  expect(ui.bin().history).toBe(history);
  expect(ui.bin().canRedo).toBe(true);
});

it("invalid Enter retains focus; invalid blur discards every preview, while valid blur commits once", () => {
  const ui = mount(); const history = ui.bin().history;
  ui.fill("75"); ui.fill("999"); ui.key("Enter");
  expect(document.activeElement).toBe(ui.input);
  expect(ui.host.textContent).toContain("from 1 to 100");
  React.act(() => ui.input.blur());
  expect(ui.bin().spec.fillHeightPercent).toBe(100);
  expect(ui.bin().history).toBe(history);
  expect(ui.host.textContent).toContain("Change not applied");
  ui.fill("80"); ui.key("Enter"); React.act(() => ui.input.blur());
  expect(ui.bin().history.index).toBe(history.index + 1);
  expect(getCommittedBinDoc(ui.bin()).spec.fillHeightPercent).toBe(80);
});

it.each([true, false])("settles a field once before changing selection (valid=%s)", valid => {
  const ui = mount(); linkedFixture(ui); ui.enable(true);
  const history = ui.bin().history;
  ui.fill("75"); if (!valid) ui.fill("");
  ui.dispatch({ type: "SELECT_CUTOUT", id: "b" });
  React.act(() => ui.input.blur());
  expect(ui.bin().history.index).toBe(history.index + (valid ? 1 : 0));
  expect(ui.bin().spec.fillHeightPercent).toBe(valid ? 75 : 100);
});

it.each(["UNDO", "REDO", "HYDRATE", "SET_EDITING_CAPABILITY"] as const)("invalidates old numeric callbacks on %s", type => {
  const ui = mount(); ui.dispatch({ type: "PATCH_SPEC", patch: { heightUnits: 8 } });
  let session!: NumericEditSession;
  React.act(() => { session = ui.edits().begin("height"); });
  React.act(() => session.preview(true, () => ui.bin().dispatch({ type: "PATCH_SPEC", patch: { heightUnits: 9 } })));
  if (type === "HYDRATE") ui.dispatch({ type, spec: ui.bin().spec, cutouts: [] });
  else if (type === "SET_EDITING_CAPABILITY") ui.dispatch({ type, enabled: false });
  else ui.dispatch({ type });
  const before = getCommittedBinDoc(ui.bin()), history = ui.bin().history;
  React.act(() => session.commit(() => ui.bin().dispatch({ type: "PATCH_SPEC", patch: { heightUnits: 10 } })));
  expect(getCommittedBinDoc(ui.bin())).toBe(before); expect(ui.bin().history).toBe(history);
});

it.each([
  (s: BinStore): BinAction => ({ type: "UPDATE_CUTOUT", id: "a", patch: { scaleX: 2 } }),
  (s: BinStore): BinAction => ({ type: "UPDATE_CUTOUT", id: "a", patch: { tilt: { xDeg: 20, yDeg: 0 } }, transient: true }),
  (s: BinStore): BinAction => ({ type: "UPDATE_OBJECTS", edits: { cutouts: [{ ...s.cutouts[0], depth: { mode: "mm", value: 12 } }], fingerHoles: [] }, historyLabel: "Batch" }),
  (s: BinStore): BinAction => ({ type: "UPDATE_FINGER_HOLE", id: "f", patch: { diameterMm: 6 } }),
  (s: BinStore): BinAction => ({ type: "PATCH_SPEC", patch: { heightUnits: 1 } }),
  (s: BinStore): BinAction => ({ type: "PATCH_SPEC", patch: { fillHeightPercent: 50 } }),
  (s: BinStore): BinAction => ({ type: "REPLACE_LAYOUT", cutouts: [{ ...s.cutouts[0], scaleY: 3 }, s.cutouts[1]], gridX: 3, gridY: 3 }),
  (s: BinStore): BinAction => ({ type: "SET_LINKED_TILT", id: "a", enabled: false }),
  (s: BinStore): BinAction => ({ type: "DUPLICATE_LINKED", kind: "pocket", id: "a", newId: "c", linkId: "new" }),
  (s: BinStore): BinAction => ({ type: "UNLINK_DESIGNS", kind: "pocket", ids: ["a"] }),
])("rejects a shared geometry command atomically while opted out %#", command => {
  const ui = mount(); linkedFixture(ui);
  const doc = getCommittedBinDoc(ui.bin()), history = ui.bin().history;
  ui.dispatch(command(ui.bin()));
  expect(ui.bin().cutouts).toEqual(doc.cutouts); expect(ui.bin().fingerHoles).toEqual(doc.fingerHoles); expect(ui.bin().spec).toEqual(doc.spec);
  expect(ui.bin().history).toBe(history); expect(ui.bin().editError).toContain("Enable experimental tools");
  expect(ui.preferences().enabled).toBe(false);
});

it("permits placement, names, independent copies, deletion and history without enabling experiments", () => {
  const ui = mount(); linkedFixture(ui);
  ui.dispatch({ type: "SET_SELECTION", selection: [{ kind: "pocket", id: "a" }, { kind: "finger", id: "f" }] });
  ui.enable(false); expect(ui.bin().selection).toHaveLength(2);
  ui.dispatch({ type: "UPDATE_CUTOUT", id: "a", patch: { name: "Named", position: { x: 5, y: 7 }, rotationDeg: 15 } });
  expect(ui.bin().cutouts[0].name).toBe("Named"); expect(ui.bin().cutouts[1].position.x).toBe(20);
  ui.dispatch({ type: "DUPLICATE_CUTOUT", id: "a", newId: "copy" }); expect(ui.bin().cutouts[2].designLink).toBeUndefined();
  ui.dispatch({ type: "REMOVE_CUTOUT", id: "a" }); expect(ui.bin().cutouts).toHaveLength(2);
  ui.dispatch({ type: "UNDO" }); expect(ui.bin().cutouts).toHaveLength(3);
  expect(ui.preferences().enabled).toBe(false);
});

it("rejects an async wording edit from before opt-out even after re-enabling", () => {
  const ui = mount(); ui.enable(true);
  const label = surfaceTextSchema.parse({ id: "text", text: "Before", position: { x: 0, y: 0 } });
  ui.dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: [label] } });
  const expectedHistory = ui.bin().history, expectedEditingEpoch = ui.bin().editingEpoch;
  ui.enable(false); ui.enable(true);
  ui.dispatch({ type: "COMMIT_SURFACE_TEXT_WORDING", id: label.id, expectedHistory, expectedEditingEpoch, expectedText: label.text, text: "Stale", font: label.font });
  expect(ui.bin().spec.surfaceTexts[0].text).toBe("Before"); expect(ui.bin().history).toBe(expectedHistory);
});

it("honors cross-tab opt-out without collapsing selection or changing committed linked geometry", () => {
  const ui = mount(); ui.enable(true); linkedFixture(ui);
  ui.dispatch({ type: "SET_SELECTION", selection: [{ kind: "pocket", id: "a" }, { kind: "finger", id: "f" }] });
  const before = getCommittedBinDoc(ui.bin()), history = ui.bin().history;
  ui.fill("75");
  localStorage.setItem("pocketry:experimental-features", "false");
  React.act(() => window.dispatchEvent(new StorageEvent("storage", { key: "pocketry:experimental-features" })));
  expect(ui.preferences().enabled).toBe(false);
  expect(ui.bin().selection).toHaveLength(2);
  expect(getCommittedBinDoc(ui.bin())).toBe(before);
  expect(ui.bin().cutouts).toEqual(before.cutouts);
  expect(ui.bin().history).toBe(history);
  ui.key("Enter");
  expect(ui.bin().history).toBe(history);
  ui.dispatch({ type: "UPDATE_CUTOUT", id: "a", patch: { scaleX: 2 } });
  expect(getCommittedBinDoc(ui.bin())).toBe(before);
  expect(ui.bin().history).toBe(history);
});
