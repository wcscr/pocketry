import { describe, expect, it } from "vitest";
import { mmPerPixel } from "@shared/geometry/scale";
import { rotateImageAlignment, transformImagePoint, transformImageRect } from "@shared/geometry/image-alignment";
import { rectRing } from "@/lib/geometry/fixtures";
import { initialTraceState, traceReducer, type TraceState } from "./trace-store";
import { mapCurves, sampleCurves } from "@shared/geometry/curves";
import { asymmetricHandle } from "@/lib/geometry/curve-symmetry.test-support";
import { symmetrizeCurves } from "@/lib/geometry/curve-symmetry";

const imageUrl = "data:image/png;base64,AA==";
function ready(): TraceState {
  const outline = [{ outer: rectRing(100, 100, 20, 160), holes: [] }, { outer: rectRing(230, 180, 30, 40), holes: [] }];
  return traceReducer({ ...initialTraceState, imageUrl, imageSize: { width: 400, height: 600 }, imageRotation: 1,
    calibration: { startX: 20, startY: 30, endX: 120, endY: 30, lengthMm: 50 },
    region: { x: 80, y: 80, width: 200, height: 200 },
    perspectiveCorrection: { source: "template", paper: "letter", paperBounds: { x: 10, y: 10, width: 380, height: 580 } },
  }, { type: "DETECTED", outline, rawOutline: outline, imageUrl, svg: "", region: null });
}
const align = (state: TraceState, radians = .6) => traceReducer(state, {
  type: "ALIGN_UPRIGHT", expectedOutline: state.outline, outline: state.outline, radians,
});
const undo = (state: TraceState) => traceReducer(state, { type: "UNDO" });
const redo = (state: TraceState) => traceReducer(state, { type: "REDO" });

