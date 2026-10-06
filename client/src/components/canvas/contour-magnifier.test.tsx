import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Point } from "@shared/geometry/types";
import { ContourMagnifier } from "./contour-magnifier";

let host: HTMLDivElement;
let root: Root;
function render(point: Point | null, width = 390, height = 735, compact = true) {
  React.act(() => root.render(<ContourMagnifier sceneId="contour-scene" point={point} canvasWidth={width} canvasHeight={height} compact={compact} />));
}
const magnifier = () => host.querySelector<HTMLElement>('[data-testid="contour-magnifier"]')!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("contour precision view", () => {
  it.each([true, false])("preserves 3× zoom and moves only the compact lens away from the finger (compact: %s)", compact => {
    render({ x: 40, y: 80 }, 864, 735, compact);
    const position = magnifier().getAttribute("style");
    const initialView = magnifier().querySelector('svg')!.getAttribute('viewBox');
    expect(Number.parseFloat(magnifier().style.left)).toBeGreaterThan(432);
    expect(Number.parseFloat(magnifier().style.top)).toBeGreaterThan(367);
    render({ x: 750, y: 650 }, 864, 735, compact);
    if (compact) expect(magnifier().getAttribute("style")).not.toBe(position);
    else expect(magnifier().getAttribute("style")).toBe(position);
    expect(magnifier().querySelector('svg')!.getAttribute('viewBox')).not.toBe(initialView);
    expect(magnifier().querySelector('use')!.getAttribute('href')).toBe('#contour-scene');
    const svg = magnifier().querySelector('svg')!;
    const size = Number(svg.getAttribute('width'));
    const viewSize = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    expect(size).toBe(compact ? 144 : 204);
    expect(size / viewSize).toBe(3);
    if (!compact) expect(size ** 2 / 144 ** 2).toBeCloseTo(2, 1);
    render(null);
    expect(magnifier()).toBeNull();
    render({ x: 750, y: 650 }, 864, 735, compact);
    expect(Number.parseFloat(magnifier().style.left)).toBeLessThan(432);
    expect(Number.parseFloat(magnifier().style.top)).toBeLessThan(367);
  });

  it("does not oscillate when the touch stays near the same corner", () => {
    render({ x: 40, y: 80 }, 864, 735);
    render({ x: 750, y: 650 }, 864, 735);
    const position = magnifier().getAttribute("style");
    render({ x: 745, y: 648 }, 864, 735);
    expect(magnifier().getAttribute("style")).toBe(position);
  });

  it("keeps the fixed view inside a short phone canvas when the viewport resizes", () => {
    render({ x: 40, y: 80 });
    render({ x: 40, y: 80 }, 320, 180);
    const box = magnifier();
    expect(Number.parseFloat(box.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(box.style.left) + 148).toBeLessThanOrEqual(320);
    expect(Number.parseFloat(box.style.top)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(box.style.top) + 148).toBeLessThanOrEqual(180);
  });
});
