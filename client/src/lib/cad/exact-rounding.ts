import type { TopoDS_Face } from "replicad-opencascadejs";

import {
  elementLength,
  leftNormal,
  reverseChain,
  startTangent,
  type ArcChain,
  type ArcElement,
  type LineElement,
} from "@shared/geometry/arc-chain";
import {
  insideCorners,
  roundingWitnesses,
  type InsideCorner,
  type SurfaceWitness,
} from "@shared/geometry/inset-rounding";
import type { Point } from "@shared/geometry/types";

import { CAD_BOOLEAN_RETRY_MM, CadContext, type CadShape } from "./adapter";
import type { SectionRegion } from "./section-chain";

/**
 * Exact construction of Pocketry's edge rounding (see
 * `@shared/geometry/inset-rounding`) on sections made of lines and arcs.
 *
 * The rule is the same at a pocket floor and at a pocket mouth. Measured away
 * from the flat face the rounding starts on, the boundary stands in by the
 * rounding inset: a full radius at that face, nothing one radius away.
 *
 * - **Floor:** the pocket narrows toward its floor. Material is *kept* inside
 *   the band next to the wall, so the band is cut from the pocket solid.
 * - **Mouth:** the bin's top edge is rounded over, so the pocket widens toward
 *   the top surface. Material is *removed* inside the band on the bin's side of
 *   the wall, so the band is added to the pocket cutter.
 *
 * The modeler's edge fillet rolls a ball along the edge. That surface does not
 * exist where a section is narrower than the ball or a corner is tighter than
 * it, which is the normal case for traced tools. This module instead sweeps one
 * band per boundary element:
 *
 * - a line gives a notch extruded along it (a cylinder face);
 * - an arc gives the same notch revolved about the arc's axis, stopping at the
 *   axis when the arc is tighter than the radius;
 * - a sharp inside corner gives the notch revolved about the corner.
 *
 * The union of those bands is exactly the set the rule describes, so creases
 * and vanishing narrow parts come out of the Booleans without special cases.
 * Every new face is a cylinder or the rounding arc revolved about a vertical
 * axis. The kernel reports the latter as a torus when the axis lies outside
 * the arc's circle and as a surface of revolution otherwise; no face is a
 * fitted spline.
 */

/**
 * How far a floor band reaches below the floor. Nothing of the pocket lies
 * there; the overhang keeps tool faces off the floor plane.
 */
const FLOOR_MARGIN_MM = 0.2;

/**
 * How far a mouth band reaches above the top surface, to keep tool faces off
 * that plane. Anything standing above the surface this close to a mouth (a
 * stacking lip, say) would be nicked by it, so it is kept tiny.
 */
const SURFACE_MARGIN_MM = 0.005;

/**
 * How far each band reaches past the wall on the side it does not act on, to
 * keep tool faces off the wall surface. A feature thinner than this next to
 * the wall would be cut through, so it is kept well under the fit tolerance
 * rather than at a convenient size.
 */
const WALL_MARGIN_MM = 0.005;

/** A finished surface point may sit this far from its exact position. */
const WITNESS_TOLERANCE_MM = CAD_BOOLEAN_RETRY_MM;

/** Position in a notch cross-section: [distance along its axis, distance from the base face]. */
type NotchPoint = readonly [number, number];

/** What exact rounding did, for the export report. */
export interface ExactRoundingStats {
  /** Band tools applied, including inside-corner bands. */
  bands: number;
  /** Roundings the modeler only got through with the bands in a different order. */
  reordered?: number;
  /** Bands that had to be applied a second time before the surface checked out. */
  recut: number;
  /** Surface points checked against the finished solid. */
  witnesses: number;
  /** Largest distance from a checked point to the finished surface. */
  maxWitnessErrorMm: number;
}

/** Where a rounding sits and which way it runs. */
interface RoundingFrame {
  /** Height of the flat face the rounding starts on: the floor, or the top surface. */
  baseZ: number;
  /** +1 when the rounding rises from a floor, -1 when it descends from a top surface. */
  vertical: 1 | -1;
  radius: number;
  /** Tool overhang past the base face. */
  baseMargin: number;
}

interface Band {
  tool: CadShape;
  ring: number;
  element: number;
  corner: boolean;
  /** Length of wall the band runs along; zero for a corner fan. */
  length: number;
  /** A band that reaches its own axis: an arc tighter than the radius, or a corner fan. */
  tight: boolean;
}

/**
 * The order in which bands are applied. Every order describes the same solid;
 * they differ only in which intermediate shapes the modeler has to get through.
 */