describe("photo and contour alignment", () => {
  it("straightens native curves without flattening handles and restores the exact source and calibration", () => {
    const before = traceReducer(ready(), { type: "CURVES_COMMITTED", curves: mapCurves(asymmetricHandle, p => ({ x: p.x + 100, y: p.y + 100 })), label: "Auto-simplify outline" });
    const after = align(before), matrix = rotateImageAlignment(before.imageSize, .6, before.imageAlignment).transform;
    expect(after.curves).toEqual(mapCurves(before.curves!, p => transformImagePoint(p, matrix)));
    expect(after.outline).toEqual(sampleCurves(after.curves!, .05));
    expect(mmPerPixel(after.calibration)).toBeCloseTo(mmPerPixel(before.calibration)!, 12);
    expect(after.history.index).toBe(before.history.index + 1);
    const restored = undo(after);
    expect(restored.curves).toEqual(before.curves); expect(restored.outline).toEqual(before.outline); expect(restored.calibration).toEqual(before.calibration);
    expect(redo(restored).curves).toEqual(after.curves);
  });

  it.each(["left", "right", "average"] as const)("applies %s curve symmetry with optional upright rotation as one edit", side => {
    const point = (p: { x: number; y: number }) => ({ x: 100 + .8 * p.x - .6 * p.y, y: 150 + .6 * p.x + .8 * p.y });
    const before = traceReducer(ready(), { type: "CURVES_COMMITTED", curves: mapCurves(asymmetricHandle, point), label: "Auto-simplify outline" });
    const result = symmetrizeCurves({ source: before.curves!, shapeIndex: 0, axis: { start: point({ x: 0, y: 0 }), end: point({ x: 0, y: 100 }) }, side, tolerance: .05 });
    for (const radians of [undefined, -Math.atan2(.6, .8)]) {
      const after = traceReducer(before, { type: "CURVE_SYMMETRY_COMMITTED", curves: result.curves,
        expectedCurves: before.curves!, expectedOutline: before.outline, expectedCalibration: before.calibration, radians, label: "Symmetry" });
      expect(after.history.index).toBe(before.history.index + 1); expect(mmPerPixel(after.calibration)).toBeCloseTo(mmPerPixel(before.calibration)!, 12);
      if (radians === undefined) { expect(after.calibration).toBe(before.calibration); expect(after.curves).toEqual(result.curves); }
      expect(undo(after).curves).toEqual(before.curves); expect(undo(after).calibration).toEqual(before.calibration);
      expect(redo(undo(after)).curves).toEqual(after.curves);
    }
  });

  it("keeps curves opt-in, converts them to points as one undoable edit and preserves old curve sources", () => {
    expect(initialTraceState.editableCurves).toBe(false);
    const before = traceReducer(ready(), { type: "CURVES_COMMITTED", curves: asymmetricHandle, label: "Curves" });
    const after = traceReducer(before, { type: "SET_EDITABLE_CURVES", enabled: false });
    expect(after.curves).toBeUndefined(); expect(after.outline).toEqual(before.outline); expect(after.history.index).toBe(before.history.index + 1);
    expect(undo(after).curves).toEqual(before.curves); expect(redo(undo(after)).curves).toBeUndefined();
    const enabled = traceReducer(ready(), { type: "SET_EDITABLE_CURVES", enabled: true });
    expect(enabled.history).toBeDefined(); expect(traceReducer(enabled, { type: "SOURCE_LOADED", imageUrl: "next", fileName: "next" }).editableCurves).toBe(true);
  });
  it("turns all contours, the crop, and scale together while retaining original pixels", () => {
    const before = ready(), after = align(before), matrix = after.imageAlignment!.matrix;
    expect(after.imageUrl).toBe(before.imageUrl);
    expect(after.imageRotation).toBe(1);
    expect(after.imageSize).toEqual(after.imageAlignment!.size);
    for (const [i, shape] of before.outline.entries()) {
      expect(after.outline[i].outer).toEqual(shape.outer.map(p => transformImagePoint(p, matrix)));
    }
    expect(after.region).toEqual(transformImageRect(before.region!, matrix));
    expect(after.perspectiveCorrection!.paperBounds).toEqual(transformImageRect(before.perspectiveCorrection!.paperBounds!, matrix));
    expect(mmPerPixel(after.calibration)).toBeCloseTo(mmPerPixel(before.calibration)!, 9);
    expect(after.sourceRevision).toBe(before.sourceRevision + 1);
    expect(after.history.index).toBe(before.history.index + 1);
  });

  it("restores exact photo, crop, and calibration through undo, redo, and history jumps", () => {
    const before = ready(), after = align(before);
    const edited = traceReducer(after, { type: "OUTLINE_COMMITTED", outline: [...after.outline], label: "Edit point" });
    expect(undo(edited).imageAlignment).toEqual(after.imageAlignment);
    const restored = undo(undo(edited));
    for (const key of ["outline", "imageSize", "imageRotation", "imageAlignment", "calibration", "region", "perspectiveCorrection"] as const) {
      expect(restored[key]).toEqual(before[key]);
      expect(redo(restored)[key]).toEqual(after[key]);
      expect(traceReducer(edited, { type: "JUMP_TO_HISTORY", index: before.history.index })[key]).toEqual(before[key]);
    }
  });

  it("keeps the photo frame on new detection and refinement entries", () => {
    const before = ready(), after = align(before);
    const detected = traceReducer(after, { type: "DETECTED", imageUrl, outline: [...after.outline], rawOutline: [...after.rawOutline], svg: "", region: after.region });
    const refined = traceReducer(detected, { type: "OUTLINE_REFINED", outline: [...detected.outline] });
    expect(refined.history.stack.at(-1)!.photoFrame!.imageAlignment).toEqual(after.imageAlignment);
    const original = traceReducer(refined, { type: "JUMP_TO_HISTORY", index: before.history.index });
    expect(original.imageAlignment).toBeNull();
    const returned = traceReducer(original, { type: "JUMP_TO_HISTORY", index: refined.history.index });
    expect(returned.imageAlignment).toEqual(after.imageAlignment);
    expect(returned.region).toEqual(after.region);
  });

  it("keeps later quarter-turns and repeated upright alignment reversible without frame growth", () => {
    const before = ready(), after = align(before);
    const turned = traceReducer(after, { type: "ROTATE_SOURCE", direction: "clockwise",
      naturalSize: { width: 1200, height: 800 }, maxSize: { width: 800, height: 600 } });
    expect(undo(turned).imageAlignment).toEqual(after.imageAlignment);
    expect(undo(turned).outline).toEqual(after.outline);
    const restored = align(turned, -.6 - Math.PI / 2);
    expect(restored.imageSize).toEqual(before.imageSize);
    expect(mmPerPixel(restored.calibration)).toBeCloseTo(mmPerPixel(before.calibration)!, 9);
  });

  it("reorders manual perspective corners on a quarter-turn after alignment", () => {
    const initial = ready();
    initial.manualPerspectivePoints = [{ x: 20, y: 20 }, { x: 380, y: 20 }, { x: 380, y: 580 }, { x: 20, y: 580 }];
    initial.pendingPerspective = { source: "manual", points: [...initial.manualPerspectivePoints] as NonNullable<TraceState["pendingPerspective"]>["points"] };
    const before = align(initial), matrix = rotateImageAlignment(before.imageSize, Math.PI / 2, before.imageAlignment).transform;
    const turned = traceReducer(before, { type: "ROTATE_SOURCE", direction: "clockwise",
      naturalSize: { width: 1200, height: 800 }, maxSize: { width: 800, height: 600 } });
    const points = before.manualPerspectivePoints.map(p => transformImagePoint(p, matrix));
    expect(turned.manualPerspectivePoints).toEqual([points[3], points[0], points[1], points[2]]);
    expect(turned.pendingPerspective!.points).toEqual(turned.manualPerspectivePoints);
    expect(undo(turned).manualPerspectivePoints).toEqual(before.manualPerspectivePoints);
  });

  it("retains a revised scale when undoing a later alignment", () => {
    const first = align(ready());
    const recalibrated = traceReducer(first, { type: "SET_CALIBRATION", calibration: { ...first.calibration!, lengthMm: 75 } });
    const second = align(recalibrated, -.3);
    expect(undo(second).calibration).toEqual(recalibrated.calibration);
  });

  it("rejects stale previews and invalid rotations", () => {
    const state = ready();
    expect(traceReducer(state, { type: "ALIGN_UPRIGHT", expectedOutline: [...state.outline], outline: [], radians: .3 })).toBe(state);
    expect(align(state, NaN)).toBe(state);
  });
});

