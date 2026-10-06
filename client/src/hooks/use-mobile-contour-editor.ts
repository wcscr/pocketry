import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Outline, Point, RingRef } from "@shared/geometry/types";
import { nearestEdge, nearestVertex } from "@/lib/geometry/hit-test";
import { getRing, setRing } from "@/lib/geometry/outline";
import type { ViewportPointerHandlers } from "./use-viewport-transform";

type SelectedPoint = { ref: RingRef; index: number; point: Point };
type Gesture = {
  id: number; start: Point; localStart: Point; outline: Outline;
  ref: RingRef; index: number; kind: "vertex" | "edge"; moved: boolean;
  preview: Outline; slop: number;
};

/** Direct manipulation: drag points, tap the line to add, select a point to delete. */
export function useMobileContourEditor(options: {
  enabled: boolean;
  outline: Outline;
  /** Clear point selection when the source photo or selected pocket changes. */
  selectionKey?: string | number | null;
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
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);
  const cancel = () => {
    const current = gesture.current;
    if (current?.moved) {
      options.onCancel(current.outline);
      setSelectedPoint({ ref: current.ref, index: current.index, point: getRing(current.outline, current.ref)![current.index] });
    }
    gesture.current = null;
    setActivePoint(null);
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const resized = () => cancelRef.current();
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  useEffect(() => {
    if (!options.enabled) { cancel(); setSelectedPoint(null); }
    // Tool exits cancel the provisional edit; normal preview renders retain it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enabled]);
  useEffect(() => {
    gesture.current = null;
    setActivePoint(null);
    setSelectedPoint(null);
  }, [options.selectionKey]);
  useEffect(() => {
    if (!selectedPoint || gesture.current) return;
    const current = getRing(options.outline, selectedPoint.ref)?.[selectedPoint.index];
    // Undo and re-detection must not leave Delete aimed at an unrelated point.
    if (!current || current.x !== selectedPoint.point.x || current.y !== selectedPoint.point.y) setSelectedPoint(null);
  }, [options.outline, selectedPoint]);

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
    const vertex = nearestVertex(displayed, screen, 18);
    const edge = nearestEdge(displayed, screen, 14);
    const hit = vertex ?? edge;
    if (hit && local) {
      const ring = getRing(options.outline, hit.ref)!;
      const index = "index" in hit ? hit.index : hit.insertIndex;
      let startPoint = local;
      if (!vertex) {
        // Insert on the line so an imprecise tap cannot introduce a new bump.
        const a = ring[(index - 1 + ring.length) % ring.length], b = ring[index % ring.length];
        const screenA = project(a), screenB = project(b);
        const dx = screenB.x - screenA.x, dy = screenB.y - screenA.y;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((screen.x - screenA.x) * dx + (screen.y - screenA.y) * dy) / lengthSquared)) : 0;
        startPoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      gesture.current = { id: event.pointerId, start: screen, localStart: startPoint,
        outline: options.outline, preview: options.outline, slop: event.pointerType === "touch" ? 12 : 6, ref: hit.ref, index, kind: vertex ? "vertex" : "edge", moved: false };
      options.onSelect?.(hit.ref);
      setSelectedPoint(vertex ? { ref: hit.ref, index, point: ring[index] } : null);
      setActivePoint(vertex ? ring[index] : null);
    } else setSelectedPoint(null);
    // Every touch reaches the viewport, including the first finger of a pinch.
    options.viewport.onPointerDown(event, { pan: !gesture.current });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    return true;
  };
  const move = (event: PointerEvent<SVGSVGElement>): boolean => {
    if (!pointers.current.has(event.pointerId)) return false;
    options.viewport.onPointerMove(event);
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return true;
    const distance = Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y);
    if (distance <= current.slop && !current.moved) return true;
    if (current.kind === "edge") {
      // Dragging the line is navigation, never point insertion.
      cancel();
      options.viewport.startPan(event);
      return true;
    }
    const point = options.toLocal({ x: event.clientX, y: event.clientY });
    const ring = getRing(current.outline, current.ref);
    if (!point || !ring) return true;
    const nextPoint = { x: ring[current.index].x + point.x - current.localStart.x,
      y: ring[current.index].y + point.y - current.localStart.y };
    const next = [...ring]; next[current.index] = nextPoint;
    current.preview = setRing(current.outline, current.ref, next);
    current.moved = true;
    options.onPreview(current.preview);
    setSelectedPoint({ ref: current.ref, index: current.index, point: nextPoint });
    setActivePoint(nextPoint);
    return true;
  };
  const end = (event: PointerEvent<SVGSVGElement>): boolean => {
    if (!pointers.current.delete(event.pointerId)) return false;
    const current = gesture.current;
    if (event.type === "pointercancel") cancel();
    else if (current?.id === event.pointerId) {
      const ring = getRing(current.outline, current.ref);
      const tap = Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) <= current.slop;
      if (current.kind === "vertex" && current.moved) options.onCommit(current.preview, "Move contour node");
      else if (ring && tap && current.kind === "edge") {
        const next = [...ring]; next.splice(current.index, 0, current.localStart);
        options.onCommit(setRing(current.outline, current.ref, next), "Add contour node");
        setSelectedPoint({ ref: current.ref, index: current.index, point: current.localStart });
      }
      gesture.current = null;
      setActivePoint(null);
    }
    options.viewport.onPointerUp(event);
    return true;
  };
  const selectedRing = selectedPoint && getRing(options.outline, selectedPoint.ref);
  const canRemove = !!selectedRing && selectedRing.length > 3;
  const removeSelected = () => {
    if (!options.enabled || !selectedPoint || !selectedRing || !canRemove || pointers.current.size) return;
    options.onCommit(setRing(options.outline, selectedPoint.ref, selectedRing.filter((_, index) => index !== selectedPoint.index)), "Remove contour node");
    setSelectedPoint(null);
  };
  return { down, move, end, activePoint, selectedPoint, canRemove, removeSelected };
}
