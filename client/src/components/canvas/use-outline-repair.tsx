import { useEffect, useState } from "react";
import { curvePath, curveRing, type CurveOutline } from "@shared/geometry/curves";
import { repairCurveSection, type SectionRepairResult } from "@shared/geometry/outline-repair";
import { curveFitRange } from "@shared/geometry/curve-fit";
import type { Point, RingRef } from "@shared/geometry/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpHint } from "@/components/ui/help-hint";

export interface RepairSection { ref: RingRef; start: number; end: number }
interface Session extends RepairSection { source: CurveOutline; mode: "line" | "curve"; bendText?: string; contextKey: string; unitsPerUnit: number; editableCurves: boolean }
interface Options {
  source: CurveOutline; enabled: boolean; contextKey: string; editableCurves: boolean;
  tolerance: number; unitsPerUnit: number; unit: "mm" | "px"; scale: number;
  toCanvas: (point: Point) => Point; onCommit: (source: CurveOutline, label: string) => void;
  onFrameSection?: (points: Point[]) => void;
}

/** Local replacement has its own Apply/Cancel session. Changing the photo,
 * source, calibration or representation invalidates the preview immediately.
 */
export function useOutlineRepair({ source, enabled, contextKey, editableCurves, tolerance, unitsPerUnit, unit, scale, toCanvas, onCommit, onFrameSection }: Options) {
  const [session, setSession] = useState<Session>();
  useEffect(() => { setSession(undefined); }, [source, enabled, contextKey, editableCurves, unitsPerUnit, tolerance]);
  const current = enabled && session?.source === source && session.contextKey === contextKey && session.unitsPerUnit === unitsPerUnit && session.editableCurves === editableCurves ? session : undefined;
  const dismiss = () => setSession(undefined);
  useEffect(() => {
    if (!current) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); dismiss(); } };
    window.addEventListener("keydown", escape, true); return () => window.removeEventListener("keydown", escape, true);
  }, [!!current]);
  let result: SectionRepairResult | undefined, error: string | undefined;
  if (current) try { result = repairCurveSection(source, current.ref, current.start, current.end,
    { mode: current.mode, bend: current.bendText === undefined ? undefined : current.bendText.trim() ? Number(current.bendText) / unitsPerUnit : NaN, editableCurves, tolerance }); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Could not repair this section."; }
  const ring = current && curveRing(source, current.ref), replacement = current && result && curveRing(result.curves, current.ref);
  const indices = current && ring ? curveFitRange(ring.length, current.start, current.end) : [];
  const frame = (section: RepairSection) => { const r = curveRing(source, section.ref); if (r) onFrameSection?.(curveFitRange(r.length, section.start, section.end).map(i => r[i].point)); };
  const start = (section: RepairSection) => { frame(section); setSession({ ...section, source, mode: "curve", contextKey, unitsPerUnit, editableCurves }); };
  const overlay = current && ring && <g pointerEvents="none" data-testid="outline-repair-overlay">
    {indices.slice(0, -1).map((index, i) => {
      const a = toCanvas(ring[index].point), b = toCanvas(ring[indices[i + 1]].point);
      return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-amber-500" strokeWidth={5} vectorEffect="non-scaling-stroke" />;
    })}
    {replacement && <path d={curvePath(replacement, toCanvas)} fill="none" className="stroke-emerald-500" strokeWidth={3} vectorEffect="non-scaling-stroke" data-testid="outline-repair-preview" />}
    {[current.start, current.end].map(index => { const p = toCanvas(ring[index].point); return <circle key={index} cx={p.x} cy={p.y} r={7 / Math.max(scale, 1e-6)} className="stroke-amber-500" fill="none" strokeWidth={3} vectorEffect="non-scaling-stroke" />; })}
  </g>;
  const controls = current && ring && <>
    <span className="text-sm font-medium">Repair section · preview</span>
    <HelpHint label="repairing an outline section">Replace the highlighted section between the two chosen endpoints. Line joins them directly. Smooth curve follows neighboring edges when possible; adjust Bend to change the bulge away from the straight line. This replaces a mistaken boundary, so it is not limited by the simplification allowance. Review against the photo. Apply makes one undoable edit.</HelpHint>
    <Button size="sm" variant={current.mode === "line" ? "secondary" : "outline"} aria-pressed={current.mode === "line"} onClick={() => setSession({ ...current, mode: "line" })}>Line</Button>
    <Button size="sm" variant={current.mode === "curve" ? "secondary" : "outline"} aria-pressed={current.mode === "curve"} onClick={() => setSession({ ...current, mode: "curve" })}>Smooth curve</Button>
    <Button size="sm" variant="outline" onClick={() => { const next = { ...current, start: current.end, end: current.start, bendText: undefined }; frame(next); setSession(next); }}>Other side</Button>
    {current.mode === "curve" && <>
      <label className="flex items-center gap-1 text-xs">Bend ({unit})<Input aria-label={`Repair curve bend (${unit})`} type="number" step="any" className="h-9 w-24"
        value={current.bendText ?? Number(((result?.bend ?? 0) * unitsPerUnit).toFixed(4))}
        onChange={event => setSession({ ...current, bendText: event.target.value })} /></label>
      <HelpHint label="repair curve bend">Signed distance at the middle of the curve from the straight line joining the endpoints. Zero is straight; changing the sign bends the other way. This is an intentional boundary edit, not pocket clearance.</HelpHint>
      <Button size="sm" variant="outline" onClick={() => setSession({ ...current, bendText: undefined })}>Follow neighboring edges</Button>
    </>}
    <p className="w-full text-xs text-muted-foreground">{editableCurves ? "The smooth curve keeps editable handles." : "The smooth curve is approximated with ordinary editable points."} Endpoints stay fixed.</p>
    {error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
    <Button size="sm" disabled={!result?.changed} onClick={() => { if (result?.changed) { onCommit(result.curves, current.mode === "line" ? "Repair outline with line" : "Repair outline with curve"); dismiss(); } }}>Apply repair</Button>
    <Button size="sm" variant="outline" onClick={dismiss}>Cancel repair</Button>
  </>;
  return { open: !!current, start, dismiss, overlay, controls };
}
