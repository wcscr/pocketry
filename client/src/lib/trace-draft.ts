import { del, get, set } from "idb-keyval";
import { traceDraftSchema, type TraceDraft } from "@shared/trace-draft";
import type { TraceState } from "@/state/trace-store";

export const TRACE_DRAFT_KEY = "pocketry:trace-draft:v1";

/** Pure snapshot construction; validation is done on recovery, not each drag. */
export function traceDraftSnapshot(trace: TraceState): TraceDraft | null {
  if (!trace.imageUrl || trace.imageSize.width <= 0 || trace.imageSize.height <= 0) return null;
  const { sourceRevision: _revision, processing: _processing, svg: _svg,
    detectedImageUrl, autoCalibrationAttemptedImageUrl, ...state } = trace;
  return {
    schemaVersion: 1,
    state: { ...state, imageUrl: trace.imageUrl },
    detectionComplete: detectedImageUrl === trace.imageUrl,
    referencesAttempted: autoCalibrationAttemptedImageUrl === trace.imageUrl,
  };
}

export async function loadTraceDraft(): Promise<TraceDraft | null> {
  const stored: unknown = await get(TRACE_DRAFT_KEY);
  if (stored == null) return null;
  const parsed = traceDraftSchema.safeParse(stored);
  if (!parsed.success) throw new Error("The saved trace could not be recovered.");
  return parsed.data;
}

// Serialize writes including clear/start-over, so an older write cannot revive
// a discarded photo or overwrite the next source selected by the user.
let writes: Promise<void> = Promise.resolve();
export function saveTraceDraft(draft: TraceDraft | null): Promise<void> {
  const pending = writes.then(() => draft ? set(TRACE_DRAFT_KEY, draft) : del(TRACE_DRAFT_KEY));
  writes = pending.catch(() => {});
  return pending;
}
