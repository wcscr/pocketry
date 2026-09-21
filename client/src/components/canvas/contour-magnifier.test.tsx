import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Point } from "@shared/geometry/types";
import { ContourMagnifier } from "./contour-magnifier";

let host: HTMLDivElement;
let root: Root;
function render(point: Point | null, width = 390, height = 735) {
  React.act(() => root.render(<ContourMagnifier sceneId="contour-scene" point={point} canvasWidth={width} canvasHeight={height} />));
}
const magnifier = () => host.querySelector<HTMLElement>('[data-testid="contour-magnifier"]')!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("contour precision view", () => {
  it("keeps its position through a drag while following the point inside the view", () => {
    render({ x: 40, y: 80 });
    const position = magnifier().getAttribute("style");
    const initialView = magnifier().querySelector('svg')!.getAttribute('viewBox');
    expect(Number.parseFloat(magnifier().style.left)).toBeGreaterThan(195);
    expect(Number.parseFloat(magnifier().style.top)).toBeGreaterThan(367);
    render({ x: 350, y: 650 });
    expect(magnifier().getAttribute("style")).toBe(position);
    expect(magnifier().querySelector('svg')!.getAttribute('viewBox')).not.toBe(initialView);
    expect(magnifier().querySelector('use')!.getAttribute('href')).toBe('#contour-scene');
    expect(magnifier().querySelector('svg')!.getAttribute('width')).toBe('144');
    render(null);
    expect(magnifier()).toBeNull();
    render({ x: 350, y: 650 });
    expect(Number.parseFloat(magnifier().style.left)).toBeLessThan(195);
    expect(Number.parseFloat(magnifier().style.top)).toBeLessThan(367);
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
