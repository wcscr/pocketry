import { describe, expect, it } from "vitest";
import { hasWhitePaperBackground } from "./background-choice";

const fixture = (background: number[], shadow = false) => {
  const width = 120, height = 180, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = x > 30 && x < 90 && y > 30 && y < 150 ? [250, 250, 250, 255]
      : shadow && x < 8 ? [100, 96, 92, 255] : background;
    data.set(color, (y * width + x) * 4);
  }
  return { width, height, data };
};

describe("automatic background choice", () => {
  it.each([[255, 255, 255, 255], [180, 173, 165, 255]].map(color => ({ color })))("recognizes light neutral paper $color despite a shadowed side", ({ color }) => {
    expect(hasWhitePaperBackground(fixture(color, true))).toBe(true);
  });
  it.each([[25, 25, 25, 255], [100, 100, 100, 255], [170, 110, 65, 255], [240, 240, 80, 255], [255, 255, 255, 0]].map(color => ({ color })))(
    "uses color for a white tool on dark, colored or transparent surroundings $color", ({ color }) => {
      expect(hasWhitePaperBackground(fixture(color))).toBe(false);
    });
  it("rejects an ambiguous half-paper/half-dark surround", () => {
    const image = fixture([210, 205, 200, 255]);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width / 2; x++)
      image.data.set([60, 60, 60, 255], (y * image.width + x) * 4);
    expect(hasWhitePaperBackground(image)).toBe(false);
  });
  it("recognizes shaded paper without mistaking a black/white checkerboard for paper", () => {
    const shaded = fixture([200, 195, 190, 255]);
    const checker = fixture([255, 255, 255, 255]);
    for (let y = 0; y < shaded.height; y++) for (let x = 0; x < shaded.width; x++) {
      if (x < shaded.width / 2) shaded.data.set([100, 96, 92, 255], (y * shaded.width + x) * 4);
      if ((Math.floor(x / 10) + Math.floor(y / 10)) % 2) checker.data.set([25, 25, 25, 255], (y * checker.width + x) * 4);
    }
    expect(hasWhitePaperBackground(shaded)).toBe(true);
    expect(hasWhitePaperBackground(checker)).toBe(false);
  });
});
