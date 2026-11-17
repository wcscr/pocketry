import type { TopoDS_Face, TopoDS_Wire } from "replicad-opencascadejs";

import {
  chainSignedArea,
  mergeChain,
  pointAlong,
  reverseChain,
  reverseElement,
  type ArcChain,
  type ChainElement,
} from "@shared/geometry/arc-chain";
import type { Point } from "@shared/geometry/types";

import { CadContext, type CadShape } from "./adapter";

/**
 * Pocket sections as line/arc chains, and their conversion to and from kernel
 * faces. A section is the pocket's horizontal outline after clearance and
 * corner rounding; the kernel carries it as a 1 mm slab with its base on
 * z = 0 (see `pocketSection`).
 */

/** One connected region of a section: its outer boundary and any holes. */
export interface SectionRegion {
  /** Positive signed area; the region lies on its left. */
  outer: ArcChain;
  /** Negative signed area each; the region lies on their left as well. */
  holes: ArcChain[];
}

/** Ends closer than this are the same vertex when edges are ordered into loops. */
const JOIN_TOLERANCE_MM = 1e-6;
/** A sweep within this of a full turn is built as a whole circle. */
const FULL_TURN_SLACK = 1e-9;

/** Builds the closed kernel wire for a chain at height `z`. */
export function chainWire(c: CadContext, chain: ArcChain, z = 0): TopoDS_Wire {
  return c.scope(
    () => {
      const builder = c.own(new c.oc.BRepBuilderAPI_MakeWire());
      for (const element of chain) {
        if (element.kind === "line") {
          builder.Add(c.line({ ...element.a, z }, { ...element.b, z }));
        } else if (Math.abs(element.sweep) >= 2 * Math.PI - FULL_TURN_SLACK) {
          // The axis direction sets the winding: a hole's circle runs clockwise.
          const axes = c.own(
            new c.oc.gp_Ax2(
              c.point(element.center.x, element.center.y, z),
              c.own(new c.oc.gp_Dir(0, 0, Math.sign(element.sweep))),
            ),
          );
          const circle = c.own(new c.oc.gp_Circ(axes, element.radius));
          builder.Add(c.own(c.own(new c.oc.BRepBuilderAPI_MakeEdge(circle)).Edge()));
        } else {
          // Three points fix the arc without any axis or sense convention.
          const middle = pointAlong(element, 0.5);
          const arc = c.own(
            new c.oc.GC_MakeArcOfCircle(
              c.point(element.a.x, element.a.y, z),
              c.point(middle.x, middle.y, z),
              c.point(element.b.x, element.b.y, z),
            ),
          );
          const edge = c.own(new c.oc.BRepBuilderAPI_MakeEdge(c.own(arc.Value())));
          if (!edge.IsDone()) throw new Error("Cannot construct a section arc");
          builder.Add(c.own(edge.Edge()));
        }
        if (!builder.IsDone()) throw new Error("Section boundary does not form one closed loop");
      }
      return c.own(builder.Wire());
    },
    (wire) => [wire],
  );
}

/** Builds the planar kernel face for one region at height `z`. */
export function regionFace(c: CadContext, region: SectionRegion, z = 0): TopoDS_Face {
  return c.scope(
    () => {
      const builder = c.own(
        new c.oc.BRepBuilderAPI_MakeFace(chainWire(c, region.outer, z), true),
      );
      for (const hole of region.holes) builder.Add(chainWire(c, hole, z));
      if (!builder.IsDone()) throw new Error("Cannot construct a section region with its holes");
      return c.own(builder.Face());
    },
    (face) => [face],
  );
}

/** The 1 mm section slab (z = 0 to 1) the pocket construction extrudes from. */
export function sectionSlab(c: CadContext, regions: readonly SectionRegion[]): CadShape {
  if (!regions.length) throw new Error("Section has no regions");
  return regions
    .map((region) => c.prism(regionFace(c, region), { x: 0, y: 0, z: 1 }))
    .reduce((joined, next) => c.boolean("fuse", joined, next, "section regions"));
}

/**
 * Reads one boundary edge as a chain element, in the direction of the edge's
 * own parameter. Returns `null` for anything other than a line or a circle.
 */
