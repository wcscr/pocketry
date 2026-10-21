import { EMPTY_PROJECT, rectangularShape, flushHydration, renderPage, toolButton, clickBinHistory, selectPocket,
  openObjectContext, contextCommand, experimentalSettings } from "./bin-designer.test-support";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { fingerHoleSchema, parseCutoutPlacement } from "@shared/gridfinity/cutout";
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
])("keeps grouping behind Experimental in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts });
  const { container, unmount } = renderPage({ mobile, experimental: false });
  try {
    await flushHydration();
    selectPocket(container, cutouts[0].id);
    React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Tool 2 in selection"]')!.click());
    expect(container.querySelector('[aria-label="Object grouping"]')).toBeNull();
    const row = () => container.querySelector(`[data-testid="button-select-${cutouts[0].id}"]`)!;
    expect(openObjectContext(row()).textContent).not.toMatch(/Group objects|Ungroup|Link geometry/);
    contextCommand("Properties");
    React.act(() => experimentalSettings.setEnabled(true));
    openObjectContext(row()); contextCommand("Group objects");
    const grouped = current();
    expect(grouped[0].placementGroup).toBeTruthy();
    React.act(() => experimentalSettings.setEnabled(false));
    expect(current()).toEqual(grouped);
    const status = container.querySelector('[aria-label="Object grouping"]')!;
    expect(status.textContent).toContain("Grouped objects");
    expect(status.textContent).toContain("Enable experimental tools");
    expect(openObjectContext(row()).textContent).not.toMatch(/Group objects|Ungroup/);
    contextCommand("Properties");
    React.act(() => status.querySelector<HTMLButtonElement>('button')!.click());
    openObjectContext(row()); contextCommand("Ungroup");
    expect(current()).toEqual(grouped.map(c => ({ ...c, placementGroup: undefined })));
    expect(container.textContent).not.toContain("Ungroup to edit one member independently");
  } finally { unmount(); }
});

it.each([{ layout: "standard", mobile: false }, { layout: "standard", mobile: true }, { layout: "workflow", mobile: false }, { layout: "workflow", mobile: true }])(
  "keeps named-member depth editing and grouping available in $layout properties (mobile: $mobile)", async ({ layout, mobile }) => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts });
    const { container, unmount } = renderPage({ mobile });
    try {
      await flushHydration();
      selectPocket(container, cutouts[1].id);
      React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Tool 1 in selection"]')!.click());
      const properties = () => container.querySelector<HTMLElement>('#pocket-properties')!;
      const groupButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === "Group objects");
      expect(groupButton).toBeDefined();
      React.act(() => groupButton!.click());
      const frame = current()[0].placementGroup;
      const depth = properties().querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]');
      expect(depth).not.toBeNull();
      expect(properties().textContent).toContain("Geometry below applies to Tool 1");
      expect(properties().querySelector('[aria-label="Pocket rotation in degrees"]')).toBeNull();
      React.act(() => { depth!.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(depth, "8"); depth!.dispatchEvent(new Event("input", { bubbles: true })); });
      React.act(() => depth!.blur());
      expect(current().map(c => c.depth)).toEqual([{ mode: "mm", value: 8 }, cutouts[1].depth]);
      expect(current().map(c => c.placementGroup)).toEqual([frame, frame]);
      const ungroup = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === "Ungroup");
      expect(ungroup).toBeDefined();
      React.act(() => ungroup!.click());
      expect(current().every(c => !c.placementGroup)).toBe(true);
    } finally { unmount(); }
  },
);

it("preserves saved groups with Experimental off, hides single-slot pose controls and retains geometry controls", async () => {
  const holes = [-20, 20].map((x, i) => fingerHoleSchema.parse({ id: `finger-${i}`, name: `Slot ${i + 1}`, kind: "oblong-straight", center: { x, y: 0 }, lengthMm: 25 }));
  const frame = createPlacementGroup(holes.map(hole => ({ kind: "finger", hole })), spec, "finger-group");
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, fingerHoles: holes.map(h => ({ ...h, placementGroup: frame })) });
  const { container, unmount } = renderPage({ mobile: true, experimental: false });
  try {
    await flushHydration();
    expect(experimentalSettings.enabled).toBe(false);
    expect(container.querySelector('[data-testid="experimental-design-notice"]')?.textContent).toContain("grouped objects");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-finger-0"]')!.click());
    const properties = container.querySelector('#finger-access-properties')!;
    expect(properties.querySelector('[aria-label="Elongated finger access rotation"]')).toBeNull();
    expect(properties.querySelector('[aria-label="Depth in millimetres"]')).not.toBeNull();
    expect(properties.textContent).toContain("Move and Rotate affect the whole group");
  } finally { unmount(); }
});

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
    pointer("pointermove", 81.75);
    expect(container.querySelectorAll('[aria-label^="Include "]:checked')).toHaveLength(2);
    pointer(finish === "cancel" ? "pointercancel" : "pointerup", 81.75);
    if (finish === "cancel") expect(current()).toEqual(grouped);
    else {
      expect(current().map(c => c.position.x)).toEqual([-2, 38]);
      expect(current()[0].placementGroup!.pivot.x).toBeCloseTo(frame.pivot.x + 18);
      clickBinHistory(container, "undo"); expect(current()).toEqual(grouped);
    }
  } finally { unmount(); }
});

it.each(["multi-selection", "touch"] as const)("preserves a selected group during a %s drag", async mode => {
  const frame = createPlacementGroup(cutouts.map(cutout => ({ kind: "pocket", cutout, shape })), spec, "saved-group");
  const grouped = cutouts.map(c => ({ ...c, placementGroup: frame }));
  const outside = { ...cutouts[0], id: "outside", name: "Tool 3", position: { x: 50, y: 25 } };
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: [...grouped, outside] });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    selectPocket(container, cutouts[0].id);
    if (mode === "multi-selection") React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Tool 3 in selection"]')!.click());
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
      setPointerCapture: { value: () => {} },
    });
    const pointer = (type: string, x: number) => React.act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 83.75, altKey: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: mode === "touch" ? "touch" : "mouse" } });
      svg.querySelector(`[data-cutout-id="${cutouts[0].id}"]`)!.dispatchEvent(event);
    });
    expect(svg.querySelector('[data-pocket-resize-handle]')).toBeNull();
    pointer("pointerdown", 63.75); pointer("pointermove", 75.75); pointer("pointerup", 75.75);
    expect(current().map(c => c.position.x)).toEqual([-8, 32, mode === "multi-selection" ? 62 : 50]);
    expect(container.querySelectorAll('[aria-label^="Include "]:checked')).toHaveLength(mode === "multi-selection" ? 3 : 2);
    clickBinHistory(container, "undo"); expect(current()).toEqual([...grouped, outside]);
  } finally { unmount(); }
});
