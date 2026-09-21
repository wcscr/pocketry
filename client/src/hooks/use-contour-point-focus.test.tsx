import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Outline } from "@shared/geometry/types";
import { useContourPointFocus } from "./use-contour-point-focus";

const outline: Outline = [{ outer: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], holes: [] }];
let root: Root;
let host: HTMLDivElement;
let focus: ReturnType<typeof useContourPointFocus>;
function Harness(props: Parameters<typeof useContourPointFocus>[0]) { focus = useContourPointFocus(props); return null; }
function render(contextKey = "first", enabled = true, value = outline) {
  React.act(() => root.render(<Harness outline={value} enabled={enabled} contextKey={contextKey} />));
}
const select = () => React.act(() => focus.select({ shapeIndex: 0, ringIndex: -1 }, 0, outline[0].outer[0], true));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("contour point focus", () => {
  it("clears focus on changing pockets with identical geometry or leaving contour editing", () => {
    render(); select();
    expect(focus.selectedPoint).not.toBeNull(); expect(focus.activePoint).not.toBeNull();
    render("second");
    expect(focus.selectedPoint).toBeNull(); expect(focus.activePoint).toBeNull();
    select(); render("second", false);
    expect(focus.selectedPoint).toBeNull();
    render("second"); expect(focus.selectedPoint).toBeNull();
  });
  it("retains focus after releasing a point but clears it when undo or replacement changes that point", () => {
    render(); select();
    React.act(() => focus.finish());
    expect(focus.activePoint).toBeNull(); expect(focus.selectedPoint).not.toBeNull();
    expect(focus.canDelete).toBe(true);
    render("first", true, [{ ...outline[0], outer: outline[0].outer.slice(1) }]);
    expect(focus.selectedPoint).toBeNull(); expect(focus.canDelete).toBe(false);
  });
});
