import { EMPTY_PROJECT, rectangularShape, flushHydration, renderPage, toolButton, selectPocket, clickBinHistory } from "./bin-designer.test-support";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { parseCutoutPlacement, binToCanvas } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";
import { createPlacementGroup } from "@/lib/gridfinity/object-arrangement";

const current = () => vi.mocked(useBinGeometry).mock.lastCall![2]!;
function setupSvg(container: HTMLElement) {
  const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
  Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
  Object.defineProperties(svg, {
    createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
    setPointerCapture: { value: () => {} },
  });
  return svg;
}
function pointer(target: Element, type: string, x: number, y: number, touch = false) {
  React.act(() => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, altKey: true });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: touch ? "touch" : "mouse" } });
    target.dispatchEvent(event);
  });
}
const click = (container: ParentNode, id: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click());

it("draws the mobile dialog's 5 mm pocket and restores it with redo", async () => {
  const { container, unmount } = renderPage({ mobile: true });
  try {
    await flushHydration(); click(container, "view-toggle-2d");
    React.act(() => container.querySelector('[data-testid="toolbar-add-object"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    React.act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Rectangle pocket")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const input = dialog.querySelectorAll('input')[2];
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => [...dialog.querySelectorAll('button')].find(b => b.textContent === "Draw on canvas")!.click());
    const svg = setupSvg(container);
    pointer(svg, "pointerdown", 25, 25, true); pointer(svg, "pointermove", 45, 45, true); pointer(svg, "pointerup", 45, 45, true);
    expect(current().cutouts).toHaveLength(1);
    expect(current().cutouts[0].depth).toEqual({ mode: "mm", value: 5 });
    clickBinHistory(container, "undo"); expect(current().cutouts).toEqual([]);
    clickBinHistory(container, "redo"); expect(current().cutouts[0].depth).toEqual({ mode: "mm", value: 5 });
  } finally { unmount(); }
});

it.each([
  { layout: "standard", touch: false, handle: false },
  { layout: "workflow", touch: false, handle: true },
  { layout: "standard", touch: true, handle: true },
  { layout: "workflow", touch: true, handle: false },
])("rotates a group in $layout using multiple drag frames (touch: $touch, handle: $handle)", async ({ layout, touch, handle }) => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const shape = rectangularShape("audit-tool", "Tool");
  const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 8 });
  const cutouts = [-20, 20].map((x, i) => parseCutoutPlacement({ id: `p${i}`, name: `Tool ${i + 1}`, shapeId: shape.id,
    position: { x, y: 0 }, depth: { mode: "mm", value: 12 } }));
  const frame = createPlacementGroup(cutouts.map(cutout => ({ kind: "pocket", cutout, shape })), spec, "group");
  const grouped = cutouts.map(c => ({ ...c, placementGroup: frame }));
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: grouped });
  const { container, unmount } = renderPage({ mobile: touch });
  try {
    await flushHydration(); click(container, "view-toggle-2d"); selectPocket(container, "p0");
    React.act(() => toolButton(container, "Rotate selected objects").click());
    const svg = setupSvg(container);
    const handleElement = svg.querySelector('[data-testid="selection-rotate-handle"]')!;
    expect(handleElement).not.toBeNull();
    const center = binToCanvas(frame.pivot, spec);
    const start = handle ? { x: Number(handleElement.getAttribute("cx")), y: Number(handleElement.getAttribute("cy")) } : binToCanvas(cutouts[0].position, spec);
    const target = handle ? handleElement : svg.querySelector('[data-cutout-id="p0"]')!;
    const at = (deg: number) => {
      const a = -deg * Math.PI / 180, x = start.x - center.x, y = start.y - center.y;
      return { x: center.x + x * Math.cos(a) - y * Math.sin(a), y: center.y + x * Math.sin(a) + y * Math.cos(a) };
    };
    pointer(target, "pointerdown", start.x, start.y, touch);
    for (const angle of [30, 60, 90]) { const p = at(angle); pointer(svg, "pointermove", p.x, p.y, touch); }
    const end = at(90); pointer(svg, "pointerup", end.x, end.y, touch);
    const rotated = current().cutouts;
    rotated.forEach((c, i) => {
      expect(c.rotationDeg).toBeCloseTo(90);
      expect(c.position.x).toBeCloseTo(frame.pivot.x - (cutouts[i].position.y - frame.pivot.y));
      expect(c.position.y).toBeCloseTo(frame.pivot.y + (cutouts[i].position.x - frame.pivot.x));
      expect(c.placementGroup!.pivot).toEqual(frame.pivot);
    });
    clickBinHistory(container, "undo"); expect(current().cutouts).toEqual(grouped);
    clickBinHistory(container, "redo"); expect(current().cutouts).toEqual(rotated);
    const cancelStart = handle ? { x: Number(handleElement.getAttribute("cx")), y: Number(handleElement.getAttribute("cy")) }
      : binToCanvas(rotated[0].position, spec);
    const dx = cancelStart.x - center.x, dy = cancelStart.y - center.y;
    const partial = { x: center.x + dy, y: center.y - dx };
    pointer(target, "pointerdown", cancelStart.x, cancelStart.y, touch);
    pointer(svg, "pointermove", partial.x, partial.y, touch);
    expect(vi.mocked(useBinGeometry).mock.lastCall![5]!.layout.cutouts.map(c => c.position)).not.toEqual(rotated.map(c => c.position));
    pointer(svg, "pointercancel", partial.x, partial.y, touch);
    expect(vi.mocked(useBinGeometry).mock.lastCall![5]!.layout.cutouts).toEqual(rotated);
    expect(current().cutouts).toEqual(rotated);
    React.act(() => toolButton(container, "Move selected objects").click());
    expect(svg.querySelector('[data-testid="selection-rotate-handle"]')).toBeNull();
  } finally { unmount(); }
});
