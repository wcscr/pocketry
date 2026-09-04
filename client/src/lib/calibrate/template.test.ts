import { describe, expect, it } from "vitest";

import { POCKETRY_ARUCO_BITS, markerBits } from "./aruco-4x4";
import {
  calibrationTemplateSvg,
  EXPERIMENTAL_TEMPLATE_MARKER_SIZE_MM,
  EXPERIMENTAL_TEMPLATE_OUTER_MARGIN_MM,
  paperFromTemplateMarkerIds,
  TEMPLATE_MARKER_IDS,
  TEMPLATE_MARKER_SIZE_MM,
  TEMPLATE_PAPER_MM,
  TEMPLATE_SPACING_MM,
  templateFromTemplateMarkerIds,
  templateMarkerCornersMm,
  templateMarkerCentersMm,
  templateMarkerSizeMm,
  templateVerificationBarMm,
} from "./template";

describe("ArUco 4x4 dictionary port", () => {
  it("preserves ids 0-7 and adds the deterministic ids 8-15", () => {
    // Decoded from OpenCV 4.11.0 predefined_dictionaries.hpp (rotation 0 of
    // each marker's byte record) — see the module header for provenance.
    expect(POCKETRY_ARUCO_BITS.slice(0, 8)).toEqual([
      0x532c, 0xaf8f, 0x203f, 0x1296, 0x03f9, 0x9a2f, 0x4754, 0xd870,
    ]);
    expect(POCKETRY_ARUCO_BITS.slice(8)).toEqual([
      0xbcd7, 0x7de6, 0x5b8b, 0xf346, 0x50cc, 0xa729, 0x10a0, 0x0c82,
    ]);
  });

  it("decodes Pocketry v2 id 0 row-major, MSB first", () => {
    expect(markerBits(0)).toEqual([
      [0, 1, 0, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 0],
      [1, 1, 0, 0],
    ]);
  });

  it("rejects unported ids", () => {
    expect(() => markerBits(16)).toThrow(/no ported pattern/);
  });
});

describe("calibration template", () => {
  it("places marker centres on the 150×200 rectangle with 3-4-5 diagonals", () => {
    for (const paper of ["a4", "letter"] as const) {
      const centers = templateMarkerCentersMm(paper);
      expect(centers.map((c) => c.id)).toEqual(TEMPLATE_MARKER_IDS[paper]);

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

  it("requires the complete paper-specific marker signature", () => {
    expect(paperFromTemplateMarkerIds([0, 1, 2, 3])).toBe("a4");
    expect(paperFromTemplateMarkerIds([4, 5, 6, 7])).toBe("letter");
    expect(paperFromTemplateMarkerIds([8, 9, 10, 11])).toBe("a4");
    expect(paperFromTemplateMarkerIds([12, 13, 14, 15])).toBe("letter");
    expect(templateFromTemplateMarkerIds([8, 9, 10, 11])).toBe(
      "a4-experimental",
    );
    expect(templateFromTemplateMarkerIds([12, 13, 14, 15])).toBe(
      "letter-experimental",
    );
    expect(paperFromTemplateMarkerIds([0, 2])).toBeNull();
    expect(paperFromTemplateMarkerIds([4, 7])).toBeNull();
    expect(paperFromTemplateMarkerIds([0, 1, 2, 3, 4])).toBeNull();
    expect(paperFromTemplateMarkerIds([0])).toBeNull();
    expect(paperFromTemplateMarkerIds([0, 4])).toBeNull();
    expect(paperFromTemplateMarkerIds([12, 13])).toBeNull();
  });

  it("places 24 mm experimental markers 12 mm from each paper edge", () => {
    for (const template of [
      "a4-experimental",
      "letter-experimental",
    ] as const) {
      const paper = template.startsWith("a4") ? "a4" : "letter";
      const page = TEMPLATE_PAPER_MM[paper];
      const centers = templateMarkerCentersMm(template);
      const half = EXPERIMENTAL_TEMPLATE_MARKER_SIZE_MM / 2;

      expect(centers.map(({ id }) => id)).toEqual(TEMPLATE_MARKER_IDS[template]);
      expect(centers[0].x - half).toBe(
        EXPERIMENTAL_TEMPLATE_OUTER_MARGIN_MM,
      );
      expect(centers[0].y - half).toBe(
        EXPERIMENTAL_TEMPLATE_OUTER_MARGIN_MM,
      );
      expect(page.width - (centers[1].x + half)).toBeCloseTo(
        EXPERIMENTAL_TEMPLATE_OUTER_MARGIN_MM,
        9,
      );
      expect(page.height - (centers[2].y + half)).toBeCloseTo(
        EXPERIMENTAL_TEMPLATE_OUTER_MARGIN_MM,
        9,
      );
      expect(centers[1].x - centers[0].x).toBeCloseTo(page.width - 48, 9);
      expect(centers[3].y - centers[0].y).toBeCloseTo(page.height - 48, 9);
    }
  });

  it("provides all sixteen physical marker corners for precision fitting", () => {
    for (const template of [
      "a4",
      "letter",
      "a4-experimental",
      "letter-experimental",
    ] as const) {
      const markers = templateMarkerCornersMm(template);
      expect(markers).toHaveLength(4);
      expect(markers.flatMap(({ corners }) => corners)).toHaveLength(16);
      for (const marker of markers) {
        expect(marker.corners[1].x - marker.corners[0].x).toBeCloseTo(
          templateMarkerSizeMm(template),
          9,
        );
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

    const experimental = calibrationTemplateSvg("a4-experimental");
    expect(experimental).toContain("experimental");
    expect(experimental).toContain('width="24" height="24"');
  });

  it("renders one white cell per set bit, per marker", () => {
    const svg = calibrationTemplateSvg("a4");
    const whiteCells = svg.match(/fill="#fff"/g) ?? [];
    const popcount = (bits: number) =>
      bits.toString(2).split("").filter((b) => b === "1").length;
    const expected = TEMPLATE_MARKER_IDS.a4.reduce(
      (sum, id) => sum + popcount(POCKETRY_ARUCO_BITS[id]),
      0,
    );
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
    expect(svg).toContain("Pocketry v2 calibration sheet");
    expect(svg).toContain("id 0");
    expect(svg).toContain("id 3");
    const letter = calibrationTemplateSvg("letter");
    expect(letter).toContain("id 4");
    expect(letter).toContain("id 7");
    expect(letter).not.toContain("id 0");

    const experimental = calibrationTemplateSvg("a4-experimental");
    expect(experimental).toContain("id 8");
    expect(experimental).toContain("id 11");
    expect(experimental).not.toContain("id 0");
  });

  it("places the experimental 100 mm line between the lower markers", () => {
    for (const template of [
      "a4-experimental",
      "letter-experimental",
    ] as const) {
      const centers = templateMarkerCentersMm(template);
      const ruler = templateVerificationBarMm(template);
      const half = EXPERIMENTAL_TEMPLATE_MARKER_SIZE_MM / 2;
      const leftInnerEdge = centers[3].x + half;
      const rightInnerEdge = centers[2].x - half;
      const lowerEdge = centers[2].y + half;

      expect(ruler.endX - ruler.startX).toBeCloseTo(100, 9);
      expect(ruler.startX).toBeGreaterThan(leftInnerEdge);
      expect(ruler.endX).toBeLessThan(rightInnerEdge);
      expect(lowerEdge - ruler.y).toBe(4);
    }
  });

  it("is deterministic", () => {
    expect(calibrationTemplateSvg("a4")).toBe(calibrationTemplateSvg("a4"));
  });
});
