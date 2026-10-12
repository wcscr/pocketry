import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { normalizeSurfaceTextRotation, surfaceTextName, type SurfaceText } from "@shared/gridfinity/surface-text";
import { binToCanvas } from "@shared/gridfinity/cutout";
import { useSurfaceTextWording } from "./use-surface-text-wording";
import { canHandleCanvasShortcut } from "@/lib/canvas-keyboard";
import { surfaceTextOutline } from "@/lib/gridfinity/surface-text";
import { STACKING_RIM_COLOR } from "@/lib/gridfinity/pocket-floor-mesh";
import { Input } from "@/components/ui/input";
import { useBin } from "@/state/bin-store";
import { useSelectionInspector } from "./selection-inspector-context";
import { useObjectToolbar } from "./object-toolbar-context";

/** Millimetre SVG outlines share the printable font, including letter holes. */
export function SurfaceTextLayer({ interactive, onSelect, inverseScale = 1, edgeBandColor = STACKING_RIM_COLOR }: {
  interactive: boolean; onSelect?: (id: string, inline?: boolean) => void; inverseScale?: number; edgeBandColor?: string;
}): JSX.Element {
  const { spec, selectedSurfaceTextId, dispatch, history, textTool, textSnap } = useBin();
  const inspector = useSelectionInspector();
  const toolbar = useObjectToolbar();
  const group = useRef<SVGGElement>(null);
  const editingAllowed = useRef(interactive);
  editingAllowed.current = interactive;
  const [editingId, setEditingId] = useState<string | null>(null);
  const drag = useRef<{
    kind: "move" | "rotate"; pointerId: number; id: string; start: DOMPoint; center: { x: number; y: number };
    clientX: number; clientY: number; moved: boolean; original: SurfaceText; labels: SurfaceText[];
  } | null>(null);
  // Undo, project replacement, or another committed edit ends the old gesture.
  useEffect(() => { drag.current = null; setEditingId(null); }, [history]);
  useEffect(() => { if (!interactive || editingId !== selectedSurfaceTextId) setEditingId(null); }, [interactive, selectedSurfaceTextId]);
  const labels = useMemo(() => spec.surfaceTexts.map(label => {
    try {
      const outline = surfaceTextOutline(label);
      const rings = outline.flatMap(shape => [shape.outer, ...shape.holes]).map(ring => ring.map(p => binToCanvas(p, spec)));
      const d = rings.map(ring => ring.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ") + "Z").join(" ");
      const points = rings.flat();
      const bounds = points.length ? points.reduce((box, p) => ({
        minX: Math.min(box.minX, p.x), minY: Math.min(box.minY, p.y),
        maxX: Math.max(box.maxX, p.x), maxY: Math.max(box.maxY, p.y),
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }) : null;
      const angle = label.rotationDeg * Math.PI / 180;
      const center = binToCanvas(label.position, spec);
      let top = -Infinity;
      for (const shape of outline) for (const p of shape.outer) {
        top = Math.max(top, -(p.x - label.position.x) * Math.sin(angle) + (p.y - label.position.y) * Math.cos(angle));
      }
      const atHeight = (height: number) => ({ x: center.x - Math.sin(angle) * height, y: center.y - Math.cos(angle) * height });
      return { label, d, bounds, center, stem: atHeight(top), handle: atHeight(top + 24 * inverseScale) };
    } catch { return { label, d: "", bounds: null, center: binToCanvas(label.position, spec), stem: null, handle: null }; }
  }), [spec, inverseScale]);
  const commit = () => {
    const active = drag.current;
    drag.current = null;
    if (active?.moved) dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: active.labels }, historyLabel: active.kind === "rotate" ? "Rotate surface text" : "Move surface text" });
  };
  const cancel = () => {
    const active = drag.current;
    drag.current = null;
    if (active?.moved) dispatch({ type: "CANCEL_PREVIEW", expectedHistory: history });
  };
  useEffect(() => { if (!interactive) cancel(); }, [interactive]);
  useEffect(() => {
    window.addEventListener("blur", commit);
    return () => { window.removeEventListener("blur", commit); commit(); };
  }, []);
  // Match the existing Layout shortcuts while leaving text inputs, dialogs,
  // and panning in control of their own keyboard events.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!interactive || editingId || !canHandleCanvasShortcut(event) || event.altKey || event.ctrlKey || event.metaKey) return;
      const label = spec.surfaceTexts.find(item => item.id === selectedSurfaceTextId);
      if (!label) return;
      if (["w", "e"].includes(event.key.toLowerCase())) {
        const tool = event.key.toLowerCase() === "w" ? "translate" : "rotate";
        event.preventDefault(); dispatch({ type: "SET_TEXT_TOOL", tool }); (inspector ?? toolbar)?.setTool(tool); return;
      }
      const active = drag.current;
      if (active) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault(); dispatch({ type: "SELECT_SURFACE_TEXT", id: null }); return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: spec.surfaceTexts.filter(item => item.id !== label.id) }, historyLabel: "Remove surface text" });
        return;
      }
      const step = event.shiftKey ? 0.1 : 1;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0;
      const rotate = event.key.toLowerCase() === "r";
      if (!dx && !dy && !rotate) return;
      event.preventDefault();
      const clamp = (value: number) => Math.max(-672, Math.min(672, value));
      const next = rotate ? { ...label, rotationDeg: normalizeSurfaceTextRotation(label.rotationDeg + (event.shiftKey ? -15 : 15)) }
        : { ...label, position: { x: clamp(label.position.x + dx), y: clamp(label.position.y + dy) } };
      dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: spec.surfaceTexts.map(item => item.id === label.id ? next : item) }, historyLabel: rotate ? "Rotate surface text" : "Move surface text" });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [interactive, editingId, selectedSurfaceTextId, spec.surfaceTexts, dispatch]);
  const point = (event: PointerEvent<SVGElement>) => {
    const matrix = group.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
  };
  const begin = (event: PointerEvent<SVGElement>, label: SurfaceText, kind: "move" | "rotate") => {
    if (!interactive || editingId || event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
    const start = point(event);
    if (!start) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dispatch({ type: "SELECT_SURFACE_TEXT", id: label.id });
    if (inspector?.tool !== "translate" && inspector?.tool !== "rotate") inspector?.setTool("properties");
    drag.current = { kind, pointerId: event.pointerId, id: label.id, start, center: binToCanvas(label.position, spec), clientX: event.clientX, clientY: event.clientY, moved: false, original: label, labels: spec.surfaceTexts };
  };
  return <g ref={group} data-testid="surface-text-layer">
    {labels.map(({ label, d, bounds, center, stem, handle }) => <g key={label.id} className="group"
      style={{ cursor: interactive ? "grab" : undefined }}
      onPointerDown={event => begin(event, label, (inspector ? inspector.tool === "rotate" : textTool === "rotate") ? "rotate" : "move")}
      onDoubleClick={event => {
        if (!interactive || event.button !== 0) return;
        event.stopPropagation();
        commit();
        dispatch({ type: "SELECT_SURFACE_TEXT", id: label.id });
        inspector?.setTool("properties");
        onSelect?.(label.id, true);
        setEditingId(label.id);
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (!interactive || !active || active.pointerId !== event.pointerId) return;
        event.stopPropagation();
        const next = point(event);
        if (!next) return;
        const clamp = (value: number) => Math.max(-672, Math.min(672, value));
        let patch: Partial<SurfaceText>;
        if (active.kind === "rotate") {
          const angle = (p: { x: number; y: number }) => Math.atan2(active.center.y - p.y, p.x - active.center.x);
          let rotation = active.original.rotationDeg + (angle(next) - angle(active.start)) * 180 / Math.PI;
          // Same near-angle snapping as pocket and finger-access handles; Alt frees it.
          const nearest = Math.round(rotation / 15) * 15;
          if (!event.altKey && Math.abs(nearest - rotation) <= 3) rotation = nearest;
          if (!event.altKey && textSnap) rotation = Math.round(rotation / 5) * 5;
          patch = { rotationDeg: normalizeSurfaceTextRotation(rotation) };
        } else {
          const snap = (value: number) => clamp(textSnap && !event.altKey ? Math.round(value) : value);
          patch = { position: { x: snap(active.original.position.x + next.x - active.start.x), y: snap(active.original.position.y - next.y + active.start.y) } };
        }
        const current = active.labels.find(item => item.id === active.id)!;
        if ((!patch.position || patch.position.x === current.position.x && patch.position.y === current.position.y) &&
          (patch.rotationDeg === undefined || patch.rotationDeg === current.rotationDeg)) return;
        active.moved = true;
        active.labels = spec.surfaceTexts.map(item => item.id === active.id ? { ...item, ...patch } : item);
        dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: active.labels }, transient: true, historyLabel: active.kind === "rotate" ? "Rotate surface text" : "Move surface text" });
      }}
      onPointerUp={event => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.stopPropagation();
        commit();
        if (active.kind === "move" && Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) <= 4) onSelect?.(label.id);
      }}
      onPointerCancel={event => { if (drag.current) { event.stopPropagation(); cancel(); } }}
      onLostPointerCapture={commit}>
      <title>{`Text: ${surfaceTextName(label)}${interactive ? " — double-click to edit wording" : ""}`}</title>
      {/* Include letter holes and spaces in the hit area so a missed stroke
          cannot select or move a pocket underneath the label. */}
      {bounds && <rect x={bounds.minX - 0.5} y={bounds.minY - 0.5}
        width={bounds.maxX - bounds.minX + 1} height={bounds.maxY - bounds.minY + 1}
        className={interactive && selectedSurfaceTextId === label.id ? "fill-transparent stroke-primary" : interactive ? "fill-transparent stroke-transparent group-hover:stroke-primary/50" : "fill-transparent stroke-transparent"}
        strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
        pointerEvents={interactive ? "all" : "none"} data-testid={`surface-text-hit-${label.id}`} />}
      <path d={d} fillRule="nonzero" fill={spec.textColor ?? edgeBandColor}
        stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.6} vectorEffect="non-scaling-stroke"
        pointerEvents="none" data-testid={`surface-text-${label.id}`} />
      {interactive && selectedSurfaceTextId === label.id && !editingId && stem && handle && <>
        <line x1={stem.x} y1={stem.y} x2={handle.x} y2={handle.y} className="stroke-primary" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <circle cx={handle.x} cy={handle.y} r={6 * inverseScale} className="fill-primary stroke-background" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
          style={{ cursor: 'url("/cursors/rotate.svg") 16 16, grab' }} data-testid={`surface-text-rotate-handle-${label.id}`}
          onPointerDown={event => begin(event, label, "rotate")} onDoubleClick={event => event.stopPropagation()}>
          <title>Drag to rotate text (Alt disables angle snapping)</title>
        </circle>
      </>}
      {interactive && editingId === label.id && <g transform={`translate(${center.x} ${center.y}) scale(${inverseScale})`}>
        <InlineTextEditor key={label.id} label={label} onClose={() => setEditingId(null)}
          commitOnUnmount={() => editingAllowed.current} />
      </g>}
    </g>)}
  </g>;
}

/** Native input over the label keeps editing accessible without substituting printable outlines. */
function InlineTextEditor({ label, onClose, commitOnUnmount }: {
  label: SurfaceText; onClose: () => void; commitOnUnmount: () => boolean;
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const { draft, error, change, commit, cancel } = useSurfaceTextWording(label, { onDone: onClose, commitOnUnmount });
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <foreignObject x={-140} y={-20} width={280} height={100} style={{ overflow: "visible", cursor: "text" }}
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <div className="rounded-md border bg-background p-1 shadow-lg">
      <Input ref={input} aria-label="Edit surface text wording" aria-invalid={!!error} value={draft} maxLength={120} className="h-8 text-sm"
        onChange={event => change(event.target.value)} onBlur={commit}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === "Enter") { event.preventDefault(); commit(); }
          if (event.key === "Escape") { event.preventDefault(); cancel(); onClose(); }
        }} />
      {error && <p role="alert" className="p-1 text-xs text-destructive">{error}</p>}
    </div>
  </foreignObject>;
}