export type BandOrder =
  | "boundary"
  | "lines-first"
  | "tight-first"
  | "tight-last"
  | "reversed"
  | "alternate"
  | "halfway";

/**
 * Orders tried in turn. Whether the modeler's Booleans hold their precision
 * through a few dozen cuts depends on the order, and not predictably: the same
 * section can pass in one order at one floor height and fail in it at another.
 * A different order is a fresh attempt at the same solid, and every attempt is
 * held to the same checks, so the first that passes is as good as any.
 */
const BAND_ORDERS: readonly BandOrder[] = ["boundary", "lines-first", "tight-last", "tight-first", "reversed", "alternate", "halfway"];

/** Limits that end the whole export; trying another order would not help. */
const isResourceLimit = (error: unknown): boolean =>
  error instanceof Error && /modeling exceeded|memory reached|cancel/i.test(error.message);

function inOrder(bands: readonly Band[], order: BandOrder): Band[] {
  const boundary = bands.slice();
  switch (order) {
    case "boundary":
      return boundary;
    case "reversed":
      return boundary.reverse();
    case "lines-first":
      // Long straight walls first, then everything that curves, tightest last.
      return boundary.sort((p, q) => Number(p.tight) - Number(q.tight) || q.length - p.length);
    case "tight-first":
      return boundary.sort((p, q) => Number(q.tight) - Number(p.tight));
    case "tight-last":
      return boundary.sort((p, q) => Number(p.tight) - Number(q.tight));
    case "alternate":
      // Every other band first, so no band meets a freshly cut neighbor on both sides.
      return [...boundary.filter((_, index) => index % 2 === 0), ...boundary.filter((_, index) => index % 2 === 1)];
    case "halfway": {
      const start = boundary.length >> 1;
      return [...boundary.slice(start), ...boundary.slice(0, start)];
    }
  }
}

/**
 * The planar notch cross-section through `outline`, placed with its axis
 * along `direction` from `origin`. The edge leaving `outline[arcAfter]` is
 * the rounding arc through `arcMiddle`; the others are straight.
 */
function notchFace(
  c: CadContext,
  origin: Point,
  direction: Point,
  frame: RoundingFrame,
  outline: readonly NotchPoint[],
  arcAfter: number,
  arcMiddle: NotchPoint,
): TopoDS_Face {
  const oc = c.oc;
  const at = ([along, away]: NotchPoint) =>
    c.point(
      origin.x + direction.x * along,
      origin.y + direction.y * along,
      frame.baseZ + frame.vertical * away,
    );
  const builder = c.own(new oc.BRepBuilderAPI_MakeWire());
  outline.forEach((from, index) => {
    const to = outline[(index + 1) % outline.length];
    if (index === arcAfter) {
      const arc = c.own(new oc.GC_MakeArcOfCircle(at(from), at(arcMiddle), at(to)));
      builder.Add(c.own(c.own(new oc.BRepBuilderAPI_MakeEdge(c.own(arc.Value()))).Edge()));
    } else {
      builder.Add(c.own(c.own(new oc.BRepBuilderAPI_MakeEdge(at(from), at(to))).Edge()));
    }
  });
  if (!builder.IsDone()) throw new Error("Rounding band cross-section did not close");
  const face = c.own(new oc.BRepBuilderAPI_MakeFace(c.own(builder.Wire()), true));
  if (!face.IsDone()) throw new Error("Rounding band cross-section is not planar");
  return c.own(face.Face());
}

/** Sweeps of a face can come out inside-out; a tool must enclose positive volume. */
function outward(c: CadContext, solid: CadShape): CadShape {
  return c.volume(solid) < 0 ? c.own(solid.Reversed()) : solid;
}

/** The band beside a straight wall: the notch extruded along the wall. */
function lineBand(c: CadContext, element: LineElement, frame: RoundingFrame): CadShape {
  const { radius, baseMargin } = frame;
  const k = radius / Math.SQRT2;
  const face = notchFace(
    c,
    element.a,
    leftNormal(startTangent(element)),
    frame,
    [
      [-WALL_MARGIN_MM, -baseMargin],
      [radius, -baseMargin],
      [radius, 0],
      [0, radius],
      [-WALL_MARGIN_MM, radius],
    ],
    2,
    [radius - k, radius - k],
  );
  return outward(
    c,
    c.prism(face, { x: element.b.x - element.a.x, y: element.b.y - element.a.y, z: 0 }),
  );
}

