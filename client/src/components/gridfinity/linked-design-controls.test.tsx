// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { parseCutoutPlacement, fingerHoleSchema } from "@shared/gridfinity/cutout";
import { LinkedDesignControls } from "./linked-design-controls";
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });
function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let state: BinStore;
  const labels = new Map([["a", "Alpha"], ["b", "Beta"], ["f", "Access"]]);
  function Harness() {
    state = useBin();
    const id = state.selectedCutoutId ?? state.selectedFingerHoleId;
    return id ? <LinkedDesignControls kind={state.selectedCutoutId ? "pocket" : "finger"} activeId={id} labels={labels} /> : null;
  }
  React.act(() => root.render(<BinProvider><Harness /></BinProvider>));
  const a = parseCutoutPlacement({ id: "a", shapeId: "s", name: "Alpha", position: { x: -15, y: 0 } });
  React.act(() => {
    state.dispatch({ type: "ADD_PLACED", cutouts: [a, { ...a, id: "b", name: "Beta", scaleX: 2, position: { x: 15, y: 0 } }], gridX: 3, gridY: 3 });
    state.dispatch({ type: "SET_SELECTION", selection: [{ kind: "pocket", id: "a" }, { kind: "pocket", id: "b" }] });
  });
  cleanups.push(() => { React.act(() => root.unmount()); host.remove(); });
  const button = (text: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent === text)!;
  const click = (text: string) => React.act(() => button(text).click());
  return { host, button, click, store: () => state! };
}
it("previews the chosen source and links selected pockets without moving or renaming them", () => {
  const { host, click, store } = mount();
  expect(host.textContent).toContain("Copies adopt this shape, size and depth");
  const source = host.querySelector('[aria-label="Linked design source"]') as HTMLSelectElement;
  expect(source.value).toBe("b");
  React.act(() => { source.value = "a"; source.dispatchEvent(new Event("change", { bubbles: true })); });
  click("Link 2 pockets");
  expect(store().cutouts.map(c => c.scaleX)).toEqual([1, 1]);
  expect(store().cutouts.map(c => c.name)).toEqual(["Alpha", "Beta"]);
  expect(store().cutouts.map(c => c.position.x)).toEqual([-15, 15]);
  expect(host.textContent).toContain("Linked design · 2 pockets");
  click("Unlink 2 pockets");
  expect(store().cutouts.every(c => !c.designLink)).toBe(true);
  React.act(() => store().dispatch({ type: "UNDO" }));
  expect(host.textContent).toContain("Linked design · 2 pockets");
});
it("offers linked duplication, optional tilt and selection of all linked copies", () => {
  const { host, click, store } = mount();
  React.act(() => store().dispatch({ type: "SELECT_CUTOUT", id: "a" }));
  click("Duplicate linked");
  expect(store().cutouts).toHaveLength(3);
  const original = store().cutouts[0], duplicate = store().cutouts[2];
  expect(duplicate.designLink).toEqual(original.designLink);
  expect(duplicate.name).toBe("Alpha (copy)");
  expect(original.name).toBe("Alpha");
  const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
  React.act(() => checkbox.click());
  expect(store().cutouts[0].designLink!.tilt).toBe(true);
  click("Select linked");
  expect(store().selection.map(s => s.id)).toEqual([original.id, duplicate.id]);
});
it("keeps mixed pocket and thumb selections in separate design sets", () => {
  const { host, button, store } = mount();
  React.act(() => {
    store().dispatch({ type: "ADD_FINGER_HOLE", hole: fingerHoleSchema.parse({ id: "f", center: { x: 0, y: 0 } }) });
    store().dispatch({ type: "SET_SELECTION", selection: [{ kind: "pocket", id: "a" }, { kind: "finger", id: "f" }] });
  });
  expect(button("Link 2 thumb slots")).toBeUndefined();
  expect(host.textContent).toContain("Pockets and thumb slots use separate designs");
});
