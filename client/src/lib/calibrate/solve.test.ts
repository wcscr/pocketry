import { describe, expect, it } from "vitest";

import { solveScaleFromMarkers, SKEW_WARN_FRACTION } from "./solve";
import { templateMarkerCentersMm } from "./template";

/** Detected markers synthesised from the template at `pxPerMm`. */
function syntheticMarkers(pxPerMm: number, ids?: number[]) {
  return templateMarkerCentersMm("a4")
    .filter((entry) => !ids || ids.includes(entry.id))
    .map((entry) => ({
      id: entry.id,
      centerPx: { x: entry.x * pxPerMm, y: entry.y * pxPerMm },
    }));
}

describe("solveScaleFromMarkers", () => {
  it("recovers the exact scale from all four markers", () => {
    const solution = solveScaleFromMarkers(syntheticMarkers(2), "a4")!;
    expect(solution).not.toBeNull();
    expect(solution.mmPerPx).toBeCloseTo(0.5, 9);
    expect(solution.markerIds).toEqual([0, 1, 2, 3]);
    expect(solution.pairCount).toBe(6);
    expect(solution.maxDeviation).toBeCloseTo(0, 9);
    // The longest pair is a 250 mm diagonal — the 3-4-5 self-check.
    expect(solution.ruler.lengthMm).toBeCloseTo(250, 9);
  });

  it("works from any two markers", () => {
    const solution = solveScaleFromMarkers(syntheticMarkers(4, [0, 1]), "a4")!;
    expect(solution.pairCount).toBe(1);
    expect(solution.mmPerPx).toBeCloseTo(0.25, 9);
    expect(solution.ruler.lengthMm).toBeCloseTo(150, 9);
  });

  it("reports skew when the shot is off-axis", () => {
    // Stretch x by 8%: pair distances disagree with any single scale.
    const skewed = syntheticMarkers(2).map((marker) => ({
      ...marker,
      centerPx: { x: marker.centerPx.x * 1.08, y: marker.centerPx.y },
    }));
    const solution = solveScaleFromMarkers(skewed, "a4")!;
    expect(solution.maxDeviation).toBeGreaterThan(SKEW_WARN_FRACTION);
  });

  it("returns null below two usable markers", () => {
    expect(solveScaleFromMarkers([], "a4")).toBeNull();
    expect(solveScaleFromMarkers(syntheticMarkers(2, [0]), "a4")).toBeNull();
    // Unknown ids are ignored entirely.
    expect(
      solveScaleFromMarkers(
        [
          { id: 17, centerPx: { x: 0, y: 0 } },
          { id: 23, centerPx: { x: 100, y: 0 } },
        ],
        "a4",
      ),
    ).toBeNull();
  });

  it("distrusts duplicated ids", () => {
    const solution = solveScaleFromMarkers(
      [
        { id: 0, centerPx: { x: 0, y: 0 } },
        { id: 0, centerPx: { x: 500, y: 0 } },
        { id: 1, centerPx: { x: 300, y: 0 } },
      ],
      "a4",
    );
    // Both id-0 sightings dropped → only one marker left → null.
    expect(solution).toBeNull();
  });
});
