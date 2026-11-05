import type { TraceState } from "@/state/trace-store";

/** One availability rule for the sidebar action and its canvas preview. */
export function outlineCleanupUnavailable(trace: Pick<TraceState, "outline" | "rawOutline" | "processing" | "curves" | "margin" | "history">): string | undefined {
  if (!trace.outline.length || !trace.rawOutline.length) return "Detect an outline first.";
  if (trace.processing) return "Wait for detection to finish.";
  if (trace.curves) return "Lines and curves are already applied. Use Edit outline to adjust them, or Undo to simplify again.";
  if (trace.history.stack[trace.history.index]?.hasManualEdits) return "Undo manual edits or re-detect before auto-simplifying the detected outline.";
  if ((trace.margin ?? 0) !== 0) return "Set Margin to zero before auto-simplifying. Add clearance later in Bin.";
}
