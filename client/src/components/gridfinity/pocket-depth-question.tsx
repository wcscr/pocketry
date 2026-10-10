import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { defaultPocketFloorThicknessMm, pocketName, resolvePocketDepth, type DepthSpec } from "@shared/gridfinity/cutout";
import type { BinSpec } from "@shared/gridfinity/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { useTrace } from "@/state/trace-store";
import { usePanelState } from "@/components/layout/panel-context";
import { useMobileWorkspaceActions } from "@/components/layout/mobile-workspace-actions";

/** One depth decision, shared by the canvas prompt and ordinary pocket properties. */
export function PocketDepthQuestion({ spec, name, count = 1, onSave, onLater }: {
  spec: BinSpec;
  name: string;
  count?: number;
  onSave: (depth: DepthSpec, all: boolean) => void;
  onLater?: () => void;
}) {
  const guidanceId = useId();
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"mm" | "remaining" | "through">("mm");
  const [all, setAll] = useState(false);
  const depth = Number(value.trim().replace(",", "."));
  const floor = defaultPocketFloorThicknessMm(spec);
  const top = resolvePocketDepth(spec, { mode: "through" }).infillTopZ;
  const maximum = Math.min(120, Math.floor((top - floor) * 10) / 10);
  const valid = mode === "through" || (mode === "remaining" ? maximum > 0
    : value.trim() !== "" && Number.isFinite(depth) && depth >= 1 && depth <= maximum);
  const chosen: DepthSpec = mode === "mm" ? { mode, value: depth }
    : mode === "remaining" ? { mode, floorThicknessMm: floor } : { mode };
  const fraction = mode === "through" ? 1 : mode === "remaining" ? Math.max(0, maximum / top)
    : valid ? depth / top : 0.45;
  return <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (valid) onSave(chosen, all); }}>
    <div>
      <h2 className="text-sm font-semibold">How deep should this pocket be?</h2>
      <p className="truncate text-xs text-muted-foreground" title={name}>{name}{count > 1 ? ` · ${count} pockets need depth` : ""}</p>
    </div>
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        {mode === "mm" ? <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Pocket depth (mm)</span>
          <Input aria-label="Pocket depth (mm)" inputMode="decimal" className="h-11 w-24" value={value} placeholder="Depth" aria-invalid={value !== "" && !valid}
            aria-describedby={guidanceId} onChange={event => setValue(event.target.value)} />
          <span>mm</span>
        </label> : <p className="text-sm font-medium">{mode === "remaining" ? "To bin floor" : "Through — no bottom"}</p>}
        <p id={guidanceId} className="mt-1 text-xs text-muted-foreground">
          {mode === "through" ? "Cuts through the bottom. The surface underneath must support the tool."
            : mode === "remaining" ? `Keeps a ${floor} mm floor above the bin underside.`
            : maximum < 1 ? "Increase the bin height to leave room for a pocket."
            : value !== "" && !valid ? `Enter a depth from 1 to ${maximum} mm, or increase the bin height.`
            : "Measure below the bin surface."}
        </p>
      </div>
      <svg viewBox="0 0 100 60" className="h-14 w-24 shrink-0 text-primary [@media(max-height:500px)_and_(min-width:560px)]:hidden" role="img" aria-label="Side view of pocket depth">
        <path d={`M5 5 H25 V${5 + 48 * Math.min(1, Math.max(0, fraction))} H75 V5 H95 V55 H5 Z`}
          fill="currentColor" opacity="0.2" stroke="currentColor" />
        <path d={`M50 5 V${5 + 48 * Math.min(1, Math.max(0, fraction))}`} stroke="currentColor" strokeWidth="2" strokeDasharray={!valid ? "3 2" : undefined} />
        <path d="M25 5 H75" stroke="currentColor" strokeDasharray="2 2" />
      </svg>
    </div>
    <details className="text-xs">
      <summary className="w-fit cursor-pointer py-1 text-muted-foreground">Other depth options</summary>
      <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Pocket depth options">
        {([ ["mm", "Fixed depth"], ["remaining", "To bin floor"], ["through", "Through — no bottom"] ] as const).map(([choice, label]) =>
          <Button key={choice} type="button" size="sm" className="min-h-9 whitespace-normal" variant={mode === choice ? "secondary" : "outline"}
            aria-pressed={mode === choice} onClick={() => setMode(choice)}>{label}</Button>)}
      </div>
    </details>
    {count > 1 && <label className="flex min-h-8 items-center gap-2 text-xs">
      <input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} />
      Use this depth for all {count} pockets
    </label>}
    <div className="flex items-center gap-2">
      <Button type="submit" size="sm" className="min-h-10 flex-1" disabled={!valid}>Done</Button>
      {onLater && <Button type="button" size="sm" className="min-h-10" variant="ghost" onClick={onLater}>Set later</Button>}
    </div>
  </form>;
}

