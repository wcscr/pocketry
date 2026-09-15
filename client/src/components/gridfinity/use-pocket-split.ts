import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { placementFootprint, untransformPointPlacement, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { nearestPocketEdge, orientRedrawnPocketSplit, resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import type { Point } from "@shared/geometry/types";
import { useBin } from "@/state/bin-store";

/** Drafts never enter the document. Click-click and edge-to-edge dragging share
 * the same commit path, so cancellation and invalid attempts are lossless.
 */
export function usePocketSplit({ cutout, shape, scale, toBin, onComplete }: {
  cutout: CutoutPlacement | null;
  shape: TracedShape | null;
  scale: number;
  toBin: (x: number, y: number) => Point | null;
  onComplete?: () => void;
}) {
  const { editorMode, dispatch } = useBin();
  const active = editorMode === "split" && !!cutout && !!shape;
  const [start, setStart] = useState<Point | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<Point | null>(null);
  const downRef = useRef<Point | null>(null);
  const placed = useMemo(() => cutout && shape ? placementFootprint(shape, cutout).outline : [], [cutout, shape]);
  const reset = () => { startRef.current = null; downRef.current = null; setStart(null); setHover(null); setError(null); };
  useEffect(reset, [active, cutout?.id, shape?.id]);

  const snap = (event: PointerEvent<SVGSVGElement>) => {
    const p = toBin(event.clientX, event.clientY);
    if (!p || !cutout) return null;
    const edge = nearestPocketEdge(placed, p);
    return edge && Math.hypot(edge.x - p.x, edge.y - p.y) * scale <= 16
      ? untransformPointPlacement(edge, cutout) : null;
  };
  const finish = (end: Point | null) => {
    if (!cutout || !shape || !startRef.current) return;
    if (!end) { setError("Choose a point on the outer edge."); return; }
    const drawn = [startRef.current, end];
    const resolved = resolvePocketSplit(shape.outlineMm, drawn);
    if (resolved.error) { setError(resolved.error); return; }
    const boundary = cutout.split ? orientRedrawnPocketSplit(drawn, cutout.split.boundary) : drawn;
    dispatch({ type: "UPDATE_CUTOUT", id: cutout.id,
      patch: { split: { boundary, depths: cutout.split?.depths ?? [cutout.depth, cutout.depth] } },
      historyLabel: cutout.split ? "Redraw pocket split" : "Split pocket" });
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
    reset();
    onComplete?.();
  };
  return {
    active, start, hover, error,
    pointerDown(event: PointerEvent<SVGSVGElement>): boolean {
      if (!active) return false;
      event.preventDefault();
      const point = snap(event);
      if (startRef.current) { finish(point); return true; }
      if (!point) { setError("Start on the pocket’s outer edge."); return true; }
      startRef.current = point;
      downRef.current = { x: event.clientX, y: event.clientY };
      setStart(point); setHover(point); setError(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return true;
    },
    pointerMove(event: PointerEvent<SVGSVGElement>): boolean {
      if (!active) return false;
      const local = snap(event);
      const p = toBin(event.clientX, event.clientY);
      setHover(local ?? (p && cutout ? untransformPointPlacement(p, cutout) : null));
      return true;
    },
    pointerUp(event: PointerEvent<SVGSVGElement>): boolean {
      if (!active) return false;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (event.type === "pointercancel") { reset(); return true; }
      const down = downRef.current;
      downRef.current = null;
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) finish(snap(event));
      return true;
    },
  };
}
