import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { pointInRing } from "@shared/geometry/rings";
import { mmPerPixel } from "@shared/geometry/scale";
import type { OpenCV } from "@/lib/detect/segment-opencv";
import { findPaperCorners } from "./paper-corners";
import { proposalFromPageCorners, runPerspectiveCorrection, type PerspectiveQuad } from "./perspective";

let cv: OpenCV;
beforeAll(async () => {
  cv = await createRequire(import.meta.url)("../../../public/opencv/opencv.js");
}, 60000);

const portrait: PerspectiveQuad = [
  { x: 151, y: 42 }, { x: 426, y: 72 }, { x: 450, y: 453 }, { x: 101, y: 432 },
];
const landscape: PerspectiveQuad = [
  { x: 95, y: 99 }, { x: 525, y: 151 }, { x: 501, y: 423 }, { x: 77, y: 371 },
];

function scene(sheets: PerspectiveQuad[], shadow = false, background = [104, 104, 104]): ImageData {
  const width = 640;
  const height = 500;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const paper = sheets.some(sheet => pointInRing(sheet, { x, y }));
      const tool = paper && (x - 210) ** 2 / 50 ** 2 + (y - 240) ** 2 / 95 ** 2 < 1;
      const light = Math.min(1, Math.max(0.58, 0.58 + (x - 80) / 420));
      const noise = (x * 3 + y * 7) % 7;
      const intensity = shadow ? light : 1;
      const material = paper ? tool ? [45, 45, 45] : [235, 235, 235] : background;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        data[offset + channel] = (material[channel] + noise) * intensity;
      }
      data[offset + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: "srgb" };
}

describe("paper corner detection with bundled OpenCV", () => {
  it.each([portrait, landscape].map(points => ({ points })))("finds an oblique sheet around a dark tool ($points)", ({ points }) => {
    const found = findPaperCorners(cv, scene([points], true));
    expect(found).not.toBeNull();
    found!.forEach(({ x, y }, i) => {
      expect(Math.hypot(x - points[i].x, y - points[i].y)).toBeLessThan(5);
    });
  });

  it("finds light paper even when the warm background is just as bright", () => {
    const found = findPaperCorners(cv, scene([portrait], true, [255, 240, 165]));
    expect(found).not.toBeNull();
    found!.forEach(({ x, y }, i) => {
      expect(Math.hypot(x - portrait[i].x, y - portrait[i].y)).toBeLessThan(5);
    });
  });

  it("keeps a detected landscape sheet in the correct aspect ratio when rectified", () => {
    const image = scene([landscape]);
    const proposal = proposalFromPageCorners(findPaperCorners(cv, image)!);
    expect(proposal?.paperOrientation).toBe("landscape");
    const result = runPerspectiveCorrection(cv, image, proposal!, "letter");
    const bounds = result.paperBounds!;
    const scale = mmPerPixel(result.calibration)!;
    expect((bounds.width - 1) * scale).toBeCloseTo(279.4, 2);
    expect((bounds.height - 1) * scale).toBeCloseTo(215.9, 2);
  });

  it("rejects a cropped page instead of using the photo border", () => {
    const clipped: PerspectiveQuad = [{ x: -30, y: 50 }, { x: 420, y: 70 }, { x: 420, y: 420 }, { x: -30, y: 440 }];
    expect(findPaperCorners(cv, scene([clipped]))).toBeNull();
  });

  it("rejects two similarly prominent sheets and an empty background", () => {
    const left: PerspectiveQuad = [{ x: 35, y: 65 }, { x: 285, y: 70 }, { x: 280, y: 440 }, { x: 35, y: 430 }];
    const right: PerspectiveQuad = left.map(({ x, y }) => ({ x: x + 315, y })) as PerspectiveQuad;
    expect(findPaperCorners(cv, scene([left, right]))).toBeNull();
    expect(findPaperCorners(cv, scene([]))).toBeNull();
  });
});
