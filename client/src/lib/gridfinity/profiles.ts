import {
  BASE_BOTTOM_RADIUS,
  BASE_PROFILE,
  BASE_PROFILE_HEIGHT,
  BASE_TOP_RADIUS,
  STACKING_LIP_DEPTH,
  STACKING_LIP_FILLET_RADIUS,
  STACKING_LIP_HEIGHT,
  STACKING_LIP_LINE,
  STACKING_LIP_SUPPORT_HEIGHT,
  STACKING_LIP_SUPPORT_HEIGHT_MM,
} from "@shared/gridfinity/standard";

/**
 * Pure 2D polygon construction for the Gridfinity builders. Everything here is
 * plain arithmetic — no WASM — so it runs identically on the main thread, in
 * the worker, and under Node, and is testable without a kernel.
 *
 * Ported from `gridfinity-rebuilt-openscad` @ 910e22d8 (see UPSTREAM.md):
 * - `baseProfilePolygon`      ← src/core/base.scad `_base_polygon()`
 * - `stackingLipProfilePolygon` ← src/core/wall.scad `_profile_wall()` and
 *   src/core/standard.scad `STACKING_LIP`
 * - `roundedRectPolygon`      ← src/helpers/shapes.scad `rounded_square()`
 *
 * Conventions: polygons are **implicitly closed** and wound **counter-
 * clockwise** (positive shoelace area), which is what manifold's default
 * `Positive` fill rule treats as solid. Sweep profiles use x = radial
 * distance from the sweep path (must be ≥ 0 for the corner revolve), y = up.
 */

export type ProfilePoint = [number, number];
export type ProfilePolygon = ProfilePoint[];

/** Twice the signed area (shoelace). Positive means counter-clockwise. */
export function polygonDoubleArea(polygon: readonly ProfilePoint[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
  }
  return sum;
}

/** Signed area of an implicitly closed polygon. */
export function polygonArea(polygon: readonly ProfilePoint[]): number {
  return polygonDoubleArea(polygon) / 2;
}

/** Area centroid. Only valid for non-zero-area polygons. */
export function polygonCentroid(polygon: readonly ProfilePoint[]): ProfilePoint {
  let cx = 0;
  let cy = 0;
  let doubleArea = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const cross =
      polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    doubleArea += cross;
    cx += (polygon[j][0] + polygon[i][0]) * cross;
    cy += (polygon[j][1] + polygon[i][1]) * cross;
  }
  if (doubleArea === 0) {
    throw new Error("polygonCentroid: degenerate polygon");
  }
  return [cx / (3 * doubleArea), cy / (3 * doubleArea)];
}

/** Drops consecutive duplicates, including across the implicit closing edge. */
function dedupePolygon(polygon: ProfilePolygon, epsilon = 1e-9): ProfilePolygon {
  const out: ProfilePolygon = [];
  for (const point of polygon) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) <= epsilon) {
      continue;
    }
    out.push(point);
  }
  while (
    out.length > 1 &&
    Math.hypot(
      out[0][0] - out[out.length - 1][0],
      out[0][1] - out[out.length - 1][1],
    ) <= epsilon
  ) {
    out.pop();
  }
  return out;
}

/**
 * Asserts the quality contract shared by every arc in this module: segment
 * counts are per full circle and must be a multiple of 8, so that quarter
 * arcs land vertices exactly on the cardinal directions (making bounding
 * boxes exact) and the lip fillet's 135° arc lands on the step grid.
 */
export function assertCircularSegments(circularSegments: number): void {
  if (
    !Number.isInteger(circularSegments) ||
    circularSegments < 16 ||
    circularSegments % 8 !== 0
  ) {
    throw new Error(
      `circularSegments must be a multiple of 8 and at least 16, got ${circularSegments}`,
    );
  }
}

