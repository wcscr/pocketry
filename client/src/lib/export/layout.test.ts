import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { binFootprintMm } from "@shared/gridfinity/standard";
import { parseBinSpec } from "@shared/gridfinity/types";
import { signedArea } from "@shared/geometry/rings";
import { describe, expect, it } from "vitest";

import { generateLayoutDXF, generateLayoutSVG, layoutRingsMm } from "./layout";

function rectShape(id: string, width: number, height: number): TracedShape {
  const hw = width / 2;
  const hh = height / 2;
  return {
    id,
    name: id,
    outlineMm: [
      {
        outer: [
          { x: -hw, y: -hh },
          { x: hw, y: -hh },
          { x: hw, y: hh },
          { x: -hw, y: hh },
        ],
        holes: [],
      },
    ],
    bboxMm: { minX: -hw, minY: -hh, maxX: hw, maxY: hh },
    pointCount: 4,
    sourceMmPerPx: 0.2,
  };
}

const SPEC = parseBinSpec({ gridX: 2, gridY: 3, heightUnits: 6, fill: "solid" });
const SHAPE = rectShape("s1", 30, 10);
const BY_ID = new Map([[SHAPE.id, SHAPE]]);

function cutout(extra: Record<string, unknown> = {}) {
  return parseCutoutPlacement({
    id: "c1",
    shapeId: "s1",
    position: { x: 5, y: -8 },
    ...extra,
  });
}

describe("layoutRingsMm", () => {
  it("exports the actual L footprint instead of its bounding rectangle", () => {
    const shaped = parseBinSpec({
      ...SPEC,
      gridX: 2,
      gridY: 2,
      footprint: {
        kind: "custom",
        cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      },
    });
    const footprint = layoutRingsMm(shaped, [], BY_ID)[0];
    expect(footprint.some((point) => point.x < 5 && point.y > 5)).toBe(true);
    expect(Math.abs(signedArea(footprint))).toBeLessThan(
      binFootprintMm(2) * binFootprintMm(2) * 0.8,
    );
  });

  it("emits the footprint plus each pocket and independent finger-hole ring", () => {
    const rings = layoutRingsMm(SPEC, [cutout()], BY_ID, [
      {
        id: "f1",
        center: { x: 18, y: 0 },
        diameterMm: 18,
        kind: "straight",
        depthMm: 12,
        topFilletMm: 0,
        bottomFilletMm: 0,
      },
      {
        id: "f2",
        kind: "oblong-deep-scoop",
        center: { x: -18, y: 0 },
        diameterMm: 10,
        depthMm: 24,
        lengthMm: 30,
        rotationDeg: 90,
        topFilletMm: 0,
        bottomFilletMm: 0,
      },
    ]);
    // footprint + outline + hole circle + scoop circle
    expect(rings).toHaveLength(4);

    // Footprint bbox matches the bin exactly, centred on the origin.
    const xs = rings[0].map((p) => p.x);
    const ys = rings[0].map((p) => p.y);
    expect(Math.max(...xs)).toBeCloseTo(binFootprintMm(2) / 2, 9);
    expect(Math.min(...ys)).toBeCloseTo(-binFootprintMm(3) / 2, 9);
    // Footprint area ≈ w·l − corner deficit (r = 3.75): sanity via bounds.
    expect(Math.abs(signedArea(rings[0]))).toBeGreaterThan(
      binFootprintMm(2) * binFootprintMm(3) * 0.98,
    );

    // The pocket ring is the placed rectangle (y-up bin frame).
    const pocket = rings[1];
    const px = pocket.map((p) => p.x);
    const py = pocket.map((p) => p.y);
    expect(Math.min(...px)).toBeCloseTo(5 - 15, 9);
    expect(Math.max(...px)).toBeCloseTo(5 + 15, 9);
    expect(Math.min(...py)).toBeCloseTo(-8 - 5, 9);
  });

  it("skips dangling shape references", () => {
    const rings = layoutRingsMm(SPEC, [cutout({ shapeId: "ghost" })], BY_ID);
    expect(rings).toHaveLength(1); // footprint only
  });
});

describe("generateLayoutDXF", () => {
  it("writes one closed LWPOLYLINE per ring in millimetres", () => {
    const dxf = generateLayoutDXF(SPEC, [cutout()], BY_ID);
    expect(dxf.match(/LWPOLYLINE/g)).toHaveLength(2);
    expect(dxf).toContain("millimetres, bin top view");
    // A pocket vertex in bin-frame mm survives untransformed: x = 5+15 = 20.
    expect(dxf).toContain("20.000000");
    expect(dxf.endsWith("EOF\n")).toBe(true);
  });
});

describe("generateLayoutSVG", () => {
  it("is sized in real millimetres with the y-flip applied once", () => {
    const svg = generateLayoutSVG(SPEC, [cutout()], BY_ID);
    expect(svg).toContain(`width="${binFootprintMm(2)}mm"`);
    expect(svg).toContain(`height="${binFootprintMm(3)}mm"`);
    expect(svg.match(/<path /g)).toHaveLength(2);
    // Bin-frame (20, -13) → view (20 + 41.75, 62.75 + 13) = (61.75, 75.75).
    expect(svg).toContain("61.7500 75.7500");
  });
});