/** The band beside a curved wall: the notch revolved about the wall's axis. */
function arcBand(c: CadContext, element: ArcElement, frame: RoundingFrame): CadShape {
  const { radius, baseMargin } = frame;
  const rho = element.radius;
  const k = radius / Math.SQRT2;
  let outline: NotchPoint[];
  let middle: NotchPoint;
  if (element.sweep > 0 && rho > radius + 1e-9) {
    // The wall curves around the banded side: the band runs toward the axis.
    outline = [
      [rho + WALL_MARGIN_MM, -baseMargin],
      [rho - radius, -baseMargin],
      [rho - radius, 0],
      [rho, radius],
      [rho + WALL_MARGIN_MM, radius],
    ];
    middle = [rho - radius + k, radius - k];
  } else if (element.sweep > 0) {
    // Tighter than the rounding radius: the band reaches the axis and stops
    // there. Past the axis the nearest wall is a different element.
    const phi = Math.acos(Math.min(1, (radius - rho) / radius));
    outline = [
      [rho + WALL_MARGIN_MM, -baseMargin],
      [0, -baseMargin],
      [0, radius - radius * Math.sin(phi)],
      [rho, radius],
      [rho + WALL_MARGIN_MM, radius],
    ];
    middle = [rho - radius + radius * Math.cos(phi / 2), radius - radius * Math.sin(phi / 2)];
  } else {
    // The wall curves away from the banded side: the band runs away from the axis.
    const inner = Math.min(WALL_MARGIN_MM, rho / 2);
    outline = [
      [rho - inner, -baseMargin],
      [rho + radius, -baseMargin],
      [rho + radius, 0],
      [rho, radius],
      [rho - inner, radius],
    ];
    middle = [rho + radius - k, radius - k];
  }
  const radial = {
    x: (element.a.x - element.center.x) / rho,
    y: (element.a.y - element.center.y) / rho,
  };
  const face = notchFace(c, element.center, radial, frame, outline, 2, middle);
  const axis = c.own(
    new c.oc.gp_Ax1(
      c.point(element.center.x, element.center.y, 0),
      c.own(new c.oc.gp_Dir(0, 0, Math.sign(element.sweep))),
    ),
  );
  const angle = Math.min(Math.abs(element.sweep), 2 * Math.PI);
  const revolve = c.own(new c.oc.BRepPrimAPI_MakeRevol(face, axis, angle, true));
  return outward(c, c.own(revolve.Shape()));
}

/** The band around a sharp inside corner: the notch revolved about the corner. */
function cornerBand(c: CadContext, corner: InsideCorner, frame: RoundingFrame): CadShape {
  const { radius, baseMargin } = frame;
  const k = radius / Math.SQRT2;
  const face = notchFace(
    c,
    corner.vertex,
    leftNormal(corner.arriving),
    frame,
    [
      [0, -baseMargin],
      [radius, -baseMargin],
      [radius, 0],
      [0, radius],
    ],
    2,
    [radius - k, radius - k],
  );
  // An inside corner turns clockwise, so the fan runs about the downward axis.
  const axis = c.own(
    new c.oc.gp_Ax1(
      c.point(corner.vertex.x, corner.vertex.y, 0),
      c.own(new c.oc.gp_Dir(0, 0, -1)),
    ),
  );
  const revolve = c.own(new c.oc.BRepPrimAPI_MakeRevol(face, axis, Math.abs(corner.turn), true));
  return outward(c, c.own(revolve.Shape()));
}

/** A boundary to band: its elements, and the sharp inside corners that get a band of their own. */
interface BandedRing {
  chain: ArcChain;
  corners: readonly InsideCorner[];
}

/** A closed boundary, banded at every sharp inside corner. */
const closedRing = (chain: ArcChain): BandedRing => ({ chain, corners: insideCorners(chain) });

/** Every band of one boundary, in boundary order. */
function ringBands(c: CadContext, banded: BandedRing, ring: number, frame: RoundingFrame): Band[] {
  const bands: Band[] = [];
  banded.chain.forEach((element, index) => {
    const tool = element.kind === "line" ? lineBand(c, element, frame) : arcBand(c, element, frame);
    const tight = element.kind === "arc" && element.sweep > 0 && element.radius <= frame.radius + 1e-9;
    bands.push({ tool, ring, element: index, corner: false, length: elementLength(element), tight });
  });
  for (const corner of banded.corners) {
    bands.push({ tool: cornerBand(c, corner, frame), ring, element: corner.element, corner: true, length: 0, tight: true });
  }
  return bands;
}

