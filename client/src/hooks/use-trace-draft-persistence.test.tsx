import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceDraft } from "@shared/trace-draft";
import { initialTraceState, TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { loadTraceDraft, saveTraceDraft, traceDraftSnapshot } from "@/lib/trace-draft";

vi.mock("@/lib/trace-draft", async (original) => ({
  ...await original<typeof import("@/lib/trace-draft")>(),
  loadTraceDraft: vi.fn(), saveTraceDraft: vi.fn(),
}));
const photo = "data:image/png;base64,AA==";
const saved = () => traceDraftSnapshot({ ...initialTraceState, imageUrl: photo, fileName: "Recovered driver",
  imageSize: { width: 600, height: 800 }, mode: "calibrate", rulerLengthInput: "182",
  draftCalibration: { startX: 10, startY: 20, endX: 100, endY: 200 } })!;

describe("Trace recovery lifecycle", () => {
  let root: Root;
  let host: HTMLDivElement;
  let trace: TraceStore;
  const Probe = () => { trace = useTrace(); return null; };
  const render = async () => { await React.act(async () => root.render(<TraceProvider persist><Probe /></TraceProvider>)); };
  const edit = async () => { await React.act(async () => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: photo, fileName: "New photo" });
    trace.dispatch({ type: "SOURCE_READY", imageSize: { width: 400, height: 300 } });
  }); };
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    vi.mocked(loadTraceDraft).mockResolvedValue(null);
    vi.mocked(saveTraceDraft).mockResolvedValue();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => {
    React.act(() => root.unmount()); host.remove(); vi.clearAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
  });

  it("restores unconfirmed endpoints and text then reports successful browser-local saving", async () => {
    vi.mocked(loadTraceDraft).mockResolvedValue(saved());
    await render();
    expect(trace!.fileName).toBe("Recovered driver");
    expect(trace!.rulerLengthInput).toBe("182");
    expect(trace!.calibration).toBeNull();
    expect(trace!.draftCalibration).toEqual(saved().state.draftCalibration);
    await React.act(async () => vi.advanceTimersByTimeAsync(200));
    expect(trace!.draftSaveStatus).toBe("saved");
  });

  it("ignores late recovery when the user has already selected another photo", async () => {
    let finish!: (draft: TraceDraft) => void;
    vi.mocked(loadTraceDraft).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render(); await edit();
    await React.act(async () => finish(saved()));
    expect(trace!.fileName).toBe("New photo");
    await React.act(async () => vi.advanceTimersByTimeAsync(200));
    expect(vi.mocked(saveTraceDraft).mock.lastCall?.[0]?.state.fileName).toBe("New photo");
  });

  it("clears the saved photo immediately when starting over, without a stale debounce", async () => {
    await render(); await edit();
    await React.act(async () => trace.dispatch({ type: "SOURCE_CLEARED" }));
    await React.act(async () => vi.advanceTimersByTimeAsync(300));
    expect(vi.mocked(saveTraceDraft).mock.lastCall?.[0]).toBeNull();
    expect(trace!.draftSaveStatus).toBe("empty");
  });

  it("keeps unreadable saved data intact and shows failure until the user starts new work", async () => {
    vi.mocked(loadTraceDraft).mockRejectedValue(new Error("Unreadable draft"));
    await render();
    await React.act(async () => vi.advanceTimersByTimeAsync(300));
    expect(trace!.draftSaveStatus).toBe("error");
    expect(saveTraceDraft).not.toHaveBeenCalled();
    await edit();
    await React.act(async () => vi.advanceTimersByTimeAsync(200));
    expect(trace!.draftSaveStatus).toBe("saved");
  });

  it("flushes pending edits and warns on refresh only until the write completes", async () => {
    await render(); await edit();
    const first = new Event("beforeunload", { cancelable: true });
    await React.act(async () => window.dispatchEvent(first));
    expect(first.defaultPrevented).toBe(true);
    expect(trace!.draftSaveStatus).toBe("saved");
    const second = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
  });

  it("shows storage failure without claiming the trace was saved", async () => {
    await render();
    vi.mocked(saveTraceDraft).mockRejectedValueOnce(new Error("Quota exceeded"));
    await edit();
    await React.act(async () => vi.advanceTimersByTimeAsync(200));
    expect(trace!.draftSaveStatus).toBe("error");
  });
});
