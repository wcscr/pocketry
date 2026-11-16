import { describe, expect, it } from "vitest";
import { pointInOutline } from "./outline";
import { distanceToSegment, signedArea } from "@shared/geometry/rings";
import { importSvgCanvasOutline, importSvgShape, readSvgCanvas, ringsCrossOrTouch } from "./svg-import";

const svg = (content: string, attributes = 'width="100mm" height="100mm" viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${content}</svg>`;
const size = (shape: ReturnType<typeof importSvgShape>) => ({ width: shape.bboxMm.maxX - shape.bboxMm.minX, height: shape.bboxMm.maxY - shape.bboxMm.minY });

describe("importSvgShape", () => {
  it("uses the physical artwork bounds instead of the canvas and ignores stroke width", () => {
    const shape = importSvgShape(svg('<path d="M 10 20 H 70 V 50 H 10 Z" fill="none" stroke="black" stroke-width="5"/>'), { id: "tool", name: "Tool" });
    expect(size(shape)).toEqual({ width: 60, height: 30 });
    expect(shape.bboxMm).toEqual({ minX: -30, minY: -15, maxX: 30, maxY: 15 });
    expect(shape.source).toBe("basic-shape");
    expect(shape.sourceMmPerPx).toBeNull();
    expect(shape.pointCount).toBe(4);
    expect(shape.id).toBe("tool");
    expect(signedArea(shape.outlineMm[0].outer)).toBeGreaterThan(0);
  });

  it("flips Y exactly once while preserving an asymmetric outline", () => {
    const shape = importSvgShape(svg('<path d="M 10 10 L 30 10 L 10 30 Z"/>'));
    expect(pointInOutline(shape.outlineMm, { x: -8, y: 8 })).toBe(true);
    expect(pointInOutline(shape.outlineMm, { x: 8, y: -8 })).toBe(false);
  });

  it.each([
    ['width="2in" height="1in" viewBox="0 0 200 100"', 50.8, 25.4],
    ['width="5cm" height="2.5cm" viewBox="0 0 200 100"', 50, 25],
    ['width="144pt" height="72pt" viewBox="0 0 200 100"', 50.8, 25.4],
    ['width="12pc" height="6pc" viewBox="0 0 200 100"', 50.8, 25.4],
    ['width="200q" height="100q" viewBox="0 0 200 100"', 50, 25],
  ])("supports physical units: %s", (attributes, width, height) => {
    const result = size(importSvgShape(svg('<rect width="200" height="100"/>', attributes)));
    expect(result.width).toBeCloseTo(width);
    expect(result.height).toBeCloseTo(height);
  });

  it("uses default meet scaling and supports explicit nonuniform viewBox scaling", () => {
    expect(size(importSvgShape(svg('<rect width="100" height="50"/>', 'width="100mm" height="100mm" viewBox="0 0 100 50"')))).toEqual({ width: 100, height: 50 });
    expect(size(importSvgShape(svg('<rect width="100" height="50"/>', 'width="100mm" height="100mm" viewBox="0 0 100 50" preserveAspectRatio="none"')))).toEqual({ width: 100, height: 100 });
  });

  it("allows a width override for unitless/px artwork and scales its real bounds", () => {
    const content = '<rect x="10" y="10" width="20" height="10"/>';
    const shape = importSvgShape(svg(content, 'width="200px" height="100px" viewBox="0 0 200 100"'), { widthMm: 40 });
    expect(size(shape)).toEqual({ width: 40, height: 20 });
    expect(size(importSvgShape(svg(content), { widthMm: 40 }))).toEqual({ width: 40, height: 20 });
    expect(() => importSvgShape(svg(content, 'width="200" height="100" viewBox="0 0 200 100"'))).toThrow(/physical|widthMm/);
  });

  it("applies nested SVG transforms in order, including reflected geometry", () => {
    const shape = importSvgShape(svg('<g transform="translate(10 20) rotate(90)"><g transform="scale(-2 3)"><rect width="10" height="20"/></g></g>'));
    expect(size(shape).width).toBeCloseTo(60);
    expect(size(shape).height).toBeCloseTo(20);
    expect(signedArea(shape.outlineMm[0].outer)).toBeGreaterThan(0);
  });

  it("preserves evenodd holes, islands, and separate shapes", () => {
    const shape = importSvgShape(svg('<path fill-rule="evenodd" d="M 0 0 H 60 V 60 H 0 Z M 10 10 H 50 V 50 H 10 Z M 20 20 H 40 V 40 H 20 Z"/><rect x="80" width="10" height="10"/>'));
    expect(shape.outlineMm).toHaveLength(3);
    expect(shape.outlineMm[0].holes).toHaveLength(1);
    expect(signedArea(shape.outlineMm[0].holes[0])).toBeLessThan(0);
    expect(pointInOutline(shape.outlineMm, { x: -30, y: 15 })).toBe(false);
    expect(pointInOutline(shape.outlineMm, { x: -15, y: 0 })).toBe(true);
  });

  it("respects nonzero fill winding instead of inventing same-winding holes", () => {
    const same = importSvgShape(svg('<path d="M 0 0 H 60 V 60 H 0 Z M 10 10 H 50 V 50 H 10 Z"/>'));
    expect(same.outlineMm[0].holes).toHaveLength(0);
    const opposite = importSvgShape(svg('<path d="M 0 0 H 60 V 60 H 0 Z M 10 10 V 50 H 50 V 10 Z"/>'));
    expect(opposite.outlineMm[0].holes).toHaveLength(1);
  });

  it("tessellates true elliptical arcs with exact cardinal bounds", () => {
    const shape = importSvgShape(svg('<ellipse cx="30" cy="40" rx="20" ry="10" transform="rotate(30 30 40)"/>'));
    const result = size(shape);
    expect(result.width).toBeCloseTo(2 * Math.sqrt(400 * 0.75 + 100 * 0.25), 6);
    expect(result.height).toBeCloseTo(2 * Math.sqrt(400 * 0.25 + 100 * 0.75), 6);
    expect(shape.pointCount).toBeGreaterThan(25);
    const circle = importSvgShape(svg('<circle cx="40" cy="40" r="30"/>'));
    expect(size(circle).width).toBeCloseTo(60, 8);
    expect(size(circle).height).toBeCloseTo(60, 8);
    const area = signedArea(circle.outlineMm[0].outer);
    expect(Math.PI * 30 ** 2 - area).toBeLessThan(2 * Math.PI * 30 * 0.05);
  });

  it("flattens cubic, quadratic, and shorthand curves under a width override", () => {
    const data = '<path d="M0 0 C 0 30 10 30 10 0 S20 -30 20 0 Q25 20 30 0 T40 0 L40 40 H0 Z"/>';
    const coarse = importSvgShape(svg(data), { widthMm: 200, toleranceMm: 0.2 });
    const fine = importSvgShape(svg(data), { widthMm: 200, toleranceMm: 0.01 });
    expect(size(fine).width).toBeCloseTo(200);
    expect(fine.pointCount).toBeGreaterThan(coarse.pointCount);
    expect(size(fine).height).toBeCloseTo(size(coarse).height, 0);
  });

  it("keeps scaled cubic chord error within the requested mm tolerance without excessive vertices", () => {
    const tolerance = 0.02;
    const shape = importSvgShape(svg('<path d="M0 0 C0 30 10 30 10 0 L10 40 H0 Z"/>'), { widthMm: 100, toleranceMm: tolerance });
    const ring = shape.outlineMm[0].outer;
    expect(ring.length).toBeLessThan(512);
    for (let index = 0; index <= 200; index++) {
      const t = index / 200;
      const point = { x: 100 * (3 * t ** 2 - 2 * t ** 3) - 50, y: 200 - 900 * t * (1 - t) };
      const error = Math.min(...ring.map((start, i) => distanceToSegment(point, start, ring[(i + 1) % ring.length])));
      expect(error).toBeLessThanOrEqual(tolerance + 1e-9);
    }
  });

  it("supports rounded rectangles, polygons, and geometrically closed paths", () => {
    const shape = importSvgShape(svg('<rect x="10" y="10" width="30" height="20" rx="4"/><polygon points="50,0 70,0 60,10"/><path d="M 80 0 L90 0 L90 10 L80 0"/>'));
    expect(shape.outlineMm).toHaveLength(3);
    expect(shape.outlineMm[0].outer.length).toBeGreaterThan(12);
    expect(shape.pointCount).toBeGreaterThan(18);
  });

  it.each([
    ['<path d="M0 0 L20 0 L20 20"/>', /Open path/],
    ['<polyline points="0,0 20,0 20,20"/>', /Open polyline/],
    ['<path d="M0 0 L20 20 L0 20 L20 0 Z"/>', /area|Intersecting/],
    ['<path d="M0 0 H30 V30 H0 Z M10 0 H20 V20 H10 Z"/>', /touching/],
    ['<path d="M0 0 H30 V30 H0 Z M20 20 H40 V40 H20 Z"/>', /Intersecting/],
    ['<path d="M0 0 H20 V20 H0 Z M20 20 H30 V30 H20 Z"/>', /touching/],
    ['<text>Hello</text>', /Unsupported <text>/],
    ['<use href="#shape"/>', /referenced/],
    ['<image href="https://example.com/image.png"/>', /referenced/],
    ['<defs><image href="https://example.com/image.png"/></defs><rect width="10" height="10"/>', /referenced/],
    ['<g display="none"><script>alert(1)</script></g><rect width="10" height="10"/>', /Scripts/],
    ['<path d="M0 0 H20 V20 Z" clip-path="url(#clip)"/>', /referenced|clip-path/],
    ['<rect width="10" height="10" transform="translate(wrong)"/>', /transform/],
    ['<rect width="10" height="10" transform="scale(0)"/>', /two-dimensional/],
    ['<rect width="10" height="10" style="transform:scale(2)"/>', /style/],
    ['<style>path{fill-rule:evenodd}</style><path d="M0 0 H20 V20 Z"/>', /Unsupported <style>/],
    ['<path d="broken"/>', /Invalid path/],
    ['<rect width="10%" height="10"/>', /length|width/],
  ])("rejects unsupported or incomplete geometry: %s", (content, error) => {
    expect(() => importSvgShape(svg(content))).toThrow(error);
  });

  it("rejects malformed XML, entities, and invalid dimensions", () => {
    expect(() => importSvgShape('<svg><path></svg>')).toThrow(/Malformed/);
    expect(() => importSvgShape('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>')).toThrow(/entities/);
    expect(() => importSvgShape(svg('<circle r="10"/>'), { widthMm: NaN })).toThrow(/positive/);
    expect(() => importSvgShape(svg('<circle r="10"/>'), { toleranceMm: 0.00001 })).toThrow(/between/);
    expect(() => importSvgShape(svg('<rect width="3000" height="10"/>'))).toThrow(/2000/);
    expect(() => importSvgShape(svg('<circle r="10"/>', 'width="100mm" height="100mm" viewBox="0 0 0 100"'))).toThrow(/viewBox/);
  });

  it.each(["0", "0.0", "+0", "0e0", " 0.0 ", "0%", "-0.25", "-20%"])("excludes transparent geometry from bounds and width calibration: %s", opacity => {
    for (const hidden of [
      `<rect x="50" width="40" height="40" opacity="${opacity}"/>`,
      `<g style="opacity: ${opacity}"><rect x="50" width="40" height="40" opacity="1"/></g>`,
    ]) {
      const content = svg(`<rect width="10" height="10"/>${hidden}`);
      expect(size(importSvgShape(content))).toEqual({ width: 10, height: 10 });
      expect(size(importSvgShape(content, { widthMm: 25 }))).toEqual({ width: 25, height: 25 });
    }
  });

  it.each(["", " ", "invalid", "0garbage", "Infinity", "0.5", "50%"])("does not treat nonzero or invalid opacity as transparent: %s", opacity => {
    expect(size(importSvgShape(svg(`<rect width="10" height="10"/><rect x="50" width="40" height="40" opacity="${opacity}"/>`))))
      .toEqual({ width: 90, height: 40 });
  });

  it("ignores metadata and explicitly hidden elements without a DOM", () => {
    const shape = importSvgShape(svg('<metadata><rdf:RDF xmlns:rdf="example"><description>arbitrary metadata</description></rdf:RDF></metadata><g display="none"><text>hidden</text></g><rect width="10" height="20"/>'));
    expect(size(shape)).toEqual({ width: 10, height: 20 });
  });

  it("imports native Inkscape editor metadata without changing artwork or holes", () => {
    const path = '<path d="M10 20 H70 V50 H10 Z M20 25 H30 V35 H20 Z" fill-rule="evenodd"/>';
    const content = svg(`<sodipodi:namedview inkscape:document-units="mm"><sodipodi:guide position="200,300" orientation="0,1"/><inkscape:page x="0" y="0" width="100" height="100"/></sodipodi:namedview><g inkscape:groupmode="layer" inkscape:label="Layer 1">${path}</g>`,
      'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100mm" height="100mm" viewBox="0 0 100 100"');
    const shape = importSvgShape(content);
    expect(shape.outlineMm).toEqual(importSvgShape(svg(path)).outlineMm);
    expect(size(shape)).toEqual({ width: 60, height: 30 });
    expect(shape.outlineMm[0].holes).toHaveLength(1);
    expect(importSvgCanvasOutline(content, 0.1)).toEqual(importSvgCanvasOutline(svg(path), 0.1));
  });

  it.each(['-inkscape-stroke:none', 'paint-order:stroke fill markers', '-inkscape-stroke:hairline;paint-order:normal'])("ignores harmless editor and paint styles: %s", style => {
    const path = '<path d="M10 20 H70 V50 H10 Z"';
    expect(importSvgShape(svg(`${path} style="${style}"/>`)).outlineMm)
      .toEqual(importSvgShape(svg(`${path}/>`)).outlineMm);
  });

  it.each(["clip-path", "mask", "filter"])("explains how to remove unsupported %s effects", effect => {
    for (const attribute of [`${effect}="url(#effect)"`, `style="fill:black; ${effect}: url(#effect)"`]) {
      const content = svg(`<rect width="10" height="20" ${attribute}/>`);
      const message = `${effect} is unsupported; flatten the effect into closed paths`;
      expect(() => importSvgShape(content)).toThrow(message);
      expect(() => importSvgCanvasOutline(content, 0.1)).toThrow(message);
    }
    expect(size(importSvgShape(svg(`<rect width="10" height="20" style="${effect}:none"/>`))))
      .toEqual({ width: 10, height: 20 });
  });

  it.each(['<script>alert(1)</script>', '<image href="https://example.com/image.png"/>'])("still validates resources inside ignored Inkscape metadata: %s", child => {
    expect(() => importSvgShape(svg(`<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">${child}</sodipodi:namedview><rect width="10" height="20"/>`)))
      .toThrow(/Scripts|referenced/);
  });
});

describe("readSvgCanvas", () => {
  it("reports the viewBox and the physical size of one unit", () => {
    expect(readSvgCanvas(svg("", 'width="200mm" height="150mm" viewBox="0 0 800 600"'))).toEqual({ width: 800, height: 600, mmPerUnit: 0.25 });
    expect(readSvgCanvas(svg("", 'width="2in" viewBox="10 20 200 100"'))).toEqual({ width: 200, height: 100, mmPerUnit: 0.254 });
    expect(readSvgCanvas(svg("", 'viewBox="0 0 800 600"'))).toEqual({ width: 800, height: 600, mmPerUnit: null });
    expect(readSvgCanvas(svg("", 'width="800px" height="600px" viewBox="0 0 800 600"'))?.mmPerUnit).toBeNull();
  });

  it("has no single scale for unequal axes, and no canvas without a viewBox", () => {
    expect(readSvgCanvas(svg("", 'width="100mm" height="100mm" viewBox="0 0 100 50" preserveAspectRatio="none"'))?.mmPerUnit).toBeNull();
    expect(readSvgCanvas(svg("", 'width="100mm" height="100mm" viewBox="0 0 100 50"'))?.mmPerUnit).toBe(1);
    expect(readSvgCanvas(svg("", 'width="100mm" height="100mm"'))).toBeNull();
  });

  it("does not flatten geometry, and rejects what importSvgShape rejects", () => {
    expect(readSvgCanvas(svg('<path d="M0 0 L20 0 L20 20"/>', 'viewBox="0 0 10 10"'))).toEqual({ width: 10, height: 10, mmPerUnit: null });
    expect(() => readSvgCanvas("<svg><path></svg>")).toThrow(/Malformed/);
    expect(() => readSvgCanvas("")).toThrow(/nonempty/);
    expect(() => readSvgCanvas('<!DOCTYPE svg><svg viewBox="0 0 1 1"/>')).toThrow(/Document types/);
    expect(() => readSvgCanvas(svg("", 'viewBox="0 0 0 100"'))).toThrow(/viewBox/);
  });
});

describe("importSvgCanvasOutline", () => {
  it("keeps canvas positions, y-down, without centering or scaling", () => {
    const outline = importSvgCanvasOutline(svg('<path d="M 10 20 H 70 V 50 H 10 Z"/>', 'width="50mm" viewBox="0 0 800 600"'), 0.1);
    expect(outline).toHaveLength(1);
    expect(outline[0].outer).toHaveLength(4);
    expect(outline[0].outer).toEqual(expect.arrayContaining([{ x: 10, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 50 }, { x: 10, y: 50 }]));
    expect(signedArea(outline[0].outer)).toBeGreaterThan(0);
  });

  it("subtracts the viewBox origin and applies element transforms", () => {
    const outline = importSvgCanvasOutline(svg('<g transform="translate(100 0)"><rect x="5" y="5" width="10" height="10"/></g>', 'viewBox="5 5 100 100"'), 0.1);
    expect(outline[0].outer).toEqual(expect.arrayContaining([{ x: 100, y: 0 }, { x: 110, y: 10 }]));
  });

  it("applies the same fill rules and rejections as importSvgShape", () => {
    const holed = importSvgCanvasOutline(svg('<path fill-rule="evenodd" d="M 0 0 H 60 V 60 H 0 Z M 10 10 H 50 V 50 H 10 Z"/>', 'viewBox="0 0 100 100"'), 0.1);
    expect(holed[0].holes).toHaveLength(1);
    expect(signedArea(holed[0].holes[0])).toBeLessThan(0);
    expect(() => importSvgCanvasOutline(svg('<path d="M0 0 L20 0 L20 20"/>', 'viewBox="0 0 100 100"'), 0.1)).toThrow(/Open path/);
    expect(() => importSvgCanvasOutline(svg('<use href="#shape"/>', 'viewBox="0 0 100 100"'), 0.1)).toThrow(/referenced/);
    expect(() => importSvgCanvasOutline(svg('<rect width="10" height="10"/>', 'width="10mm"'), 0.1)).toThrow(/viewBox/);
    expect(() => importSvgCanvasOutline(svg('<rect width="10" height="10"/>', 'viewBox="0 0 100 100"'), 0)).toThrow(/positive/);
  });
});

describe("contours that cross or touch", () => {
  // A square with one small loop in its right side, the kind a tracer or a thinning pass leaves behind.
  const loop = '<path d="M 0 0 H 60 V 30 L 62 32 L 62 30 L 60 32 V 60 H 0 Z"/>';
  const touching = '<path d="M0 0 H20 V20 H0 Z M20 20 H30 V30 H20 Z"/>';

  it("stay rejected for pockets", () => {
    expect(() => importSvgShape(svg(loop))).toThrow(/Intersecting or touching/);
    expect(() => importSvgCanvasOutline(svg(loop, 'viewBox="0 0 100 100"'), 0.1)).toThrow(/Intersecting or touching/);
  });

  it("are taken exactly as drawn when the caller asks", () => {
    const outline = importSvgCanvasOutline(svg(loop, 'viewBox="0 0 100 100"'), 0.1, { allowCrossing: true });
    expect(outline).toHaveLength(1);
    expect(outline[0].outer).toHaveLength(8);
    expect(outline[0].outer).toEqual(expect.arrayContaining([{ x: 62, y: 32 }, { x: 62, y: 30 }, { x: 60, y: 32 }]));
    const shape = importSvgShape(svg(loop), { allowCrossing: true });
    expect(shape.pointCount).toBe(8);
    expect(size(shape)).toEqual({ width: 62, height: 60 });
    expect(importSvgCanvasOutline(svg(touching, 'viewBox="0 0 100 100"'), 0.1, { allowCrossing: true })).toHaveLength(2);
  });

  it("can be told apart from clean rings", () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(ringsCrossOrTouch([square])).toBe(false);
    expect(ringsCrossOrTouch([square, square.map(point => ({ x: point.x + 30, y: point.y }))])).toBe(false);
    expect(ringsCrossOrTouch([[{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: -5, y: 5 }]])).toBe(true);
    expect(ringsCrossOrTouch([square, square.map(point => ({ x: point.x + 10, y: point.y + 10 }))])).toBe(true);
  });
});
