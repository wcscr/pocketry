// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { fingerHoleSchema } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { applyObjectEdits, objectRef, type EditableObject, type ObjectEdits } from "@/lib/gridfinity/object-arrangement";
import { recordTransformOrigins } from "@shared/gridfinity/transform-origins";
import { ObjectTransformPanel } from "./object-transform-panel";
const spec = parseBinSpec({ gridX: 6, gridY: 4, heightUnits: 6, lip: "none" });
const objects: EditableObject[] = [-25, 0, 40].map((x, i) => ({ kind: "pocket", ...createBasicPocket("rectangle", { x: x - 4, y: -5 }, { x: x + 4, y: 5 }, String(i))! }));
const finger: EditableObject = { kind: "finger", hole: fingerHoleSchema.parse({ id: "f", center: { x: 10, y: 0 }, diameterMm: 8, depthMm: 8 }) };
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });
function mount(selected = objects) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onCommitObjects = vi.fn(), onSelectionChange = vi.fn();
  const container = document.createElement("div"), root = createRoot(container); document.body.append(container);
  const origins = recordTransformOrigins({ pockets: [], fingerHoles: [] }, [{ spec,
    cutouts: selected.flatMap(o => o.kind === "pocket" ? [o.cutout] : []), fingerHoles: selected.flatMap(o => o.kind === "finger" ? [o.hole] : []) }]);
  let update!: (edits: ObjectEdits) => void;
  function Harness() {
    const [current, setCurrent] = React.useState(selected);
    update = edits => setCurrent(items => applyObjectEdits(items, edits));
    const [mode, setMode] = React.useState<"translate" | "rotate">("translate");
    const [pivot, setPivot] = React.useState<"individual" | "selection">("individual");
    return <ObjectTransformPanel editor={{ spec, transformOrigins: origins, pockets: objects.flatMap(o => o.kind === "pocket" ? [o] : []), selectedId: null,
      onSelect: vi.fn(), onCommit: vi.fn(), onCommitObjects: (edits, label) => { onCommitObjects(edits, label); update(edits); }, onSelectionChange }} objects={[...current, ...[...objects, finger].filter(o => !current.some(c => objectRef(c).id === objectRef(o).id))]} selected={current} displayed={current}
      mode={mode} setMode={setMode} pivot={pivot} setPivot={setPivot} snap={false} setSnap={vi.fn()} limited={false} onClose={vi.fn()} />;
  }
  React.act(() => root.render(<Harness />));
  cleanups.push(() => { React.act(() => root.unmount()); container.remove(); });
  const button = (label: string) => Array.from(container.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === label || b.textContent === label)!;
  const click = (label: string) => React.act(() => button(label).click());
  const fill = (label: string, value: string) => React.act(() => {
    const input = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return { container, click, button, fill, onCommitObjects, onSelectionChange, update: (edits: ObjectEdits) => React.act(() => update(edits)) };
}
it("applies one mixed XYZ move and defaults rotation to individual centers", () => {
  const ui = mount([...objects, finger]);
  ui.fill("Move X by", "6.5"); ui.fill("Move Y by", "-3"); ui.click("Apply move · mm");
  expect(ui.onCommitObjects).toHaveBeenCalledTimes(1);
  const edits = ui.onCommitObjects.mock.calls[0][0];
  expect(edits.cutouts[0].position).toEqual({ x: -18.5, y: -3 });
  expect(edits.fingerHoles[0].center).toEqual({ x: 16.5, y: -3 });
  ui.click("Rotate pocket (E)");
  expect((ui.container.querySelector('[aria-label="Rotation pivot"]') as HTMLSelectElement).value).toBe("individual");
  expect((ui.container.querySelector('[aria-label="Rotate X by"]') as HTMLInputElement).disabled).toBe(true);
  expect((ui.container.querySelector('[aria-label="Rotate Z by"]') as HTMLInputElement).disabled).toBe(false);
});
it("supports explicit selection toggles, last selected alignment and equal center distribution", () => {
  const ui = mount();
  React.act(() => (ui.container.querySelector('[aria-label="Select Thumb access 4"]') as HTMLInputElement).click());
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith([...objects, finger].map(objectRef));
  ui.click("Align and distribute objects"); ui.click("Equal centers");
  expect(ui.onCommitObjects.mock.calls[0][0].cutouts[0].position.x).toBe(7.5);
  expect(ui.onCommitObjects.mock.calls[0][0].cutouts).toHaveLength(1);
});
it("requires three objects for distribution and ignores zero movement", () => {
  const ui = mount(objects.slice(0, 2));
  ui.click("Apply move · mm"); expect(ui.onCommitObjects).not.toHaveBeenCalled();
  ui.click("Align and distribute objects");
  expect(ui.button("Equal centers").disabled).toBe(true); expect(ui.button("Equal gaps").disabled).toBe(true);
});

it("tracks actual offsets through repeated moves and resets only the entered axis", () => {
  const ui = mount([objects[0]]);
  const value = (axis: string) => (ui.container.querySelector(`[aria-label="Move ${axis} by"]`) as HTMLInputElement).value;
  ui.fill("Move X by", "6"); ui.fill("Move Y by", "4"); ui.click("Apply move · mm");
  expect(value("X")).toBe("6"); expect(value("Y")).toBe("4");
  ui.fill("Move X by", "9"); ui.click("Apply move · mm");
  expect(ui.onCommitObjects.mock.lastCall![0].cutouts[0].position).toEqual({ x: -16, y: 4 });
  ui.fill("Move X by", "0"); ui.click("Apply move · mm");
  expect(ui.onCommitObjects.mock.lastCall![0].cutouts[0].position).toEqual({ x: -25, y: 4 });
  ui.click("Rotate pocket (E)"); ui.click("Move pocket (W)");
  expect(value("Y")).toBe("4");
  expect(ui.button("Snap: 1 mm moves and 5 degree rotations").textContent).toBe("");
});
it("updates fields from external drag/undo poses and resets mixed group offsets", () => {
  const ui = mount(objects);
  const first = objects[0]; if (first.kind !== "pocket") throw new Error("fixture");
  ui.update({ cutouts: [{ ...first.cutout, position: { x: -20, y: 2 } }], fingerHoles: [] });
  expect((ui.container.querySelector('[aria-label="Move X by"]') as HTMLInputElement).value).toBe("");
  ui.fill("Move X by", "0"); ui.click("Apply move · mm");
  expect(ui.onCommitObjects.mock.lastCall![0].cutouts.map((c: { position: { x: number } }) => c.position.x)).toEqual([-25, 0, 40]);
  expect(ui.onCommitObjects.mock.lastCall![0].cutouts[0].position.y).toBe(2);
});
