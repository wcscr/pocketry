import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { pointInOutline, outlineArea } from "../geometry/outline";
import { buildOutline } from "../geometry/outline";
import { traceIsoRings } from "../geometry/trace";
import { processImage } from "../image-processor";
import { buildScoreFieldJS } from "./segment-js";
import { buildScoreFieldOpenCV, type OpenCV } from "./segment-opencv";
import { restoreOccludedScore } from "./occlusions";
import type { ImageLike, ScoreField } from "./types";
import type { Ring } from "@shared/geometry/types";

let cv: OpenCV;
beforeAll(async () => { cv = await createRequire(import.meta.url)("../../../public/opencv/opencv.js"); }, 60000);
const rectangle = (x: number, y: number, w: number, h: number): Ring =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const footprint = rectangle(90, 45, 25, 75);
function photograph(placement: "inside" | "outside" | "edge"): ImageLike {
  const width = 180, height = 160;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const right = placement === "inside" ? 150 : placement === "edge" ? 103 : 70;
    let v = x >= 25 && x < right && y >= 25 && y < 140 ? 35 : 245;
    // A real hole outside the aid must survive.
    if (x >= 40 && x < 50 && y >= 50 && y < 65) v = 245;
    if (x >= 90 && x < 115 && y >= 45 && y < 120) {
      v = ((y >= 50 && y < 62) || (y >= 100 && y < 112)) && x > 95 && x < 110 ? 0 : 245;
    }
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  return { width, height, data };
}
function outlines(field: ScoreField) {
  return buildOutline(traceIsoRings(field.score, field.width, field.height, { iso: field.iso, interpolate: true, ambiguity: "separate" })
    .map(ring => ring.map(p => ({ x: (p.x + .5) / field.scale + field.offsetX, y: (p.y + .5) / field.scale + field.offsetY }))));
}

describe("recognized aid occlusion", () => {
  it.each(["js", "opencv"] as const)("suppresses only aid details using the %s backend", engine => {
    for (const placement of ["inside", "outside", "edge"] as const) {
      const image = photograph(placement);
      const field = engine === "js" ? buildScoreFieldJS(image) : buildScoreFieldOpenCV(cv, image);
      const before = field.score.slice();
      const regions: Ring[] = [];
      const inferred = restoreOccludedScore(field, [footprint], regions);
      expect(regions).toEqual(placement === "edge" ? [footprint] : []);
      const outline = outlines(field);
      expect(inferred).toBe(placement === "edge");
      expect(outline).toHaveLength(1);
      expect(pointInOutline(outline, { x: 45, y: 55 })).toBe(false);
      expect(pointInOutline(outline, { x: 100, y: 80 })).toBe(placement !== "outside");
      if (placement === "edge") expect(pointInOutline(outline, { x: 110, y: 80 })).toBe(false);
      for (let y = 0; y < field.height; y++) for (let x = 0; x < field.width; x++) {
        if (x < 90 || x >= 115 || y < 45 || y >= 120) expect(field.score[y * field.width + x]).toBe(before[y * field.width + x]);
      }
    }
  });

  it("maps footprints through ROI offsets and downscaling", () => {
    const image = photograph("inside");
    const field = buildScoreFieldJS(image, { roi: { x: 5, y: 5, width: 170, height: 150 }, maxPixels: 10000 });
    restoreOccludedScore(field, [footprint]);
    const outline = outlines(field);
    expect(pointInOutline(outline, { x: 100, y: 80 })).toBe(true);
    expect(pointInOutline(outline, { x: 45, y: 55 })).toBe(false);
    expect(outline).toHaveLength(1);
  });

  it("leaves an entirely occluded crop and invalid/off-image masks unchanged", () => {
    const field = buildScoreFieldJS(photograph("inside"));
    const before = field.score.slice();
    expect(restoreOccludedScore(field, [rectangle(-1, -1, 1000, 1000), rectangle(300, 300, 5, 5), [{ x: NaN, y: 0 }]])).toBe(false);
    expect(field.score).toEqual(before);
  });

  it("persists the restored raw contour and reports a hidden edge only when needed", async () => {
    for (const placement of ["inside", "edge"] as const) {
      const notices: string[] = [];
      const result = await processImage(photograph(placement), { includeInteriorHoles: true,
        detect: { engine: "js", occlusions: [footprint], smoothing: 0, tolerancePx: 0 },
        onNotice: title => notices.push(title) });
      expect(result.outline).toHaveLength(1);
      expect(result.outline[0].holes).toHaveLength(1);
      expect(outlineArea(result.rawOutline)).toBeCloseTo(outlineArea(result.outline), 5);
      expect(notices).toEqual(placement === "edge" ? ["Review the edge beneath the measurement aid"] : []);
      expect(result.estimatedEdgeRegions).toEqual(placement === "edge" ? [footprint] : []);
    }
  });
});

it("returns estimated areas in the same source frame as a cropped trace", async () => {
  const result = await processImage(photograph("edge"), {
    region: { originalRegion: { x: 20, y: 30, width: 180, height: 160 }, isCropped: true },
    detect: { engine: "js", occlusions: [footprint], smoothing: 0, tolerancePx: 0 },
  });
  expect(result.estimatedEdgeRegions).toEqual([footprint.map(p => ({ x: p.x + 20, y: p.y + 30 }))]);
});
