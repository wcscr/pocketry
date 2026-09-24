import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Point } from "@shared/geometry/types";
import { basicPocketDimensions, createBasicPocket, type BasicPocketShape } from "@/lib/gridfinity/basic-shape";
import { useDraftNavigation } from "@/hooks/use-draft-navigation";
import type { ViewportPointerHandlers } from "@/hooks/use-viewport-transform";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";

/** A cancelled or tiny drag never creates a library shape or a history entry. */
export function useBasicPocket({ toBin, viewport }: { toBin: (x: number, y: number) => Point | null; viewport: ViewportPointerHandlers }) {
  const { spec, editorMode, dispatch } = useBin();
  const { storeShape } = useShapeLibrary();
  const kind: BasicPocketShape | null = editorMode === "draw-rectangle" ? "rectangle"
    : editorMode === "draw-square" ? "square" : editorMode === "draw-circle" ? "circle" : null;
  const [draft, setDraft] = useState<{ start: Point; end: Point } | null>(null);
  const gesture = useRef<{ start: Point; clientX: number; clientY: number; pointerId: number } | null>(null);
  const cancel = () => {
    gesture.current = null;
    setDraft(null);
  };
  const navigation = useDraftNavigation(!!kind, viewport, cancel);
  useEffect(cancel, [editorMode, spec]);
  return {
    kind,
    draft: kind && draft ? basicPocketDimensions(kind, draft.start, draft.end) : null,
    cancel,
    pointerDown(event: PointerEvent<SVGSVGElement>) {
      if (!kind) return false;
      if (navigation.down(event)) return true;
      if (gesture.current) return true;
      const point = toBin(event.clientX, event.clientY);
      if (!point) return true;
      gesture.current = { start: point, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId };
      setDraft({ start: point, end: point });
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return true;
    },
    pointerMove(event: PointerEvent<SVGSVGElement>) {
      if (!kind) return false;
      if (navigation.move(event)) return true;
      const current = gesture.current;
      const point = toBin(event.clientX, event.clientY);
      if (current && current.pointerId === event.pointerId && point) setDraft({ start: current.start, end: point });
      return true;
    },
    pointerUp(event: PointerEvent<SVGSVGElement>) {
      if (!kind) return false;
      if (navigation.end(event)) return true;
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return true;
      cancel();
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (event.type !== "pointerup") return true;
      const end = toBin(event.clientX, event.clientY);
      if (!end || Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) <= (event.pointerType === "touch" ? 8 : 4)) return true;
      const pocket = createBasicPocket(kind, current.start, end, crypto.randomUUID());
      if (!pocket) return true;
      storeShape(pocket.shape);
      dispatch({ type: "ADD_PLACED", cutouts: [pocket.cutout], gridX: spec.gridX, gridY: spec.gridY,
        historyLabel: `Add ${kind} pocket` });
      dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
      return true;
    },
  };
}
