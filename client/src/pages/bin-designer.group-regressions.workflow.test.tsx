import { EMPTY_PROJECT, rectangularShape, flushHydration, renderPage, toolButton, selectPocket, clickBinHistory } from "./bin-designer.test-support";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { fingerHoleSchema, parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";
import { createPlacementGroup, type EditableObject } from "@/lib/gridfinity/object-arrangement";

const shape = rectangularShape("group-regression-tool", "Tool");
const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 8 });
const cutouts = [-20, 20].map((x, i) => parseCutoutPlacement({ id: `p${i}`, name: `Tool ${i + 1}`, shapeId: shape.id,
  position: { x, y: 0 }, depth: { mode: "mm", value: 12 } }));
const current = () => vi.mocked(useBinGeometry).mock.lastCall![2]!;
const currentSpec = () => vi.mocked(useBinGeometry).mock.lastCall![0]!;
const groupedPockets = (pockets = cutouts) => {
  const frame = createPlacementGroup(pockets.map(cutout => ({ kind: "pocket", cutout, shape })), spec, "group");
  return pockets.map(c => ({ ...c, placementGroup: frame }));
};
const click = (container: ParentNode, id: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click());

function setupSvg(container: HTMLElement) {
  const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
  Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
  Object.defineProperties(svg, {
    createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
    setPointerCapture: { value: () => {} },
  });
  return svg;
}
function clickCell(rect: Element) {
  React.act(() => rect.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0,
    clientX: Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2,
    clientY: Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")) / 2 })));
}
function inputAxis(container: HTMLElement, label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  expect(input).not.toBeNull();
  React.act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  React.act(() => input.blur());
}

it.each(["standard", "workflow"])("edits the footprint without ungrouping pockets in %s", async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const grouped = groupedPockets();
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: grouped });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    click(container, "button-edit-footprint");
    const svg = setupSvg(container);
    clickCell(svg.querySelector('[data-testid="footprint-cell"]')!);
    const edited = currentSpec();
    expect(edited.footprint.kind).toBe("custom");
    expect(current().cutouts).toEqual(grouped);
    clickBinHistory(container, "undo"); expect(currentSpec()).toEqual(spec);
    clickBinHistory(container, "redo"); expect(currentSpec()).toEqual(edited);
    expect(current().cutouts).toEqual(grouped);
    expect(parseProjectDoc({ ...EMPTY_PROJECT, spec: edited, shapes: [shape], cutouts: current().cutouts })).not.toBeNull();
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});

it.each(["pockets", "fingers", "mixed"] as const)("keeps the %s group pivot with the contents when the footprint expands left", async kind => {
  const holes = [-20, 20].map((x, i) => fingerHoleSchema.parse({ id: `f${i}`, center: { x, y: 0 }, diameterMm: 8, depthMm: 8 }));
  const pockets = kind === "fingers" ? [] : kind === "mixed" ? cutouts.slice(0, 1) : cutouts;
  const fingers = kind === "pockets" ? [] : kind === "mixed" ? holes.slice(1) : holes;
  const members: EditableObject[] = [...pockets.map(cutout => ({ kind: "pocket" as const, cutout, shape })), ...fingers.map(hole => ({ kind: "finger" as const, hole }))];
  const group = createPlacementGroup(members, spec, "group");
  const grouped = pockets.map(c => ({ ...c, placementGroup: group }));
  const groupedFingers = fingers.map(h => ({ ...h, placementGroup: group }));
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: grouped, fingerHoles: groupedFingers });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    click(container, "button-edit-footprint");
    const svg = setupSvg(container);
    const left = [...svg.querySelectorAll('[data-testid="footprint-halo-cell"]')].find(r => Number(r.getAttribute("x")) < -1)!;
    expect(left).toBeDefined(); clickCell(left);
    expect(currentSpec().gridX).toBe(5);
    const shifted = [...current().cutouts, ...current().fingerHoles];
    shifted.forEach(member => {
      expect(member.placementGroup!.pivot).toEqual({ ...group.pivot, x: group.pivot.x + 21 });
      expect(member.placementGroup!.origin).toEqual({ ...group.origin, x: group.origin.x + 21 });
    });
    click(container, "button-edit-footprint");
    if (pockets.length) selectPocket(container, pockets[0].id);
    else click(container, `button-select-finger-hole-${fingers[0].id}`);
    React.act(() => toolButton(container, "Rotate selected objects").click());
    inputAxis(container, "Rotate Z by", "90");
    const positions = [...current().cutouts.map(c => c.position), ...current().fingerHoles.map(h => h.center)];
    const originalPositions = [...pockets.map(c => c.position), ...fingers.map(h => h.center)];
    positions.forEach((position, i) => {
      expect(position.x).toBeCloseTo(group.pivot.x + 21 - (originalPositions[i].y - group.pivot.y), 5);
      expect(position.y).toBeCloseTo(group.pivot.y + originalPositions[i].x - group.pivot.x, 5);
    });
    clickBinHistory(container, "undo");
    expect([...current().cutouts, ...current().fingerHoles]).toEqual(shifted);
    clickBinHistory(container, "undo");
    expect(current().cutouts).toEqual(grouped);
    expect(current().fingerHoles).toEqual(groupedFingers);
  } finally { unmount(); }
});

