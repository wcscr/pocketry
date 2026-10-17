import { inspectPhotoDataUrl } from "./photo-dimensions";
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
    schemaVersion: 2,
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
  // Recovery publishes the URL to SVG as well as the canvas hook. Gate both
  // source copies here, before either native image consumer can see them.
  // Perspective correction exports PNG; a valid 6 MP PNG can exceed the
  // original 10 MiB upload cap. Match the existing 60M-character draft bound.
  inspectPhotoDataUrl(parsed.data.state.imageUrl, 45_000_000);
  if (parsed.data.state.perspectiveOriginalImageUrl) inspectPhotoDataUrl(parsed.data.state.perspectiveOriginalImageUrl, 45_000_000);
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
