import { BoxSelect, Brush, Check, Eraser, Hand, Trash2 } from "lucide-react";
import type { Point } from "@shared/geometry/types";
import type { ComponentType, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type CorrectionTool = "points" | "tool" | "paper" | "pan";

interface CorrectionToolsProps {
  tool: CorrectionTool;
  busy: boolean;
  addFeedback?: string;
  hasOutline: boolean;
  edgeUnavailable?: string;
  brushWidth: number;
  onWidth: (width: number) => void;
  pointUnavailable?: string;
  brushUnavailable?: string;
  hasMarks: boolean;
  onTool: (tool: CorrectionTool) => void;
  onClear: () => void;
  onDone: () => void;
  children: ReactNode;
}

/** Point and brush tools share one correction session. */
export function CorrectionTools({ tool, busy, addFeedback, hasOutline, edgeUnavailable, brushWidth, onWidth, pointUnavailable, brushUnavailable, hasMarks, onTool, onClear, onDone, children }: CorrectionToolsProps) {
  const brushLabel = hasOutline ? "Edge brush" : "Add area";
  const guidance: Record<CorrectionTool, string> = {
    points: "Pick points or drag a box around them. Drag a selected point to move the group.",
    tool: !hasOutline ? "Brush over tool material, or circle a gap to fill it."
      : "Trace the new edge from one spot on the purple outline to another. Follow a recess or draw across its opening.",
    paper: "Brush over unwanted background to remove it from the outline.",
    pan: "Drag to move the photo.",
  };
  const instructions = tool === "tool" && hasOutline && !brushUnavailable
    ? `${guidance.tool} Close a loop to fill its interior.` : guidance[tool];
  const status = busy ? "Updating the outline…" : tool === "tool" && addFeedback ? addFeedback : instructions;
  return <section aria-label="Correction tools" className="border-b bg-background px-2 pb-2">
    <header className="flex items-center justify-between gap-2 px-1 py-1">
      <h2 className="text-sm font-semibold">Correct outline</h2>
      <Button size="sm" variant="outline" aria-label="Done correcting" onClick={onDone}>Done</Button>
    </header>
    <div role="group" aria-label="Correction tool" className="grid grid-cols-3 gap-1 rounded-md bg-muted/50 p-1 [&_button]:h-12 [&_button]:w-full [&_button]:flex-col [&_button]:gap-0.5 [&_button]:px-1 [&_button]:text-xs">
      <CorrectionButton icon={BoxSelect} label="Select points" pressed={tool === "points"} disabled={busy || !!pointUnavailable}
        hint={pointUnavailable ?? "Select individual points or drag a selection box."} onClick={() => onTool("points")}>Select points</CorrectionButton>
      <CorrectionButton icon={Brush} label={brushLabel} pressed={tool === "tool"} disabled={busy || !!edgeUnavailable}
        className={tool === "tool" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : undefined}
        hint={edgeUnavailable ?? (hasOutline && !brushUnavailable ? "Trace an edge, or circle an area to include it." : guidance.tool)} onClick={() => onTool("tool")}>{brushLabel}</CorrectionButton>
      <CorrectionButton icon={Eraser} label="Remove area" pressed={tool === "paper"} disabled={busy || !!brushUnavailable}
        className={tool === "paper" ? "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" : undefined}
        hint={brushUnavailable ?? guidance.paper} onClick={() => onTool("paper")}>Remove area</CorrectionButton>
    </div>
    {(tool === "tool" || tool === "paper") && <label className="flex items-center gap-2 px-1 pt-2 text-xs">
      <span className="shrink-0">Brush width</span>
      <input type="range" aria-label="Brush width" aria-valuetext={`${brushWidth} pixels`} min={2} max={80} step={1} value={brushWidth}
        className="min-w-0 flex-1 accent-primary" disabled={busy} onChange={e => onWidth(Number(e.currentTarget.value))} />
      <span className="w-10 text-right tabular-nums">{brushWidth} px</span>
    </label>}
    <div className="grid px-1 py-1 text-xs leading-relaxed text-muted-foreground">
      {/* Reserve the resting height so a shorter drag hint cannot reframe the photo on a phone. */}
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">{instructions}</span>
      <p role="status" className="col-start-1 row-start-1">{status}</p>
    </div>
    <div className="flex flex-wrap items-center gap-1.5 empty:hidden">{children}</div>
    {hasMarks && <CorrectionButton icon={Trash2} label="Clear correction marks" disabled={busy || !!brushUnavailable}
      hint="Clear all brush marks and detect again. Undo restores them." onClick={onClear}>Clear marks</CorrectionButton>}
  </section>;
}

/** The fine line becomes the edge. Dots and dashed joins stay legible at any photo zoom. */
export function EdgeBrushGuide({ stroke, start, end, scale }: {
  stroke?: Point[]; start?: Point; end?: Point; scale: number;
}) {
  const marker = (join: Point, tip?: Point) => <g>
    {tip && <line x1={join.x} y1={join.y} x2={tip.x} y2={tip.y} strokeDasharray="3 2"
      strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
    <circle cx={join.x} cy={join.y} r={3 / scale} fill="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
  </g>;
  return <g pointerEvents="none" fill="none" stroke="#067647" data-testid={end ? "edge-joins" : undefined}>
    {stroke && <polyline points={stroke.map(p => `${p.x},${p.y}`).join(" ")} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    {start && marker(start, stroke?.[0])}
    {end && marker(end, stroke?.at(-1))}
  </g>;
}

export function CorrectionPanButton({ pressed, onClick }: { pressed: boolean; onClick: () => void }) {
  return <CorrectionButton icon={Hand} label="Pan while correcting" pressed={pressed}
    hint="Move the photo. You can also hold Space while dragging." onClick={onClick} />;
}

export function CorrectButton({ unavailable, hasMarks, onClick }: { unavailable?: string; hasMarks: boolean; onClick: () => void }) {
  return <CorrectionButton icon={Brush} label="Correct" disabled={!!unavailable}
    hint={unavailable ?? "Select outline points or correct the boundary with a brush."} onClick={onClick}>
    Correct{hasMarks && <Check className="h-3 w-3" aria-label="Corrections applied" />}
  </CorrectionButton>;
}

function CorrectionButton({ icon: Icon, label, hint, children, pressed, disabled, className, onClick }: {
  icon: ComponentType<{ className?: string }>; label: string; hint: string; children?: ReactNode;
  pressed?: boolean; disabled?: boolean; className?: string; onClick: () => void;
}) {
  return <Tooltip><TooltipTrigger asChild>
    <span className="pointer-events-auto inline-flex" tabIndex={disabled ? 0 : undefined}>
      <Button variant={pressed ? "secondary" : "ghost"} className={cn("h-11 gap-1.5 px-2", !children && "w-11 px-0", pressed && "ring-1 ring-current/30", className)}
        aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={event => { if (event.detail > 0) event.currentTarget.blur(); onClick(); }}>
        <Icon className="h-4 w-4" />{children}
      </Button>
    </span>
  </TooltipTrigger><TooltipContent side="bottom" className="max-w-64">{hint}</TooltipContent></Tooltip>;
}
