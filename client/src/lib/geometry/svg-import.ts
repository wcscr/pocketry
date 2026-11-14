import { XMLParser, XMLValidator } from "fast-xml-parser";
import svgpath from "svgpath";
import { buildOutline, mapOutline, normalizeOutline, outlineBounds, outlinePointCount } from "./outline";
import { boundsContain, dedupeRing, distanceToSegment, pointInRing, ringArea, ringBounds, signedArea } from "@shared/geometry/rings";
import type { Bounds, Outline, Point, Ring } from "@shared/geometry/types";
import { withinImportLimits } from "@shared/gridfinity/import-limits";
import { tracedShapeSchema, type TracedShape } from "@shared/gridfinity/cutout";

/** Width override refers to the artwork's bounds, excluding SVG canvas margins. */
export interface SvgImportOptions {
  name?: string;
  id?: string;
  widthMm?: number;
  /** Maximum chord deviation when flattening curves, in the final mm frame. */
  toleranceMm?: number;
}

type Matrix = [number, number, number, number, number, number];
type XmlNode = Record<string, unknown>;
interface Style { fill: string; fillRule: "evenodd" | "nonzero"; hidden: boolean }
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MAX_POINTS = 20_000;
const MAX_XML_LENGTH = 5_000_000;
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

function fail(message: string): never { throw new Error(`SVG import: ${message}`); }
function record(value: unknown): XmlNode {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as XmlNode : {};
}
function attributes(node: XmlNode): Record<string, string> {
  return Object.fromEntries(Object.entries(record(node[":@"]))
    .map(([key, value]) => [key, String(value)]));
}
function tagName(node: XmlNode): string | undefined { return Object.keys(node).find(key => key !== ":@"); }
function assertNoResources(node: XmlNode, depth = 0): void {
  if (depth > 64) fail("SVG nesting exceeds 64 levels.");
  const key = tagName(node);
  if (!key) return;
  const tag = key.split(":").pop();
  if (tag === "script" || tag === "foreignObject") fail("Scripts and embedded documents are not supported.");
  for (const [name, value] of Object.entries(attributes(node))) {
    if (/^on/i.test(name) || /(?:^|:)href$/.test(name) || /url\s*\(/i.test(value)) fail("Scripts and referenced resources are not supported.");
  }
  const children: unknown = node[key];
  if (Array.isArray(children)) for (const child of children) assertNoResources(record(child), depth + 1);
}
function numbers(value: string, context: string): number[] {
  const matches = value.match(NUMBER) ?? [];
  if (value.replace(NUMBER, "").replace(/[\s,]/g, "")) fail(`Invalid ${context}.`);
  const result = matches.map(Number);
  if (!result.every(Number.isFinite)) fail(`Non-finite ${context}.`);
  return result;
}
function positive(value: number | undefined, context: string): number | undefined {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) fail(`${context} must be positive and finite.`);
  return value;
}
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function transform(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  let result = IDENTITY;
  const pattern = /([A-Za-z]+)\s*\(([^)]*)\)/g;
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    if (value.slice(end, match.index).replace(/[\s,]/g, "")) fail("Invalid transform syntax.");
    const args = numbers(match[2], "transform");
    let next: Matrix;
    switch (match[1]) {
      case "matrix":
        if (args.length !== 6) fail("matrix needs six numbers.");
        next = args as Matrix; break;
      case "translate":
        if (args.length < 1 || args.length > 2) fail("translate needs one or two numbers.");
        next = [1, 0, 0, 1, args[0], args[1] ?? 0]; break;
      case "scale":
        if (args.length < 1 || args.length > 2) fail("scale needs one or two numbers.");
        next = [args[0], 0, 0, args[1] ?? args[0], 0, 0]; break;
      case "rotate": {
        if (args.length !== 1 && args.length !== 3) fail("rotate needs an angle and optional centre.");
        const angle = args[0] * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
        next = [c, s, -s, c, 0, 0];
        if (args.length === 3) next = multiply(multiply([1, 0, 0, 1, args[1], args[2]], next), [1, 0, 0, 1, -args[1], -args[2]]);
        break;
      }
      case "skewX": case "skewY": {
        if (args.length !== 1) fail("skew needs one angle.");
        const tangent = Math.tan(args[0] * Math.PI / 180);
        next = match[1] === "skewX" ? [1, 0, tangent, 1, 0, 0] : [1, tangent, 0, 1, 0, 0];
        break;
      }
      default: fail(`Unsupported transform ${match[1]}.`);
    }
    result = multiply(result, next);
    end = match.index! + match[0].length;
  }
  if (value.slice(end).trim() || !end || !result.every(Number.isFinite) || Math.abs(result[0] * result[3] - result[1] * result[2]) < 1e-12) {
    fail("Transform must be valid and preserve a two-dimensional outline.");
  }
  return result;
}

