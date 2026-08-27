import { isValidRing } from "@shared/geometry/rings";
import type { Outline, Ring } from "@shared/geometry/types";

import { iterateRings } from "@/lib/geometry/outline";

import { describeScale, toModelSpace, type ExportScale } from "./scale";

/**
 * DXF export (AC1027 / AutoCAD 2013).
 *
 * DXF is y-up, so this exporter flips — through `toModelSpace`, the same call
 * the STL writer makes, which is what stops the two formats disagreeing about
 * handedness.
 *
 * Three fixes over the legacy writer:
 *
 * - It emitted old-style `POLYLINE`/`VERTEX`/`SEQEND` with no `AcDbEntity` /
 *   `AcDbPolyline` subclass markers. Strict AC1027 readers reject that, and it
 *   cannot express a hole at all. Every ring is now its own `LWPOLYLINE`.
 * - `$DIMSCALE` was written as a `9`-coded name followed by `70` and `40`
 *   codes, which is malformed — `$DIMSCALE` is a single `40` real. It is gone
 *   entirely rather than repaired: the scale is baked into the coordinates, so
 *   a drawing-scale variable on top of that would double-apply.
 * - The legacy file ended with an empty `OBJECTS` section, which is invalid —
 *   an `OBJECTS` section must at least contain the root dictionary. A minimal
 *   `HEADER` + `ENTITIES` file is the well-trodden interchange shape.
 */

/** Millimetres. Written unconditionally; see {@link unitsComment}. */
const INSUNITS_MILLIMETRES = 4;

/** 1 = metric, which selects the metric linetype/hatch pattern files. */
const MEASUREMENT_METRIC = 1;

/** First entity handle. Anything below 0x100 is conventionally reserved. */
const FIRST_HANDLE = 0x100;

/** Six decimals is ~1 nm at millimetre scale — far past any real tolerance. */
const COORDINATE_DECIMALS = 6;

/**
 * Every layer is `0`.
 *
 * A hole must sit on the same layer as its shell, or a CAM tool's
 * layer-based selection cuts the pocket without its islands. Layer `0` always
 * exists, so no `TABLES` section is needed to define it — the alternative,
 * per-shape layers, would require one and buys nothing here.
 */
const LAYER = "0";

/** A DXF drawing containing one closed `LWPOLYLINE` per ring. */
export function generateDXF(outline: Outline, scale: ExportScale): string {
  const model = toModelSpace(outline, scale);
  const rings: Ring[] = [];
  for (const { ring } of iterateRings(model)) {
    if (isValidRing(ring)) rings.push(ring);
  }
  return dxfFromModelRings(rings, unitsComment(scale));
}

/**
 * The writer proper, over rings already in model space (millimetres, y-up).
 * Split out so the bin-layout export — which is born in millimetres and must
 * not pass the px→mm boundary a second time — shares one DXF encoder.
 */
export function dxfFromModelRings(rings: readonly Ring[], comment: string): string {
  const lines: string[] = [];
  const pair = (code: number, value: string | number): void => {
    // Group codes are right-justified in three columns, as every DXF writer
    // since R12 has done; values are written unpadded, and readers trim.
    lines.push(String(code).padStart(3, " "));
    lines.push(String(value));
  };

  pair(999, "Pocketry outline export");
  pair(999, comment);

  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1027");
  pair(9, "$INSUNITS");
  pair(70, INSUNITS_MILLIMETRES);
  pair(9, "$MEASUREMENT");
  pair(70, MEASUREMENT_METRIC);
  pair(9, "$HANDSEED");
  // Must exceed every handle used below, or a reader may hand out a duplicate.
  pair(5, handleHex(FIRST_HANDLE + rings.length));
  pair(0, "ENDSEC");

  pair(0, "SECTION");
  pair(2, "ENTITIES");
  rings.forEach((ring, index) => {
    pair(0, "LWPOLYLINE");
    pair(5, handleHex(FIRST_HANDLE + index));
    pair(100, "AcDbEntity");
    pair(8, LAYER);
    pair(100, "AcDbPolyline");
    pair(90, ring.length);
    // Bit 1: closed. The ring's closing edge is implicit in our model too, so
    // the first point is never repeated.
    pair(70, 1);
    for (const point of ring) {
      pair(10, point.x.toFixed(COORDINATE_DECIMALS));
      pair(20, point.y.toFixed(COORDINATE_DECIMALS));
    }
  });
  pair(0, "ENDSEC");

  pair(0, "EOF");
  return `${lines.join("\n")}\n`;
}

/**
 * The `999` comment that says what the numbers actually mean.
 *
 * `$INSUNITS` is 4 (mm) either way, because a CAD reader needs *some* unit and
 * "unitless" imports at an arbitrary size. When there is no calibration the
 * coordinates are still raw pixels, so that declaration is a convenient lie —
 * hence saying so in the file rather than only in the UI.
 */
function unitsComment(scale: ExportScale): string {
  return scale.mmPerPx === null
    ? "Units: source pixels (no ruler calibration) — $INSUNITS declares mm so the drawing opens, but 1 unit = 1 pixel"
    : `Units: millimetres — ${describeScale(scale)}`;
}

function handleHex(handle: number): string {
  return handle.toString(16).toUpperCase();
}
