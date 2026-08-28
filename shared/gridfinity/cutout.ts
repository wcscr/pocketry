import { z } from "zod";

import { ensureOrientation, mapRing } from "../geometry/rings";
import {
  HOLE_ORIENTATION,
  OUTER_ORIENTATION,
  type Outline,
  type Point,
} from "../geometry/types";
import {
  BASE_HEIGHT,
  binFootprintMm,
  binHeightMm,
  binTotalHeightMm,
  D_WALL,
  R_F2,
  STACKING_LIP_SUPPORT_HEIGHT,
} from "./standard";
import {
  footprintInteriorRingMm,
  signedDistanceToFootprintRing,
  type BinFootprint,
} from "./footprint";
import type { BinSpec } from "./types";

/**
 * The cutout model: traced shapes placed into a bin as pockets. Pure data and
 * pure math — no WASM — shared by the 2D editor, the validation rules, and
 * the geometry worker, so placement can never mean different things in
 * different places.
 *
 * ## Coordinate frames (the mirrored-STL prevention, stated once)
 *
 * - **Shape-local** (`TracedShape.outlineMm`): millimetres, **y-up**, origin
 *   at the shape's bbox centre. Produced exactly once, at Add-to-bin time,
 *   by `toModelSpace` (the app's single px→mm + Y-flip) plus a translation.
 * - **Bin-local** (`CutoutPlacement.position`): millimetres, y-up, origin at
 *   the bin centre — identical to the manifold build frame's XY, so
 *   placement maths and build maths are the same numbers. `rotationDeg` is
 *   CCW-positive in this frame.
 * - The 2D editor's SVG view is y-down; that flip is **view-only** and lives
 *   solely in {@link binToCanvas} / {@link canvasToBin}.
 *
 * G4 adds per-pocket **finger holes** whose type is either a vertical cylinder
 * sharing the pocket's floor or a spherical scoop sunk from the top surface.
 * There may be several of either. Their centres are stored **shape-local**, so
 * they travel with the pocket through move / rotate / mirror. Schema-v1's
 * one-off scoop migrates into this per-hole model.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const vec2Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const ringSchema = z.array(vec2Schema).min(3);

const shapeSchema = z.object({
  outer: ringSchema,
  holes: z.array(ringSchema),
});

export const outlineSchema = z.array(shapeSchema).min(1);

export const boundsSchema = z.object({
  minX: z.number().finite(),
  minY: z.number().finite(),
  maxX: z.number().finite(),
  maxY: z.number().finite(),
});

/** A traced tool outline, normalised into the shape-local mm frame. */
export const tracedShapeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** Full-resolution outline; vertex budgets are applied at build time. */
    outlineMm: outlineSchema,
    /** Bbox of `outlineMm` (centred, so roughly symmetric around 0). */
    bboxMm: boundsSchema,
    pointCount: z.number().int().positive(),
    /**
     * Scale the trace was captured at. `null` marks a shape that somehow
     * bypassed the calibration gate — validation rejects it.
     */
    sourceMmPerPx: z.number().positive().nullable(),
  })
  .strict();

export type TracedShape = z.infer<typeof tracedShapeSchema>;

export const depthSpecSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("through") }).strict(),
  /** Pocket depth measured down from the infill top. */
  z.object({ mode: z.literal("mm"), value: z.number().positive() }).strict(),
  /** Absolute material left below the pocket, from the bin's bottom (z = 0). */
  z
    .object({
      mode: z.literal("remaining"),
      floorThicknessMm: z.number().min(0),
    })
    .strict(),
]);

export type DepthSpec = z.infer<typeof depthSpecSchema>;

/**
 * A draggable finger-access feature. Straight holes are vertical cylinders
 * cut to the pocket floor; scoops are spherical dishes cut from the top.
 * `center` is shape-local, so either kind follows move / rotate / mirror.
 */
