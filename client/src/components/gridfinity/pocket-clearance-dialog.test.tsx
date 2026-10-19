// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseCutoutPlacement, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { rigidPocket } from "@shared/gridfinity/rigid-pocket";
import { expandLinkedObjectEdits } from "@/lib/gridfinity/object-arrangement";
import { ExperimentalFeaturesProvider, EXPERIMENTAL_FEATURES_KEY, useExperimentalFeatures } from "@/state/experimental-features";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { ShapeLibraryProvider, useShapeLibrary, type ShapeLibrary } from "@/state/shape-library";
import { PocketMeasurements } from "./pocket-measurements";
import { PocketClearanceDialog } from "./pocket-clearance-dialog";

const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6 });
const shape: TracedShape = { id: "tool", name: "Test tool", sourceMmPerPx: 1, pointCount: 4,
  outlineMm: [{ outer: [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }], holes: [] }],
  bboxMm: { minX: -10, minY: -5, maxX: 10, maxY: 5 } };
const pocket = (id: string, patch: Partial<CutoutPlacement> = {}) => parseCutoutPlacement({ id, name: id, shapeId: shape.id,
  position: { x: 0, y: 0 }, depth: { mode: "mm", value: 12 }, ...patch });
let experimental: ReturnType<typeof useExperimentalFeatures>;
let store: BinStore, library: ShapeLibrary, host: HTMLDivElement, root: ReturnType<typeof createRoot>;
function Probe() {
  store = useBin(); library = useShapeLibrary(); experimental = useExperimentalFeatures();
  return <><PocketClearanceDialog />{store.cutouts[0] && <PocketMeasurements cutout={store.cutouts[0]} shape={shape} />}</>;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear(); localStorage.setItem(EXPERIMENTAL_FEATURES_KEY, "true");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  React.act(() => root.render(<ExperimentalFeaturesProvider><ShapeLibraryProvider><BinProvider><Probe /></BinProvider></ShapeLibraryProvider></ExperimentalFeaturesProvider>));
  React.act(() => library.replaceShapes([shape]));
  hydrate([pocket("First tool")]);
});
afterEach(() => {
  React.act(() => root.unmount()); host.remove();
  localStorage.removeItem(EXPERIMENTAL_FEATURES_KEY); vi.unstubAllGlobals();
});
function hydrate(cutouts: CutoutPlacement[]) { React.act(() => store.dispatch({ type: "HYDRATE", spec, cutouts })); }
function dialog() { return document.querySelector<HTMLElement>('[data-testid="pocket-clearance-dialog"]'); }
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!; }
function choose(label: string, value: string) {
  const select = document.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  React.act(() => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
function enter(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function rotate(ids = ["First tool"], tilt = { xDeg: 0, yDeg: 80 }) {
  const objects = store.cutouts.map(cutout => ({ kind: "pocket" as const, cutout, shape }));
  const edits = expandLinkedObjectEdits(objects, spec, { cutouts: store.cutouts.filter(cutout => ids.includes(cutout.id))
    .map(cutout => ({ ...rigidPocket(cutout, shape, spec), tilt, insertionMode: "axis" as const })), fingerHoles: [] })!;
  React.act(() => store.dispatch({ type: "UPDATE_OBJECTS", edits, historyLabel: "Rotate objects" }));
}

it("waits for a numeric rotation commit and applies the chosen local axis without changing pose or dimensions", () => {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Pocket Y rotation in degrees"]')!;
  React.act(() => {
    input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "80");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(dialog()).toBeNull();
  React.act(() => input.blur());
  expect(dialog()).not.toBeNull();
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Clearance style for First tool"]')!.value).toBe("axis");
  const before = store.cutouts[0], history = store.history;
  choose("Insertion axis for First tool", "x");
  expect(dialog()!.textContent).toContain("10.0° from vertical");
  expect(store.cutouts[0]).toBe(before);
  React.act(() => button("Apply settings").click());
  expect(dialog()).toBeNull();
  expect(store.cutouts[0]).toEqual({ ...before, insertionAxis: "x" });
  expect(store.history.stack).toHaveLength(history.stack.length + 1);
  React.act(() => store.dispatch({ type: "UNDO" }));
  expect(store.cutouts[0]).toEqual(before); expect(dialog()).toBeNull();
  React.act(() => store.dispatch({ type: "REDO" }));
  expect(store.cutouts[0].insertionAxis).toBe("x"); expect(dialog()).toBeNull();
});

it.each(["button", "escape"])("keeps the committed rotation and settings when dismissed with %s", method => {
  rotate(); const before = store.cutouts, history = store.history;
  choose("Insertion axis for First tool", "x");
  if (method === "button") React.act(() => button("Keep current settings").click());
  else React.act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(dialog()).toBeNull(); expect(store.cutouts).toBe(before); expect(store.history).toBe(history);
});

it("rejects a horizontal selected axis and preserves it while switching styles", () => {
  rotate(undefined, { xDeg: 30, yDeg: 0 });
  choose("Insertion axis for First tool", "x");
  expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("First tool: The selected X axis");
  expect(button("Apply settings").disabled).toBe(true);
  choose("Clearance style for First tool", "vertical");
  expect(document.querySelector('[aria-label="Insertion axis for First tool"]')).toBeNull();
  expect(button("Apply settings").disabled).toBe(false);
  choose("Clearance style for First tool", "axis");
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Insertion axis for First tool"]')!.value).toBe("x");
  choose("Clearance style for First tool", "none");
  React.act(() => button("Apply settings").click());
  expect(store.cutouts[0]).toMatchObject({ insertionAxis: "x", tilt: { xDeg: 30, yDeg: 0 } });
  expect(store.cutouts[0].insertionMode).toBeUndefined();
});

it("shows separate choices for a pocket and a kept-material hole and applies them in one step", () => {
  hydrate([pocket("Tool pocket"), pocket("Kept island", { role: "hole" })]);
  rotate(["Tool pocket", "Kept island"]);
  expect(document.querySelectorAll('[data-testid="clearance-design-choice"]')).toHaveLength(2);
  expect(dialog()!.textContent).toContain("Kept-volume extension");
  choose("Clearance style for Tool pocket", "vertical");
  choose("Extension style for Kept island", "none");
  const history = store.history;
  React.act(() => button("Apply settings").click());
  expect(store.cutouts[0].insertionMode).toBe("vertical"); expect(store.cutouts[1].insertionMode).toBeUndefined();
  expect(store.cutouts[1].role).toBe("hole");
  expect(store.history.stack).toHaveLength(history.stack.length + 1);
});

it("groups linked copies, validates unselected poses, and freezes a legacy copy before applying", () => {
  const designLink = { id: "shared", tilt: false };
  hydrate([pocket("Tilted tool", { designLink }), pocket("Upright copy", { designLink, position: { x: 30, y: 0 } })]);
  const tilted = { ...rigidPocket(store.cutouts[0], shape, spec), tilt: { xDeg: 30, yDeg: 0 } };
  React.act(() => store.dispatch({ type: "UPDATE_OBJECTS", edits: { cutouts: [tilted], fingerHoles: [] }, historyLabel: "Rotate objects" }));
  expect(store.cutouts[1].elevationMm).toBeUndefined();
  choose("Clearance style for Tilted tool", "axis");
  expect(document.querySelectorAll('[data-testid="clearance-design-choice"]')).toHaveLength(1);
  expect(dialog()!.textContent).toContain("Applies to 2 linked copies.");
  choose("Insertion axis for Tilted tool", "y");
  const errors = [...dialog()!.querySelectorAll('[role="alert"]')].map(item => item.textContent);
  expect(errors).toHaveLength(1); expect(errors[0]).toContain("Upright copy: The selected Y axis");
  expect(button("Apply settings").disabled).toBe(true);
  choose("Clearance style for Tilted tool", "vertical");
  const before = store.cutouts;
  React.act(() => button("Apply settings").click());
  expect(store.cutouts.every(cutout => cutout.insertionMode === "vertical" && cutout.insertionAxis === "y" && cutout.elevationMm !== undefined)).toBe(true);
  expect(store.cutouts[0].tilt).toEqual(before[0].tilt); expect(store.cutouts[1].tilt).toBeUndefined();
  expect(store.cutouts.map(cutout => cutout.position)).toEqual(before.map(cutout => cutout.position));
});

it("does not add an undo step when applying unchanged settings", () => {
  rotate(); const history = store.history;
  React.act(() => button("Apply settings").click());
  expect(dialog()).toBeNull(); expect(store.history).toBe(history);
});

it("discards stale draft choices when another object receives its first tilt", () => {
  hydrate([pocket("First tool"), pocket("Second tool")]);
  rotate(["First tool"]); choose("Insertion axis for First tool", "x");
  rotate(["Second tool"], { xDeg: 40, yDeg: 0 });
  expect(document.querySelector('[aria-label="Insertion axis for First tool"]')).toBeNull();
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Insertion axis for Second tool"]')!.value).toBe("z");
  React.act(() => button("Apply settings").click());
  expect(store.cutouts[0].insertionAxis).toBeUndefined(); expect(store.cutouts[1].insertionAxis).toBeUndefined();
});


it("keeps a multi-object dialog scrollable above the mobile keyboard", () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  hydrate([pocket("First tool"), pocket("Second tool"), pocket("Third tool")]);
  rotate(["First tool", "Second tool", "Third tool"]);
  React.act(() => { viewport.height = 330; viewport.offsetTop = 20; viewport.dispatchEvent(new Event("resize")); });
  expect(dialog()!.style.top).toBe("185px");
  expect(dialog()!.style.maxHeight).toBe("298px");
  expect(dialog()!.className).toContain("overflow-y-auto");
  expect(document.querySelectorAll('[data-testid="clearance-design-choice"]')).toHaveLength(3);
});


it("explains locked linked choices and enables them without blocking independent rows", () => {
  const linked = { designLink: { id: "shared", tilt: false }, elevationMm: 30, insertionMode: "axis" as const };
  hydrate([pocket("Linked tool", linked), pocket("Linked copy", linked), pocket("Independent tool")]);
  React.act(() => experimental.setEnabled(false));
  rotate(["Linked tool", "Independent tool"]);
  const linkedStyle = document.querySelector<HTMLSelectElement>('[aria-label="Clearance style for Linked tool"]')!;
  expect(linkedStyle.disabled).toBe(true);
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Insertion axis for Linked tool"]')!.disabled).toBe(true);
  expect(dialog()!.textContent).toContain("Shared depth, height and clearance settings require experimental tools");
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Clearance style for Independent tool"]')!.disabled).toBe(false);
  choose("Clearance style for Independent tool", "none");
  React.act(() => button("Enable experimental tools").click());
  expect(linkedStyle.disabled).toBe(false);
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Clearance style for Independent tool"]')!.value).toBe("none");
  choose("Clearance style for Linked tool", "vertical");
  React.act(() => button("Apply settings").click());
  expect(dialog()).toBeNull();
  expect(store.cutouts.slice(0, 2).every(cutout => cutout.insertionMode === "vertical")).toBe(true);
  expect(store.cutouts[2].insertionMode).toBeUndefined();
});


it.each(["Keep current settings", "Apply settings", "Escape"])("returns keyboard focus after closing with %s", async action => {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Pocket Y rotation in degrees"]')!;
  React.act(() => {
    input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "80");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(dialog()).not.toBeNull();
  if (action === "Escape") React.act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  else React.act(() => button(action).click());
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(input);
});


it("preserves No extra clearance through reset and later numeric tilt", () => {
  const enterTilt = (value: string) => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="Pocket Y rotation in degrees"]')!;
    React.act(() => {
      input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
  };
  enterTilt("80");
  choose("Clearance style for First tool", "none");
  React.act(() => button("Apply settings").click());
  expect(store.cutouts[0].insertionMode).toBeUndefined();
  React.act(() => button("Reset to X–Y plane").click());
  enterTilt("30");
  expect(dialog()).toBeNull();
  expect(store.cutouts[0].insertionMode).toBeUndefined();
});

it("confirms depth and insertion together, preserving pose and source dimensions with undo", () => {
  rotate();
  const before = store.cutouts[0], history = store.history;
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Depth mode for First tool"]')!.value).toBe("mm");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Fixed depth for First tool"]')!.value).toBe("12");
  choose("Depth mode for First tool", "remaining");
  enter("Floor thickness for First tool", "8.5");
  choose("Insertion axis for First tool", "x");
  expect(store.cutouts[0]).toBe(before);
  React.act(() => button("Apply settings").click());
  expect(store.cutouts[0]).toEqual({ ...before, depth: { mode: "remaining", floorThicknessMm: 8.5, sourceDepthMm: 12 }, insertionAxis: "x" });
  expect(store.history.stack).toHaveLength(history.stack.length + 1);
  React.act(() => store.dispatch({ type: "UNDO" }));
  expect(store.cutouts[0]).toEqual(before);
  React.act(() => store.dispatch({ type: "REDO" }));
  expect(store.cutouts[0].depth).toEqual({ mode: "remaining", floorThicknessMm: 8.5, sourceDepthMm: 12 });
});

it.each(["remaining", "through"] as const)("preserves an existing %s source on confirmation and when switching to fixed depth", mode => {
  hydrate([pocket("First tool", { depth: mode === "remaining"
    ? { mode, floorThicknessMm: 8.25, sourceDepthMm: 13.375 } : { mode, sourceDepthMm: 13.375 } })]);
  rotate();
  const before = store.cutouts[0], history = store.history;
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Depth mode for First tool"]')!.value).toBe(mode);
  choose("Depth mode for First tool", "mm");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Fixed depth for First tool"]')!.value).toBe("13.375");
  choose("Depth mode for First tool", mode);
  React.act(() => button("Apply settings").click());
  expect(store.cutouts[0]).toEqual(before);
  expect(store.history).toBe(history);
  // A now-horizontal insertion axis prompts again with the current depth.
  rotate(undefined, { xDeg: 0, yDeg: 90 });
  choose("Depth mode for First tool", "mm");
  choose("Insertion axis for First tool", "x");
  React.act(() => button("Apply settings").click());
  expect(store.cutouts[0].depth).toEqual({ mode: "mm", value: 13.375 });
});

it("validates draft depth and discards it when keeping current settings", () => {
  rotate(); const before = store.cutouts, history = store.history;
  for (const value of ["", "0", "-1", "text", "Infinity"]) {
    enter("Fixed depth for First tool", value);
    expect(button("Apply settings").disabled).toBe(true);
  }
  enter("Fixed depth for First tool", "14,5");
  expect(button("Apply settings").disabled).toBe(false);
  choose("Depth mode for First tool", "remaining");
  enter("Floor thickness for First tool", "-1");
  expect(button("Apply settings").disabled).toBe(true);
  enter("Floor thickness for First tool", "0");
  expect(button("Apply settings").disabled).toBe(false);
  React.act(() => button("Keep current settings").click());
  expect(store.cutouts).toBe(before); expect(store.history).toBe(history);
});

it("keeps split-section depth choices separate and propagates them to linked copies", () => {
  const designLink = { id: "split", tilt: true };
  const split = { boundary: [{ x: 0, y: -5 }, { x: 0, y: 5 }], depths: [
    { mode: "mm" as const, value: 12 }, { mode: "remaining" as const, floorThicknessMm: 7, sourceDepthMm: 9 },
  ] as [import("@shared/gridfinity/cutout").DepthSpec, import("@shared/gridfinity/cutout").DepthSpec] };
  hydrate([pocket("First tool", { split, designLink }), pocket("Copy", { split, designLink, position: { x: 30, y: 0 } })]);
  rotate();
  choose("Section A Depth mode for First tool", "remaining");
  enter("Section A Floor thickness for First tool", "8");
  choose("Insertion axis for First tool", "x");
  const before = store.cutouts;
  React.act(() => button("Apply settings").click());
  expect(dialog()).toBeNull();
  for (const cutout of store.cutouts) expect(cutout.split).toEqual({ ...split, depths: [
    { mode: "remaining", floorThicknessMm: 8, sourceDepthMm: 12 }, split.depths[1],
  ] });
  expect(store.cutouts.map(c => [c.position, c.tilt, c.elevationMm])).toEqual(before.map(c => [c.position, c.tilt, c.elevationMm]));
});
