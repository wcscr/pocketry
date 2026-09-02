import { createRequire } from "node:module";

import { mmPerPixel } from "@shared/geometry/scale";
import { beforeAll, describe, expect, it } from "vitest";

import {
  perspectiveLayout,
  proposalFromTemplateMarkers,
  runPerspectiveCorrection,
  scalePerspectiveProposal,
  validPerspectiveQuad,
  type PerspectiveProposal,
  type PerspectiveQuad,
} from "./perspective";
import {
  templateMarkerCentersMm,
  templateMarkerCornersMm,
} from "./template";

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

function marker(id: number, x: number, y: number) {
  return {
    id,
    centerPx: { x, y },
    cornersPx: [
      { x: x - 5, y: y - 5 },
      { x: x + 5, y: y - 5 },
      { x: x + 5, y: y + 5 },
      { x: x - 5, y: y + 5 },
    ] as PerspectiveQuad,
  };
}

function transformPoints(points: readonly { x: number; y: number }[], transform: any) {
  const input = cv.matFromArray(
    points.length,
    1,
    cv.CV_32FC2,
    points.flatMap(({ x, y }) => [x, y]),
  );
  const output = new cv.Mat();
  try {
    cv.perspectiveTransform(input, output, transform);
    return points.map((_, index) => ({
      x: output.data32F[index * 2],
      y: output.data32F[index * 2 + 1],
    }));
  } finally {
    output.delete();
    input.delete();
  }
}

describe("perspective geometry", () => {
  it("orders the four unique template ids and rejects incomplete sets", () => {
    const markers = [
      marker(2, 90, 120),
      marker(0, 10, 20),
      marker(3, 20, 110),
      marker(1, 100, 30),
    ];
    const proposal = proposalFromTemplateMarkers(markers, "a4");
    expect(proposal?.points).toEqual([
      { x: 10, y: 20 },
      { x: 100, y: 30 },
      { x: 90, y: 120 },
      { x: 20, y: 110 },
    ]);
    expect(proposal?.paper).toBe("a4");
    expect(proposal?.correspondences?.source).toHaveLength(16);
    expect(proposal?.correspondences?.destinationMm).toHaveLength(16);
    expect(proposalFromTemplateMarkers(markers.slice(0, 3), "a4")).toBeNull();
    expect(proposalFromTemplateMarkers([...markers, markers[0]], "a4")).toBeNull();
  });

  it("maps an A4 sheet to a high-resolution four-pixels-per-mm plane", () => {
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
    expect(layout).toMatchObject({ width: 841, height: 1189, pxPerMm: 4 });
    expect(layout.destination).toEqual([
      { x: 0, y: 0 },
      { x: 840, y: 0 },
      { x: 840, y: 1188 },
      { x: 0, y: 1188 },
    ]);
  });

  it("maps detection coordinates back with exact independent axis scales", () => {
    const proposal: PerspectiveProposal = {
      source: "template",
      paper: "a4",
      points: [
        { x: 100, y: 200 },
        { x: 300, y: 200 },
        { x: 300, y: 500 },
        { x: 100, y: 500 },
      ],
      correspondences: {
        source: [{ x: 80, y: 160 }],
        destinationMm: [{ x: 15, y: 20 }],
      },
    };

    const scaled = scalePerspectiveProposal(proposal, 0.5, 0.4);
    expect(scaled.points).toEqual([
      { x: 50, y: 80 },
      { x: 150, y: 80 },
      { x: 150, y: 200 },
      { x: 50, y: 200 },
    ]);
    expect(scaled.correspondences?.source).toEqual([{ x: 40, y: 64 }]);
    expect(scaled.correspondences?.destinationMm).toEqual([{ x: 15, y: 20 }]);
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

      expect(corrected.width).toBe(841);
      expect(corrected.height).toBe(1189);
      expect(mmPerPixel(corrected.calibration)).toBeCloseTo(0.25, 9);
      expect(corrected.reprojectionErrorPx).toBeNull();
      expect(pixel(corrected.imageData, 420, 580).slice(0, 3)).toEqual([
        20, 80, 180,
      ]);
      expect(pixel(corrected.imageData, 80, 200).slice(0, 3)).toEqual([
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

  it("uses all sixteen refined marker corners for a precision template fit", () => {
    const canonical = imageData(421, 595);
    const canonicalPage: PerspectiveQuad = [
      { x: 0, y: 0 },
      { x: 420, y: 0 },
      { x: 420, y: 594 },
      { x: 0, y: 594 },
    ];
    const photographedPage: PerspectiveQuad = [
      { x: 65, y: 22 },
      { x: 452, y: 72 },
      { x: 494, y: 512 },
      { x: 31, y: 548 },
    ];
    const from = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      canonicalPage.flatMap(({ x, y }) => [x, y]),
    );
    const to = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      photographedPage.flatMap(({ x, y }) => [x, y]),
    );
    const photographTransform = cv.getPerspectiveTransform(from, to);
    const canonicalMat = cv.matFromImageData(canonical);
    const photographedMat = new cv.Mat();
    try {
      cv.warpPerspective(
        canonicalMat,
        photographedMat,
        photographTransform,
        new cv.Size(525, 570),
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(255, 255, 255, 255),
      );

      const centers = transformPoints(
        templateMarkerCentersMm("a4").map(({ x, y }) => ({
          x: x * 2,
          y: y * 2,
        })),
        photographTransform,
      );
      const physicalCorners = templateMarkerCornersMm("a4");
      const photographedCorners = transformPoints(
        physicalCorners.flatMap(({ corners }) =>
          corners.map(({ x, y }) => ({ x: x * 2, y: y * 2 })),
        ),
        photographTransform,
      );
      const markers = templateMarkerCentersMm("a4").map(({ id }, index) => ({
        id,
        centerPx: centers[index],
        cornersPx: photographedCorners.slice(
          index * 4,
          index * 4 + 4,
        ) as PerspectiveQuad,
      }));
      const proposal = proposalFromTemplateMarkers(markers, "a4")!;
      const photographed = {
        data: new Uint8ClampedArray(photographedMat.data),
        width: photographedMat.cols,
        height: photographedMat.rows,
        colorSpace: "srgb",
      } as ImageData;
      const corrected = runPerspectiveCorrection(
        cv,
        photographed,
        proposal,
        "a4",
      );

      expect(corrected.reprojectionErrorPx).not.toBeNull();
      expect(corrected.reprojectionErrorPx!).toBeLessThan(0.01);
      expect(pixel(corrected.imageData, 420, 580).slice(0, 3)).toEqual([
        20, 80, 180,
      ]);
    } finally {
      photographedMat.delete();
      canonicalMat.delete();
      photographTransform.delete();
      to.delete();
      from.delete();
    }
  });
});
