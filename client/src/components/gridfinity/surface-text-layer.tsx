import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import type { SurfaceText } from "@shared/gridfinity/surface-text";
import { binToCanvas } from "@shared/gridfinity/cutout";
import { surfaceTextOutline } from "@/lib/gridfinity/surface-text";
import { STACKING_RIM_COLOR } from "@/lib/gridfinity/pocket-floor-mesh";
import { useBin } from "@/state/bin-store";
import { useSelectionInspector } from "./selection-inspector-context";

/** Millimetre SVG outlines share the printable font, including letter holes. */
export function SurfaceTextLayer({ interactive, edgeBandColor = STACKING_RIM_COLOR }: { interactive: boolean; edgeBandColor?: string }): JSX.Element {
  const { spec, dispatch, history } = useBin();
  const inspector = useSelectionInspector();
  const group = useRef<SVGGElement>(null);
  const drag = useRef<{ pointerId: number; id: string; start: DOMPoint; position: SurfaceText["position"]; labels: SurfaceText[] } | null>(null);
  // Undo, project replacement, or another committed edit ends the old gesture.
  useEffect(() => { drag.current = null; }, [history]);
  const labels = useMemo(() => spec.surfaceTexts.map(label => {
    try {
      const rings = surfaceTextOutline(label).flatMap(shape => [shape.outer, ...shape.holes]);
      const d = rings.map(ring => ring.map((p, i) => {
        const point = binToCanvas(p, spec);
        return `${i ? "L" : "M"}${point.x} ${point.y}`;
      }).join(" ") + "Z").join(" ");
      return { label, d };
    } catch { return { label, d: "" }; }
  }), [spec]);
  const commit = () => {
    if (!drag.current) return;
    dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: drag.current.labels }, historyLabel: "Move surface text" });
    drag.current = null;
  };
  // Finish a live gesture once when editing is disabled; later pointer events
  // must not keep moving the label through the experimental opt-out.
  useEffect(() => { if (!interactive) commit(); }, [interactive]);
  useEffect(() => {
    window.addEventListener("blur", commit);
    return () => { window.removeEventListener("blur", commit); commit(); };
  }, []);
  const point = (event: PointerEvent<SVGPathElement>) => {
    const matrix = group.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
  };
  return <g ref={group} data-testid="surface-text-layer">
    {labels.map(({ label, d }) => <path key={label.id} d={d} fillRule="nonzero"
      fill={spec.textColor ?? edgeBandColor} stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.6} vectorEffect="non-scaling-stroke"
      style={{ cursor: interactive ? "grab" : undefined }}
      pointerEvents={interactive ? "visiblePainted" : "none"} data-testid={`surface-text-${label.id}`}
      onPointerDown={event => {
        if (!interactive || event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
        const start = point(event);
        if (!start) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        inspector?.showSection("bin-settings-text");
        drag.current = { pointerId: event.pointerId, id: label.id, start, position: label.position, labels: spec.surfaceTexts };
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (!interactive || !active || active.pointerId !== event.pointerId) return;
        event.stopPropagation();
        const next = point(event);
        if (!next) return;
        const clamp = (value: number) => Math.max(-672, Math.min(672, value));
        const position = { x: clamp(active.position.x + next.x - active.start.x), y: clamp(active.position.y - next.y + active.start.y) };
        active.labels = spec.surfaceTexts.map(item => item.id === active.id ? { ...item, position } : item);
        dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: active.labels }, transient: true, historyLabel: "Move surface text" });
      }}
      onPointerUp={event => { if (drag.current) { event.stopPropagation(); commit(); } }}
      onPointerCancel={event => { if (drag.current) { event.stopPropagation(); commit(); } }}
      onLostPointerCapture={commit}>
      <title>{`Text: ${label.text}`}</title>
    </path>)}
  </g>;
}
