import { EMPTY_PROJECT, rectangularShape, flushHydration, renderPage, toolButton, clickBinHistory, selectPocket,
  openObjectContext, contextCommand } from "./bin-designer.test-support";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";
import { createPlacementGroup } from "@/lib/gridfinity/object-arrangement";

const shape = rectangularShape("group-tool", "Tool");
const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 8 });
const cutouts = [-20, 20].map((x, i) => parseCutoutPlacement({ id: `group-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id,
  position: { x, y: 0 }, rotationDeg: i * 20, depth: { mode: "mm", value: 12 } }));
const current = () => vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;

it.each([
  { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
  { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
])("groups, rotates, duplicates and ungroups in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts });
  const { container, unmount } = renderPage({ mobile });
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    selectPocket(container, cutouts[0].id);
    React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Tool 2 in selection"]')!.click());
    const row = () => container.querySelector(`[data-testid="button-select-${cutouts[0].id}"]`)!;
    openObjectContext(row()); contextCommand("Group objects");
    const frame = current()[0].placementGroup!;
    expect(frame).toBeTruthy(); expect(current()[1].placementGroup).toEqual(frame);
    expect(current().every(c => !c.designLink)).toBe(true);
    expect(current().map(c => c.position)).toEqual(cutouts.map(c => c.position));
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-auto-arrange"]')!.disabled).toBe(true);
    React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Tool 1 in selection"]')!.click());
    expect(container.querySelectorAll('[aria-label^="Include "]:checked')).toHaveLength(0);
    selectPocket(container, cutouts[1].id);
    expect(container.querySelectorAll('[aria-label^="Include "]:checked')).toHaveLength(2);
    const rotate = toolButton(container, "Rotate selected objects");
    React.act(() => rotate.click());
    if (mobile) React.act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Adjust")!.click());
    const angle = container.querySelector<HTMLInputElement>('[aria-label="Rotate Z by"]')!;
    expect(angle).not.toBeNull();
    React.act(() => { angle.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(angle, "90"); angle.dispatchEvent(new Event("input", { bubbles: true })); });
    React.act(() => angle.blur());
    const rotated = current();
    expect(rotated.map(c => Math.round(c.rotationDeg))).toEqual([90, 110]);
    rotated.forEach((c, i) => {
      expect(c.position.x).toBeCloseTo(frame.pivot.x - (cutouts[i].position.y - frame.pivot.y), 5);
      expect(c.position.y).toBeCloseTo(frame.pivot.y + (cutouts[i].position.x - frame.pivot.x), 5);
      expect(c.placementGroup!.pivot).toEqual(frame.pivot);
    });
    clickBinHistory(container, "undo"); expect(current().map(c => c.position)).toEqual(cutouts.map(c => c.position));
    clickBinHistory(container, "redo"); expect(current()).toEqual(rotated);
    openObjectContext(row()); contextCommand("Duplicate 2 objects");
    expect(current()).toHaveLength(4);
    expect(current()[2].placementGroup).toEqual(current()[3].placementGroup);
    expect(current()[2].placementGroup?.id).not.toBe(frame.id);
    const copies = current().slice(2);
    openObjectContext(container.querySelector(`[data-testid="button-select-${copies[0].id}"]`)!); contextCommand("Ungroup");
    expect(current().slice(2)).toEqual(copies.map(c => ({ ...c, placementGroup: undefined })));
    expect(current().slice(0, 2)).toEqual(rotated);
  } finally { unmount(); }
});

it.each(["commit", "cancel"] as const)("drags an initially unselected group as one unit and can %s", async finish => {
  const frame = createPlacementGroup(cutouts.map(cutout => ({ kind: "pocket", cutout, shape })), spec, "saved-group");
  const grouped = cutouts.map(c => ({ ...c, placementGroup: frame }));
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: grouped });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
      setPointerCapture: { value: () => {} },
    });
    const body = svg.querySelector(`[data-cutout-id="${cutouts[0].id}"]`)!;
    const pointer = (type: string, x: number) => React.act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 83.75, altKey: true });
      Object.defineProperty(event, 'pointerId', { value: 1 }); body.dispatchEvent(event);
    });
    pointer("pointerdown", 63.75); pointer("pointermove", 75.75);
    expect(container.querySelectorAll('[aria-label^="Include "]:checked')).toHaveLength(2);
    pointer(finish === "cancel" ? "pointercancel" : "pointerup", 75.75);
    if (finish === "cancel") expect(current()).toEqual(grouped);
    else {
      expect(current().map(c => c.position.x)).toEqual([-8, 32]);
      expect(current()[0].placementGroup!.pivot.x).toBeCloseTo(frame.pivot.x + 12);
      clickBinHistory(container, "undo"); expect(current()).toEqual(grouped);
    }
  } finally { unmount(); }
});
