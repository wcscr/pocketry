import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { exportScale } from "@/lib/export/scale";
import { traceObjects } from "@/lib/gridfinity/trace-objects";
import { normalizeTracedShapeWithPlacement } from "@/lib/gridfinity/traced-shape";
import { useShapeLibrary } from "@/state/shape-library";
import { hasPendingManualCalibration, useTrace } from "@/state/trace-store";
import { useProjectActivity } from "@/state/project-activity";

/** Place pockets to the destination bin's floor; depth can be edited in Bin. */
export function useTraceHandoff(onCanvasInteraction?: () => void) {
  const trace = useTrace();
  const destination = useProjectActivity();
  const library = useShapeLibrary();
  const [, navigate] = useLocation();
  const [separateTools, setSeparateTools] = useState(true);
  const adding = useRef(false);
  const scale = exportScale(trace.calibration, trace.imageSize.height);
  const destinationReady = !destination || (destination.status !== "loading" && destination.status !== "error");
  const ready = destinationReady && !!scale.mmPerPx && trace.outline.length > 0
    && !trace.pendingAutoCalibration && !hasPendingManualCalibration(trace) && !trace.processing;
  const addToBin = () => {
    if (!ready || adding.current) return;
    const names = new Set(library.shapes.map(shape => shape.name));
    let number = 1;
    const parts = traceObjects(trace.outline, separateTools);
    let holeNumber = 1;
    const shapes = parts.map(part => {
      while (names.has(`Tool ${number}`)) number++;
      while (names.has(`Hole ${holeNumber}`)) holeNumber++;
      const name = part.role === "hole" ? `Hole ${holeNumber++}` : `Tool ${number++}`;
      const normalized = normalizeTracedShapeWithPlacement(part.outline, scale, name);
      return normalized ? { ...normalized, role: part.role } : null;
    });
    if (shapes.some(shape => !shape)) return;
    adding.current = true;
    const target = destination ? { key: destination.destinationKey ?? `project:${destination.activeProjectId}`, name: destination.name ?? "Untitled project" } : undefined;
    for (const entry of shapes) {
      if (!entry) continue;
      const shape = { ...entry.shape, traceMarginMm: trace.margin ?? 0 };
      if (shapes.length > 1) library.addShape(shape, { mode: "to-floor" }, target,
        { batchId: shapes[0]!.shape.id, center: entry.center, ...(entry.role ? { role: entry.role } : {}) });
      else library.addShape(shape, { mode: "to-floor" }, target);
    }
    onCanvasInteraction?.();
    navigate("/bin");
  };
  return { ready, addToBin, separateTools, setSeparateTools, objectCount: trace.outline.length,
    destinationName: destination?.name ?? "Untitled project", destinationStatus: destination?.status };
}

export type TraceHandoff = ReturnType<typeof useTraceHandoff>;

/** A short destination reminder; grouping is available without a blocking form. */
export function TraceHandoffOptions({ handoff }: { handoff: TraceHandoff }) {
  return <div className="space-y-1 text-xs text-muted-foreground">
    <p className="truncate" title={handoff.destinationName}>
      {handoff.destinationStatus === "loading" ? "Reading destination…"
        : handoff.destinationStatus === "error" ? "Open Bin to resolve the project storage problem."
        : <>Adding to: {handoff.destinationName}</>}
    </p>
    <p>Holes stay separate and editable in Bin.</p>
    {handoff.objectCount > 1 && <details>
      <summary className="cursor-pointer py-1">{handoff.separateTools ? `${handoff.objectCount} separate pockets` : "One combined pocket"}</summary>
      <p>Positions from the photo are preserved, including overlaps.</p>
      <label className="flex min-h-9 items-center gap-2">
        <input type="checkbox" checked={!handoff.separateTools}
          onChange={event => handoff.setSeparateTools(!event.target.checked)} />
        Keep these outlines together
      </label>
    </details>}
  </div>;
}