export const fingerHoleSchema = z
  .object({
    id: z.string().min(1),
    /** Shape-local mm, same frame as `outlineMm`. */
    center: vec2Schema,
    diameterMm: z.number().min(6).max(80).default(18),
    kind: z.enum(["straight", "scoop"]).default("straight"),
    /** Used only for scoops; retained on straight holes so type changes are reversible. */
    depthMm: z.number().min(1).max(30).default(12),
  })
  .strict();

export type FingerHole = z.infer<typeof fingerHoleSchema>;

/**
 * A spherical dish cut down from the top surface. Placed on the pocket's
 * edge it ramps a fingertip under the tool; deeper than the pocket floor is
 * legal and often the point.
 */
/** Schema-v1 compatibility only; current scoops use `fingerHoleSchema`. */
const legacyScoopSpecSchema = z
  .object({
    /** Shape-local mm, same frame as `outlineMm`. */
    center: vec2Schema,
    /** Rim diameter of the dish at the top surface. */
    diameterMm: z.number().min(10).max(80).default(30),
    /** Dish depth below the top surface; clamped to diameter/2 at build. */
    depthMm: z.number().min(1).max(30).default(12),
  })
  .strict();

/**
 * The depth the scoop actually cuts. A spherical cap deeper than its own
 * radius would overhang inward (unprintable upside down); the build clamps
 * to a hemisphere, and validation must judge the same number.
 */
export function effectiveScoopDepthMm(
  scoop: Pick<FingerHole, "diameterMm" | "depthMm">,
): number {
  return Math.min(scoop.depthMm, scoop.diameterMm / 2);
}

const cutoutPlacementInputSchema = z
  .object({
    id: z.string().min(1),
    shapeId: z.string().min(1),
    /** Bin-local mm, y-up, origin at the bin centre. */
    position: vec2Schema,
    /** CCW-positive in the y-up bin frame. */
    rotationDeg: z.number().finite().default(0),
    mirrored: z.boolean().default(false),
    depth: depthSpecSchema.default({
      mode: "remaining",
      floorThicknessMm: BASE_HEIGHT,
    }),
    /** Fit clearance grown around the outline before cutting. */
    clearanceMm: z.number().min(0).max(5).default(0),
    /** 2D rounding of vertical pocket edges (offset −r then +r). */
    cornerRoundMm: z.number().min(0).max(5).default(1),
    /** Round-over radius where the pocket wall meets the top surface. */
    topFilletMm: z.number().min(0).max(5).default(0),
    /** Bottom-edge fillet radius; clamped to depth/2 at build time. */
    bottomFilletMm: z.number().min(0).max(6).default(R_F2),
    fingerHoles: z.array(fingerHoleSchema).default([]),
    /** Schema-v1 compatibility; normalized into a scoop finger hole below. */
    scoop: legacyScoopSpecSchema.nullable().optional(),
  })
  .strict();

/**
 * Normalizes schema-v1's one-off `scoop` into the schema-v2 per-hole model.
 * New documents never retain the legacy field, while old autosaves and files
 * load without losing geometry.
 */
export const cutoutPlacementSchema = cutoutPlacementInputSchema.transform(
  ({ scoop, ...placement }) => {
    if (!scoop) return placement;
    const ids = new Set(placement.fingerHoles.map((hole) => hole.id));
    let id = "legacy-scoop";
    let suffix = 2;
    while (ids.has(id)) id = `legacy-scoop-${suffix++}`;
    return {
      ...placement,
      fingerHoles: [
        ...placement.fingerHoles,
        { id, kind: "scoop" as const, ...scoop },
      ],
    };
  },
);

export type CutoutPlacement = z.infer<typeof cutoutPlacementSchema>;
export type CutoutPlacementInput = z.input<typeof cutoutPlacementSchema>;

export function parseCutoutPlacement(input: unknown): CutoutPlacement {
  return cutoutPlacementSchema.parse(input);
}

// ---------------------------------------------------------------------------
// Placement transform
// ---------------------------------------------------------------------------

