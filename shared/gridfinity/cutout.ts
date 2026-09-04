import { z } from "zod";

import { ensureOrientation, mapRing } from "../geometry/rings";
import {
  HOLE_ORIENTATION,
  OUTER_ORIENTATION,
  type Bounds,
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
 * Finger holes are independent bin-local objects in the project document.
 * `CutoutPlacement.fingerHoles` remains only as an import bridge for project
 * schemas 1–6; current UI and geometry never attach holes to a tool pocket.
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
 * cut to the pocket floor; round scoops are spherical dishes cut from the top;
 * deep scoops descend through straight vertical walls and finish in a rounded
 * bottom. The oblong variant stores its midpoint, overall length and rotation
 * so its two end handles can resize it. Every hole is positioned directly in
 * the bin frame, independently from tool-pocket transforms.
 */
export const fingerHoleSchema = z
  .object({
    id: z.string().min(1),
    /** Bin-local mm, y-up, origin at the bin centre. */
    center: vec2Schema,
    diameterMm: z.number().min(6).max(80).default(18),
    // `oblong-scoop` accepts saves made by the short-lived directed-trough
    // prototype and normalizes them to the corrected vertical deep scoop.
    kind: z
      .enum([
        "straight",
        "scoop",
        "deep-scoop",
        "oblong-deep-scoop",
        "oblong-scoop",
      ])
      .default("straight"),
    /** Used only for scoops; retained on straight holes so type changes are reversible. */
    depthMm: z.number().min(1).max(120).default(12),
    /** Compatibility only; removed with the directed-trough prototype. */
    reachMm: z.number().min(1).max(120).optional(),
    /** Compatibility only; removed with the directed-trough prototype. */
    directionDeg: z.number().finite().optional(),
    /** Overall end-to-end mouth length; used by oblong deep scoops only. */
    lengthMm: z.number().min(6).max(160).optional(),
    /** CCW mouth rotation in the bin-local y-up frame. */
    rotationDeg: z.number().finite().optional(),
  })
  .strict()
  .transform(({ reachMm: _reach, directionDeg: _direction, kind, ...hole }) => ({
    ...hole,
    kind: kind === "oblong-scoop" ? ("deep-scoop" as const) : kind,
  }));

export type FingerHole = z.infer<typeof fingerHoleSchema>;

export const MIN_FINGER_HOLE_DIAMETER_MM = 6;
export const MAX_FINGER_HOLE_DIAMETER_MM = 80;
export const DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM = 36;
export const MAX_OBLONG_DEEP_SCOOP_LENGTH_MM = 160;
export const MIN_OBLONG_DEEP_SCOOP_SPAN_MM = 2;

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

/**
 * Total top-to-bottom depth of a deep scoop. The cutter always includes at
 * least one radius so its bottom remains a true hemisphere even when an old
 * or hand-edited project requests a shallower value.
 */
export function effectiveDeepScoopDepthMm(
  scoop: Pick<FingerHole, "diameterMm" | "depthMm">,
): number {
  return Math.max(scoop.depthMm, scoop.diameterMm / 2);
}

export interface OblongDeepScoopEndpoints {
  /** Centres of the two semicircular end caps in shape-local mm. */
  start: Point;
  end: Point;
  /** Effective overall end-to-end mouth length. */
  lengthMm: number;
}

/** Shape-local cap centres for an oblong deep scoop. */
export function oblongDeepScoopEndpoints(
  hole: Pick<
    FingerHole,
    "center" | "diameterMm" | "lengthMm" | "rotationDeg"
  >,
): OblongDeepScoopEndpoints {
  const minimumLength = hole.diameterMm + MIN_OBLONG_DEEP_SCOOP_SPAN_MM;
  const lengthMm = Math.min(
    MAX_OBLONG_DEEP_SCOOP_LENGTH_MM,
    Math.max(hole.lengthMm ?? DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM, minimumLength),
  );
  const halfSpan = (lengthMm - hole.diameterMm) / 2;
  const radians = ((hole.rotationDeg ?? 0) * Math.PI) / 180;
  const dx = halfSpan * Math.cos(radians);
  const dy = halfSpan * Math.sin(radians);
  return {
    start: { x: hole.center.x - dx, y: hole.center.y - dy },
    end: { x: hole.center.x + dx, y: hole.center.y + dy },
    lengthMm,
  };
}

/**
 * Moves one oblong end while the opposite end stays fixed. This is shared by
 * the editor and tests so endpoint dragging, resizing and rotation are one
 * operation with one source of truth.
 */
export function resizeOblongDeepScoopFromEndpoint(
  hole: FingerHole,
  endpoint: "start" | "end",
  dragged: Point,
): FingerHole {
  const current = oblongDeepScoopEndpoints(hole);
  const fixed = endpoint === "start" ? current.end : current.start;
  let dx = endpoint === "start" ? fixed.x - dragged.x : dragged.x - fixed.x;
  let dy = endpoint === "start" ? fixed.y - dragged.y : dragged.y - fixed.y;
  let span = Math.hypot(dx, dy);
  if (span < 1e-9) {
    const radians = ((hole.rotationDeg ?? 0) * Math.PI) / 180;
    dx = Math.cos(radians);
    dy = Math.sin(radians);
    span = 1;
  }
  const clampedSpan = Math.min(
    MAX_OBLONG_DEEP_SCOOP_LENGTH_MM - hole.diameterMm,
    Math.max(MIN_OBLONG_DEEP_SCOOP_SPAN_MM, span),
  );
  const ux = dx / span;
  const uy = dy / span;
  const start = endpoint === "start"
    ? { x: fixed.x - ux * clampedSpan, y: fixed.y - uy * clampedSpan }
    : fixed;
  const end = endpoint === "end"
    ? { x: fixed.x + ux * clampedSpan, y: fixed.y + uy * clampedSpan }
    : fixed;
  const rotationDeg =
    ((Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI + 360) % 360;
  return {
    ...hole,
    center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    lengthMm: clampedSpan + hole.diameterMm,
    rotationDeg,
  };
}

/**
 * Resizes a mouth from its radial/width handle. Round holes keep their centre
 * fixed. Oblong holes keep both cap centres fixed, so changing width does not
 * unexpectedly change either end position.
 */
export function resizeFingerHoleFromWidthHandle(
  hole: FingerHole,
  dragged: Point,
): FingerHole {
  if (hole.kind !== "oblong-deep-scoop") {
    const diameterMm = Math.min(
      MAX_FINGER_HOLE_DIAMETER_MM,
      Math.max(
        MIN_FINGER_HOLE_DIAMETER_MM,
        2 * Math.hypot(dragged.x - hole.center.x, dragged.y - hole.center.y),
      ),
    );
    const depthMm =
      hole.kind === "scoop"
        ? Math.min(hole.depthMm, diameterMm / 2)
        : hole.kind === "deep-scoop"
          ? Math.max(hole.depthMm, diameterMm / 2)
          : hole.depthMm;
    return { ...hole, diameterMm, depthMm };
  }

  const endpoints = oblongDeepScoopEndpoints(hole);
  const span = Math.hypot(
    endpoints.end.x - endpoints.start.x,
    endpoints.end.y - endpoints.start.y,
  );
  const radians = ((hole.rotationDeg ?? 0) * Math.PI) / 180;
  const normal = { x: -Math.sin(radians), y: Math.cos(radians) };
  const signedDistance =
    (dragged.x - hole.center.x) * normal.x +
    (dragged.y - hole.center.y) * normal.y;
  const diameterMm = Math.min(
    MAX_FINGER_HOLE_DIAMETER_MM,
    MAX_OBLONG_DEEP_SCOOP_LENGTH_MM - span,
    Math.max(MIN_FINGER_HOLE_DIAMETER_MM, 2 * Math.abs(signedDistance)),
  );
  return {
    ...hole,
    diameterMm,
    depthMm: Math.max(hole.depthMm, diameterMm / 2),
    lengthMm: span + diameterMm,
  };
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
    /** Independent placement scale; 1 = the traced silhouette's true size. */
    scaleX: z.number().finite().min(0.05).max(20).default(1),
    scaleY: z.number().finite().min(0.05).max(20).default(1),
    /** Editor preference for subsequent mouse/numeric resizing. */
    aspectRatioLocked: z.boolean().default(true),
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
    /** Project schemas 1–6 only; current holes live at project level. */
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
        {
          id,
          kind: "scoop" as const,
          ...scoop,
        },
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
 * Applies a placement to a shape-local outline: **scale → mirror → rotate
 * → translate**, then re-enforces the ring orientation invariant (mirroring
 * negates signed area, and downstream offsetting depends on outer-positive /
 * hole-negative winding).
 *
 * This is the single source of truth used by the editor rendering, the
 * validation rules, and the worker's cutter builder.
 */
export type PlacementTransform = Pick<
  CutoutPlacement,
  "position" | "rotationDeg" | "mirrored"
> & Partial<Pick<CutoutPlacement, "scaleX" | "scaleY">>;

/** Applies scale → mirror → rotate → translate to one shape-local point. */
export function transformPointPlacement(
  point: Point,
  placement: PlacementTransform,
): Point {
  const radians = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaledX = point.x * (placement.scaleX ?? 1);
  const x = placement.mirrored ? -scaledX : scaledX;
  const y = point.y * (placement.scaleY ?? 1);
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
  const unmirroredX = placement.mirrored ? -x : x;
  return {
    x: unmirroredX / (placement.scaleX ?? 1),
    y: y / (placement.scaleY ?? 1),
  };
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
// Placement resizing
// ---------------------------------------------------------------------------

export type PocketResizeHandle =
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "nw";

const MIN_POCKET_SCALE = 0.05;
const MAX_POCKET_SCALE = 20;

function clampPocketScale(value: number): number {
  return Math.min(MAX_POCKET_SCALE, Math.max(MIN_POCKET_SCALE, value));
}

function resizeHandlePoint(bounds: Bounds, handle: PocketResizeHandle): Point {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    x: handle.includes("w")
      ? bounds.minX
      : handle.includes("e")
        ? bounds.maxX
        : centerX,
    y: handle.includes("s")
      ? bounds.minY
      : handle.includes("n")
        ? bounds.maxY
        : centerY,
  };
}

function oppositeResizeHandle(handle: PocketResizeHandle): PocketResizeHandle {
  const opposite: Record<PocketResizeHandle, PocketResizeHandle> = {
    n: "s",
    ne: "sw",
    e: "w",
    se: "nw",
    s: "n",
    sw: "ne",
    w: "e",
    nw: "se",
  };
  return opposite[handle];
}

/**
 * Resizes one placed pocket from an oriented edge/corner handle. The opposite
 * handle remains fixed; `fromCenter` (Option/Alt in the editor) fixes the
 * bounds centre instead. Rotation and mirroring remain unchanged.
 */
export function resizeCutoutPlacementFromHandle(
  placement: CutoutPlacement,
  localBounds: Bounds,
  handle: PocketResizeHandle,
  draggedBinPoint: Point,
  fromCenter = false,
): CutoutPlacement {
  const moving = resizeHandlePoint(localBounds, handle);
  const anchor = fromCenter
    ? {
        x: (localBounds.minX + localBounds.maxX) / 2,
        y: (localBounds.minY + localBounds.maxY) / 2,
      }
    : resizeHandlePoint(localBounds, oppositeResizeHandle(handle));
  const anchorBin = transformPointPlacement(anchor, placement);

  const radians = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = draggedBinPoint.x - anchorBin.x;
  const dy = draggedBinPoint.y - anchorBin.y;
  const rotatedX = dx * cos + dy * sin;
  const localVector = {
    x: placement.mirrored ? -rotatedX : rotatedX,
    y: -dx * sin + dy * cos,
  };
  const basis = { x: moving.x - anchor.x, y: moving.y - anchor.y };
  const changesX = handle.includes("e") || handle.includes("w");
  const changesY = handle.includes("n") || handle.includes("s");

  let scaleX = placement.scaleX;
  let scaleY = placement.scaleY;
  if (placement.aspectRatioLocked) {
    let factor: number;
    if (changesX && changesY) {
      const startVector = {
        x: basis.x * placement.scaleX,
        y: basis.y * placement.scaleY,
      };
      const lengthSq = startVector.x ** 2 + startVector.y ** 2;
      factor =
        lengthSq > 0
          ? (localVector.x * startVector.x + localVector.y * startVector.y) /
            lengthSq
          : 1;
    } else if (changesX && basis.x !== 0) {
      factor = localVector.x / basis.x / placement.scaleX;
    } else if (changesY && basis.y !== 0) {
      factor = localVector.y / basis.y / placement.scaleY;
    } else {
      factor = 1;
    }
    const minFactor = Math.max(
      MIN_POCKET_SCALE / placement.scaleX,
      MIN_POCKET_SCALE / placement.scaleY,
    );
    const maxFactor = Math.min(
      MAX_POCKET_SCALE / placement.scaleX,
      MAX_POCKET_SCALE / placement.scaleY,
    );
    factor = Math.min(maxFactor, Math.max(minFactor, factor));
    scaleX = placement.scaleX * factor;
    scaleY = placement.scaleY * factor;
  } else {
    if (changesX && basis.x !== 0) {
      scaleX = clampPocketScale(localVector.x / basis.x);
    }
    if (changesY && basis.y !== 0) {
      scaleY = clampPocketScale(localVector.y / basis.y);
    }
  }

  const withoutTranslation = transformPointPlacement(anchor, {
    position: { x: 0, y: 0 },
    rotationDeg: placement.rotationDeg,
    mirrored: placement.mirrored,
    scaleX,
    scaleY,
  });
  return {
    ...placement,
    position: {
      x: anchorBin.x - withoutTranslation.x,
      y: anchorBin.y - withoutTranslation.y,
    },
    scaleX,
    scaleY,
  };
}

// ---------------------------------------------------------------------------
// Placement footprint (outline + finger-access rims)
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

/** A CCW capsule between two cap centres, including both semicircular ends. */
export function capsuleRing(
  start: Point,
  end: Point,
  radiusMm: number,
  segments = 24,
): Point[] {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const halfSegments = Math.max(4, Math.ceil(segments / 2));
  const ring: Point[] = [];
  for (let index = 0; index <= halfSegments; index++) {
    const theta = angle - Math.PI / 2 + (Math.PI * index) / halfSegments;
    ring.push({
      x: end.x + radiusMm * Math.cos(theta),
      y: end.y + radiusMm * Math.sin(theta),
    });
  }
  for (let index = 0; index <= halfSegments; index++) {
    const theta = angle + Math.PI / 2 + (Math.PI * index) / halfSegments;
    ring.push({
      x: start.x + radiusMm * Math.cos(theta),
      y: start.y + radiusMm * Math.sin(theta),
    });
  }
  return ring;
}

/** Exact plan-view rim used by rendering, validation, and cutter geometry. */
export function fingerHoleFootprintRing(
  hole: FingerHole,
  placement: PlacementTransform,
  segments = 24,
): Point[] {
  const local = hole.kind === "oblong-deep-scoop"
    ? (() => {
        const { start, end } = oblongDeepScoopEndpoints(hole);
        return capsuleRing(start, end, hole.diameterMm / 2, segments);
      })()
    : circleRing(hole.center, hole.diameterMm / 2, segments);
  return ensureOrientation(
    mapRing(local, (point) => transformPointPlacement(point, placement)),
    OUTER_ORIENTATION,
  );
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
 * Everything a tool-pocket placement occupies in the bin frame. The feature
 * array is retained as a compatibility shape but remains empty; independent
 * finger holes are measured separately.
 */
export function placementFootprint(
  shape: Pick<TracedShape, "outlineMm">,
  placement: Pick<
    CutoutPlacement,
    "position" | "rotationDeg" | "mirrored" | "fingerHoles"
  > & Partial<Pick<CutoutPlacement, "scaleX" | "scaleY">>,
  segments = 24,
): PlacementFootprint {
  return {
    outline: transformOutlinePlacement(shape.outlineMm, placement),
    // Legacy nested holes migrate to project-level objects before current
    // layout math runs.
    features: [],
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
