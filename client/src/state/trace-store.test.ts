import { mmPerPixel } from "@shared/geometry/scale";
import type { Outline } from "@shared/geometry/types";
import { describe, expect, it } from "vitest";

import {
  initialTraceState,
  traceReducer,
  type TraceAction,
  type TraceState,
} from "./trace-store";

const ringA: Outline = [
  { outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], holes: [] },
];
const ringB: Outline = [
  { outer: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }], holes: [] },
];
const ringC: Outline = [
  { outer: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }], holes: [] },
];

const run = (state: TraceState, ...actions: TraceAction[]): TraceState =>
  actions.reduce(traceReducer, state);

const detected = (
  outline: Outline,
): Extract<TraceAction, { type: "DETECTED" }> => ({
  type: "DETECTED",
  imageUrl: null,
  outline,
  rawOutline: outline,
  svg: "<svg/>",
  region: null,
});

describe("undo / redo", () => {
  it("starts with nothing to undo or redo", () => {
    expect(initialTraceState.history.index).toBe(0);
    expect(initialTraceState.history.stack).toHaveLength(1);
  });

  it("undoes a committed edit", () => {
    const state = run(
      initialTraceState,
      detected(ringA),
      { type: "OUTLINE_COMMITTED", outline: ringB },
      { type: "UNDO" },
    );
    expect(state.outline).toBe(ringA);
  });

  it("redoes after an undo", () => {
    const state = run(
      initialTraceState,
      detected(ringA),
      { type: "OUTLINE_COMMITTED", outline: ringB },
      { type: "UNDO" },
      { type: "REDO" },
    );
    expect(state.outline).toBe(ringB);
  });

  it("survives repeated edits — the bug that made undo permanently dead", () => {
    // Previously every edit reset the history to a single entry, because the
    // preview mirrored the outline and reset on prop-identity change.
    const state = run(
      initialTraceState,
      detected(ringA),
      { type: "OUTLINE_COMMITTED", outline: ringB },
      { type: "OUTLINE_COMMITTED", outline: ringC },
    );
    expect(state.history.stack).toHaveLength(3);

    const undoneOnce = traceReducer(state, { type: "UNDO" });
    expect(undoneOnce.outline).toBe(ringB);
    expect(traceReducer(undoneOnce, { type: "UNDO" }).outline).toBe(ringA);
  });

  it("treats one drag as one undo step", () => {
    // Dragging a vertex fires on every pointermove; without the distinct
    // action each frame would become its own undo entry.
    const state = run(
      initialTraceState,
      detected(ringA),
      { type: "OUTLINE_DRAGGING", outline: ringB },
      { type: "OUTLINE_DRAGGING", outline: ringC },
    );
    expect(state.history.stack).toHaveLength(1);
    expect(state.outline).toBe(ringC);
  });

  it("restores the pre-drag contour when a moved node is undone", () => {
    const committed = run(
      initialTraceState,
      detected(ringA),
      { type: "OUTLINE_DRAGGING", outline: ringB },
      { type: "OUTLINE_DRAGGING", outline: ringC },
      {
        type: "OUTLINE_COMMITTED",
        outline: ringC,
        label: "Move contour node",
      },
    );

    expect(committed.history.stack.map((entry) => entry.label)).toEqual([
      "Detected outline",
      "Move contour node",
    ]);
    expect(traceReducer(committed, { type: "UNDO" }).outline).toBe(ringA);
  });

  it("jumps directly to any named history step", () => {
    const state = run(
      initialTraceState,
      detected(ringA),
      { type: "OUTLINE_COMMITTED", outline: ringB, label: "Add contour node" },
      { type: "OUTLINE_COMMITTED", outline: ringC, label: "Remove contour node" },
      { type: "JUMP_TO_HISTORY", index: 0 },
    );
    expect(state.outline).toBe(ringA);
    expect(state.history.index).toBe(0);
    expect(traceReducer(state, { type: "REDO" }).outline).toBe(ringB);
  });

  it("discards the redo branch after a new edit", () => {
    const state = run(
      initialTraceState,
      detected(ringA),
      { type: "OUTLINE_COMMITTED", outline: ringB },
      { type: "UNDO" },
      { type: "OUTLINE_COMMITTED", outline: ringC },
    );
    expect(state.history.stack).toHaveLength(2);
    expect(traceReducer(state, { type: "REDO" }).outline).toBe(ringC);
  });

  it("is a no-op at either end", () => {
    const state = run(initialTraceState, detected(ringA));
    expect(traceReducer(state, { type: "UNDO" })).toBe(state);
    expect(traceReducer(state, { type: "REDO" })).toBe(state);
  });

  it("caps the history", () => {
    let state = run(initialTraceState, detected(ringA));
    for (let i = 0; i < 80; i++) {
      state = traceReducer(state, {
        type: "OUTLINE_COMMITTED",
        outline: [{ outer: [{ x: i, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], holes: [] }],
      });
    }
    expect(state.history.stack.length).toBeLessThanOrEqual(50);
    expect(state.history.index).toBe(state.history.stack.length - 1);
  });

  it("re-derivation from the sliders is not undoable", () => {
    const state = run(
      initialTraceState,
      detected(ringA),
      { type: "OUTLINE_REFINED", outline: ringB },
    );
    expect(state.history.stack).toHaveLength(1);
    expect(state.outline).toBe(ringB);
    expect(state.history.stack[0].outline).toBe(ringB);
  });
});

describe("loading a new image", () => {
  const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 };

  const dirty = run(
    initialTraceState,
    { type: "SOURCE_LOADED", imageUrl: "a", fileName: "a" },
    detected(ringA),
    { type: "SET_CALIBRATION", calibration },
    { type: "SET_REGION", region: { x: 1, y: 2, width: 3, height: 4 } },
    { type: "OUTLINE_COMMITTED", outline: ringB },
  );

  it("clears the stale ruler", () => {
    // Previously the preview was not keyed on the image URL, so the previous
    // image's ruler silently rescaled every export after the second upload.
    const state = traceReducer(dirty, {
      type: "SOURCE_LOADED",
      imageUrl: "b",
      fileName: "b",
    });
    expect(state.calibration).toBeNull();
    expect(state.region).toBeNull();
    expect(state.outline).toEqual([]);
    expect(state.history.stack).toHaveLength(1);
    expect(state.history.index).toBe(0);
  });

  it("tracks choosing the same source again as a new workflow", () => {
    const first = traceReducer(initialTraceState, {
      type: "SOURCE_LOADED",
      imageUrl: "same-image",
      fileName: "same-image",
    });
    const second = traceReducer(first, {
      type: "SOURCE_LOADED",
      imageUrl: "same-image",
      fileName: "same-image",
    });
    expect(second.sourceRevision).toBe(first.sourceRevision + 1);
  });

  it("keeps reusable settings but resets a new source to the default margin", () => {
    const configured = run(
      dirty,
      { type: "SET_SENSITIVITY", sensitivity: 90 },
      { type: "SET_MARGIN", margin: 3.5 },
      { type: "SET_EXTRUSION_HEIGHT", extrusionHeight: 22 },
    );
    const state = traceReducer(configured, {
      type: "SOURCE_LOADED",
      imageUrl: "c",
      fileName: "c",
    });
    expect(state.sensitivity).toBe(90);
    expect(state.margin).toBe(1.5);
    expect(state.extrusionHeight).toBe(22);
  });

  it("ignores a detection result from an image that has already been replaced", () => {
    const state = run(initialTraceState, {
      type: "SOURCE_LOADED",
      imageUrl: "new-image",
      fileName: "new",
    });
    const result = traceReducer(state, {
      type: "DETECTED",
      imageUrl: "old-image",
      outline: ringA,
      rawOutline: ringA,
      svg: "<svg/>",
      region: null,
    });
    expect(result).toBe(state);
  });

  it("tracks completed tracing and automatic calibration per source", () => {
    const loaded = run(initialTraceState, {
      type: "SOURCE_LOADED",
      imageUrl: "image-a",
      fileName: "a",
    });
    const processed = run(
      loaded,
      {
        type: "DETECTED",
        imageUrl: "image-a",
        outline: [],
        rawOutline: [],
        svg: "<svg/>",
        region: null,
      },
      { type: "AUTO_CALIBRATION_ATTEMPTED", imageUrl: "image-a" },
    );
    expect(processed.detectedImageUrl).toBe("image-a");
    expect(processed.autoCalibrationAttemptedImageUrl).toBe("image-a");

    const replaced = traceReducer(processed, {
      type: "SOURCE_LOADED",
      imageUrl: "image-b",
      fileName: "b",
    });
    expect(replaced.detectedImageUrl).toBeNull();
    expect(replaced.autoCalibrationAttemptedImageUrl).toBeNull();
  });
});