/** Distance from a point to the boundary surface of `solid`. */
function distanceToSurface(c: CadContext, solid: CadShape, x: number, y: number, z: number): number {
  return c.scope(() => {
    const vertex = c.own(c.own(new c.oc.BRepBuilderAPI_MakeVertex(c.point(x, y, z))).Vertex());
    let nearest = Infinity;
    for (const shell of c.subshapes(solid, "shell")) {
      const extrema = c.own(new c.oc.BRepExtrema_DistShapeShape(vertex, shell));
      if (!extrema.IsDone()) throw new Error("Surface distance query failed");
      nearest = Math.min(nearest, extrema.Value());
    }
    return nearest;
  });
}

/**
 * Applies one band per boundary element to `start` and checks the result.
 *
 * `ringsByRegion` holds, per section region, every boundary with the banded
 * side on its left. `apply` is the Boolean that combines a band with the body.
 *
 * The kernel can return a valid, unchanged solid for a Boolean that plainly
 * overlaps, and a volume check cannot see one missing sliver. So the result is
 * checked against points that must lie on the rounded surface, computed from
 * the chains alone. Bands whose points are off are applied again; if any are
 * still off the attempt fails rather than return a solid that only looks
 * right.
 *
 * Without an explicit `order` the orders in {@link BAND_ORDERS} are tried in
 * turn and the first attempt that passes every check is returned.
 */
function applyBands(
  c: CadContext,
  start: CadShape,
  ringsByRegion: readonly BandedRing[][],
  frame: RoundingFrame,
  apply: "cut" | "fuse",
  operation: string,
  stats?: ExactRoundingStats,
  order?: BandOrder,
): CadShape {
  if (order) return applyBandsInOrder(c, start, ringsByRegion, frame, apply, operation, stats, order);
  let first: unknown;
  // An abandoned attempt must not leave its figures in the export report.
  const accepted = { tolerance: c.maxNativeToleranceMm, occurrences: c.maxTopologyOccurrences, retries: c.retries };
  for (const [attempt, candidate] of BAND_ORDERS.entries()) {
    try {
      const result = applyBandsInOrder(c, start, ringsByRegion, frame, apply, operation, stats, candidate);
      if (attempt > 0 && stats) stats.reordered = (stats.reordered ?? 0) + 1;
      return result;
    } catch (error) {
      c.maxNativeToleranceMm = accepted.tolerance;
      c.maxTopologyOccurrences = accepted.occurrences;
      c.retries = accepted.retries;
      if (isResourceLimit(error)) throw error;
      first ??= error;
    }
  }
  const reason = first instanceof Error ? first.message : String(first);
  throw new Error(`${reason} (no band order succeeded; first failure shown)`);
}

/** One attempt at {@link applyBands}, with the bands in the given order. */
function applyBandsInOrder(
  c: CadContext,
  start: CadShape,
  ringsByRegion: readonly BandedRing[][],
  frame: RoundingFrame,
  apply: "cut" | "fuse",
  operation: string,
  stats: ExactRoundingStats | undefined,
  order: BandOrder,
): CadShape {
  return c.scope(
    () => {
      // Rings are numbered across regions so a witness can name its band.
      const boundaryBands: Band[] = [];
      const witnesses: SurfaceWitness[] = [];
      let ringOffset = 0;
      for (const rings of ringsByRegion) {
        rings.forEach((banded, index) => {
          boundaryBands.push(...ringBands(c, banded, ringOffset + index, frame));
        });
        const chains = rings.map((banded) => banded.chain);
        const corners = rings.map((banded) => banded.corners);
        for (const witness of roundingWitnesses(chains, frame.radius, {}, corners)) {
          witnesses.push({ ...witness, ring: witness.ring + ringOffset });
        }
        ringOffset += rings.length;
      }
      const bands = inOrder(boundaryBands, order);
      const invalid = bands.filter((band) => !c.valid(band.tool)).length;
      if (invalid) {
        throw new Error(`${operation}: ${invalid} of ${bands.length} rounding bands are not valid solids`);
      }

      let body = start;
      const combine = (band: Band, label: string) => {
        const next = c.boolean(apply, body, band.tool, `${operation}: ${label}`);
        if (body !== start) c.drop(body);
        body = next;
      };
      bands.forEach((band, index) => combine(band, `band ${index + 1} of ${bands.length}`));

      const key = (item: { ring: number; element: number; corner: boolean }) =>
        `${item.ring}:${item.element}:${item.corner ? "corner" : "wall"}`;
      const offSurface = () => {
        let worst = 0;
        const failed = new Set<string>();
        for (const witness of witnesses) {
          const z = frame.baseZ + frame.vertical * witness.height;
          const error = distanceToSurface(c, body, witness.point.x, witness.point.y, z);
          worst = Math.max(worst, error);
          if (error > WITNESS_TOLERANCE_MM) failed.add(key(witness));
        }
        return { worst, failed };
      };

      let check = offSurface();
      let recut = 0;
      if (check.failed.size) {
        const again = bands.filter((band) => check.failed.has(key(band)));
        recut = again.length;
        again.forEach((band, index) => combine(band, `repeat band ${index + 1} of ${again.length}`));
        check = offSurface();
      }
      if (check.failed.size) {
        throw new Error(
          `${operation}: ${check.failed.size} of ${bands.length} rounding bands did not take ` +
            `(surface off by up to ${check.worst.toExponential(2)} mm); no solid was produced`,
        );
      }
      if (stats) {
        stats.bands += bands.length;
        stats.recut += recut;
        stats.witnesses += witnesses.length;
        stats.maxWitnessErrorMm = Math.max(stats.maxWitnessErrorMm, check.worst);
      }
      return body;
    },
    (result) => [result],
  );
}

