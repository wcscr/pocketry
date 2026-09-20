import { useRef, useState, type PointerEvent } from "react";
import type { Outline, Point, RingRef } from "@shared/geometry/types";
import { nearestEdge, nearestVertex } from "@/lib/geometry/hit-test";
import { getRing, setRing } from "@/lib/geometry/outline";
import type { ViewportPointerHandlers } from "./use-viewport-transform";

export type ContourTool = "move" | "add" | "remove";
type Gesture = {
  id: number; start: Point; localStart: Point; outline: Outline;
  ref: RingRef; index: number; tool: ContourTool; moved: boolean;
  preview: Outline;
};

/** Mobile edits are provisional until release; a pinch always wins over editing. */
export function useMobileContourEditor(options: {
  enabled: boolean;
  tool: ContourTool;
  outline: Outline;
  toLocal: (point: Point) => Point | null;
  /** Capture the SVG matrix once per gesture, rather than once per vertex. */
  getScreenProjection: () => (point: Point) => Point;
  viewport: ViewportPointerHandlers;
  onSelect?: (ref: RingRef) => void;
  onPreview: (outline: Outline) => void;
  onCancel: (outline: Outline) => void;
  onCommit: (outline: Outline, label: string) => void;
}) {
  const pointers = useRef(new Set<number>());
  const gesture = useRef<Gesture | null>(null);
  const [activePoint, setActivePoint] = useState<Point | null>(null);
  const cancel = () => {
    if (gesture.current?.moved) options.onCancel(gesture.current.outline);
    gesture.current = null;
    setActivePoint(null);
  };
  const down = (event: PointerEvent<SVGSVGElement>): boolean => {
    if (!options.enabled || event.button !== 0 || event.shiftKey) return false;
    pointers.current.add(event.pointerId);
    if (pointers.current.size > 1) {
      cancel();
      options.viewport.onPointerDown(event, { pan: false });
      return true;
    }
    const screen = { x: event.clientX, y: event.clientY };
    const local = options.toLocal(screen);
    const project = options.getScreenProjection();
    const displayed = options.outline.map(shape => ({
      outer: shape.outer.map(project), holes: shape.holes.map(ring => ring.map(project)),
    }));
    const vertex = nearestVertex(displayed, screen, 22);
    const edge = nearestEdge(displayed, screen, 22);
    const hit = options.tool === "add" ? edge : vertex;
    if (edge) options.onSelect?.(edge.ref);
    if (hit && local) {
      const index = "index" in hit ? hit.index : hit.insertIndex;
      gesture.current = { id: event.pointerId, start: screen, localStart: local,
        outline: options.outline, preview: options.outline, ref: hit.ref, index, tool: options.tool, moved: false };
      options.onSelect?.(hit.ref);
      setActivePoint(options.tool === "add" ? local : getRing(options.outline, hit.ref)![index]);
    }
    // Every touch reaches the viewport, including the first finger of a pinch.
    options.viewport.onPointerDown(event, { pan: !gesture.current });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    return true;
  };
  const move = (event: PointerEvent<SVGSVGElement>): boolean => {
    if (!pointers.current.has(event.pointerId)) return false;
    options.viewport.onPointerMove(event);
    const current = gesture.current;
    if (!current) return true;
    if (current.id !== event.pointerId) return true;
    const distance = Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y);
    if (distance < 6 && !current.moved) return true;
    if (current.tool !== "move") { cancel(); return true; }
    const point = options.toLocal({ x: event.clientX, y: event.clientY });
    const ring = getRing(current.outline, current.ref);
    if (!point || !ring) return true;
    // Keep the grab offset so a generous hit target does not make the point jump.
    const nextPoint = { x: ring[current.index].x + point.x - current.localStart.x,
      y: ring[current.index].y + point.y - current.localStart.y };
    const next = [...ring]; next[current.index] = nextPoint;
    current.preview = setRing(current.outline, current.ref, next);
    current.moved = true;
    options.onPreview(current.preview);
    setActivePoint(nextPoint);
    return true;
  };
  const end = (event: PointerEvent<SVGSVGElement>): boolean => {
    if (!pointers.current.delete(event.pointerId)) return false;
    const current = gesture.current;
    if (event.type === "pointercancel") cancel();
    else if (current?.id === event.pointerId) {
      const ring = getRing(current.outline, current.ref);
      const tap = Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) < 6;
      if (current.tool === "move" && current.moved) options.onCommit(current.preview, "Move contour node");
      else if (ring && tap && current.tool === "remove" && ring.length > 3) {
        options.onCommit(setRing(current.outline, current.ref, ring.filter((_, index) => index !== current.index)), "Remove contour node");
      } else if (ring && tap && current.tool === "add") {
        const next = [...ring]; next.splice(current.index, 0, current.localStart);
        options.onCommit(setRing(current.outline, current.ref, next), "Add contour node");
      }
      gesture.current = null;
      setActivePoint(null);
    }
    options.viewport.onPointerUp(event);
    return true;
  };
  return { down, move, end, activePoint };
}
