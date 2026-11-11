import type { TraceState } from "@/state/trace-store";

/** One availability rule for the sidebar action and its canvas preview. */
export function outlineCleanupUnavailable(trace: Pick<TraceState, "outline" | "processing" | "margin">): string | undefined {
  if (!trace.outline.length) return "Detect or draw an outline first.";
  if (trace.processing) return "Wait for detection to finish.";
  if ((trace.margin ?? 0) !== 0) return "Set Margin to zero before auto-simplifying. Add clearance later in Bin.";
}