it.each([false, true])("keeps legacy linked projects valid after a Move field edit (Experimental: %s)", async experimental => {
  const linked = cutouts.map(c => ({ ...c, zOffsetMm: 2, designLink: { id: "link", tilt: false } }));
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: linked });
  const { container, unmount } = renderPage({ experimental });
  try {
    await flushHydration();
    click(container, "view-toggle-2d");
    selectPocket(container, cutouts[0].id);
    React.act(() => toolButton(container, "Move selected objects").click());
    const before = current().cutouts;
    inputAxis(container, "Move X by", "1");
    const moved = current().cutouts;
    expect(moved[0].position.x).toBeCloseTo(before[0].position.x + 1);
    expect(moved[1]).toEqual(before[1]);
    expect(parseProjectDoc({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: moved })).not.toBeNull();
    clickBinHistory(container, "undo"); expect(current().cutouts).toEqual(before);
    clickBinHistory(container, "redo"); expect(current().cutouts).toEqual(moved);
  } finally { unmount(); }
});

it.each(["standard", "workflow"])("rejects a mixed selection Z move atomically at the floor in %s", async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const pair = cutouts.map(c => ({ ...c, elevationMm: 10 }));
  const all = [...groupedPockets(pair), { ...pair[0], id: "outside", name: "Outside", elevationMm: 1, position: { x: 60, y: 0 } }];
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: all });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    click(container, "view-toggle-2d");
    selectPocket(container, cutouts[0].id);
    React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Outside in selection"]')!.click());
    React.act(() => toolButton(container, "Move selected objects").click());
    inputAxis(container, "Move Z by", "-2");
    expect(current().cutouts).toEqual(all);
    expect(container.textContent).toContain("Keep every member within the height limits");
    inputAxis(container, "Move Z by", "-1");
    expect(current().cutouts.map((c, i) => c.elevationMm! - all[i].elevationMm!)).toEqual([-1, -1, -1]);
    clickBinHistory(container, "undo"); expect(current().cutouts).toEqual(all);
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});

it.each(["fit", "remove-and-fit"] as const)("preserves a separate pocket group during %s", async action => {
  const grouped = groupedPockets(cutouts.map(c => ({ ...c, position: { x: c.position.x + 15, y: 0 } })));
  const outside = { ...cutouts[0], id: "outside", name: "Outside", position: { x: 65, y: 50 } };
  const all = action === "fit" ? grouped : [...grouped, outside];
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: all });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    if (action === "fit") click(container, "button-fit-bin");
    else {
      click(container, "button-remove-outside");
      click(document, "button-remove-pocket-and-fit");
    }
    const fitted = current().cutouts;
    expect(fitted).toHaveLength(2);
    expect(currentSpec().gridX * currentSpec().gridY).toBeLessThan(spec.gridX * spec.gridY);
    const dx = fitted[0].position.x - grouped[0].position.x;
    const dy = fitted[0].position.y - grouped[0].position.y;
    expect(fitted[1].position).toEqual({ x: grouped[1].position.x + dx, y: grouped[1].position.y + dy });
    fitted.forEach(c => {
      expect(c.placementGroup!.pivot).toEqual({ ...grouped[0].placementGroup.pivot, x: grouped[0].placementGroup.pivot.x + dx, y: grouped[0].placementGroup.pivot.y + dy });
      expect(c.placementGroup!.origin).toEqual({ ...grouped[0].placementGroup.origin, x: grouped[0].placementGroup.origin.x + dx, y: grouped[0].placementGroup.origin.y + dy });
    });
    clickBinHistory(container, "undo"); expect(current().cutouts).toEqual(all);
    expect(currentSpec()).toEqual(spec);
  } finally { unmount(); }
});
