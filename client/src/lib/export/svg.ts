import { isValidRing } from "@shared/geometry/rings";
import { mmPerPixel, rulerPixelLength, type Calibration } from "@shared/geometry/scale";
import type { Outline, Ring } from "@shared/geometry/types";

import { iterateRings } from "@/lib/geometry/outline";

/**
 * SVG export.
 *
 * SVG is y-down, the same frame the tracer works in, so this is the one
 * exporter that must **not** flip Y — see `./scale` for the exporters that do.
 *
 * Two things the legacy writer got wrong are fixed here:
 *
 * - The `viewBox` fell back to a hardcoded `0 0 800 600` and only used the real
 *   image size when a calibration happened to exist, so an uncalibrated 800×450
 *   trace was stretched by 1.33× on import. The real dimensions are now always
 *   used, calibration or not.
 * - The root element carried `width="100%" height="100%"`, which makes the
 *   physical size of the drawing undefined in Inkscape and LightBurn no matter
 *   what the RDF metadata says. When the scale is known, real `mm` dimensions
 *   are emitted so the file imports at true size.
 */

export interface SvgOptions {
  /** Source image size in pixels. Used verbatim for the viewBox. */
  width: number;
  height: number;
  /**
   * Millimetres per pixel. When set, the root element also gets physical `mm`
   * dimensions. Ignored if `calibration` is supplied and this is null.
   */
  mmPerPx?: number | null;
  /**
   * The ruler calibration behind `mmPerPx`. Only needed for the RDF metadata
   * block, which records the ruler itself and cannot be reconstructed from a
   * ratio alone.
   */
  calibration?: Calibration | null;
  /** Decimal places for coordinates. Default 2. */
  precision?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
}

/** Default decimals. Native-resolution rings are megabytes at full precision. */
const DEFAULT_PRECISION = 2;

/** `toFixed` is only defined for 0–100 decimals, and past ~17 it is noise. */
const MAX_PRECISION = 17;

/**
 * The whole outline as one path, with an `M…L…Z` subpath per ring.
 *
 * Rings are emitted in `iterateRings` order — shell first, then its holes — and
 * are meant to be filled with `fill-rule="evenodd"`: under that rule a ring
 * nested inside another subtracts, which is precisely the shell/hole model.
 * Rings are *not* rewound here, because even-odd ignores winding; the sign
 * convention still holds in the output, it simply is not what makes holes work.
 */
export function outlineToPathData(
  outline: Outline,
  precision: number = DEFAULT_PRECISION,
): string {
  const decimals = clampPrecision(precision);
  const subpaths: string[] = [];
  for (const { ring } of iterateRings(outline)) {
    if (!isValidRing(ring)) continue; // Fewer than 3 points encloses nothing.
    subpaths.push(ringToSubpath(ring, decimals));
  }
  return subpaths.join(" ");
}

function ringToSubpath(ring: Ring, decimals: number): string {
  const parts: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const point = ring[i];
    const command = i === 0 ? "M" : "L";
    parts.push(
      `${command} ${formatCoordinate(point.x, decimals)} ${formatCoordinate(
        point.y,
        decimals,
      )}`,
    );
  }
  // `Z` closes back to the first point, so the ring's implicit closing edge
  // never has to be written out.
  parts.push("Z");
  return parts.join(" ");
}

/** A complete SVG document for an outline. */
export function generateOutlineSVG(outline: Outline, options: SvgOptions): string {
  const {
    width,
    height,
    precision = DEFAULT_PRECISION,
    stroke = "black",
    fill = "none",
    strokeWidth = 2,
  } = options;

  const calibration = options.calibration ?? null;
  // An explicit `mmPerPx` wins; `null` means "unknown", so a calibration can
  // still supply it. Both absent leaves the document unitless.
  const mmPerPx = options.mmPerPx ?? mmPerPixel(calibration);

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<svg xmlns="http://www.w3.org/2000/svg"',
    '     xmlns:xlink="http://www.w3.org/1999/xlink"',
  ];

  if (mmPerPx !== null && Number.isFinite(mmPerPx) && mmPerPx > 0) {
    // Physical size, so the drawing lands at true scale on import. The viewBox
    // stays in pixels, so this is also the user-space-per-mm mapping.
    lines.push(
      `     width="${formatCoordinate(width * mmPerPx, 4)}mm" height="${formatCoordinate(
        height * mmPerPx,
        4,
      )}mm"`,
    );
  }

  // Always the real image size: the viewBox is what every consumer scales by.
  lines.push(
    `     viewBox="0 0 ${formatCoordinate(width, 2)} ${formatCoordinate(height, 2)}">`,
  );
  lines.push(...metadataLines(mmPerPx, calibration));

  const pathData = outlineToPathData(outline, precision);
  if (pathData.length > 0) {
    lines.push(
      "  <path",
      `    d="${pathData}"`,
      `    fill="${escapeAttribute(fill)}"`,
      // Even-odd is what makes a hole a hole; see `outlineToPathData`.
      '    fill-rule="evenodd"',
      `    stroke="${escapeAttribute(stroke)}"`,
      `    stroke-width="${escapeAttribute(String(strokeWidth))}"`,
      "  />",
    );
  }

  lines.push("</svg>");
  return `${lines.join("\n")}\n`;
}

/**
 * The RDF scale block, kept byte-for-byte as the legacy exporter wrote it.
 *
 * Downstream tools and saved files already read these element names, so the
 * shape is frozen: `dc:scale` is **pixels per mm** (the reciprocal of
 * `mmPerPx`), and the two ruler elements echo the calibration verbatim.
 *
 * The ruler elements are omitted when only a ratio is known, because inventing
 * a ruler length that the user never measured would put a fabricated
 * measurement into a file people treat as a record.
 */
function metadataLines(
  mmPerPx: number | null,
  calibration: Calibration | null,
): string[] {
  if (mmPerPx === null || !Number.isFinite(mmPerPx) || mmPerPx <= 0) return [];

  const rulerLines = calibration
    ? [
        `        <dc:rulerLengthMm>${calibration.lengthMm}</dc:rulerLengthMm>`,
        `        <dc:rulerLengthPixels>${rulerPixelLength(calibration).toFixed(
          2,
        )}</dc:rulerLengthPixels>`,
      ]
    : [];

  return [
    "  <!-- SVG Scaling Information -->",
    "  <metadata>",
    '    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
    '             xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"',
    '             xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "      <rdf:Description>",
    `        <dc:scale>${1 / mmPerPx} pixels per mm</dc:scale>`,
    ...rulerLines,
    "      </rdf:Description>",
    "    </rdf:RDF>",
    "  </metadata>",
  ];
}

/**
 * Fixed-point with trailing zeros trimmed.
 *
 * Trimming textually rather than via `Number(...)` keeps large values out of
 * exponent notation, which is not valid in SVG path data.
 */
function formatCoordinate(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`generateOutlineSVG: coordinate must be finite, got ${value}`);
  }
  const fixed = value.toFixed(decimals);
  if (!fixed.includes(".")) return normalizeZero(fixed);
  return normalizeZero(fixed.replace(/0+$/, "").replace(/\.$/, ""));
}

/** `(-0.001).toFixed(2)` is `"-0.00"`; nobody wants `-0` in a path. */
function normalizeZero(text: string): string {
  return text === "-0" ? "0" : text;
}

function clampPrecision(precision: number): number {
  if (!Number.isFinite(precision)) return DEFAULT_PRECISION;
  return Math.min(MAX_PRECISION, Math.max(0, Math.floor(precision)));
}

/** Caller-supplied colours land in attribute values, so they are escaped. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
