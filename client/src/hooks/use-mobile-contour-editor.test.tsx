import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Outline, Point } from "@shared/geometry/types";
import { useMobileContourEditor } from "./use-mobile-contour-editor";
import { useViewportTransform } from "./use-viewport-transform";

const original: Outline = [{ outer: [{ x: 40, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 160 }, { x: 40, y: 160 }], holes: [] }];
let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useMobileContourEditor>;
let displayed: Outline;
let transform: { scale: number; translateX: number; translateY: number };
const commit = vi.fn();
const cancel = vi.fn();
let project: (point: Point) => Point;
let unproject: (point: Point) => Point;
let pointerType: "touch" | "mouse";
function Harness({ selectionKey = "first", enabled = true }: { selectionKey?: string; enabled?: boolean }) {
  const [outline, setOutline] = React.useState(original);
  const viewport = useViewportTransform({ contentWidth: 200, contentHeight: 200, containerWidth: 248, containerHeight: 248, panEnabled: false });
  transform = viewport.transform;
  displayed = outline;
  current = useMobileContourEditor({ enabled, selectionKey, outline,
    toLocal: unproject, getScreenProjection: () => project, viewport: viewport.handlers,
    onPreview: setOutline, onCancel: value => { cancel(value); setOutline(value); },
    onCommit: (value, label) => { commit(value, label); setOutline(value); },
  });
  return <svg />;
}
function pointer(kind: "down" | "move" | "end", x: number, y: number, id = 1, cancelled = false) {
  const target = host.querySelector("svg")!;
  React.act(() => current[kind]({ pointerId: id, pointerType, button: kind === "move" ? -1 : 0, buttons: kind === "end" ? 0 : 1,
    clientX: x, clientY: y, currentTarget: target, target, shiftKey: false,
    type: kind === "end" ? cancelled ? "pointercancel" : "pointerup" : `pointer${kind}`,
    preventDefault: () => {},
  } as unknown as React.PointerEvent<SVGSVGElement>));
}
function render(selectionKey = "first", enabled = true) { React.act(() => root.render(<Harness selectionKey={selectionKey} enabled={enabled} />)); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  project = point => point; unproject = point => point;
  pointerType = "touch";
  commit.mockClear(); cancel.mockClear();
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("mobile contour gestures", () => {
  it("grabs within 18 screen pixels, preserves finger offset, and commits one move", () => {
    render(); pointer("down", 55, 45); pointer("move", 75, 65);
    expect(displayed[0].outer[0]).toEqual({ x: 60, y: 60 });
    expect(commit).not.toHaveBeenCalled();
    pointer("end", 75, 65);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][1]).toBe("Move contour node");
  });
  it("ignores hand jitter, selects a tapped point, and pans empty space", () => {
    render(); pointer("down", 40, 40); pointer("move", 42, 42); pointer("end", 42, 42);
    expect(displayed).toEqual(original); expect(commit).not.toHaveBeenCalled();
    expect(current.selectedPoint?.index).toBe(0);
    pointer("down", 100, 100); pointer("move", 120, 120); pointer("end", 120, 120);
    expect(transform.translateX).toBe(44); expect(transform.translateY).toBe(44);
    expect(commit).not.toHaveBeenCalled();
    expect(current.selectedPoint).toBeNull();
  });
  it("projects a released edge tap onto the line, selects it, and deletes only on request", () => {
    render(); pointer("down", 100, 48);
    expect(commit).not.toHaveBeenCalled(); pointer("end", 100, 48);
    expect(displayed[0].outer).toHaveLength(5);
    expect(displayed[0].outer[1]).toEqual({ x: 100, y: 40 });
    expect(current.selectedPoint?.index).toBe(1);
    pointer("down", 100, 40); pointer("end", 100, 40);
    expect(displayed[0].outer).toHaveLength(5);
    React.act(() => current.removeSelected());
    expect(displayed[0].outer).toHaveLength(4);
    expect(current.selectedPoint).toBeNull();
    pointer("down", 40, 40); pointer("end", 40, 40);
    React.act(() => current.removeSelected());
    expect(displayed[0].outer).toHaveLength(3);
    pointer("down", 160, 40); pointer("end", 160, 40);
    expect(current.canRemove).toBe(false);
    React.act(() => current.removeSelected());
    expect(displayed[0].outer).toHaveLength(3);
  });
  it.each(["touch", "mouse"] as const)("pans when dragging the line with %s without adding a point", type => {
    pointerType = type;
    render(); pointer("down", 100, 40); pointer("move", 120, 50);
    pointer("move", 140, 70); pointer("end", 140, 70);
    expect(transform.translateX).toBe(44); expect(transform.translateY).toBe(44);
    expect(displayed).toEqual(original); expect(commit).not.toHaveBeenCalled();
  });
  it.each([40, 100])("does not change a point after a cancelled tap or pinch starting at %s", x => {
    render();
    pointer("down", x, 40); pointer("end", x, 40, 1, true);
    pointer("down", x, 40); pointer("down", 170, 170, 2);
    pointer("move", 200, 200, 2); pointer("end", x, 40); pointer("end", 200, 200, 2);
    expect(displayed).toEqual(original); expect(commit).not.toHaveBeenCalled();
    expect(transform.scale).toBeGreaterThan(1);
  });
  it("clears selection when switching between pockets with identical geometry", () => {
    render(); pointer("down", 40, 40); pointer("end", 40, 40);
    expect(current.selectedPoint).not.toBeNull();
    render("second");
    expect(current.selectedPoint).toBeNull();
    React.act(() => current.removeSelected());
    expect(commit).not.toHaveBeenCalled();
  });
  it("rolls back a drag on leaving edit mode and clears point selection", () => {
    render(); pointer("down", 40, 40); pointer("move", 60, 60);
    render("first", false);
    expect(displayed).toEqual(original); expect(current.selectedPoint).toBeNull();
    pointer("end", 60, 60);
    expect(commit).not.toHaveBeenCalled();
  });
  it("rolls back a partial move when a second finger starts a pinch; the surviving finger only pans", () => {
    render(); pointer("down", 40, 40); pointer("move", 50, 50);
    expect(displayed).not.toEqual(original);
    pointer("down", 160, 160, 2);
    expect(displayed).toEqual(original); expect(cancel).toHaveBeenCalledTimes(1);
    pointer("move", 180, 180, 2); pointer("end", 180, 180, 2);
    pointer("move", 70, 60); pointer("end", 70, 60);
    expect(commit).not.toHaveBeenCalled(); expect(displayed).toEqual(original);
    pointer("down", 40, 40); pointer("move", 60, 60); pointer("end", 60, 60);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it("cancels a point drag without a history entry", () => {
    render(); pointer("down", 40, 40); pointer("move", 80, 80); pointer("end", 80, 80, 1, true);
    expect(displayed).toEqual(original); expect(commit).not.toHaveBeenCalled();
    expect(current.activePoint).toBeNull();
  });
  it("picks rotated, nonuniformly scaled contours in screen space", () => {
    project = point => ({ x: point.y * 2, y: -point.x / 2 + 120 });
    unproject = point => ({ x: (120 - point.y) * 2, y: point.x / 2 });
    render(); pointer("down", 95, 100); pointer("move", 115, 90); pointer("end", 115, 90);
    expect(displayed[0].outer[0]).toEqual({ x: 60, y: 50 });
  });
});
