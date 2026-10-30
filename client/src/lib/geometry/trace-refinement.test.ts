import { expect, it } from "vitest";
import { signedArea } from "@shared/geometry/rings";
import { traceDraftSchema } from "@shared/trace-draft";
import { initialTraceState, traceReducer } from "@/state/trace-store";
import { adjustOutlineMargin, reprocessOutline } from "@/lib/image-processor";
import { traceDraftSnapshot } from "@/lib/trace-draft";
import { projectFromTrace } from "@/lib/project/trace-export";
import { traceObjects } from "@/lib/gridfinity/trace-objects";
import { withKernel } from "@/lib/manifold/runtime";
import { changeContourRole, traceMaterialOutline } from "./contour-role";
import { pointInOutline } from "./outline";
import { rectRing } from "./fixtures";
import { offsetDetectedOutline, offsetTraceOutline, refineTraceOutline } from "./trace-refinement";

const rect = (x: number, y: number, w: number, h: number) => ({ outer: rectRing(x, y, w, h), holes: [] });
const calibration = { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 100 };

it("keeps a crossing hole removable after margin, undo/redo, draft recovery and Bin backup", async () => {
  const pockets = [rect(0, 0, 100, 80), rect(80, 20, 40, 20)];
  const holed = await withKernel(kernel => changeContourRole(kernel, pockets, { shapeIndex: 1, ringIndex: -1 }, "hole"));
  const adjusted = await adjustOutlineMargin(holed, 0, 1, calibration);
  expect(traceObjects(adjusted).map(object => object.role ?? "pocket")).toEqual(["pocket", "hole"]);
  expect(Math.max(...adjusted[0].holes[0].map(p => p.x))).toBeCloseTo(119);
  expect(Math.max(...adjusted[0].outer.map(p => p.x))).toBeCloseTo(101);
  await withKernel(kernel => {
    expect(pointInOutline(traceMaterialOutline(kernel, adjusted), { x: 90, y: 30 })).toBe(false);
    expect(pointInOutline(traceMaterialOutline(kernel, adjusted.map(part => ({ ...part, holes: [] }))), { x: 90, y: 30 })).toBe(true);
  });
  let state = traceReducer(initialTraceState, { type: "SOURCE_LOADED", imageUrl: "data:image/png;base64,AA==", fileName: "crossing" });
  state = traceReducer(state, { type: "SOURCE_READY", imageSize: { width: 150, height: 100 } });
  state = traceReducer(state, { type: "SET_CALIBRATION", calibration });
  state = traceReducer(state, { type: "DETECTED", imageUrl: state.imageUrl, region: null, outline: pockets, rawOutline: pockets, svg: "" });
  state = traceReducer(state, { type: "OUTLINE_COMMITTED", outline: holed, label: "Make hole" });
  state = traceReducer(state, { type: "MARGIN_COMMITTED", margin: 1, outline: adjusted });
  const draft = traceDraftSchema.parse(JSON.parse(JSON.stringify(traceDraftSnapshot(state))));
  state = traceReducer(initialTraceState, { type: "TRACE_DRAFT_RESTORED", draft });
  expect(state.outline).toEqual(adjusted);
  state = traceReducer(state, { type: "UNDO" });
  expect(state.outline).toEqual(holed);
  state = traceReducer(state, { type: "REDO" });
  expect(state.outline).toEqual(adjusted);
  const backup = projectFromTrace(state.outline, { mmPerPx: 1, imageHeight: 100 }, "Crossing", 1);
  expect(backup.cutouts.map(cutout => cutout.role ?? "pocket")).toEqual(["pocket", "hole"]);
});

it("preserves overlapping pockets and a single shared hole through margin and refinement", async () => {
  const holed = await withKernel(kernel => changeContourRole(kernel,
    [rect(0, 0, 100, 80), rect(20, 0, 100, 80), rect(40, 20, 20, 20)], { shapeIndex: 2, ringIndex: -1 }, "hole"));
  // Equivalent references can have different first vertices after saved-data edits.
  const hole = holed[1].holes[0];
  holed[1].holes[0] = [...hole.slice(1), hole[0]];
  for (const adjusted of [
    await adjustOutlineMargin(holed, 0, 1, calibration),
    await reprocessOutline(holed, { detect: { smoothing: 2, tolerancePx: 1 }, margin: 1, calibration }),
  ]) {
    expect(traceObjects(adjusted).map(object => object.role ?? "pocket")).toEqual(["pocket", "pocket", "hole"]);
    expect(adjusted[0].holes[0]).toBe(adjusted[1].holes[0]);
    expect(signedArea(adjusted[0].outer)).toBeGreaterThan(0);
    expect(signedArea(adjusted[0].holes[0])).toBeLessThan(0);
    await withKernel(kernel => expect(pointInOutline(traceMaterialOutline(kernel, adjusted), { x: 50, y: 30 })).toBe(false));
  }
});

it("keeps small authored objects when changing detail", () => {
  const outline = [rect(0, 0, 1000, 1000), { ...rect(1100, 0, 2, 2), holes: [rectRing(1100.5, 0.5, 0.5, 0.5)] }];
  const refined = refineTraceOutline(outline, { smoothing: 0, tolerancePx: 0 });
  expect(refined).toHaveLength(2);
  expect(refined[1].holes).toHaveLength(1);
});

it("rejects destructive margins without changing the existing hole object", async () => {
  const outline = [{ ...rect(0, 0, 100, 80), holes: [rectRing(20, 20, 2, 2)] }];
  const before = JSON.stringify(outline);
  await expect(offsetTraceOutline(outline, 2)).rejects.toThrow("remove a hole");
  expect(JSON.stringify(outline)).toBe(before);
});

it("keeps separate detected tools when their initial clearance overlaps", async () => {
  const adjusted = await offsetDetectedOutline([rect(0, 0, 10, 10), rect(11, 0, 10, 10)], 1);
  expect(adjusted).toHaveLength(2);
  expect(Math.max(...adjusted[0].outer.map(p => p.x))).toBeGreaterThan(Math.min(...adjusted[1].outer.map(p => p.x)));
});