/**
 * Rounds the floor of `prism` exactly.
 *
 * `prism` is the pocket section extruded upward from `floorZ`, at least
 * `radius` tall, and `regions` is that same section as line/arc chains.
 */
export function roundBottomExact(
  c: CadContext,
  prism: CadShape,
  regions: readonly SectionRegion[],
  floorZ: number,
  radius: number,
  operation: string,
  stats?: ExactRoundingStats,
  order?: BandOrder,
): CadShape {
  if (!(radius > 0)) return prism;
  return applyBands(
    c,
    prism,
    regions.map((region) => [region.outer, ...region.holes].map(closedRing)),
    { baseZ: floorZ, vertical: 1, radius, baseMargin: FLOOR_MARGIN_MM },
    "cut",
    operation,
    stats,
    order,
  );
}

/**
 * Rounds the bin's top edge over into a pocket mouth, exactly.
 *
 * `cutter` is the pocket cutter, whose walls are vertical for at least
 * `radius` below `surfaceZ`, and `regions` is its section at that height as
 * line/arc chains. The returned cutter also removes the rounded-over edge: at
 * depth `t` below the surface it is wider than the section by the rounding
 * inset at `t`, a full radius at the surface and nothing at depth `radius`.
 *
 * This is the print path's top-edge rule. It is not the modeler's fillet of a
 * widened prism, which cuts a concave cove of the same radius instead.
 */
export function roundMouthExact(
  c: CadContext,
  cutter: CadShape,
  regions: readonly SectionRegion[],
  surfaceZ: number,
  radius: number,
  operation: string,
  stats?: ExactRoundingStats,
  order?: BandOrder,
): CadShape {
  if (!(radius > 0)) return cutter;
  // Reversed, each boundary has the bin's material on its left.
  const materialSide = regions.map((region) =>
    [region.outer, ...region.holes].map((chain) => closedRing(reverseChain(chain))),
  );
  return applyBands(
    c,
    cutter,
    materialSide,
    { baseZ: surfaceZ, vertical: -1, radius, baseMargin: SURFACE_MARGIN_MM },
    "fuse",
    operation,
    stats,
    order,
  );
}

/** A stretch of wall whose top edge is to be rounded over, on its own. */
export interface WallRun {
  /** The wall, in order, with the bin's material on its left. It need not close. */
  chain: ArcChain;
  /**
   * Fans to add where the rounding turns a sharp corner, including at either
   * end of the run when the wall carries on in a direction this run omits.
   */
  corners: readonly InsideCorner[];
}

/**
 * Rounds the bin's top edge over along separate runs of wall, exactly, by the
 * same rule as {@link roundMouthExact}. Use it when only part of a mouth has a
 * vertical wall to round: a flat-ended scoop's end walls, say, whose sides
 * carry their rounding in their own profile.
 */
export function roundMouthRunsExact(
  c: CadContext,
  cutter: CadShape,
  runs: readonly WallRun[],
  surfaceZ: number,
  radius: number,
  operation: string,
  stats?: ExactRoundingStats,
): CadShape {
  if (!(radius > 0) || !runs.length) return cutter;
  return applyBands(
    c,
    cutter,
    // Runs do not bound one region together, so each is checked on its own.
    runs.map((run) => [{ chain: run.chain, corners: run.corners }]),
    { baseZ: surfaceZ, vertical: -1, radius, baseMargin: SURFACE_MARGIN_MM },
    "fuse",
    operation,
    stats,
  );
}
