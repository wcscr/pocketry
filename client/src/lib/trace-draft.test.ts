import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialTraceState, traceReducer } from "@/state/trace-store";
import { traceDraftSchema } from "@shared/trace-draft";

const storage = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { storage.set(key, value); }),
  del: vi.fn(async (key: string) => { storage.delete(key); }),
}));
import { set } from "idb-keyval";
import { loadTraceDraft, saveTraceDraft, traceDraftSnapshot, TRACE_DRAFT_KEY } from "./trace-draft";

const image = "data:image/png;base64,AA==";
const outline = [{ outer: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 30 }], holes: [] }];
const calibrated = () => {
  let state = traceReducer(initialTraceState, { type: "SOURCE_LOADED", imageUrl: image, fileName: "Driver" });
  state = traceReducer(state, { type: "SOURCE_READY", imageSize: { width: 600, height: 800 } });
  state = traceReducer(state, { type: "SET_CALIBRATION", calibration: { startX: 1, startY: 2, endX: 150, endY: 200, lengthMm: 182 } });
  state = traceReducer(state, { type: "OUTLINE_COMMITTED", outline, label: "Move point" });
  return { ...state, mode: "edit" as const, processing: true, rawOutline: outline,
    perspectiveOriginalImageUrl: image, perspectiveOriginalImageRotation: 1 as const,
    detectedImageUrl: image, autoCalibrationAttemptedImageUrl: image };
};

beforeEach(() => { storage.clear(); vi.clearAllMocks(); });

