import { describe, expect, it } from "vitest";

import { distanceToSegment, signedArea } from "@shared/geometry/rings";
import type { Outline } from "@shared/geometry/types";

import { generateOutlineSVG } from "@/lib/export/svg";

import { normalizeOutline, outlineBounds, pointInOutline } from "./outline";
import { importCenter, placeSvgOutline, type TraceImportTarget } from "./trace-outline-import";

const PHOTO = { width: 800, height: 600 };
const target = (overrides: Partial<TraceImportTarget> = {}): TraceImportTarget =>
  ({ imageSize: PHOTO, mmPerPx: 0.25, ...overrides });

/** A concave shell with a hole plus a separate part, as the tracer would hold them. */
const TRACED: Outline = normalizeOutline([
  { outer: [{ x: 100.25, y: 80.5 }, { x: 420, y: 80.5 }, { x: 420, y: 300.75 }, { x: 260.13, y: 190 }, { x: 100.25, y: 300.75 }],
    holes: [[{ x: 150, y: 120 }, { x: 200, y: 120 }, { x: 200, y: 160 }, { x: 150, y: 160 }]] },
  { outer: [{ x: 600, y: 400 }, { x: 700, y: 400 }, { x: 650.5, y: 520.25 }], holes: [] },
]);

const physicalSvg = (content: string, attributes = 'width="100mm" height="100mm" viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${content}</svg>`;

describe("placeSvgOutline on a Trace export of the same photo", () => {
  it.each([
    ["calibrated export", 0.25, 0.25],
    ["calibrated export onto an unscaled trace", 0.25, null],
    ["pixel-only export", null, 0.25],
    ["pixel-only export onto an unscaled trace", null, null],
  ])("returns every vertex to its pixel: %s", (_name, exportMmPerPx, traceMmPerPx) => {
    const svg = generateOutlineSVG(TRACED, { ...PHOTO, mmPerPx: exportMmPerPx });
    const placed = placeSvgOutline(svg, target({ mmPerPx: traceMmPerPx, region: { x: 10, y: 10, width: 50, height: 50 } }));
    expect(placed.placement).toBe("photo");
    expect(placed.matchesPhoto).toBe(true);
    expect(placed.scaleMismatch).toBe(false);
    expect(placed.fileMmPerPx).toBe(exportMmPerPx);
    // Exact, not approximate: same points, same order, same winding.
    expect(placed.outline).toEqual(TRACED);
    expect(placed.sizePx).toEqual({ width: 599.75, height: 439.75 });
  });

  it("keeps the tracer's winding and hole convention", () => {
    const { outline } = placeSvgOutline(generateOutlineSVG(TRACED, PHOTO), target());
    expect(outline).toHaveLength(2);
    expect(signedArea(outline[0].outer)).toBeGreaterThan(0);
    expect(outline[0].holes).toHaveLength(1);
    expect(signedArea(outline[0].holes[0])).toBeLessThan(0);
    expect(pointInOutline(outline, { x: 175, y: 140 })).toBe(false);
    expect(pointInOutline(outline, { x: 120, y: 100 })).toBe(true);
  });

  it("re-orients rings a hand-edited file wound the other way", () => {
    const reversed = `<svg viewBox="0 0 800 600"><path fill-rule="evenodd" d="M 100 100 L 100 300 L 400 300 L 400 100 Z M 150 150 L 250 150 L 250 250 L 150 250 Z"/></svg>`;
    const { outline } = placeSvgOutline(reversed, target());
    expect(signedArea(outline[0].outer)).toBeGreaterThan(0);
    expect(signedArea(outline[0].holes[0])).toBeLessThan(0);
    expect(outlineBounds(outline)).toEqual({ minX: 100, minY: 100, maxX: 400, maxY: 300 });
  });

  it("measures from the viewBox origin and flattens curves to a fraction of a pixel", () => {
    const { outline } = placeSvgOutline('<svg viewBox="50 20 800 600"><circle cx="450" cy="320" r="100"/></svg>', target());
    const ring = outline[0].outer;
    const bounds = outlineBounds(outline)!;
    expect(bounds.minX).toBeCloseTo(300, 6);
    expect(bounds.maxX).toBeCloseTo(500, 6);
    expect(bounds.minY).toBeCloseTo(200, 6);
    expect(bounds.maxY).toBeCloseTo(400, 6);
    for (let step = 0; step < 360; step++) {
      const angle = step * Math.PI / 180;
      const point = { x: 400 + 100 * Math.cos(angle), y: 300 + 100 * Math.sin(angle) };
      const error = Math.min(...ring.map((start, index) => distanceToSegment(point, start, ring[(index + 1) % ring.length])));
      expect(error).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it("flags a file whose recorded scale disagrees with the trace, and can use either", () => {
    const svg = generateOutlineSVG(TRACED, { ...PHOTO, mmPerPx: 0.5 });
    const kept = placeSvgOutline(svg, target());
    expect(kept).toMatchObject({ placement: "photo", scaleMismatch: true, fileMmPerPx: 0.5 });
    expect(kept.outline).toEqual(TRACED);

    const region = { x: 200, y: 100, width: 400, height: 300 };
    const trueSize = placeSvgOutline(svg, target({ region }), { placement: "true-size" });
    expect(trueSize).toMatchObject({ placement: "true-size", matchesPhoto: true, scaleMismatch: true });
    // 599.75 × 439.75 px at 0.5 mm/px is twice as many pixels at 0.25 mm/px.
    expect(trueSize.sizePx.width).toBeCloseTo(1199.5, 6);
    expect(trueSize.sizePx.height).toBeCloseTo(879.5, 6);
    const bounds = outlineBounds(trueSize.outline)!;
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(400, 6);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(250, 6);
  });

  it("treats a rounding-level scale difference as the same scale", () => {
    const svg = generateOutlineSVG(TRACED, { ...PHOTO, mmPerPx: 0.25001 });
    expect(placeSvgOutline(svg, target()).scaleMismatch).toBe(false);
  });

  it("rejects contours that fall entirely outside the photo", () => {
    expect(() => placeSvgOutline('<svg viewBox="0 0 800 600"><rect x="900" y="100" width="50" height="50"/></svg>', target()))
      .toThrow(/outside the photo/);
  });
});

describe("placeSvgOutline at true size", () => {
  it("lands a physical file at the right size, centered on the region", () => {
    const placed = placeSvgOutline(physicalSvg('<rect x="10" y="20" width="60" height="30"/>'),
      target({ region: { x: 400, y: 200, width: 300, height: 200 } }));
    expect(placed).toMatchObject({ placement: "true-size", matchesPhoto: false, fileMmPerPx: null, scaleMismatch: false });
    // 60 × 30 mm at 0.25 mm/px.
    expect(placed.sizePx).toEqual({ width: 240, height: 120 });
    expect(outlineBounds(placed.outline)).toEqual({ minX: 430, minY: 240, maxX: 670, maxY: 360 });
    expect(signedArea(placed.outline[0].outer)).toBeGreaterThan(0);
  });

  it("follows the trace scale", () => {
    const placed = placeSvgOutline(physicalSvg('<rect width="60" height="30"/>'), target({ mmPerPx: 0.1 }));
    expect(placed.sizePx.width).toBeCloseTo(600, 9);
    expect(placed.sizePx.height).toBeCloseTo(300, 9);
  });

  it("does not mirror the artwork: SVG and Trace are both y-down", () => {
    // A right triangle with its right angle at the top-left of its bounds.
    const { outline } = placeSvgOutline(physicalSvg('<path d="M 10 10 L 50 10 L 10 50 Z"/>'), target());
    const bounds = outlineBounds(outline)!;
    const inset = (fx: number, fy: number) => ({ x: bounds.minX + (bounds.maxX - bounds.minX) * fx, y: bounds.minY + (bounds.maxY - bounds.minY) * fy });
    expect(pointInOutline(outline, inset(0.2, 0.2))).toBe(true);
    expect(pointInOutline(outline, inset(0.8, 0.8))).toBe(false);
  });

  it("centers on the photo without a region, and on the visible paper of a corrected photo", () => {
    const svg = physicalSvg('<rect width="40" height="40"/>');
    const center = (placed: ReturnType<typeof placeSvgOutline>) => {
      const bounds = outlineBounds(placed.outline)!;
      return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    };
    expect(center(placeSvgOutline(svg, target()))).toEqual({ x: 400, y: 300 });
    const visibleBounds = { x: 100, y: 50, width: 400, height: 500 };
    expect(center(placeSvgOutline(svg, target({ visibleBounds })))).toEqual({ x: 300, y: 300 });
    // The region is clipped to what is visible, as it is for a new manual contour.
    expect(importCenter(target({ visibleBounds, region: { x: 300, y: 450, width: 400, height: 300 } }))).toEqual({ x: 400, y: 500 });
    expect(importCenter(target({ visibleBounds, region: { x: 600, y: 0, width: 100, height: 40 } }))).toEqual({ x: 300, y: 300 });
  });

  it("requires a scale, with a message that says why", () => {
    expect(() => placeSvgOutline(physicalSvg('<rect width="40" height="40"/>'), target({ mmPerPx: null })))
      .toThrow(/Set the scale first.*800 × 600 px photo/);
    expect(() => placeSvgOutline(physicalSvg('<rect width="40" height="40"/>'), target({ mmPerPx: 0 }))).toThrow(/Set the scale first/);
  });

  it("needs physical units or a width override for a canvas that is not the photo", () => {
    const svg = '<svg viewBox="0 0 4032 3024"><rect x="1000" y="1000" width="2000" height="500"/></svg>';
    expect(() => placeSvgOutline(svg, target())).toThrow(/physical width\/height/);
    const placed = placeSvgOutline(svg, target(), { widthMm: 50 });
    expect(placed.placement).toBe("true-size");
    expect(placed.sizePx.width).toBeCloseTo(200, 9);
    expect(placed.sizePx.height).toBeCloseTo(50, 9);
  });

  it("will not keep positions from a canvas that is not the photo", () => {
    expect(() => placeSvgOutline(physicalSvg('<rect width="40" height="40"/>'), target(), { placement: "photo" }))
      .toThrow(/not this photo's 800 × 600 px/);
  });
});

describe("placeSvgOutline rejections", () => {
  it.each([
    ["not an SVG", "this is not an SVG", /Malformed XML|Expected one SVG root/],
    ["truncated markup", '<svg viewBox="0 0 800 600"><path d="M0 0 L10 0 L10 10 Z">', /Malformed XML/],
    ["an empty file", "   ", /nonempty SVG/],
    ["another XML document", "<html><body/></html>", /Expected one SVG root/],
    ["a document type", '<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 800 600"/>', /Document types/],
    ["an open path", '<svg viewBox="0 0 800 600"><path d="M 10 10 L 200 10 L 200 200"/></svg>', /Open path/],
    ["self-intersecting contours", '<svg viewBox="0 0 800 600"><path d="M0 0 L200 200 L0 200 L200 0 Z"/></svg>', /area|Intersecting/],
    ["embedded images", '<svg viewBox="0 0 800 600"><image href="photo.jpg"/></svg>', /referenced resources/],
    ["no geometry", '<svg viewBox="0 0 800 600"></svg>', /No usable closed silhouettes/],
  ])("reports %s without placing anything", (_name, svg, message) => {
    expect(() => placeSvgOutline(svg, target())).toThrow(message);
    // An unreadable file is reported as such even when the scale is also missing.
    expect(() => placeSvgOutline(svg, target({ mmPerPx: null }))).toThrow(message);
  });

  it("applies the importer's vertex limit to a photo-frame file", () => {
    const points = Array.from({ length: 20_001 }, (_, index) => {
      const angle = index / 20_001 * 2 * Math.PI;
      return `${(400 + 250 * Math.cos(angle)).toFixed(3)},${(300 + 250 * Math.sin(angle)).toFixed(3)}`;
    }).join(" ");
    expect(() => placeSvgOutline(`<svg viewBox="0 0 800 600"><polygon points="${points}"/></svg>`, target()))
      .toThrow(/Too many vertices|exceeds 20000 vertices/);
  });

  it("applies Pocketry's import limits to a single oversized contour", () => {
    const points = Array.from({ length: 10_001 }, (_, index) => {
      const angle = index / 10_001 * 2 * Math.PI;
      return `${(400 + 250 * Math.cos(angle)).toFixed(3)},${(300 + 250 * Math.sin(angle)).toFixed(3)}`;
    }).join(" ");
    expect(() => placeSvgOutline(`<svg viewBox="0 0 800 600"><polygon points="${points}"/></svg>`, target()))
      .toThrow(/import limits/);
  });

  it("needs a loaded photo", () => {
    expect(() => placeSvgOutline(physicalSvg('<rect width="40" height="40"/>'), target({ imageSize: { width: 0, height: 0 } })))
      .toThrow(/Choose a photo first/);
  });
});
