import type { Calibration } from "@shared/geometry/scale";
import type { Outline } from "@shared/geometry/types";
import { describe, expect, it } from "vitest";

import { circleRing, cShapeRing, rectRing } from "@/lib/geometry/fixtures";
import { buildOutline } from "@/lib/geometry/outline";

import { generateOutlineSVG, outlineToPathData } from "./svg";

/** A 100×100 square with a 20×20 hole. */
function annulus(): Outline {
  return buildOutline([rectRing(0, 0, 100, 100), rectRing(40, 40, 20, 20)]);
}

const calibration: Calibration = {
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 0,
  lengthMm: 25, // 0.25 mm/px, i.e. 4 px/mm.
};

/** Number of `M` commands, i.e. subpaths. */
function subpathCount(pathData: string): number {
  return (pathData.match(/M /g) ?? []).length;
}

describe("outlineToPathData", () => {
  it("emits one closed subpath per ring", () => {
    const data = outlineToPathData(buildOutline([rectRing(0, 0, 10, 20)]));
    expect(data).toBe("M 0 0 L 10 0 L 10 20 L 0 20 Z");
  });

  it("emits a subpath for a hole as well as its shell", () => {
    // Two subpaths in one path is what makes even-odd carve the hole out; the
    // legacy exporter could only ever emit the outer ring.
    const data = outlineToPathData(annulus());
    expect(subpathCount(data)).toBe(2);
    expect(data.match(/Z/g)).toHaveLength(2);
  });

  it("emits one subpath per ring across several shapes", () => {
    const outline = [
      ...annulus(),
      ...buildOutline([rectRing(200, 0, 30, 30)]),
      ...buildOutline([cShapeRing()]),
    ];
    expect(subpathCount(outlineToPathData(outline))).toBe(4);
  });

  it("rounds to two decimals by default", () => {
    const outline: Outline = [
      {
        outer: [
          { x: 1.234_56, y: 2.999_9 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
        holes: [],
      },
    ];
    expect(outlineToPathData(outline)).toBe("M 1.23 3 L 10 0 L 0 10 Z");
  });

  it("shortens the output as precision drops", () => {
    // Native-resolution rings are megabytes at full float precision, which is
    // the whole reason this parameter exists.
    const outline = buildOutline([circleRing(50.5, 50.5, 33.3, 64)]);
    const coarse = outlineToPathData(outline, 1);
    const fine = outlineToPathData(outline, 6);

    expect(coarse.length).toBeLessThan(fine.length);
    expect(subpathCount(coarse)).toBe(subpathCount(fine));
  });

  it("never writes a negative zero", () => {
    const outline: Outline = [
      {
        outer: [
          { x: -0.001, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
        holes: [],
      },
    ];
    expect(outlineToPathData(outline)).toBe("M 0 0 L 10 0 L 0 10 Z");
  });

  it("skips rings that enclose nothing", () => {
    const outline: Outline = [
      { outer: [{ x: 0, y: 0 }, { x: 1, y: 1 }], holes: [] },
    ];
    expect(outlineToPathData(outline)).toBe("");
  });

  it("returns an empty string for an empty outline", () => {
    expect(outlineToPathData([])).toBe("");
  });
});

describe("generateOutlineSVG — viewBox", () => {
  it("uses the real image size even with no calibration", () => {
    // Regression: the legacy writer fell back to a hardcoded "0 0 800 600" and
    // only consulted the real dimensions when a calibration existed, so an
    // uncalibrated 800×450 trace imported 1.33× too tall.
    const svg = generateOutlineSVG(annulus(), { width: 800, height: 450 });

    expect(svg).toContain('viewBox="0 0 800 450"');
    expect(svg).not.toContain("800 600");
  });

  it("uses the real image size when calibrated too", () => {
    const svg = generateOutlineSVG(annulus(), {
      width: 1024,
      height: 768,
      calibration,
    });
    expect(svg).toContain('viewBox="0 0 1024 768"');
  });
});

describe("generateOutlineSVG — physical size", () => {
  it("emits mm dimensions when the scale is known", () => {
    // Regression: width="100%" left the physical size undefined in Inkscape
    // and LightBurn regardless of what the RDF metadata claimed.
    const svg = generateOutlineSVG(annulus(), {
      width: 800,
      height: 450,
      calibration,
    });

    expect(svg).toContain('width="200mm" height="112.5mm"');
    expect(svg).not.toContain('width="100%"');
  });

  it("accepts mmPerPx without a calibration", () => {
    const svg = generateOutlineSVG(annulus(), {
      width: 800,
      height: 450,
      mmPerPx: 0.25,
    });
    expect(svg).toContain('width="200mm" height="112.5mm"');
  });

  it("omits dimensions entirely when uncalibrated", () => {
    // Better unitless than wrong: a viewer then picks its own scale instead of
    // trusting a fabricated millimetre size.
    const svg = generateOutlineSVG(annulus(), { width: 800, height: 450 });
    expect(svg).not.toContain("mm");
    // Leading space, so `stroke-width` on the path does not match.
    expect(svg).not.toContain(" width=");
  });
});

describe("generateOutlineSVG — path", () => {
  it("puts every ring in a single evenodd path", () => {
    const svg = generateOutlineSVG(annulus(), { width: 200, height: 200 });

    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(subpathCount(svg)).toBe(2);
  });

  it("honours the styling options", () => {
    const svg = generateOutlineSVG(annulus(), {
      width: 200,
      height: 200,
      fill: "rgba(100, 100, 255, 0.3)",
      stroke: "blue",
      strokeWidth: 3,
    });

    expect(svg).toContain('fill="rgba(100, 100, 255, 0.3)"');
    expect(svg).toContain('stroke="blue"');
    expect(svg).toContain('stroke-width="3"');
  });

  it("escapes caller-supplied styling", () => {
    const svg = generateOutlineSVG(annulus(), {
      width: 200,
      height: 200,
      stroke: '"><script/>',
    });
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&quot;&gt;&lt;script/&gt;");
  });

  it("omits the path for an empty outline", () => {
    const svg = generateOutlineSVG([], { width: 200, height: 200 });
    expect(svg).not.toContain("<path");
    expect(svg).toContain("</svg>");
  });

  it("does not flip Y — SVG shares the tracer's y-down frame", () => {
    const outline = buildOutline([rectRing(0, 10, 10, 10)]);
    const svg = generateOutlineSVG(outline, { width: 100, height: 100 });
    expect(svg).toContain("M 0 10");
  });
});

describe("generateOutlineSVG — metadata", () => {
  /** The block exactly as the legacy exporter wrote it. */
  const legacyBlock = `
  <!-- SVG Scaling Information -->
  <metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
             xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
             xmlns:dc="http://purl.org/dc/elements/1.1/">
      <rdf:Description>
        <dc:scale>4 pixels per mm</dc:scale>
        <dc:rulerLengthMm>25</dc:rulerLengthMm>
        <dc:rulerLengthPixels>100.00</dc:rulerLengthPixels>
      </rdf:Description>
    </rdf:RDF>
  </metadata>`;

  it("stays byte-compatible with the legacy RDF block", () => {
    const svg = generateOutlineSVG(annulus(), {
      width: 800,
      height: 450,
      calibration,
    });
    expect(svg).toContain(legacyBlock);
  });

  it("writes dc:scale as pixels per mm, not mm per pixel", () => {
    const svg = generateOutlineSVG(annulus(), {
      width: 800,
      height: 450,
      mmPerPx: 0.25,
    });
    expect(svg).toContain("<dc:scale>4 pixels per mm</dc:scale>");
  });

  it("omits the ruler elements when only a ratio is known", () => {
    // Reporting a ruler length the user never measured would put a fabricated
    // measurement into a file people treat as a record.
    const svg = generateOutlineSVG(annulus(), {
      width: 800,
      height: 450,
      mmPerPx: 0.25,
    });
    expect(svg).not.toContain("rulerLengthMm");
  });

  it("omits the metadata block entirely when uncalibrated", () => {
    const svg = generateOutlineSVG(annulus(), { width: 800, height: 450 });
    expect(svg).not.toContain("<metadata>");
  });
});