/** Physical CSS/SVG units; px/unitless canvas sizes need an explicit artwork width. */
function physicalLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = value.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(mm|cm|in|pt|pc|q)$/i);
  if (!match) return undefined;
  const factors: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 };
  return positive(Number(match[1]) * factors[match[2].toLowerCase()], "SVG canvas size");
}
function canvasMatrix(attrs: Record<string, string>, widthOverride: number | undefined): Matrix {
  const width = physicalLength(attrs.width), height = physicalLength(attrs.height);
  if (widthOverride === undefined && width === undefined && height === undefined) {
    fail("SVG needs physical width/height units (such as mm), or an explicit widthMm for its artwork.");
  }
  if (!attrs.viewBox) return widthOverride === undefined ? [25.4 / 96, 0, 0, 25.4 / 96, 0, 0] : IDENTITY;
  const box = numbers(attrs.viewBox, "viewBox");
  if (box.length !== 4 || box[2] <= 0 || box[3] <= 0) fail("viewBox needs four numbers with positive width and height.");
  const sx = width === undefined ? (height === undefined ? 1 : height / box[3]) : width / box[2];
  const sy = height === undefined ? sx : height / box[3];
  const aspect = (attrs.preserveAspectRatio ?? "xMidYMid meet").trim().split(/\s+/);
  if (aspect[0] === "none" && aspect.length === 1) return [sx, 0, 0, sy, -box[0] * sx, -box[1] * sy];
  if (!/^x(Min|Mid|Max)Y(Min|Mid|Max)$/.test(aspect[0]) || aspect.length > 2 || (aspect[1] && !["meet", "slice"].includes(aspect[1]))) {
    fail("Unsupported preserveAspectRatio.");
  }
  if (aspect[1] === "slice") fail("preserveAspectRatio slice can clip artwork; use meet or none.");
  const scale = Math.min(sx, sy);
  // Alignment only translates the artwork; centering after import removes it.
  return [scale, 0, 0, scale, -box[0] * scale, -box[1] * scale];
}

/** SVG opacity accepts numbers or percentages and clamps negative values to zero. */
function transparentOpacity(value: string | undefined): boolean {
  const match = value?.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?:%)?$/);
  if (!match) return false;
  const opacity = Number(match[1]);
  return Number.isFinite(opacity) && opacity <= 0;
}