it("keeps source-photo mapping and correction marks through rotation and undo without sheet bounds", async () => {
  const { projectPoint } = await import("@shared/geometry/projective");
  const before = ready();
  before.perspectiveCorrection = {source:"manual",paper:"letter",toOriginal:[1/400,0,0,0,1/600,0,0,0,1]};
  const hint = {kind:"tool" as const,points:[{x:120,y:140}],radius:2};
  const marked = traceReducer(before,{type:"DETECTED",outline:before.outline,rawOutline:before.rawOutline,imageUrl,svg:"",region:null,detectionHints:[hint]});
  const after = align(marked), p = after.detectionHints[0].points[0];
  const mapped = projectPoint(after.perspectiveCorrection!.toOriginal!,p);
  expect(mapped.x).toBeCloseTo(.3,12); expect(mapped.y).toBeCloseTo(140/600,12);
  expect(undo(after).detectionHints).toEqual(marked.detectionHints);
  expect(redo(undo(after)).detectionHints).toEqual(after.detectionHints);
  expect(undo(marked).detectionHints).toEqual([]);
  const turned = traceReducer(marked,{type:"ROTATE_SOURCE",direction:"clockwise",naturalSize:marked.imageSize,maxSize:{width:1600,height:1600}});
  const turnedPoint=projectPoint(turned.perspectiveCorrection!.toOriginal!,turned.detectionHints[0].points[0]);
  expect(turnedPoint.x).toBeCloseTo(.3,12);expect(turnedPoint.y).toBeCloseTo(140/600,12);
});

it("keeps a correction brush's physical width when a quarter-turn resizes the photo", () => {
  const hint = { kind: "tool" as const, points: [{ x: 40, y: 40 }], radius: 2 };
  const before = traceReducer({ ...ready(), imageSize: { width: 200, height: 100 }, imageRotation: 0,
    calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 100 } },
  { type: "DETECTED", outline: [], rawOutline: [], imageUrl, svg: "", region: null, detectionHints: [hint] });
  const after = traceReducer(before, { type: "ROTATE_SOURCE", direction: "clockwise",
    naturalSize: before.imageSize, maxSize: { width: 100, height: 100 } });
  expect(after.imageSize).toEqual({ width: 50, height: 100 });
  expect(after.detectionHints[0]).toEqual({ ...hint, radius: 1, points: [{ x: 30, y: 20 }] });
  expect(after.detectionHints[0].radius * mmPerPixel(after.calibration)!).toBe(hint.radius * mmPerPixel(before.calibration)!);
  expect(after.history.stack.at(-1)?.detectionHints).toEqual(after.detectionHints);
});