/** Non-modal: keep the selected outline and the rest of the bin available. */
export function PendingPocketDepthPrompt({ request, fallback }: { request: number; fallback?: ReactNode }) {
  const { spec, cutouts, selectedCutoutId, dispatch } = useBin();
  const { shapes } = useShapeLibrary();
  const { dispatch: dispatchTrace } = useTrace();
  const { setPanelOpen } = usePanelState();
  const [, navigate] = useLocation();
  const traceAnotherPhoto = () => {
    dispatchTrace({ type: "SOURCE_CLEARED" });
    setPanelOpen(false);
    navigate("/");
  };
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [finished, setFinished] = useState(false);
  const workspace = useMobileWorkspaceActions();
  const showCanvas = useRef(workspace?.showCanvas);
  showCanvas.current = workspace?.showCanvas;
  const pending = cutouts.filter(cutout => cutout.depthPending);
  const selected = pending.find(cutout => cutout.id === selectedCutoutId);
  useEffect(() => {
    if (request) setDismissed(new Set());
  }, [request]);
  useEffect(() => { if (selected) showCanvas.current?.(); }, [selected?.id, request]);
  if (!selected && pending.length) return <><div className="flex shrink-0 items-center justify-center gap-3 border-t bg-background px-3 py-1 text-xs">
    <span>{pending.length} {pending.length === 1 ? "pocket needs" : "pockets need"} depth</span>
    <Button variant="outline" size="sm" onClick={() => {
      setDismissed(new Set()); dispatch({ type: "SELECT_CUTOUT", id: pending[0].id }); dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
    }}>Set depth</Button>
  </div>{fallback}</>;
  if (!selected) return <>{finished && <div className="flex shrink-0 justify-end border-t bg-background px-3 py-1">
    <Button variant="ghost" size="sm" onClick={traceAnotherPhoto}>Trace another photo</Button>
  </div>}{fallback}</>;
  const name = pocketName(selected, shapes.find(shape => shape.id === selected.shapeId));
  return <><div className={fallback ? "bg-background p-1" : "max-h-[45dvh] shrink-0 overflow-y-auto border-t bg-background p-3"} data-testid="pending-pocket-depth">
    <div className="mx-auto w-full max-w-md">
      {dismissed.has(selected.id) ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="min-w-0 flex-1 truncate">{name} · Depth needed</span>
        <Button variant="outline" size="sm" onClick={() => setDismissed(new Set())}>Set depth</Button>
        <Button variant="ghost" size="sm" onClick={traceAnotherPhoto}>Trace another photo</Button>
      </div> : <PocketDepthQuestion key={selected.id} spec={spec} name={name} count={pending.length}
        onLater={() => { setDismissed(new Set(pending.map(cutout => cutout.id))); setFinished(true); }}
        onSave={(depth, all) => {
          const targets = all ? pending : [selected];
          dispatch({ type: "UPDATE_OBJECTS", edits: { cutouts: targets.map(cutout => ({ ...cutout, depth, depthPending: undefined, fillHeightReference: undefined })), fingerHoles: [] }, historyLabel: all ? "Set pocket depths" : "Set pocket depth" });
          const next = pending.find(cutout => !targets.includes(cutout) && !dismissed.has(cutout.id));
          if (next) dispatch({ type: "SELECT_CUTOUT", id: next.id });
          else setFinished(true);
        }} />}
    </div>
  </div>{dismissed.has(selected.id) && fallback}</>;
}
