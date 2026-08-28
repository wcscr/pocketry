import { ringBounds, signedArea } from "@shared/geometry/rings";
import {
  calibrationFromDraft,
  hasCalibrationEndpoints,
  type Calibration,
} from "@shared/geometry/scale";
import type { Outline } from "@shared/geometry/types";
import { describe, expect, it } from "vitest";

import { buildOutline } from "@/lib/geometry/outline";
import { cShapeRing, rectRing } from "@/lib/geometry/fixtures";

import {
  describeScale,
  exportScale,
  isCalibrated,
  mmPerPixel,
  toMm,
  toModelSpace,
  type ExportScale,
} from "./scale";

/** A 100×100 square with a 20×20 hole, in a 200 px tall image. */
function annulus(): Outline {
  return buildOutline([rectRing(0, 0, 100, 100), rectRing(40, 40, 20, 20)]);
}

const uncalibrated: ExportScale = { mmPerPx: null, imageHeight: 200 };
const calibrated: ExportScale = { mmPerPx: 0.5, imageHeight: 200 };

describe("manual calibration drafts", () => {
  it("requires two distinct endpoints and a positive confirmed length", () => {
    const endpoints = { startX: 10, startY: 20, endX: 110, endY: 20 };
    expect(hasCalibrationEndpoints({ startX: 10, startY: 20 })).toBe(false);
    expect(hasCalibrationEndpoints(endpoints)).toBe(true);
    expect(calibrationFromDraft(endpoints, 50)).toEqual({
      ...endpoints,
      lengthMm: 50,
    });
    expect(calibrationFromDraft(endpoints, 0)).toBeNull();
    expect(
      calibrationFromDraft(
        { startX: 10, startY: 20, endX: 10, endY: 20 },
        50,
      ),
    ).toBeNull();
  });
});

describe("toModelSpace — the Y flip", () => {
  it("flips Y exactly once, about the image height", () => {
    // A ring at y 10..30 in a 200 px image lands at 170..190, not at −10..−30
    // (no flip at all, just negation) and not back at 10..30 (flipped twice).
    const outline = buildOutline([rectRing(5, 10, 15, 20)]);
    const bounds = ringBounds(toModelSpace(outline, uncalibrated)[0].outer);

    expect(bounds).toEqual({ minX: 5, minY: 170, maxX: 20, maxY: 190 });
  });

  it("is an involution at the same height", () => {
    // Applying it twice returns the original, which is what makes "exactly
    // once" a meaningful statement about the exporters.
    const outline = buildOutline([cShapeRing()]);
    const round = toModelSpace(toModelSpace(outline, uncalibrated), uncalibrated);

    expect(round[0].outer).toEqual(outline[0].outer);
  });

  it("keeps shells positive and holes negative", () => {
    // Negating y alone would flip every sign and turn shells into holes; the
    // ring reversal inside `flipOutlineY` is what preserves the convention.
    const model = toModelSpace(annulus(), calibrated);

    expect(signedArea(model[0].outer)).toBeGreaterThan(0);
    expect(signedArea(model[0].holes[0])).toBeLessThan(0);
  });

  it("does not mutate its input", () => {
    const outline = annulus();
    const before = structuredClone(outline);
    toModelSpace(outline, calibrated);

    expect(outline).toEqual(before);
  });
});

describe("toModelSpace — units", () => {
  it("leaves pixel units when uncalibrated", () => {
    const model = toModelSpace(annulus(), uncalibrated);
    const bounds = ringBounds(model[0].outer);

    expect(bounds?.maxX).toBe(100);
    expect((bounds?.maxY ?? 0) - (bounds?.minY ?? 0)).toBe(100);
  });

  it("scales to millimetres when calibrated", () => {
    const model = toModelSpace(annulus(), calibrated);

    // 0.5 mm/px: the 100 px square is 50 mm, and the flip is measured in mm
    // too — 200 px × 0.5 = 100 mm, minus the 50 mm shape = 50..100.
    expect(ringBounds(model[0].outer)).toEqual({
      minX: 0,
      minY: 50,
      maxX: 50,
      maxY: 100,
    });
  });

  it("scales holes with their shell", () => {
    const model = toModelSpace(annulus(), calibrated);
    expect(ringBounds(model[0].holes[0])).toEqual({
      minX: 20,
      minY: 70,
      maxX: 30,
      maxY: 80,
    });
  });

  it("rejects a scale that would poison every coordinate", () => {
    const outline = annulus();
    expect(() => toModelSpace(outline, { mmPerPx: null, imageHeight: NaN })).toThrow(
      /imageHeight/,
    );
    expect(() => toModelSpace(outline, { mmPerPx: 0, imageHeight: 200 })).toThrow(
      /mmPerPx/,
    );
    expect(() => toModelSpace(outline, { mmPerPx: -2, imageHeight: 200 })).toThrow(
      /mmPerPx/,
    );
  });
});

describe("exportScale", () => {
  const calibration: Calibration = {
    startX: 0,
    startY: 0,
    endX: 100,
    endY: 0,
    lengthMm: 25,
  };

  it("derives mm/px from the shared helper", () => {
    const scale = exportScale(calibration, 480);
    expect(scale).toEqual({ mmPerPx: 0.25, imageHeight: 480 });
    expect(scale.mmPerPx).toBe(mmPerPixel(calibration));
  });

  it("carries a missing calibration through as null rather than 1", () => {
    // A silent 1 mm/px fallback is how a bin gets printed at the wrong size.
    expect(exportScale(null, 480).mmPerPx).toBeNull();
    expect(exportScale({ ...calibration, lengthMm: 0 }, 480).mmPerPx).toBeNull();
    expect(isCalibrated(exportScale(null, 480))).toBe(false);
    expect(isCalibrated(exportScale(calibration, 480))).toBe(true);
  });
});

describe("toMm", () => {
  it("converts pixel lengths when calibrated", () => {
    expect(toMm(10, calibrated)).toBe(5);
  });

  it("returns null when uncalibrated", () => {
    expect(toMm(10, uncalibrated)).toBeNull();
  });
});

describe("describeScale", () => {
  it("states both directions when calibrated", () => {
    expect(describeScale(calibrated)).toBe("0.5 mm/px (2 px/mm)");
  });

  it("says so when uncalibrated", () => {
    expect(describeScale(uncalibrated)).toMatch(/uncalibrated/i);
    expect(describeScale(uncalibrated)).toMatch(/pixels/i);
  });

  it("trims float noise to four significant figures", () => {
    expect(describeScale({ mmPerPx: 1 / 3, imageHeight: 10 })).toBe(
      "0.3333 mm/px (3 px/mm)",
    );
  });
});
