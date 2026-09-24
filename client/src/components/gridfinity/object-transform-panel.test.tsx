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
  const input = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  const fill = (label: string, value: string) => React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(label), value);
    input(label).dispatchEvent(new Event("input", { bubbles: true }));
  });
  const focus = (label: string) => React.act(() => input(label).focus());
  const blur = (label: string) => React.act(() => input(label).blur());
  const press = (label: string, key: string) => React.act(() => input(label).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  const edit = (label: string, value: string) => { focus(label); fill(label, value); blur(label); };
  return { container, click, button, input, fill, focus, blur, press, edit, onCommitObjects, onSelectionChange, update: (edits: ObjectEdits) => React.act(() => update(edits)) };
}
it("commits each finished axis edit for the whole mixed selection and defaults rotation to individual centers", () => {
  const ui = mount([...objects, finger]);
  ui.focus("Move X by"); ui.fill("Move X by", "6.5");
  expect(ui.onCommitObjects).not.toHaveBeenCalled();
  // Moving focus to the next field (including Tab) commits the previous axis.
  ui.focus("Move Y by");
  expect(ui.onCommitObjects).toHaveBeenCalledTimes(1);
  ui.fill("Move Y by", "-3"); ui.press("Move Y by", "Enter");
  expect(ui.onCommitObjects).toHaveBeenCalledTimes(2);
  const edits = ui.onCommitObjects.mock.lastCall![0];
  expect(edits.cutouts[0].position).toEqual({ x: -18.5, y: -3 });
  expect(edits.fingerHoles[0].center).toEqual({ x: 16.5, y: -3 });
  ui.click("Rotate pocket (E)");
  expect((ui.container.querySelector('[aria-label="Rotation pivot"]') as HTMLSelectElement).value).toBe("individual");
  expect((ui.container.querySelector('[aria-label="Rotate X by"]') as HTMLInputElement).disabled).toBe(true);
  expect((ui.container.querySelector('[aria-label="Rotate Z by"]') as HTMLInputElement).disabled).toBe(false);
});
it("supports explicit selection toggles, last selected alignment and equal center distribution", () => {
  const ui = mount();
  React.act(() => (ui.container.querySelector('[aria-label="Select Finger access 1"]') as HTMLInputElement).click());
  expect(ui.onSelectionChange).toHaveBeenLastCalledWith([...objects, finger].map(objectRef));
  ui.click("Align and distribute objects"); ui.click("Distribute horizontal centers");
  expect(ui.onCommitObjects.mock.calls[0][0].cutouts[0].position.x).toBe(7.5);
  expect(ui.onCommitObjects.mock.calls[0][0].cutouts).toHaveLength(1);
});
it("requires three objects for distribution and ignores zero movement", () => {
  const ui = mount(objects.slice(0, 2));
  ui.edit("Move X by", "0"); expect(ui.onCommitObjects).not.toHaveBeenCalled();
  ui.click("Align and distribute objects");
  expect(ui.button("Distribute horizontal centers").disabled).toBe(true); expect(ui.button("Equal horizontal gaps").disabled).toBe(true);
});

it("tracks actual offsets through repeated moves and resets only the entered axis", () => {
  const ui = mount([objects[0]]);
  const value = (axis: string) => (ui.container.querySelector(`[aria-label="Move ${axis} by"]`) as HTMLInputElement).value;
  ui.edit("Move X by", "6"); ui.edit("Move Y by", "4");
  expect(value("X")).toBe("6"); expect(value("Y")).toBe("4");
  ui.edit("Move X by", "9");
  expect(ui.onCommitObjects.mock.lastCall![0].cutouts[0].position).toEqual({ x: -16, y: 4 });
  ui.edit("Move X by", "0");
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
  ui.edit("Move X by", "0");
  expect(ui.onCommitObjects.mock.lastCall![0].cutouts.map((c: { position: { x: number } }) => c.position.x)).toEqual([-25, 0, 40]);
  expect(ui.onCommitObjects.mock.lastCall![0].cutouts[0].position.y).toBe(2);
});

it("cancels a draft with Escape and preserves untouched offset precision on blur", () => {
  const ui = mount([objects[0]]);
  const first = objects[0]; if (first.kind !== "pocket") throw new Error("fixture");
  ui.update({ cutouts: [{ ...first.cutout, position: { x: -20.123456, y: 2 } }], fingerHoles: [] });
  expect(ui.input("Move X by").value).toBe("4.8765");
  ui.focus("Move X by"); ui.blur("Move X by");
  ui.focus("Move X by"); ui.fill("Move X by", "10"); ui.press("Move X by", "Escape");
  expect(ui.input("Move X by").value).toBe("4.8765");
  expect(ui.onCommitObjects).not.toHaveBeenCalled();
  ui.edit("Move Y by", "3");
  expect(ui.onCommitObjects.mock.lastCall![0].cutouts[0].position.x).toBe(-20.123456);
});

it("restores invalid or incomplete numbers and permits a corrected edit", () => {
  const ui = mount([objects[0]]);
  for (const value of ["", "-", "1e", "1e308"]) {
    ui.edit("Move X by", value);
    expect(ui.onCommitObjects).not.toHaveBeenCalled();
    expect(ui.input("Move X by").value).toBe("0");
    expect(ui.container.querySelector('[role="status"]')).not.toBeNull();
  }
  ui.edit("Move X by", "-2.5");
  expect(ui.onCommitObjects).toHaveBeenCalledTimes(1);
  expect(ui.container.querySelector('[role="status"]')).toBeNull();
});

it("commits rotation once on Enter and restores geometry-invalid drafts", () => {
  const ui = mount([objects[0]]);
  ui.click("Rotate pocket (E)");
  ui.focus("Rotate Z by"); ui.fill("Rotate Z by", "15");
  expect(ui.onCommitObjects).not.toHaveBeenCalled();
  ui.press("Rotate Z by", "Enter"); ui.blur("Rotate Z by");
  expect(ui.onCommitObjects).toHaveBeenCalledTimes(1);
  expect(ui.onCommitObjects.mock.lastCall![0].cutouts[0].rotationDeg).toBeCloseTo(15);
  ui.edit("Rotate X by", "90");
  expect(ui.onCommitObjects).toHaveBeenCalledTimes(1);
  expect(ui.input("Rotate X by").value).toBe("0");
  expect(ui.container.querySelector('[role="status"]')?.textContent).toContain("Cannot transform");
});