/**
 * The closed, solid base profile ready for sweeping: {@link BASE_PROFILE}
 * pushed outward by {@link BASE_BOTTOM_RADIUS} (so the corner revolve produces
 * the spec's 0.8 mm bottom radius), then squared off back to the sweep axis so
 * a centre fill can complete the solid. Mirrors upstream `_base_polygon()`.
 */
export function baseProfilePolygon(): ProfilePolygon {
  const translated: ProfilePolygon = BASE_PROFILE.map(([x, y]) => [
    x + BASE_BOTTOM_RADIUS,
    y,
  ]);
  const polygon: ProfilePolygon = [
    ...translated,
    [0, BASE_PROFILE_HEIGHT],
    [0, 0],
  ];
  if (polygonArea(polygon) <= 0) {
    throw new Error("baseProfilePolygon: expected counter-clockwise winding");
  }
  return polygon;
}

/**
 * The stacking-lip cross-section in sweep coordinates, positioned at the top
 * of a wall of the given height (y = 0 is the wall's *bottom*).
 *
 * Construction, following upstream `STACKING_LIP` + `_profile_wall()`:
 * lip-local coordinates put x outward from the lip's inner tip and y up from
 * the bin's nominal top. The recess surface is {@link STACKING_LIP_LINE}; the
 * closing edges drop from the outer top edge straight down the wall face and
 * back in along the 45° support cone to the inner face.
 *
 * Two deliberate deviations from upstream, recorded in UPSTREAM.md:
 * - upstream nudges the support's outer bottom vertex inward by
 *   `TOLLERANCE = 0.02` to avoid coincident faces in OpenSCAD preview;
 *   manifold's booleans are exact, so the vertex sits on the wall face.
 * - the top-corner fillet centre is computed in closed form (the corner is
 *   exactly a 45° edge meeting a vertical edge) rather than via the general
 *   tangent-tangent-radius routine.
 */
export function stackingLipProfilePolygon(options: {
  wallHeightMm: number;
  circularSegments: number;
}): ProfilePolygon {
  const { wallHeightMm, circularSegments } = options;
  assertCircularSegments(circularSegments);
  if (!Number.isFinite(wallHeightMm) || wallHeightMm < 0) {
    throw new Error(`wallHeightMm must be ≥ 0, got ${wallHeightMm}`);
  }

  const r = STACKING_LIP_FILLET_RADIUS;
  // Fillet centre for the 45°-meets-vertical corner at (2.6, 4.4): r·(1+√2)
  // below the corner, r left of the vertical edge. See STACKING_LIP_HEIGHT_ACTUAL.
  const centreX = STACKING_LIP_DEPTH - r;
  const centreY = STACKING_LIP_HEIGHT - r * (1 + Math.SQRT2);

  // Arc from the tangent on the rising 45° edge (135°) clockwise over the
  // summit (90°) to the tangent on the vertical outer edge (0°).
  const stepDeg = 360 / circularSegments;
  const arc: ProfilePolygon = [];
  for (let angle = 135; angle >= 0; angle -= stepDeg) {
    const radians = (angle * Math.PI) / 180;
    arc.push([
      centreX + r * Math.cos(radians),
      centreY + r * Math.sin(radians),
    ]);
  }

  // Lip-local outline, wound clockwise here; reversed to CCW below.
  const local: ProfilePolygon = [
    [0, 0],
    ...STACKING_LIP_LINE.slice(1, 3).map(
      ([x, y]): ProfilePoint => [x, y],
    ),
    ...arc,
    // Straight down the outer wall face to the bottom of the 45° support…
    [STACKING_LIP_DEPTH, -STACKING_LIP_SUPPORT_HEIGHT_MM],
    // …and back in along the support cone to the inner face.
    [0, -STACKING_LIP_SUPPORT_HEIGHT],
  ];

  // Into sweep coordinates: radial offset so the outer face lands at
  // BASE_TOP_RADIUS from the sweep path, vertical offset to the wall top,
  // clamped at the wall's bottom exactly like upstream `_profile_wall()`.
  const radialOffset = BASE_TOP_RADIUS - STACKING_LIP_DEPTH;
  const positioned: ProfilePolygon = local.map(([x, y]) => [
    x + radialOffset,
    Math.max(y + wallHeightMm, 0),
  ]);

  const polygon = dedupePolygon(positioned).reverse();
  if (polygon.length < 3 || polygonArea(polygon) <= 0) {
    throw new Error("stackingLipProfilePolygon: degenerate profile");
  }
  return polygon;
}