/**
 * Applies a placement to a shape-local outline: **mirror → rotate →
 * translate**, then re-enforces the ring orientation invariant (mirroring
 * negates signed area, and downstream offsetting depends on outer-positive /
 * hole-negative winding).
 *
 * This is the single source of truth used by the editor rendering, the
 * validation rules, and the worker's cutter builder.
 */
export type PlacementTransform = Pick<
  CutoutPlacement,
  "position" | "rotationDeg" | "mirrored"
>;

/** Applies mirror → rotate → translate to one shape-local point. */
export function transformPointPlacement(
  point: Point,
  placement: PlacementTransform,
): Point {
  const radians = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = placement.mirrored ? -point.x : point.x;
  const y = point.y;
  return {
    x: placement.position.x + x * cos - y * sin,
    y: placement.position.y + x * sin + y * cos,
  };
}

/** Inverse of {@link transformPointPlacement}: bin-local → shape-local. */
export function untransformPointPlacement(
  point: Point,
  placement: PlacementTransform,
): Point {
  const radians = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - placement.position.x;
  const dy = point.y - placement.position.y;
  const x = dx * cos + dy * sin;
  const y = -dx * sin + dy * cos;
  return { x: placement.mirrored ? -x : x, y };
}

export function transformOutlinePlacement(
  outlineMm: Outline,
  placement: PlacementTransform,
): Outline {
  const transformPoint = (point: Point) => transformPointPlacement(point, placement);
  return outlineMm.map((shape) => ({
    outer: ensureOrientation(mapRing(shape.outer, transformPoint), OUTER_ORIENTATION),
    holes: shape.holes.map((hole) =>
      ensureOrientation(mapRing(hole, transformPoint), HOLE_ORIENTATION),
    ),
  }));
}

// ---------------------------------------------------------------------------
// Placement footprint (outline + feature circles)
// ---------------------------------------------------------------------------

/** A CCW `segments`-gon approximating the circle, for validation geometry. */
export function circleRing(center: Point, radiusMm: number, segments = 24): Point[] {
  const ring: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    ring.push({
      x: center.x + radiusMm * Math.cos(angle),
      y: center.y + radiusMm * Math.sin(angle),
    });
  }
  return ring;
}

export interface PlacementFootprint {
  /** The tool outline in bin-local mm. */
  outline: Outline;
  /**
   * Straight-hole and scoop rims in bin-local mm, as CCW rings. Kept apart
   * from the outline because rules apply the fit clearance to the outline
   * only — features are cut at their exact diameter.
   */
  features: Point[][];
}

/**
 * Everything a placement occupies in the bin frame. This is what validation
 * measures — a finger hole poking through the bin wall is exactly as much a
 * wall breach as the outline doing it.
 */
export function placementFootprint(
  shape: Pick<TracedShape, "outlineMm">,
  placement: Pick<
    CutoutPlacement,
    "position" | "rotationDeg" | "mirrored" | "fingerHoles"
  >,
  segments = 24,
): PlacementFootprint {
  const features: Point[][] = [];
  for (const hole of placement.fingerHoles) {
    features.push(
      circleRing(
        transformPointPlacement(hole.center, placement),
        hole.diameterMm / 2,
        segments,
      ),
    );
  }
  return {
    outline: transformOutlinePlacement(shape.outlineMm, placement),
    features,
  };
}

// ---------------------------------------------------------------------------
// Depth resolution
// ---------------------------------------------------------------------------

export interface ResolvedPocket {
  /** Absolute z of the pocket floor, or null for a through cut. */
  floorZ: number | null;
  /** Absolute z of the infill's top surface — where pockets start. */
  infillTopZ: number;
  /** Cutter top, above the lip so the pocket mouth is always open. */
  cutterTopZ: number;
  /** Pocket depth below the infill top, or null for a through cut. */
  depthMm: number | null;
}

