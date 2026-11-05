import { useEffect, useRef, useState } from "react";
import { curvePath, curveRing, type CurveOutline } from "@shared/geometry/curves";
import { curveFitRange, fitContour, type CurveFitResult } from "@shared/geometry/curve-fit";
import { reconstructDetectedOutline, recommendedReconstructionTolerance, type ReconstructionResult } from "@shared/geometry/contour-reconstruction";
import { reconstructInWorker } from "@/lib/detect/worker-client";
import type { Outline, Point, RingRef } from "@shared/geometry/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpHint } from "@/components/ui/help-hint";

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
  const [showOriginal, setShowOriginal] = useState(false);
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
    setShowOriginal(false);
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
  const start = (mode: Session["mode"], range?: { start: number; end: number }) => {
    const next: Session = { source, ref: ringRef, contextKey, unitsPerUnit, unit, mode, start: null, end: null, deviation: unit === "mm" ? "0.1" : "1" };
    if (range) { next.start = range.start; next.end = range.end; }
    if (mode === "reconstruct" && reconstructionSource) {
      const rings = reconstructionSource.flatMap(s => [s.outer, ...s.holes]);
      next.deviation = String(Math.ceil(Math.max(...rings.map(r => recommendedReconstructionTolerance(r, unitsPerUnit, unit))) * unitsPerUnit * 1000) / 1000);
    }
    if (mode === "range" && !range) { stop(); setSession(next); } else performPreview(next);
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
  const recommended = reconstructionSource?.length ? Math.max(...reconstructionSource.flatMap(s => [s.outer, ...s.holes]).map(r => recommendedReconstructionTolerance(r, unitsPerUnit, unit))) * unitsPerUnit : 1;
  const presets = [{ value: "fine", label: "More detail", allowance: recommended / 2 },
    { value: "balanced", label: "Balanced", allowance: recommended }, { value: "smooth", label: "Smoother", allowance: recommended * 2 }];
  const preset = current && presets.find(p => Math.abs(Number(current.deviation) - Math.ceil(p.allowance * 1000) / 1000) < 1e-9)?.value;
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
    {current.mode === "reconstruct" && (showOriginal || !current.result) && reconstructionSource?.flatMap(s => [s.outer, ...s.holes]).map((r, i) => <path key={`raw:${i}`} d={`M${r.map(p => { const q = toCanvas(p); return `${q.x},${q.y}`; }).join(" L")} Z`} fill="none" className="stroke-muted-foreground" strokeWidth={2} vectorEffect="non-scaling-stroke" data-testid="reconstruction-source" />)}
    {current.mode === "reconstruct" && !showOriginal && current.result?.curves.flatMap(s => [s.outer, ...s.holes]).map((r, i) => <path key={`reconstructed:${i}`} d={curvePath(r, toCanvas)} fill="none" className="stroke-emerald-500" strokeWidth={3} vectorEffect="non-scaling-stroke" data-testid="curve-fit-preview" />)}
    {current.mode !== "reconstruct" && previewRing && <path d={curvePath(previewRing, toCanvas)} fill="none" className="stroke-emerald-500" strokeWidth={3} vectorEffect="non-scaling-stroke" data-testid="curve-fit-preview" />}
  </g>;
  const actions = !current && <>
    {!!reconstructionSource?.length && !source.some(s => [s.outer, ...s.holes].some(r => r.some(a => a.in || a.out))) &&
      <Button size="sm" variant="outline" title="Simplify the detected outline with supported straight lines and smooth curves. Review the preview before applying." onClick={() => start("reconstruct")}>Auto-simplify outline</Button>}
    <Button size="sm" variant="outline" onClick={() => start("range")}>Select a section</Button>
    <Button size="sm" variant="outline" onClick={() => start("auto")}>Auto-fit contour</Button>
  </>;
  const controls = current && ring && <>
    <span className="text-sm font-medium">{current.mode === "reconstruct" ? "Auto-simplify outline · preview" : current.mode === "auto" ? "Auto-fit contour" : "Simplify selected section · preview"}</span>
    {current.mode === "reconstruct" && <HelpHint label="auto-simplify outline">Simplify detected edges into straight lines and smooth curves while keeping supported corners. Review the green preview before applying. Cancel leaves the outline unchanged; Undo restores it after applying.</HelpHint>}
    {current.mode !== "reconstruct" && <p className="w-full text-xs text-muted-foreground">{current.mode === "auto"
      ? "Preview this contour only. Corners and existing curves are kept. Apply makes one undoable edit."
      : "Choose the first and last point of one continuous section. The highlighted points are selected; Swap ends chooses the other way around the outline."}</p>}
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
    {current.mode === "reconstruct" && <div className="flex w-full items-center gap-2"><label className="flex items-center gap-2 text-xs">Detail
      <select className="h-10 rounded-md border bg-background px-2 text-sm" aria-label="Outline detail" value={preset ?? "custom"}
        onChange={event => { const selected = presets.find(p => p.value === event.target.value); if (selected) performPreview({ ...current, deviation: String(Math.ceil(selected.allowance * 1000) / 1000) }); }}>
        {presets.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        {!preset && <option value="custom">Custom</option>}
      </select></label><HelpHint label="outline detail">More detail follows small features more closely. Smoother removes more small bumps and uses fewer points. Balanced starts from the detected boundary’s sampling detail. These choices change the boundary allowance, not the detection method or pocket clearance.</HelpHint></div>}
    {current.mode === "reconstruct" ? <details className="w-full"><summary className="cursor-pointer py-2 text-xs">Advanced: boundary allowance</summary>
      <div className="flex flex-wrap items-center gap-2"><label className="flex flex-wrap items-center gap-1 text-xs">Maximum change from detected outline ({unit})
        <Input aria-label={`Maximum change from detected outline (${unit})`} type="number" min="0" step="any" value={current.deviation}
          className="h-9 w-24" onChange={e => change({ deviation: e.target.value })} />
      </label><HelpHint label="boundary allowance">The maximum distance the simplified line or curve can move from the detected boundary. For example, 0.2 mm allows up to 0.2 mm of boundary change. Smaller values keep more detail. This is not tool measurement accuracy or clearance added around a pocket.</HelpHint>
      <Button size="sm" variant="outline" disabled={current.pending} onClick={() => performPreview(current)}>Update preview</Button></div></details>
      : <><label className="flex flex-wrap items-center gap-1 text-xs">Maximum change from current outline ({unit})
      <Input aria-label={`Maximum change from current outline (${unit})`} type="number" min="0" step="any" value={current.deviation}
        className="h-9 w-24" onChange={e => change({ deviation: e.target.value })} />
    </label><HelpHint label="section boundary allowance">Maximum distance from the current outline’s points and edges to the fitted replacement. Calibration converts the distance to millimeters. Smaller values preserve more detail; larger values allow more smoothing. This does not add pocket clearance.</HelpHint>
    <Button size="sm" variant="outline" disabled={current.pending} onClick={() => performPreview(current)}>Preview fit</Button></>}
    {current.pending && <p role="status" className="w-full text-xs">Simplifying outline…</p>}
    {current.result && <p className="w-full text-xs" role="status">
      {current.result.changed ? <>{current.result.before} → {current.result.after} points. {"lines" in current.result && <>{current.result.lines} lines · {current.result.cubics} curves. </>} Maximum change from {current.mode === "reconstruct" ? "detected" : "current"} outline ≤ {(Math.ceil(current.result.maxDeviation * unitsPerUnit * 10000) / 10000).toFixed(4)} {unit}. Green is the preview.</>
        : "No changes needed at this deviation."}
    </p>}
    {current.error && <p className="w-full text-xs text-destructive" role="alert">{current.error}</p>}
    {current.mode === "reconstruct" && current.result && <label className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={showOriginal} onChange={event => setShowOriginal(event.target.checked)} />Show original outline</label>}
    <Button size="sm" disabled={!current.result?.changed} onClick={() => {
      if (!current.result?.changed) return;
      onCommit(current.result.curves, current.mode === "reconstruct" ? "Auto-simplify outline" : current.mode === "auto" ? "Auto-fit contour" : "Fit selected points");
      dismiss();
    }}>{current.mode === "reconstruct" ? "Apply simplified outline" : "Apply fit"}</Button>
    <Button size="sm" variant="outline" onClick={dismiss}>{current.mode === "reconstruct" ? "Cancel" : "Cancel fit"}</Button>
  </>;
  return { open: !!current, pick, overlay, actions, controls, start, dismiss };
}