function styleFor(attrs: Record<string, string>, inherited: Style): Style {
  const css: Record<string, string> = {};
  for (const declaration of (attrs.style ?? "").split(";")) {
    if (!declaration.trim()) continue;
    const index = declaration.indexOf(":");
    if (index < 1) fail("Invalid inline style.");
    const key = declaration.slice(0, index).trim(), value = declaration.slice(index + 1).trim();
    if (!["fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linejoin", "stroke-linecap", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "display", "visibility", "vector-effect"].includes(key)) {
      fail(`Unsupported inline style ${key}; flatten effects into paths first.`);
    }
    css[key] = value;
  }
  const values = { ...attrs, ...css };
  for (const [key, value] of Object.entries(values)) {
    if (/^on/i.test(key) || /(?:^|:)href$/.test(key) || /url\s*\(/i.test(value)) fail("Scripts and referenced resources are not supported.");
    if (["clip-path", "mask", "filter"].includes(key) && value !== "none") fail(`${key} is unsupported; flatten effects into paths first.`);
  }
  const fillRule = values["fill-rule"] ?? inherited.fillRule;
  if (fillRule !== "evenodd" && fillRule !== "nonzero") fail("Unsupported fill-rule.");
  return { fill: values.fill ?? inherited.fill, fillRule,
    hidden: inherited.hidden || values.display === "none" || values.visibility === "hidden" || transparentOpacity(values.opacity) };
}
function userLength(attrs: Record<string, string>, key: string, fallback = 0): number {
  if (attrs[key] === undefined) return fallback;
  const value = attrs[key].trim();
  const physical = physicalLength(value);
  // Absolute lengths inside shape geometry are expressed in CSS pixels before
  // the viewBox transform, as required by SVG's user-unit conversion.
  if (physical !== undefined) return physical * 96 / 25.4;
  const parsed = numbers(value.replace(/px$/i, ""), key);
  if (parsed.length !== 1) fail(`Unsupported ${key} length; use SVG user units for shape attributes.`);
  return parsed[0];
}
function shapePath(tag: string, attrs: Record<string, string>): string {
  if (tag === "path") return attrs.d?.trim() || fail("A path is missing its d attribute.");
  if (tag === "polygon" || tag === "polyline") {
    const coords = numbers(attrs.points ?? "", "polygon points");
    if (coords.length < 6 || coords.length % 2 !== 0) fail("Polygon needs at least three coordinate pairs.");
    if (tag === "polyline" && (coords[0] !== coords[coords.length - 2] || coords[1] !== coords[coords.length - 1])) fail("Open polyline; close the outline first.");
    return `M ${coords[0]} ${coords[1]} ${coords.slice(2).join(" ")} Z`;
  }
  if (tag === "rect") {
    const x = userLength(attrs, "x"), y = userLength(attrs, "y"), w = userLength(attrs, "width"), h = userLength(attrs, "height");
    if (w <= 0 || h <= 0) fail("Rectangle dimensions must be positive.");
    const rx = Math.min(w / 2, userLength(attrs, "rx", userLength(attrs, "ry"))), ry = Math.min(h / 2, userLength(attrs, "ry", userLength(attrs, "rx")));
    if (rx < 0 || ry < 0) fail("Rectangle radii cannot be negative.");
    if (!rx || !ry) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
    return `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
  }
  const cx = userLength(attrs, "cx"), cy = userLength(attrs, "cy");
  const rx = userLength(attrs, tag === "circle" ? "r" : "rx"), ry = tag === "circle" ? rx : userLength(attrs, "ry");
  if (rx <= 0 || ry <= 0) fail("Circle/ellipse radii must be positive.");
  return `M ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} Z`;
}

function midpoint(a: Point, b: Point): Point { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function append(ring: Ring, point: Point): void {
  if (ring.length >= MAX_POINTS) fail(`Too many vertices; increase toleranceMm or simplify the SVG (limit ${MAX_POINTS}).`);
  ring.push(point);
}
/** De Casteljau subdivision bounds the curve by its control polygon. */
function flattenBezier(points: Point[], ring: Ring, tolerance: number, depth = 0): void {
  const first = points[0], last = points[points.length - 1];
  if (points.slice(1, -1).every(point => distanceToSegment(point, first, last) <= tolerance)) { append(ring, last); return; }
  if (depth >= 24) fail("Curve exceeds tessellation limits; simplify the SVG.");
  const left = [first], right = [last];
  let layer = points;
  while (layer.length > 1) {
    layer = layer.slice(1).map((point, index) => midpoint(layer[index], point));
    left.push(layer[0]); right.unshift(layer[layer.length - 1]);
  }
  flattenBezier(left, ring, tolerance, depth + 1);
  flattenBezier(right, ring, tolerance, depth + 1);
}

/** Endpoint-to-centre SVG elliptical arc conversion, sampled on the true ellipse. */
function flattenArc(start: Point, values: number[], ring: Ring, tolerance: number): void {
  let [rx, ry, degrees, large, sweep, endX, endY] = values;
  const end = { x: endX, y: endY };
  if (!rx || !ry) { append(ring, end); return; }
  if (start.x === end.x && start.y === end.y) return;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const dx = (start.x - end.x) / 2, dy = (start.y - end.y) / 2;
  const x = c * dx + s * dy, y = -s * dx + c * dy;
  const stretch = Math.sqrt(x * x / (rx * rx) + y * y / (ry * ry));
  if (stretch > 1) { rx *= stretch; ry *= stretch; }
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x);
  const denominator = rx * rx * y * y + ry * ry * x * x;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(numerator / denominator);
  const localX = factor * rx * y / ry, localY = -factor * ry * x / rx;
  const centerX = c * localX - s * localY + (start.x + end.x) / 2;
  const centerY = s * localX + c * localY + (start.y + end.y) / 2;
  const theta = Math.atan2((y - localY) / ry, (x - localX) / rx);
  const target = Math.atan2((-y - localY) / ry, (-x - localX) / rx);
  let delta = target - theta;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  const maxStep = 2 * Math.acos(Math.max(-1, 1 - tolerance / Math.max(rx, ry)));
  const count = Math.max(1, Math.ceil(Math.abs(delta) / maxStep));
  if (!Number.isFinite(count) || count > MAX_POINTS) fail("Arc exceeds tessellation limits; increase toleranceMm.");
  const steps = Array.from({ length: count }, (_, index) => (index + 1) / count);
  // Include exact X/Y extrema, so the physical bounds are independent of tolerance.
  for (const extremum of [Math.atan2(-ry * s, rx * c), Math.atan2(ry * c, rx * s)]) {
    for (let k = -3; k <= 3; k++) {
      const t = (extremum + k * Math.PI - theta) / delta;
      if (t > 0 && t < 1) steps.push(t);
    }
  }
  for (const t of steps.sort((a, b) => a - b)) {
    const a = theta + delta * t;
    append(ring, t === 1 ? end : { x: centerX + rx * c * Math.cos(a) - ry * s * Math.sin(a),
      y: centerY + rx * s * Math.cos(a) + ry * c * Math.sin(a) });
  }
}

function flattenPath(data: string, matrix: Matrix, tolerance: number): Ring[] {
  const path = svgpath(data);
  // svgpath exposes parse errors at runtime, but its bundled declaration omits err.
  if ("err" in path && typeof path.err === "string" && path.err) fail(`Invalid path: ${path.err}`);
  path.abs().unshort().matrix(matrix);
  const rings: Ring[] = [];
  let ring: Ring = [], current: Point = { x: 0, y: 0 }, start = current;
  const finish = (closed: boolean) => {
    if (!ring.length) return;
    if (!closed && Math.hypot(current.x - start.x, current.y - start.y) > 1e-8) fail("Open path; close every pocket outline first.");
    const clean = dedupeRing(ring);
    if (clean.length < 3 || ringArea(clean) < 1e-10) fail("Outline has no enclosed area.");
    rings.push(clean); ring = [];
  };
  path.iterate(segment => {
    const command = segment[0];
    const values = segment.slice(1) as number[];
    if (command !== "M" && command !== "Z" && command !== "z" && !ring.length) {
      start = current;
      append(ring, current);
    }
    switch (command) {
      case "M":
        finish(false); current = { x: values[0], y: values[1] }; start = current; append(ring, current); break;
      case "L": current = { x: values[0], y: values[1] }; append(ring, current); break;
      case "H": current = { x: values[0], y: current.y }; append(ring, current); break;
      case "V": current = { x: current.x, y: values[0] }; append(ring, current); break;
      case "C": {
        const end = { x: values[4], y: values[5] };
        flattenBezier([current, { x: values[0], y: values[1] }, { x: values[2], y: values[3] }, end], ring, tolerance);
        current = end; break;
      }
      case "Q": {
        const end = { x: values[2], y: values[3] };
        flattenBezier([current, { x: values[0], y: values[1] }, end], ring, tolerance); current = end; break;
      }
      case "A": flattenArc(current, values, ring, tolerance); current = { x: values[5], y: values[6] }; break;
      case "Z": case "z": current = start; finish(true); break;
      default: fail(`Unsupported path command ${command}.`);
    }
  });
  finish(false);
  return rings;
}

function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - 1e-9 || Math.max(c.x, d.x) < Math.min(a.x, b.x) - 1e-9 ||
      Math.max(a.y, b.y) < Math.min(c.y, d.y) - 1e-9 || Math.max(c.y, d.y) < Math.min(a.y, b.y) - 1e-9) return false;
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return ((abC > 1e-9 && abD < -1e-9) || (abC < -1e-9 && abD > 1e-9)) &&
    ((cdA > 1e-9 && cdB < -1e-9) || (cdA < -1e-9 && cdB > 1e-9)) ||
    [distanceToSegment(c, a, b), distanceToSegment(d, a, b), distanceToSegment(a, c, d), distanceToSegment(b, c, d)].some(distance => distance < 1e-9);
}
function assertSimpleRings(rings: Ring[]): void {
  const segments = rings.flatMap((ring, ringIndex) => ring.map((point, index) => ({
    a: point, b: ring[(index + 1) % ring.length], index, ringIndex, length: ring.length,
    minX: Math.min(point.x, ring[(index + 1) % ring.length].x), maxX: Math.max(point.x, ring[(index + 1) % ring.length].x),
  }))).sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length && segments[j].minX <= a.maxX + 1e-9; j++) {
      const b = segments[j];
      if (a.ringIndex === b.ringIndex && (Math.abs(a.index - b.index) === 1 || Math.abs(a.index - b.index) === a.length - 1)) continue;
      if (segmentsTouch(a.a, a.b, b.a, b.b)) fail("Intersecting or touching contours are unsupported; merge them into simple closed paths first.");
    }
  }
}
function filledOutline(rings: Ring[], style: Style): Outline {
  assertSimpleRings(rings);
  if (style.fillRule === "evenodd" || style.fill === "none") return buildOutline(rings);
  const entries = rings.map(ring => ({ ring, area: ringArea(ring), sign: Math.sign(signedArea(ring)), bounds: ringBounds(ring)! }));
  // A same-winding nested contour is filled under nonzero, so it is not a hole.
  const boundaries = entries.filter(entry => {
    const outsideWinding = entries.filter(parent => parent.area > entry.area && boundsContain(parent.bounds, entry.bounds) && pointInRing(parent.ring, entry.ring[0]))
      .reduce((winding, parent) => winding + parent.sign, 0);
    return (outsideWinding === 0) !== (outsideWinding + entry.sign === 0);
  });
  return buildOutline(boundaries.map(entry => entry.ring));
}

/**
 * Imports closed SVG silhouettes into Pocketry's centred, y-up millimetre frame.
 * No rasterisation, remote resources, DOM globals, or boolean kernel is involved.
 * Stroke width is deliberately ignored: closed fill="none" traces describe the
 * object's boundary, rather than a thin stroked ribbon. Effects and open paths
 * are rejected instead of silently creating incomplete or incorrectly sized bins.
 */
export function importSvgShape(svgText: string, options: SvgImportOptions = {}): TracedShape {
  if (typeof svgText !== "string" || !svgText.trim() || svgText.length > MAX_XML_LENGTH) fail("Supply a nonempty SVG smaller than 5 MB.");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(svgText)) fail("Document types and custom entities are not supported.");
  const widthOverride = positive(options.widthMm, "widthMm");
  const tolerance = positive(options.toleranceMm ?? 0.05, "toleranceMm")!;
  if (tolerance > 1 || tolerance < 0.001) fail("toleranceMm must be between 0.001 and 1 mm.");
  const validXml = XMLValidator.validate(svgText);
  if (validXml !== true) fail(`Malformed XML: ${validXml.err.msg}`);
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: false, parseAttributeValue: false, processEntities: false });
  const nodes: unknown = parser.parse(svgText);
  if (!Array.isArray(nodes)) fail("Missing SVG root.");
  const roots = nodes.map(record).filter(node => !tagName(node)?.startsWith("?") && tagName(node) !== "#comment");
  if (roots.length !== 1 || tagName(roots[0])?.split(":").pop() !== "svg") fail("Expected one SVG root.");
  const root = roots[0], rootAttrs = attributes(root), scale = canvasMatrix(rootAttrs, widthOverride);
  assertNoResources(root);
  const collect = (flattenTolerance: number): Outline => {
    const outline: Outline = [];
    const walk = (node: XmlNode, parentMatrix: Matrix, inherited: Style, rootNode = false, depth = 0) => {
      if (depth > 64) fail("SVG nesting exceeds 64 levels.");
      const key = tagName(node);
      if (!key) return;
      const tag = key.split(":").pop()!;
      if (["metadata", "title", "desc", "defs", "#comment"].includes(tag) || tag.startsWith("?")) return;
      if (tag === "#text") { if (String(node[key]).trim()) fail("Unexpected text outside metadata."); return; }
      const attrs = attributes(node), style = styleFor(attrs, inherited);
      if (style.hidden) return;
      const matrix = multiply(parentMatrix, transform(attrs.transform));
      if (tag === "g" || rootNode) {
        const children: unknown = node[key];
        if (Array.isArray(children)) for (const child of children) walk(record(child), matrix, style, false, depth + 1);
      } else if (["path", "rect", "circle", "ellipse", "polygon", "polyline"].includes(tag)) {
        outline.push(...filledOutline(flattenPath(shapePath(tag, attrs), matrix, flattenTolerance), style));
      } else fail(`Unsupported <${tag}>; convert visible geometry to closed paths first.`);
    };
    walk(root, scale, { fill: "black", fillRule: "nonzero", hidden: false }, true);
    if (!outline.length) fail("No usable closed silhouettes found.");
    if (outlinePointCount(outline) > MAX_POINTS) fail(`Artwork exceeds ${MAX_POINTS} vertices; simplify it first.`);
    return outline;
  };
  let outline = collect(tolerance);
  let bounds = outlineBounds(outline)!;
  let factor = widthOverride === undefined ? 1 : widthOverride / (bounds.maxX - bounds.minX);
  if (widthOverride !== undefined && factor > 1) {
    // An override can enlarge artwork; flatten again so final-mm error stays bounded.
    outline = collect(tolerance / factor);
    bounds = outlineBounds(outline)!;
    factor = widthOverride / (bounds.maxX - bounds.minX);
  }
  const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
  const outlineMm = normalizeOutline(mapOutline(outline, point => ({ x: (point.x - centerX) * factor, y: -(point.y - centerY) * factor })));
  const bboxMm: Bounds = outlineBounds(outlineMm)!;
  if (![bboxMm.minX, bboxMm.minY, bboxMm.maxX, bboxMm.maxY].every(Number.isFinite) || bboxMm.maxX - bboxMm.minX > 2000 || bboxMm.maxY - bboxMm.minY > 2000) {
    fail("Artwork must have finite dimensions no larger than 2000 mm per axis.");
  }
  const shape = { id: options.id ?? "svg-shape", name: options.name ?? "SVG pocket", outlineMm, bboxMm,
    pointCount: outlinePointCount(outlineMm), source: "basic-shape", sourceMmPerPx: null };
  if (!withinImportLimits(shape)) fail("Outline exceeds Pocketry's import limits; simplify it first.");
  return tracedShapeSchema.parse(shape);
}