describe("modes and calibration", () => {
  it("has exactly one active mode", () => {
    // The four independent booleans this replaces could all be on at once.
    const state = run(
      initialTraceState,
      { type: "SET_MODE", mode: "edit" },
      { type: "SET_MODE", mode: "region" },
    );
    expect(state.mode).toBe("region");
  });

  it("returns to the pointer after a crop is committed", () => {
    const state = run(
      initialTraceState,
      { type: "SET_MODE", mode: "region" },
      { type: "SET_REGION", region: { x: 5, y: 6, width: 40, height: 30 } },
      { type: "REGION_COMMITTED" },
    );
    expect(state.mode).toBe("pan");
    expect(state.region).toEqual({ x: 5, y: 6, width: 40, height: 30 });
  });

  it("clears the detected contour when the detection region is cleared", () => {
    const state = run(
      initialTraceState,
      { type: "SET_REGION", region: { x: 5, y: 6, width: 40, height: 30 } },
      detected(ringA),
      { type: "OUTLINE_COMMITTED", outline: ringB },
      { type: "SET_REGION", region: null },
    );

    expect(state.region).toBeNull();
    expect(state.outline).toEqual([]);
    expect(state.rawOutline).toEqual([]);
    expect(state.svg).toBeNull();
    expect(state.detectedImageUrl).toBeNull();
    expect(state.history.stack).toEqual([{ outline: [], label: "Start" }]);
  });

  it("ignores a detection result from a region that was replaced", () => {
    const oldRegion = { x: 5, y: 6, width: 40, height: 30 };
    const state = run(
      initialTraceState,
      { type: "SET_REGION", region: oldRegion },
      { type: "SET_REGION", region: { x: 50, y: 60, width: 100, height: 80 } },
      {
        ...detected(ringA),
        region: oldRegion,
      },
    );

    expect(state.outline).toEqual([]);
  });

  it("abandons a half-placed ruler when leaving calibrate mode", () => {
    const state = run(
      initialTraceState,
      { type: "SET_MODE", mode: "calibrate" },
      { type: "SET_DRAFT_CALIBRATION", draftCalibration: { startX: 1, startY: 2 } },
      { type: "SET_MODE", mode: "pan" },
    );
    expect(state.draftCalibration).toBeNull();
  });

  it("keeps a draft while still in calibrate mode", () => {
    const state = run(
      initialTraceState,
      { type: "SET_MODE", mode: "calibrate" },
      { type: "SET_DRAFT_CALIBRATION", draftCalibration: { startX: 1, startY: 2 } },
    );
    expect(state.draftCalibration).toEqual({ startX: 1, startY: 2 });
  });

  it("clears the draft once the calibration completes", () => {
    const state = run(
      initialTraceState,
      { type: "SET_MODE", mode: "calibrate" },
      { type: "SET_DRAFT_CALIBRATION", draftCalibration: { startX: 1, startY: 2 } },
      {
        type: "SET_CALIBRATION",
        calibration: { startX: 1, startY: 2, endX: 9, endY: 2, lengthMm: 10 },
      },
    );
    expect(state.draftCalibration).toBeNull();
    expect(state.calibration?.endX).toBe(9);
    expect(state.calibrationSource).toBe("manual");
    expect(state.margin).toBe(1.5);
  });

  it("holds a sheet-detected scale for explicit acceptance", () => {
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 0,
      lengthMm: 50,
    };
    const pending = traceReducer(initialTraceState, {
      type: "AUTO_CALIBRATION_DETECTED",
      calibration,
    });
    expect(pending.calibration).toBeNull();
    expect(pending.pendingAutoCalibration).toBe(calibration);
    expect(pending.calibrationSource).toBeNull();

    const accepted = traceReducer(pending, { type: "ACCEPT_AUTO_CALIBRATION" });
    expect(accepted.calibration).toBe(calibration);
    expect(accepted.pendingAutoCalibration).toBeNull();
    expect(accepted.calibrationSource).toBe("sheet");
    expect(accepted.margin).toBe(1.5);
  });

  it("manual calibration replaces a pending sheet candidate", () => {
    const detected = {
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 0,
      lengthMm: 50,
    };
    const manual = { ...detected, lengthMm: 75 };
    const state = run(
      initialTraceState,
      { type: "AUTO_CALIBRATION_DETECTED", calibration: detected },
      { type: "SET_CALIBRATION", calibration: manual },
    );
    expect(state.calibration).toBe(manual);
    expect(state.pendingAutoCalibration).toBeNull();
    expect(state.calibrationSource).toBe("manual");
    expect(state.margin).toBe(1.5);
  });

  it("removes a pending automatic ruler when manual placement begins", () => {
    const detected = {
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 0,
      lengthMm: 50,
    };
    const state = run(
      initialTraceState,
      { type: "AUTO_CALIBRATION_DETECTED", calibration: detected },
      { type: "SET_MODE", mode: "calibrate" },
    );

    expect(state.mode).toBe("calibrate");
    expect(state.pendingAutoCalibration).toBeNull();
    expect(state.calibration).toBeNull();
  });

  it("preserves a chosen margin when the scale is replaced", () => {
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 0,
      lengthMm: 50,
    };
    const state = run(
      initialTraceState,
      { type: "SET_CALIBRATION", calibration },
      { type: "SET_MARGIN", margin: 2.5 },
      { type: "SET_CALIBRATION", calibration: { ...calibration, lengthMm: 75 } },
    );
    expect(state.margin).toBe(2.5);
  });

  it("updates mm/px when a completed manual ruler length changes", () => {
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 0,
      lengthMm: 50,
    };
    const state = run(
      initialTraceState,
      { type: "SET_CALIBRATION", calibration },
      { type: "SET_RULER_LENGTH", rulerLengthMm: 75 },
    );

    expect(state.rulerLengthMm).toBe(75);
    expect(state.calibration?.lengthMm).toBe(75);
    expect(mmPerPixel(state.calibration)).toBe(0.75);
  });

  it("does not overwrite an accepted calibration-sheet scale", () => {
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 0,
      lengthMm: 50,
    };
    const state = run(
      initialTraceState,
      { type: "AUTO_CALIBRATION_DETECTED", calibration },
      { type: "ACCEPT_AUTO_CALIBRATION" },
      { type: "SET_RULER_LENGTH", rulerLengthMm: 75 },
    );

    expect(state.rulerLengthMm).toBe(75);
    expect(state.calibration?.lengthMm).toBe(50);
    expect(mmPerPixel(state.calibration)).toBe(0.5);
  });

  it("retains the margin preference when scale is cleared", () => {
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 0,
      lengthMm: 50,
    };
    const state = run(
      initialTraceState,
      { type: "SET_CALIBRATION", calibration },
      { type: "SET_MARGIN", margin: 2.5 },
      { type: "SET_CALIBRATION", calibration: null },
    );
    expect(state.calibration).toBeNull();
    expect(state.margin).toBe(2.5);
  });
});

describe("selection", () => {
  it("clears when a new detection lands", () => {
    const state = run(
      initialTraceState,
      detected(ringA),
      { type: "SELECT_RING", selection: { shapeIndex: 0, ringIndex: -1 } },
      detected(ringB),
    );
    expect(state.selection).toBeNull();
  });

  it("clears on undo, since the ring may no longer exist", () => {
    const state = run(
      initialTraceState,
      detected(ringA),
      { type: "OUTLINE_COMMITTED", outline: ringB },
      { type: "SELECT_RING", selection: { shapeIndex: 0, ringIndex: -1 } },
      { type: "UNDO" },
    );
    expect(state.selection).toBeNull();
  });
});
