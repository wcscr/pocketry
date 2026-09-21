import { useEffect, useState } from "react";
import type { Outline, Point, RingRef } from "@shared/geometry/types";
import { getRing } from "@/lib/geometry/outline";

/** Point focus is local UI state; selecting a handle never creates a geometry edit. */
export function useContourPointFocus({ outline, enabled, contextKey }: {
  outline: Outline;
  enabled: boolean;
  contextKey: string | number | null;
}) {
  const [selectedPoint, setSelectedPoint] = useState<{ ref: RingRef; index: number; point: Point } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clear = () => { setSelectedPoint(null); setDragging(false); };
  useEffect(() => { if (!enabled) clear(); }, [enabled]);
  useEffect(() => { clear(); }, [contextKey]);
  useEffect(() => {
    if (!selectedPoint) return;
    const point = getRing(outline, selectedPoint.ref)?.[selectedPoint.index];
    // Undo, replacement, or another edit must not aim Delete at a different point.
    if (!point || point.x !== selectedPoint.point.x || point.y !== selectedPoint.point.y) clear();
  }, [outline, selectedPoint]);
  const select = (ref: RingRef, index: number, point: Point, active = false) => {
    setSelectedPoint({ ref, index, point });
    setDragging(active);
  };
  const move = (point: Point) => setSelectedPoint(current => current && { ...current, point });
  return {
    selectedPoint: enabled ? selectedPoint : null,
    activePoint: enabled && dragging ? selectedPoint?.point ?? null : null,
    canDelete: !!selectedPoint && (getRing(outline, selectedPoint.ref)?.length ?? 0) > 3,
    select, move, clear,
    finish: () => setDragging(false),
  };
}