describe("browser-local Trace recovery", () => {
  it.each([false, true])("recovers a replacement ruler without losing accepted scale (complete: %s)", async complete => {
    const before = calibrated();
    let pending = traceReducer(before, { type: "SET_MODE", mode: "calibrate" });
    pending = traceReducer(pending, { type: "SET_DRAFT_CALIBRATION", draftCalibration: complete
      ? { startX: 20, startY: 30, endX: 120, endY: 30 } : { startX: 20, startY: 30 } });
    if (complete) pending = traceReducer(pending, { type: "SET_MODE", mode: "pan" });
    pending = traceReducer(pending, { type: "SET_RULER_LENGTH_INPUT", value: "75" });
    await saveTraceDraft(traceDraftSnapshot(pending));
    const restored = traceReducer(initialTraceState, { type: "TRACE_DRAFT_RESTORED", draft: (await loadTraceDraft())! });
    expect(restored.calibration).toEqual(before.calibration);
    expect(restored.draftCalibration).toEqual(pending.draftCalibration);
    expect(restored.rulerLengthInput).toBe("75");
    const cancelled = traceReducer(restored, { type: "CANCEL_MANUAL_CALIBRATION" });
    expect(cancelled.calibration).toEqual(before.calibration);
    expect(cancelled.draftCalibration).toBeNull();
    expect(cancelled.rulerLengthInput).toBe("182");
    expect(cancelled.outline).toEqual(before.outline);
    expect(cancelled.history).toEqual(before.history);
  });

  it("persists aligned photos and restores their matching contours, crop, and scale with Undo", async () => {
    const before = { ...calibrated(), processing: false, region: { x: 10, y: 20, width: 40, height: 60 } };
    const aligned = traceReducer(before, { type: "ALIGN_UPRIGHT", outline: before.outline, expectedOutline: before.outline, radians: .5 });
    await saveTraceDraft(traceDraftSnapshot(aligned));
    const restored = traceReducer(initialTraceState, { type: "TRACE_DRAFT_RESTORED", draft: (await loadTraceDraft())! });
    expect(restored.imageAlignment).toEqual(aligned.imageAlignment);
    expect(restored.imageUrl).toBe(before.imageUrl);
    const undone = traceReducer(restored, { type: "UNDO" });
    expect(undone.imageAlignment).toBeNull(); expect(undone.region).toEqual(before.region);
    expect(undone.outline).toEqual(before.outline); expect(undone.calibration).toEqual(before.calibration);
    expect(traceReducer(undone, { type: "REDO" }).imageAlignment).toEqual(aligned.imageAlignment);
  });

  it("accepts older drafts without photo alignment", () => {
    const snapshot = traceDraftSnapshot(calibrated())!;
    const { imageAlignment: _alignment, ...legacy } = snapshot.state;
    expect(traceDraftSchema.parse({ ...snapshot, state: legacy }).state.imageAlignment).toBeNull();
  });

  it("recovers the photo, physical scale, edits, original source and undo history without a running job", async () => {
    const state = calibrated();
    const snapshot = traceDraftSnapshot(state)!;
    expect(traceDraftSchema.safeParse(snapshot).success).toBe(true);
    await saveTraceDraft(snapshot);
    const restored = traceReducer(initialTraceState, { type: "TRACE_DRAFT_RESTORED", draft: (await loadTraceDraft())! });
    expect(restored).toEqual({ ...state, sourceRevision: 1, processing: false });
    expect(traceReducer(restored, { type: "UNDO" }).outline).toEqual([]);
    expect(traceReducer(traceReducer(restored, { type: "UNDO" }), { type: "REDO" }).outline).toEqual(outline);
  });

  it.each([
    ["svg", "svg"], ["dxf", "dxf"], ["dwg", "dxf"], ["stl", "stl"],
  ] as const)("recovers saved %s exports as %s without changing the trace", async (savedFormat, restoredFormat) => {
    const state = calibrated();
    const snapshot = traceDraftSnapshot(state)!;
    storage.set(TRACE_DRAFT_KEY, { ...snapshot, state: { ...snapshot.state, exportFormat: savedFormat } });
    const restored = traceReducer(initialTraceState, { type: "TRACE_DRAFT_RESTORED", draft: (await loadTraceDraft())! });
    expect(restored).toEqual({ ...state, exportFormat: restoredFormat, sourceRevision: 1, processing: false });
    await saveTraceDraft(traceDraftSnapshot(restored));
    expect((await loadTraceDraft())!.state.exportFormat).toBe(restoredFormat);
  });

  it.each([false, true])("recovers the paper crop and full-photo choice (%s) with edits intact", async showFullPhoto => {
    const state = { ...calibrated(), perspectiveCorrection: { source: "template" as const, paper: "a4" as const,
      paperBounds: { x: 100, y: 50, width: 300, height: 500 }, showFullPhoto } };
    await saveTraceDraft(traceDraftSnapshot(state));
    const restored = traceReducer(initialTraceState, { type: "TRACE_DRAFT_RESTORED", draft: (await loadTraceDraft())! });
    expect(restored.perspectiveCorrection).toEqual(state.perspectiveCorrection);
    expect(restored.calibration).toEqual(state.calibration);
    expect(restored.outline).toEqual(state.outline);
    expect(traceReducer(restored, { type: "UNDO" }).outline).toEqual([]);
  });

  it("restores manual paper selection and accepts older drafts without it", async () => {
    const state = traceReducer(calibrated(), { type: "SET_PERSPECTIVE_PAPER", paper: "letter" });
    await saveTraceDraft(traceDraftSnapshot(state));
    expect((await loadTraceDraft())!.state.manualPerspectivePaper).toBe("letter");
    const snapshot = traceDraftSnapshot(state)!;
    const { manualPerspectivePaper: _paper, ...legacy } = snapshot.state;
    const restored = traceReducer(initialTraceState, { type: "TRACE_DRAFT_RESTORED", draft: traceDraftSchema.parse({ ...snapshot, state: legacy }) });
    expect(restored.manualPerspectivePaper).toBeNull();
    expect(restored.outline).toEqual(state.outline);
  });

  it("retains invalid unconfirmed ruler text without replacing the accepted calibration", async () => {
    const state = traceReducer(calibrated(), { type: "SET_RULER_LENGTH_INPUT", value: "" });
    await saveTraceDraft(traceDraftSnapshot(state));
    const restored = (await loadTraceDraft())!.state;
    expect(restored.rulerLengthInput).toBe("");
    expect(restored.calibration?.lengthMm).toBe(182);
    expect(restored.rulerLengthMm).toBe(182);
  });

  it.each(["future version", "invalid geometry", "invalid scale"])("rejects %s without deleting stored work", async (kind) => {
    const snapshot = structuredClone(traceDraftSnapshot(calibrated())!);
    const invalid = kind === "future version" ? { ...snapshot, schemaVersion: 999 }
      : kind === "invalid geometry" ? { ...snapshot, state: { ...snapshot.state, outline: [{ outer: [{ x: 1, y: 2 }], holes: [] }] } }
      : { ...snapshot, state: { ...snapshot.state, calibration: { ...snapshot.state.calibration!, lengthMm: 0 } } };
    storage.set(TRACE_DRAFT_KEY, invalid);
    await expect(loadTraceDraft()).rejects.toThrow("could not be recovered");
    expect(storage.get(TRACE_DRAFT_KEY)).toBe(invalid);
  });

  it("serializes clear after an in-flight save so Start over cannot revive an old photo", async () => {
    let finish!: () => void;
    vi.mocked(set).mockImplementationOnce((key, value) => new Promise<void>((resolve) => {
      finish = () => { storage.set(String(key), value); resolve(); };
    }));
    const first = saveTraceDraft(traceDraftSnapshot(calibrated()));
    await Promise.resolve();
    const clear = saveTraceDraft(null);
    finish();
    await Promise.all([first, clear]);
    expect(await loadTraceDraft()).toBeNull();
  });

  it("permits a later save after a storage error", async () => {
    vi.mocked(set).mockRejectedValueOnce(new Error("Quota exceeded"));
    await expect(saveTraceDraft(traceDraftSnapshot(calibrated()))).rejects.toThrow("Quota exceeded");
    await saveTraceDraft(traceDraftSnapshot(calibrated()));
    expect((await loadTraceDraft())?.state.fileName).toBe("Driver");
  });
});