/**
 * A rounded rectangle centred on the origin, wound counter-clockwise, with
 * quarter-circle corners of `circularSegments / 4` chords whose endpoints lie
 * exactly on the cardinal directions — so the polygon's bounding box is
 * exactly `width × length` regardless of segment count.
 */
export function roundedRectPolygon(
  widthMm: number,
  lengthMm: number,
  cornerRadiusMm: number,
  circularSegments: number,
): ProfilePolygon {
  if (widthMm <= 0 || lengthMm <= 0) {
    throw new Error(`roundedRectPolygon: size must be positive, got ${widthMm}×${lengthMm}`);
  }
  if (cornerRadiusMm < 0) {
    throw new Error(`roundedRectPolygon: negative corner radius ${cornerRadiusMm}`);
  }
  if (2 * cornerRadiusMm > widthMm + 1e-9 || 2 * cornerRadiusMm > lengthMm + 1e-9) {
    throw new Error(
      `roundedRectPolygon: corner radius ${cornerRadiusMm} too large for ${widthMm}×${lengthMm}`,
    );
  }

  const halfW = widthMm / 2;
  const halfL = lengthMm / 2;
  if (cornerRadiusMm === 0) {
    return [
      [halfW, -halfL],
      [halfW, halfL],
      [-halfW, halfL],
      [-halfW, -halfL],
    ];
  }

  assertCircularSegments(circularSegments);
  const chordsPerCorner = circularSegments / 4;
  const stepDeg = 90 / chordsPerCorner;

  // Corner arc centres in CCW order, with each corner's start angle.
  const corners: { cx: number; cy: number; startDeg: number }[] = [
    { cx: halfW - cornerRadiusMm, cy: halfL - cornerRadiusMm, startDeg: 0 },
    { cx: -halfW + cornerRadiusMm, cy: halfL - cornerRadiusMm, startDeg: 90 },
    { cx: -halfW + cornerRadiusMm, cy: -halfL + cornerRadiusMm, startDeg: 180 },
    { cx: halfW - cornerRadiusMm, cy: -halfL + cornerRadiusMm, startDeg: 270 },
  ];

  const points: ProfilePolygon = [];
  for (const { cx, cy, startDeg } of corners) {
    for (let chord = 0; chord <= chordsPerCorner; chord++) {
      const radians = ((startDeg + chord * stepDeg) * Math.PI) / 180;
      points.push([
        cx + cornerRadiusMm * Math.cos(radians),
        cy + cornerRadiusMm * Math.sin(radians),
      ]);
    }
  }
  return dedupePolygon(points);
}

/**
 * Area of the polygonised rounded rectangle above, in closed form: the exact
 * rectangle minus what the four polygonised corner fans leave uncovered.
 * Each quarter-corner fan of `m` chords covers `(m/2)·r²·sin(90°/m)`.
 * Used by the invariant tests to pin volumes tightly.
 */
export function roundedRectPolygonArea(
  widthMm: number,
  lengthMm: number,
  cornerRadiusMm: number,
  circularSegments: number,
): number {
  if (cornerRadiusMm === 0) return widthMm * lengthMm;
  const m = circularSegments / 4;
  const fan = 2 * m * cornerRadiusMm ** 2 * Math.sin(Math.PI / (2 * m));
  return widthMm * lengthMm - cornerRadiusMm ** 2 * 4 + fan;
}
