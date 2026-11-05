import { useEffect, useRef, useState } from "react";
import { curvePath, curveRing, type CurveOutline } from "@shared/geometry/curves";
import { curveFitRange, fitContour, type CurveFitResult } from "@shared/geometry/curve-fit";
import { reconstructDetectedOutline, recommendedReconstructionTolerance, type ReconstructionResult } from "@shared/geometry/contour-reconstruction";
import { reconstructInWorker } from "@/lib/detect/worker-client";
import type { Outline, Point, RingRef } from "@shared/geometry/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Options {
  source: CurveOutline;
  ringRef: RingRef;
  enabled: boolean;
  contextKey: string;
  /** mm per local unit, or 1 for uncalibrated px. Use the largest placement
   * scale so the bound also holds after stretching a Bin pocket. */
  unitsPerUnit: number;
  unit: "mm" | "px";
  scale: number;
  toCanvas: (point: Point) => Point;
  reconstructionSource?: Outline;
  onCommit: (curves: CurveOutline, label: string) => void;
}
interface Session {
  source: CurveOutline;
  contextKey: string;
  ref: RingRef;
  unitsPerUnit: number;
  mode: "auto" | "range" | "reconstruct";
  unit: "mm" | "px";
  start: number | null;
  end: number | null;
  deviation: string;
  result?: CurveFitResult | ReconstructionResult;
  pending?: boolean;
  error?: string;
}

