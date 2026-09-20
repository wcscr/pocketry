import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Outline, Point } from "@shared/geometry/types";
import { useMobileContourEditor, type ContourTool } from "./use-mobile-contour-editor";
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
function Harness({ tool }: { tool: ContourTool }) {
  const [outline, setOutline] = React.useState(original);
  const viewport = useViewportTransform({ contentWidth: 200, contentHeight: 200, containerWidth: 248, containerHeight: 248, panEnabled: false });
  transform = viewport.transform;
  displayed = outline;
  current = useMobileContourEditor({ enabled: true, tool, outline,
    toLocal: unproject, getScreenProjection: () => project, viewport: viewport.handlers,
    onPreview: setOutline, onCancel: value => { cancel(value); setOutline(value); },
    onCommit: (value, label) => { commit(value, label); setOutline(value); },
  });
  return <svg />;
}
function pointer(kind: "down" | "move" | "end", x: number, y: number, id = 1, cancelled = false) {
  const target = host.querySelector("svg")!;
  React.act(() => current[kind]({ pointerId: id, pointerType: "touch", button: 0,
    clientX: x, clientY: y, currentTarget: target, target, shiftKey: false,
    type: kind === "end" ? cancelled ? "pointercancel" : "pointerup" : `pointer${kind}`,
    preventDefault: () => {},
  } as unknown as React.PointerEvent<SVGSVGElement>));
}
function render(tool: ContourTool = "move") { React.act(() => root.render(<Harness tool={tool} />)); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  project = point => point; unproject = point => point;
  commit.mockClear(); cancel.mockClear();
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("mobile contour gestures", () => {
  it("grabs within 22 screen pixels, preserves finger offset, and commits one move", () => {
    render(); pointer("down", 55, 45); pointer("move", 75, 65);
    expect(displayed[0].outer[0]).toEqual({ x: 60, y: 60 });
    expect(commit).not.toHaveBeenCalled();
    pointer("end", 75, 65);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][1]).toBe("Move contour node");
  });
  it("ignores hand jitter and does not add points when Move misses", () => {
    render(); pointer("down", 40, 40); pointer("move", 42, 42); pointer("end", 42, 42);
    expect(displayed).toEqual(original); expect(commit).not.toHaveBeenCalled();
    pointer("down", 100, 100); pointer("move", 120, 120); pointer("end", 120, 120);
    expect(transform.translateX).toBe(44); expect(transform.translateY).toBe(44);
    expect(commit).not.toHaveBeenCalled();
  });
  it("adds only a released edge tap and retains the three-point minimum", () => {
    render("add"); pointer("down", 100, 40);
    expect(commit).not.toHaveBeenCalled(); pointer("end", 100, 40);
    expect(displayed[0].outer).toHaveLength(5);
    render("remove"); pointer("down", 100, 40); pointer("end", 100, 40);
    pointer("down", 40, 40); pointer("end", 40, 40);
    expect(displayed[0].outer).toHaveLength(3);
    pointer("down", 160, 40); pointer("end", 160, 40);
    expect(displayed[0].outer).toHaveLength(3);
  });
  it.each(["add", "remove"] as const)("does not %s a point during a drag, cancelled touch, or pinch", tool => {
    render(tool); const x = tool === "add" ? 100 : 40;
    pointer("down", x, 40); pointer("move", x + 20, 50); pointer("end", x + 20, 50);
    pointer("down", x, 40); pointer("end", x, 40, 1, true);
    pointer("down", x, 40); pointer("down", 170, 170, 2);
    pointer("move", 200, 200, 2); pointer("end", x, 40); pointer("end", 200, 200, 2);
    expect(displayed).toEqual(original); expect(commit).not.toHaveBeenCalled();
    expect(transform.scale).toBeGreaterThan(1);
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
