import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { exportScale } from "@/lib/export/scale";
import { normalizeTracedShape } from "@/lib/gridfinity/traced-shape";
import { useShapeLibrary } from "@/state/shape-library";
import { hasPendingManualCalibration, useTrace } from "@/state/trace-store";
import { useProjectActivity } from "@/state/project-activity";

/** Place first, then ask about depth where the user can see the bin. */
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
    const parts = separateTools ? trace.outline.map(part => [part]) : [trace.outline];
    const shapes = parts.map(part => {
      while (names.has(`Tool ${number}`)) number++;
      const name = `Tool ${number++}`;
      return normalizeTracedShape(part, scale, name);
    });
    if (shapes.some(shape => !shape)) return;
    adding.current = true;
    for (const shape of shapes) {
      if (shape) library.addShape({ ...shape, traceMarginMm: trace.margin ?? 0 }, { mode: "unset" },
        destination ? { key: destination.destinationKey ?? `project:${destination.activeProjectId}`, name: destination.name ?? "Untitled project" } : undefined);
    }
    onCanvasInteraction?.();
    navigate("/bin");
  };
  return { ready, addToBin, separateTools, setSeparateTools, objectCount: trace.outline.length,
    destinationName: destination?.name ?? "Untitled project", destinationStatus: destination?.status };
}

/** A short destination reminder; grouping is available without a blocking form. */
export function TraceHandoffOptions({ handoff }: { handoff: ReturnType<typeof useTraceHandoff> }) {
  return <div className="space-y-1 text-xs text-muted-foreground">
    <p className="truncate" title={handoff.destinationName}>
      {handoff.destinationStatus === "loading" ? "Reading destination…"
        : handoff.destinationStatus === "error" ? "Open Bin to resolve the project storage problem."
        : <>Adding to: {handoff.destinationName}</>}
    </p>
    {handoff.objectCount > 1 && <details>
      <summary className="cursor-pointer py-1">{handoff.separateTools ? `${handoff.objectCount} separate pockets` : "One combined pocket"}</summary>
      <label className="flex min-h-9 items-center gap-2">
        <input type="checkbox" checked={!handoff.separateTools}
          onChange={event => handoff.setSeparateTools(!event.target.checked)} />
        Keep these outlines together
      </label>
    </details>}
  </div>;
}