/** Preview never writes to Trace/Bin. Only Apply invokes the single-commit path. */
export function useCurveFitting({ source, ringRef, enabled, contextKey, unitsPerUnit, unit, scale, toCanvas, onCommit, reconstructionSource }: Options) {
  const task = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const stop = () => { revision.current++; task.current?.abort(); task.current = null; };
  const dismiss = () => { stop(); setSession(null); };
  const [session, setSession] = useState<Session | null>(null);
  const current = enabled && session?.source === source && session.contextKey === contextKey
    && session.unitsPerUnit === unitsPerUnit && session.unit === unit && session.ref.shapeIndex === ringRef.shapeIndex
    && session.ref.ringIndex === ringRef.ringIndex ? session : null;
  useEffect(() => { dismiss(); return stop; }, [source, enabled, contextKey, ringRef.shapeIndex, ringRef.ringIndex, unitsPerUnit, unit, reconstructionSource]);
  useEffect(() => {
    if (!current) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); } };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [!!current]);
  const preview = (next: Session): Session => {
    try {
      if (next.mode === "range" && (next.start === null || next.end === null)) throw new Error("Choose the first and last point of the section.");
      const result = fitContour(source, ringRef, next.mode === "auto" ? { kind: "auto" }
        : { kind: "range", start: next.start!, end: next.end! }, Number(next.deviation) / unitsPerUnit);
      return { ...next, result, error: undefined };
    } catch (error) { return { ...next, result: undefined, error: error instanceof Error ? error.message : "Could not fit this contour." }; }
  };
  const performPreview = (next: Session) => {
    stop();
    if (next.mode !== "reconstruct") { setSession(preview(next)); return; }
    const controller = new AbortController(); task.current = controller;
    const request = revision.current;
    setSession({ ...next, result: undefined, error: undefined, pending: true });
    void (async () => {
      try {
        if (!reconstructionSource) throw new Error("The original detected boundary is no longer available.");
        const dense = reconstructionSource;
        const tolerance = Number(next.deviation) / unitsPerUnit;
        const result = typeof Worker === "undefined" ? reconstructDetectedOutline(source, dense, tolerance)
          : await reconstructInWorker({ source, dense, tolerance }, controller.signal);
        if (!controller.signal.aborted && request === revision.current) setSession({ ...next, result, pending: false });
      } catch (error) {
        if (!controller.signal.aborted && request === revision.current) setSession({ ...next, pending: false,
          error: error instanceof Error ? error.message : "Could not reconstruct this contour." });
      }
    })();
  };
  const start = (mode: Session["mode"]) => {
    const next: Session = { source, ref: ringRef, contextKey, unitsPerUnit, unit, mode, start: null, end: null, deviation: unit === "mm" ? "0.1" : "1" };
    if (mode === "reconstruct" && reconstructionSource) {
      const rings = reconstructionSource.flatMap(s => [s.outer, ...s.holes]);
      next.deviation = String(Math.ceil(Math.max(...rings.map(r => recommendedReconstructionTolerance(r, unitsPerUnit, unit))) * unitsPerUnit * 1000) / 1000);
    }
    if (mode === "range") { stop(); setSession(next); } else performPreview(next);
  };
  const change = (patch: Partial<Session>) => { if (current) { stop(); setSession({ ...current, ...patch, result: undefined, pending: false, error: undefined }); } };
  const pick = (ref: RingRef, index: number) => {
    if (!current || current.mode !== "range" || ref.shapeIndex !== ringRef.shapeIndex || ref.ringIndex !== ringRef.ringIndex) return;
    if (current.start === null || current.end !== null) change({ start: index, end: null });
    else change({ end: index });
  };
  const ring = curveRing(source, ringRef);
  const indices = current && ring && current.start !== null && current.end !== null
    ? curveFitRange(ring.length, current.start, current.end) : [];
  const previewRing = current?.result && curveRing(current.result.curves, ringRef);
  const overlay = current && ring && <g pointerEvents="none" data-testid="curve-fit-overlay">
    {indices.slice(0, -1).map((index, i) => {
      const a = toCanvas(ring[index].point), b = toCanvas(ring[indices[i + 1]].point);
      return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-amber-500" strokeWidth={5} vectorEffect="non-scaling-stroke" />;
    })}
    {[current.start, current.end].map((index, i) => {
      if (index === null) return null;
      const p = toCanvas(ring[index].point);
      return <circle key={i} cx={p.x} cy={p.y} r={7 / Math.max(scale, 1e-6)} fill="none" className="stroke-amber-500" strokeWidth={3} vectorEffect="non-scaling-stroke" />;
    })}
    {current.mode === "reconstruct" && reconstructionSource?.flatMap(s => [s.outer, ...s.holes]).map((r, i) => <path key={`raw:${i}`} d={`M${r.map(p => { const q = toCanvas(p); return `${q.x},${q.y}`; }).join(" L")} Z`} fill="none" className="stroke-muted-foreground" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" data-testid="reconstruction-source" />)}
    {current.mode === "reconstruct" && current.result?.curves.flatMap(s => [s.outer, ...s.holes]).map((r, i) => <path key={`reconstructed:${i}`} d={curvePath(r, toCanvas)} fill="none" className="stroke-emerald-500" strokeWidth={3} vectorEffect="non-scaling-stroke" data-testid="curve-fit-preview" />)}
    {current.mode !== "reconstruct" && previewRing && <path d={curvePath(previewRing, toCanvas)} fill="none" className="stroke-emerald-500" strokeWidth={3} vectorEffect="non-scaling-stroke" data-testid="curve-fit-preview" />}
  </g>;
  const actions = !current && <>
    {!!reconstructionSource?.length && !source.some(s => [s.outer, ...s.holes].some(r => r.some(a => a.in || a.out))) &&
      <Button size="sm" variant="outline" onClick={() => start("reconstruct")}>Reconstruct lines &amp; curves</Button>}
    <Button size="sm" variant="outline" onClick={() => start("range")}>Fit selected points</Button>
    <Button size="sm" variant="outline" onClick={() => start("auto")}>Auto-fit contour</Button>
  </>;
  const controls = current && ring && <>
    <span className="text-sm font-medium">{current.mode === "reconstruct" ? "Reconstruct lines & curves" : current.mode === "auto" ? "Auto-fit contour" : "Fit selected points"}</span>
    <p className="w-full text-xs text-muted-foreground">{current.mode === "reconstruct" ? "Rebuild all detected contours from their dense boundaries. Prefer supported lines; fit curves elsewhere. The visible allowance is against that boundary, not the photograph. Apply is one undoable edit." : current.mode === "auto"
      ? "Preview this contour only. Corners and existing curves are kept. Apply makes one undoable edit."
      : "Tap the first and last point, or choose them below. The highlighted section follows the point numbers; Swap ends selects the other way around."}</p>
    {current.mode === "range" && <>
      {(["start", "end"] as const).map(key => <label key={key} className="flex items-center gap-1 text-xs">{key === "start" ? "First" : "Last"}
        <select aria-label={key === "start" ? "First fit point" : "Last fit point"} value={current[key] ?? ""}
          className="h-9 max-w-32 rounded border bg-background px-1 text-xs" onChange={e => change({ [key]: e.target.value === "" ? null : Number(e.target.value) })}>
          <option value="">Choose point</option>
          {ring.map((_, i) => <option key={i} value={i}>Point {i + 1}</option>)}
        </select>
      </label>)}
      <Button size="sm" variant="outline" disabled={current.start === null || current.end === null}
        onClick={() => change({ start: current.end, end: current.start })}>Swap ends</Button>
      {indices.length > 0 && <span className="text-xs">{indices.length} points selected</span>}
    </>}
    <label className="flex items-center gap-1 text-xs">Max deviation ({unit})
      <Input aria-label={`Maximum fit deviation (${unit})`} type="number" min="0" step="any" value={current.deviation}
        className="h-9 w-24" onChange={e => change({ deviation: e.target.value })} />
    </label>
    <Button size="sm" variant="outline" disabled={current.pending} onClick={() => performPreview(current)}>Preview fit</Button>
    {current.pending && <p role="status" className="w-full text-xs">Reconstructing contour…</p>}
    {current.result && <p className="w-full text-xs" role="status">
      {current.result.changed ? <>{current.result.before} → {current.result.after} points. {"lines" in current.result && <>{current.result.lines} lines · {current.result.cubics} curves. </>} Deviation ≤ {(Math.ceil(current.result.maxDeviation * unitsPerUnit * 10000) / 10000).toFixed(4)} {unit}. Green is the preview.</>
        : "No changes needed at this deviation."}
    </p>}
    {current.error && <p className="w-full text-xs text-destructive" role="alert">{current.error}</p>}
    <Button size="sm" disabled={!current.result?.changed} onClick={() => {
      if (!current.result?.changed) return;
      onCommit(current.result.curves, current.mode === "reconstruct" ? "Reconstruct lines and curves" : current.mode === "auto" ? "Auto-fit contour" : "Fit selected points");
      dismiss();
    }}>Apply fit</Button>
    <Button size="sm" variant="outline" onClick={dismiss}>Cancel fit</Button>
  </>;
  return { open: !!current, pick, overlay, actions, controls };
}