function readEdge(c: CadContext, edge: CadShape): ChainElement | null {
  const oc = c.oc;
  const adaptor = c.own(new oc.BRepAdaptor_Curve(c.own(oc.TopoDS.Edge(edge))));
  const first = adaptor.FirstParameter();
  const last = adaptor.LastParameter();
  const at = (parameter: number): Point => {
    const value = c.own(adaptor.Value(parameter));
    return { x: value.X(), y: value.Y() };
  };
  const a = at(first);
  const b = at(last);
  const type = adaptor.GetType();
  if (type === oc.GeomAbs_CurveType.GeomAbs_Line) return { kind: "line", a, b };
  if (type !== oc.GeomAbs_CurveType.GeomAbs_Circle) return null;
  const circle = c.own(adaptor.Circle());
  const location = c.own(circle.Location());
  const center = { x: location.X(), y: location.Y() };
  // A quarter of the way along stays within a half turn of the start even for
  // a full circle, so the cross product gives the turning sense.
  const quarter = at(first + (last - first) / 4);
  const turn =
    (a.x - center.x) * (quarter.y - center.y) - (a.y - center.y) * (quarter.x - center.x);
  return {
    kind: "arc",
    a,
    b,
    center,
    radius: circle.Radius(),
    sweep: Math.sign(turn) * Math.abs(last - first),
  };
}

/** Orders loose boundary elements into one closed loop by matching their ends. */
function orderLoop(elements: ChainElement[]): ArcChain {
  const loose = elements.slice();
  const loop: ArcChain = [loose.shift()!];
  const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < JOIN_TOLERANCE_MM;
  while (loose.length) {
    const end = loop[loop.length - 1].b;
    let index = loose.findIndex((element) => near(element.a, end));
    let reversed = false;
    if (index < 0) {
      index = loose.findIndex((element) => near(element.b, end));
      reversed = true;
    }
    if (index < 0) throw new Error("Section boundary edges do not form a closed loop");
    const [next] = loose.splice(index, 1);
    loop.push(reversed ? reverseElement(next) : next);
  }
  return loop;
}

/**
 * Reads the base of a vertical extrusion back as line/arc chains: the planar,
 * horizontal faces of `solid` at height `z` (0 for a section slab).
 *
 * Returns `null` when any boundary edge is neither a line nor a circle (an
 * ellipse, say), so the caller can keep its existing construction for that
 * section. This build of the kernel has no wire explorer, so edges are ordered
 * here by their end points.
 */
export function readSectionRegions(c: CadContext, solid: CadShape, z = 0): SectionRegion[] | null {
  return c.scope(() => {
    const oc = c.oc;
    const regions: SectionRegion[] = [];
    for (const shape of c.subshapes(solid, "face")) {
      const face = c.own(oc.TopoDS.Face(shape));
      const surface = c.own(new oc.BRepAdaptor_Surface(face, true));
      if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) continue;
      const plane = c.own(surface.Plane());
      const normal = c.own(c.own(plane.Axis()).Direction());
      const location = c.own(plane.Location());
      // Only the base: horizontal and at the requested height.
      if (Math.abs(location.Z() - z) > 1e-8 || Math.abs(Math.abs(normal.Z()) - 1) > 1e-10) continue;

      const loops: { chain: ArcChain; area: number }[] = [];
      for (const wire of c.subshapes(face, "wire")) {
        const elements: ChainElement[] = [];
        for (const edge of c.subshapes(wire, "edge")) {
          const element = readEdge(c, edge);
          if (!element) return null;
          elements.push(element);
        }
        const chain = mergeChain(orderLoop(elements));
        loops.push({ chain, area: chainSignedArea(chain) });
      }
      if (!loops.length) continue;
      // The largest loop bounds the region; the others are holes inside it.
      loops.sort((p, q) => Math.abs(q.area) - Math.abs(p.area));
      const [outer, ...holes] = loops;
      regions.push({
        outer: outer.area > 0 ? outer.chain : reverseChain(outer.chain),
        holes: holes.map((hole) => (hole.area < 0 ? hole.chain : reverseChain(hole.chain))),
      });
    }
    return regions;
  });
}
