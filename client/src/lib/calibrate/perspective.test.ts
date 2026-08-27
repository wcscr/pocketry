import { createRequire } from "node:module";

import { mmPerPixel } from "@shared/geometry/scale";
import { beforeAll, describe, expect, it } from "vitest";

import {
  perspectiveLayout,
  proposalFromTemplateMarkers,
  runPerspectiveCorrection,
  validPerspectiveQuad,
  type PerspectiveProposal,
  type PerspectiveQuad,
} from "./perspective";

/* eslint-disable @typescript-eslint/no-explicit-any -- opencv.js is untyped */
let cv: any;

beforeAll(async () => {
  const required = createRequire(import.meta.url)(
    "../../../public/opencv/opencv.js",
  ) as unknown;
  cv = await Promise.resolve(required);
}, 60000);

function imageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 180; y < 410; y++) {
    for (let x = 120; x < 310; x++) {
      const at = (y * width + x) * 4;
      data[at] = 20;
      data[at + 1] = 80;
      data[at + 2] = 180;
      data[at + 3] = 255;
    }
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return [...image.data.slice(at, at + 4)];
}

describe("perspective geometry", () => {
  it("orders the four unique template ids and rejects incomplete sets", () => {
    const markers = [
      { id: 2, centerPx: { x: 90, y: 120 } },
      { id: 0, centerPx: { x: 10, y: 20 } },
      { id: 3, centerPx: { x: 20, y: 110 } },
      { id: 1, centerPx: { x: 100, y: 30 } },
    ];
    expect(proposalFromTemplateMarkers(markers)?.points).toEqual([
      { x: 10, y: 20 },
      { x: 100, y: 30 },
      { x: 90, y: 120 },
      { x: 20, y: 110 },
    ]);
    expect(proposalFromTemplateMarkers(markers.slice(0, 3))).toBeNull();
    expect(proposalFromTemplateMarkers([...markers, markers[0]])).toBeNull();
  });

  it("maps an A4 sheet to a uniform two-pixels-per-mm plane", () => {
    const proposal: PerspectiveProposal = {
      source: "manual",
      points: [
        { x: 10, y: 10 },
        { x: 200, y: 20 },
        { x: 190, y: 280 },
        { x: 20, y: 270 },
      ],
    };
    const layout = perspectiveLayout(proposal, "a4");
    expect(layout).toMatchObject({ width: 421, height: 595, pxPerMm: 2 });
    expect(layout.destination).toEqual([
      { x: 0, y: 0 },
      { x: 420, y: 0 },
      { x: 420, y: 594 },
      { x: 0, y: 594 },
    ]);
  });

  it("rejects a crossed manual selection", () => {
    expect(
      validPerspectiveQuad([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ]),
    ).toBe(false);
  });
});

describe("perspective correction with the shipped OpenCV build", () => {
  it("rectifies a synthetic keystoned A4 photograph back to a metric plane", () => {
    const canonical = imageData(421, 595);
    const sourceCorners: PerspectiveQuad = [
      { x: 0, y: 0 },
      { x: 420, y: 0 },
      { x: 420, y: 594 },
      { x: 0, y: 594 },
    ];
    const photographedCorners: PerspectiveQuad = [
      { x: 70, y: 25 },
      { x: 445, y: 65 },
      { x: 490, y: 505 },
      { x: 35, y: 545 },
    ];

    const canonicalMat = cv.matFromImageData(canonical);
    const photographedMat = new cv.Mat();
    const from = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      sourceCorners.flatMap(({ x, y }) => [x, y]),
    );
    const to = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      photographedCorners.flatMap(({ x, y }) => [x, y]),
    );
    const transform = cv.getPerspectiveTransform(from, to);
    try {
      cv.warpPerspective(
        canonicalMat,
        photographedMat,
        transform,
        new cv.Size(525, 570),
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(255, 255, 255, 255),
      );
      const photographed = {
        data: new Uint8ClampedArray(photographedMat.data),
        width: photographedMat.cols,
        height: photographedMat.rows,
        colorSpace: "srgb",
      } as ImageData;
      const corrected = runPerspectiveCorrection(
        cv,
        photographed,
        { source: "manual", points: photographedCorners },
        "a4",
      );

      expect(corrected.width).toBe(421);
      expect(corrected.height).toBe(595);
      expect(mmPerPixel(corrected.calibration)).toBeCloseTo(0.5, 9);
      expect(pixel(corrected.imageData, 210, 290).slice(0, 3)).toEqual([
        20, 80, 180,
      ]);
      expect(pixel(corrected.imageData, 40, 100).slice(0, 3)).toEqual([
        255, 255, 255,
      ]);
    } finally {
      transform.delete();
      to.delete();
      from.delete();
      photographedMat.delete();
      canonicalMat.delete();
    }
  });
});
