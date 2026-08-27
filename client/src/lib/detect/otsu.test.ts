import { describe, expect, it } from "vitest";

import { applySensitivity, histogram, otsuFromHistogram, otsuThreshold } from "./otsu";

describe("histogram", () => {
  it("counts values into 256 bins", () => {
    const bins = histogram([0, 0, 255, 128]);
    expect(bins[0]).toBe(2);
    expect(bins[255]).toBe(1);
    expect(bins[128]).toBe(1);
  });

  it("clamps out-of-range values", () => {
    const bins = histogram([-10, 300, 12.7]);
    expect(bins[0]).toBe(1);
    expect(bins[255]).toBe(1);
    expect(bins[12]).toBe(1);
  });
});

describe("otsuThreshold", () => {
  it("splits a clean bimodal distribution between the modes", () => {
    const values = [...Array(500).fill(30), ...Array(500).fill(200)];
    const threshold = otsuThreshold(values);
    expect(threshold).toBeGreaterThanOrEqual(30);
    expect(threshold).toBeLessThan(200);
  });

  it("puts the split between unequal modes", () => {
    // 90% dark background, 10% bright subject — the common case for a photo.
    const values = [...Array(900).fill(40), ...Array(100).fill(220)];
    const threshold = otsuThreshold(values);
    expect(threshold).toBeGreaterThan(40);
    expect(threshold).toBeLessThan(220);
  });

  it("returns 0 for empty input", () => {
    expect(otsuThreshold([])).toBe(0);
  });

  it("returns a level that classifies nothing away for a single-valued input", () => {
    // With one mode there is no meaningful split; the loop breaks before it
    // can pick a level above it.
    expect(otsuThreshold(new Array(100).fill(77))).toBeLessThanOrEqual(77);
  });

  it("agrees between the array and histogram forms", () => {
    const values = [...Array(300).fill(10), ...Array(200).fill(180)];
    expect(otsuFromHistogram(histogram(values))).toBe(otsuThreshold(values));
  });

  it("is invariant to input order", () => {
    const values = [...Array(200).fill(20), ...Array(200).fill(190)];
    const shuffled = [...values].sort(() => 0.5 - ((values.length * 7) % 3) / 3);
    expect(otsuThreshold(shuffled)).toBe(otsuThreshold(values));
  });
});

describe("applySensitivity", () => {
  it("returns the Otsu level unchanged at the neutral setting", () => {
    expect(applySensitivity(100, 128)).toBe(100);
    expect(applySensitivity(37, 128)).toBe(37);
  });

  it("lowers the level below neutral, admitting more foreground", () => {
    expect(applySensitivity(100, 64)).toBeLessThan(100);
  });

  it("raises the level above neutral, admitting less", () => {
    expect(applySensitivity(100, 192)).toBeGreaterThan(100);
  });

  it("scales rather than offsets, so the control feels the same at any level", () => {
    // A fixed offset would be drastic on a low Otsu level and negligible on a
    // high one; a ratio keeps the proportional effect constant.
    const lowRatio = applySensitivity(40, 64) / 40;
    const highRatio = applySensitivity(200, 64) / 200;
    expect(lowRatio).toBeCloseTo(highRatio, 1);
  });

  it("clamps to 1..254 so the tracer always has background on one side", () => {
    expect(applySensitivity(250, 255)).toBeLessThanOrEqual(254);
    expect(applySensitivity(1, 0)).toBeGreaterThanOrEqual(1);
    expect(applySensitivity(0, 0)).toBe(1);
  });

  it("falls back to neutral for a non-finite sensitivity", () => {
    expect(applySensitivity(100, Number.NaN)).toBe(100);
  });
});
