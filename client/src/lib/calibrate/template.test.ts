import { describe, expect, it } from "vitest";

import { ARUCO_4X4_BITS, markerBits } from "./aruco-4x4";
import {
  calibrationTemplateSvg,
  TEMPLATE_MARKER_SIZE_MM,
  TEMPLATE_PAPER_MM,
  TEMPLATE_SPACING_MM,
  templateMarkerCentersMm,
} from "./template";

describe("ArUco 4x4 dictionary port", () => {
  it("carries the canonical DICT_4X4 patterns for ids 0-3", () => {
    // Decoded from OpenCV 4.11.0 predefined_dictionaries.hpp (rotation 0 of
    // each marker's byte record) — see the module header for provenance.
    expect(ARUCO_4X4_BITS).toEqual([0xb532, 0x0f9a, 0x332d, 0x9946]);
  });

  it("decodes id 0 row-major, MSB first", () => {
    expect(markerBits(0)).toEqual([
      [1, 0, 1, 1],
      [0, 1, 0, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 0],
    ]);
  });

  it("rejects unported ids", () => {
    expect(() => markerBits(7)).toThrow(/no ported pattern/);
  });
});

describe("calibration template", () => {
  it("places marker centres on the 150×200 rectangle with 3-4-5 diagonals", () => {
    for (const paper of ["a4", "letter"] as const) {
      const centers = templateMarkerCentersMm(paper);
      expect(centers.map((c) => c.id)).toEqual([0, 1, 2, 3]);

      const [tl, tr, br, bl] = centers;
      expect(tr.x - tl.x).toBeCloseTo(TEMPLATE_SPACING_MM.width, 9);
      expect(bl.y - tl.y).toBeCloseTo(TEMPLATE_SPACING_MM.height, 9);
      expect(Math.hypot(br.x - tl.x, br.y - tl.y)).toBeCloseTo(250, 9);

      // Everything on the page with ≥ 10 mm clearance, both paper sizes.
      const page = TEMPLATE_PAPER_MM[paper];
      const half = TEMPLATE_MARKER_SIZE_MM / 2;
      for (const { x, y } of centers) {
        expect(x - half).toBeGreaterThanOrEqual(10);
        expect(y - half).toBeGreaterThanOrEqual(10);
        expect(x + half).toBeLessThanOrEqual(page.width - 10);
        expect(y + half).toBeLessThanOrEqual(page.height - 10);
      }
    }
  });

  it("emits true-size SVG: millimetre user units and exact page dimensions", () => {
    const svg = calibrationTemplateSvg("a4");
    expect(svg).toContain('width="210mm"');
    expect(svg).toContain('height="297mm"');
    expect(svg).toContain('viewBox="0 0 210 297"');

    const letter = calibrationTemplateSvg("letter");
    expect(letter).toContain('width="215.9mm"');
    expect(letter).toContain('viewBox="0 0 215.9 279.4"');
  });

  it("renders one white cell per set bit, per marker", () => {
    const svg = calibrationTemplateSvg("a4");
    const whiteCells = svg.match(/fill="#fff"/g) ?? [];
    const popcount = (bits: number) =>
      bits.toString(2).split("").filter((b) => b === "1").length;
    const expected = ARUCO_4X4_BITS.reduce((sum, bits) => sum + popcount(bits), 0);
    // One background rect is white too.
    expect(whiteCells.length).toBe(expected + 1);
    // One black base rect per marker (texts also use #000, hence rect-scoped).
    expect(svg.match(/<rect [^>]*fill="#000"/g)?.length).toBe(4);
  });

  it("includes the 100 mm verification bar and labels", () => {
    const svg = calibrationTemplateSvg("a4");
    const bar = svg.match(/<line x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"/);
    expect(bar).not.toBeNull();
    expect(Number(bar![2]) - Number(bar![1])).toBeCloseTo(100, 9);
    expect(svg).toContain("print at 100% scale");
    expect(svg).toContain("id 0");
    expect(svg).toContain("id 3");
  });

  it("is deterministic", () => {
    expect(calibrationTemplateSvg("a4")).toBe(calibrationTemplateSvg("a4"));
  });
});
