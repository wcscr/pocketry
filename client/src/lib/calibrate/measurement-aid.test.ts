import { describe, expect, it } from "vitest";
import { MEASUREMENT_AIDS, MEASUREMENT_AID_LENGTHS, referenceStripMarkers } from "./reference-strip";
import { measurementAidRulerMarks } from "./measurement-aid";
import { solveReferenceStrip } from "./solve-reference-strip";

describe("50/100/200 mm printable measurement aids", () => {

  it("rejects mixed lengths, multiple rulers and wrong spacing", () => {
    const markers = (length: 50 | 100 | 200) => referenceStripMarkers(MEASUREMENT_AIDS[length]).map(({ id, center, corners }) => ({ id, centerPx: center, cornersPx: corners }));
    const short = markers(50), medium = markers(100), long = markers(200);
    // Scale up so even the shortest baseline exceeds the minimum 40 pixels.
    const zoom = (ms: ReturnType<typeof markers>) => ms.map((m) => ({ ...m, centerPx: { x: m.centerPx.x * 4, y: m.centerPx.y * 4 }, cornersPx: m.cornersPx.map((p) => ({ x: p.x * 4, y: p.y * 4 })) as typeof m.cornersPx }));
    expect(solveReferenceStrip(zoom(short))?.mmPerPx).toBe(.25);
    expect(solveReferenceStrip(zoom([short[0], medium[1]]))).toBeNull();
    expect(solveReferenceStrip(zoom([...medium, ...long]))).toBeNull();
    expect(solveReferenceStrip(zoom(medium.map((m, i) => ({ ...m, id: MEASUREMENT_AIDS[50].markerIds[i] }))))).toBeNull();
  });

  it.each(MEASUREMENT_AID_LENGTHS)("keeps %s mm ruler ticks at physical millimetres and outside marker quiet zones", (length) => {
    const marks = measurementAidRulerMarks(length);
    for (let mm = 1; mm < length; mm++) {
      const ticks = marks.filter((mark) => Math.abs(mark.x + mark.width / 2 - mm) < 1e-8 && mark.width === .4 && (mark.y < 1 || mark.y > 13));
      expect(ticks).toHaveLength(2);
      expect(ticks[0].height).toBe(mm % 10 === 0 ? 1.15 : mm % 5 === 0 ? .95 : .7);
    }
    for (const { corners } of referenceStripMarkers(MEASUREMENT_AIDS[length])) {
      const x0 = corners[0].x - 1.5, y0 = corners[0].y - 1.5;
      const x1 = corners[2].x + 1.5, y1 = corners[2].y + 1.5;
      expect(marks.some(({ x, y, width, height }) => x < x1 && x + width > x0 && y < y1 && y + height > y0 + 1e-8)).toBe(false);
    }
  });});
