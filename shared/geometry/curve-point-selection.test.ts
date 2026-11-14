import { expect, it } from "vitest";
import { curvesFromOutline, type CurveOutline } from "./curves";
import { curvePoints, deleteCurvePoints, moveCurvePoints, selectedCurveSection } from "./curve-point-selection";

const source: CurveOutline = curvesFromOutline([{ outer: Array.from({ length: 6 }, (_, i) => ({ x: Math.cos(i * Math.PI / 3), y: Math.sin(i * Math.PI / 3) })),
  holes: [[{ x: 0, y: 0 }, { x: .1, y: 0 }, { x: 0, y: .1 }]] }]);
it("moves selected anchors and both handles without mutating the source or other contours", () => {
  const curves = structuredClone(source); curves[0].outer[0].in = { x: 2, y: 3 }; curves[0].outer[0].out = { x: 4, y: 5 };
  const snapshot = structuredClone(curves), refs = curvePoints(curves).slice(0, 2);
  const result = moveCurvePoints(curves, [...refs, refs[0]], { x: 10, y: -3 });
  expect(result[0].outer[0]).toEqual({ point: { x: 11, y: -3 }, in: { x: 12, y: 0 }, out: { x: 14, y: 2 } });
  expect(result[0].outer.slice(2)).toEqual(curves[0].outer.slice(2)); expect(result[0].holes).toEqual(curves[0].holes);
  expect(curves).toEqual(snapshot);
});
it("deletes a group atomically, keeps three anchors per ring and rejects stale references", () => {
  const refs = curvePoints(source);
  expect(deleteCurvePoints(source, refs.slice(0, 3))[0].outer).toHaveLength(3);
  expect(() => deleteCurvePoints(source, refs.slice(0, 4))).toThrow("three points");
  expect(() => deleteCurvePoints(source, [refs[0], refs[6]])).toThrow("three points");
  expect(source[0].outer).toHaveLength(6);
  expect(() => moveCurvePoints(source, [{ shapeIndex: 9, ringIndex: -1, index: 0 }], { x: 1, y: 0 })).toThrow("changed");
});
it("recognizes contiguous, wrapped and entire-ring sections, rejecting scattered or mixed-ring selections", () => {
  const refs = curvePoints(source);
  expect(selectedCurveSection(source, refs.slice(0, 3))).toMatchObject({ start: 0, end: 2 });
  expect(selectedCurveSection(source, [refs[5], refs[0], refs[1]])).toMatchObject({ start: 5, end: 1 });
  expect(selectedCurveSection(source, refs.slice(0, 6))).toMatchObject({ start: 0, end: 5 });
  expect(selectedCurveSection(source, [refs[0], refs[2], refs[4]])).toBeUndefined();
  expect(selectedCurveSection(source, [refs[0], refs[1], refs[6]])).toBeUndefined();
});