/**
 * Turns a {@link DepthSpec} into absolute z values in the bin frame.
 *
 * The infill top is `binHeightMm − lipAllowance` (see `infillHeightMm` in
 * lib/gridfinity/bin.ts — same rule); `remaining` measures the floor from the
 * bin's bottom, so the default `BASE_HEIGHT` puts the pocket floor exactly on
 * top of the base. Geometric impossibilities (negative depth, floor above the
 * infill) are validation's job, not an exception here.
 */
export function resolvePocketDepth(
  spec: Pick<BinSpec, "heightUnits" | "lip">,
  depth: DepthSpec,
): ResolvedPocket {
  const lipAllowance = spec.lip === "standard" ? STACKING_LIP_SUPPORT_HEIGHT : 0;
  const infillTopZ = binHeightMm(spec.heightUnits) - lipAllowance;
  const cutterTopZ = binTotalHeightMm(spec.heightUnits, spec.lip === "standard") + 1;

  let floorZ: number | null;
  switch (depth.mode) {
    case "through":
      floorZ = null;
      break;
    case "mm":
      floorZ = infillTopZ - depth.value;
      break;
    case "remaining":
      floorZ = depth.floorThicknessMm;
      break;
  }

  return {
    floorZ,
    infillTopZ,
    cutterTopZ,
    depthMm: floorZ === null ? null : infillTopZ - floorZ,
  };
}

// ---------------------------------------------------------------------------
// Bin interior and view flip
// ---------------------------------------------------------------------------

export interface BinInterior {
  widthMm: number;
  lengthMm: number;
  /** Corner radius of the interior boundary (R_F2). */
  cornerRadiusMm: number;
}

type GridFootprintSpec = Pick<BinSpec, "gridX" | "gridY"> &
  Partial<Pick<BinSpec, "gridPitch">> & { footprint?: BinFootprint };

/** The cavity footprint the pockets must stay inside. */
export function binInteriorMm(spec: GridFootprintSpec): BinInterior {
  return {
    widthMm: binFootprintMm(spec.gridX, spec.gridPitch) - 2 * D_WALL,
    lengthMm: binFootprintMm(spec.gridY, spec.gridPitch) - 2 * D_WALL,
    cornerRadiusMm: R_F2,
  };
}

/**
 * Signed distance from a bin-local point to the interior boundary; positive
 * inside. Exact for the rounded rectangle because it is convex — which is
 * also why per-vertex checks in validation are exact for whole polygons.
 */
export function signedDistanceToInterior(
  point: Point,
  spec: GridFootprintSpec,
): number {
  if (spec.footprint?.kind === "custom") {
    return signedDistanceToFootprintRing(point, footprintInteriorRingMm(spec));
  }
  const { widthMm, lengthMm, cornerRadiusMm } = binInteriorMm(spec);
  const halfW = widthMm / 2;
  const halfL = lengthMm / 2;
  const ax = Math.abs(point.x);
  const ay = Math.abs(point.y);

  const cornerX = halfW - cornerRadiusMm;
  const cornerY = halfL - cornerRadiusMm;
  if (ax > cornerX && ay > cornerY) {
    return cornerRadiusMm - Math.hypot(ax - cornerX, ay - cornerY);
  }
  return Math.min(halfW - ax, halfL - ay);
}

/**
 * Bin frame (y-up, centre origin) → 2D canvas frame (y-down, top-left
 * origin, content size = the bin footprint). The one and only view flip.
 */
export function binToCanvas(
  point: Point,
  spec: GridFootprintSpec,
): Point {
  return {
    x: point.x + binFootprintMm(spec.gridX, spec.gridPitch) / 2,
    y: binFootprintMm(spec.gridY, spec.gridPitch) / 2 - point.y,
  };
}

/** Inverse of {@link binToCanvas}. */
export function canvasToBin(
  point: Point,
  spec: GridFootprintSpec,
): Point {
  return {
    x: point.x - binFootprintMm(spec.gridX, spec.gridPitch) / 2,
    y: binFootprintMm(spec.gridY, spec.gridPitch) / 2 - point.y,
  };
}
