import type { Point } from "@shared/geometry/types";
import type { TopoDS_Face, TopoDS_Wire } from "replicad-opencascadejs";
import { CadContext, type CadShape } from "./adapter";

export type CadCurve =
  | { kind: "line"; start: Point; end: Point }
  | { kind: "arc"; start: Point; middle: Point; end: Point }
  | { kind: "bezier"; poles: Point[] };

/** Curves are authored geometry. No tessellation enters this interface. */
export function curveWire(c: CadContext, curves: readonly CadCurve[], z = 0, radial = false): TopoDS_Wire {
  const wire = c.own(new c.oc.BRepBuilderAPI_MakeWire());
  const p = (point: Point) => radial ? c.point(point.x,0,point.y) : c.point(point.x,point.y,z);
  for (const curve of curves) {
    if (curve.kind === "line") {
      const edge = c.own(new c.oc.BRepBuilderAPI_MakeEdge(p(curve.start),p(curve.end))); wire.Add(c.own(edge.Edge()));
    } else if (curve.kind === "arc") {
      const arc = c.own(c.own(new c.oc.GC_MakeArcOfCircle(p(curve.start),p(curve.middle),p(curve.end))).Value());
      const edge = c.own(new c.oc.BRepBuilderAPI_MakeEdge(arc)); wire.Add(c.own(edge.Edge()));
    } else {
      const poles = c.own(new c.oc.NCollection_Array1_gp_Pnt(1,curve.poles.length));
      curve.poles.forEach((point,index)=>poles.SetValue(index+1,p(point)));
      const bezier = c.own(new c.oc.Geom_BezierCurve(poles));
      const edge = c.own(new c.oc.BRepBuilderAPI_MakeEdge(bezier)); wire.Add(c.own(edge.Edge()));
    }
  }
  if (!wire.IsDone()) throw new Error("Cannot construct the authored curve boundary");
  return c.own(wire.Wire());
}

export function curvesFace(c: CadContext, outer: readonly CadCurve[], holes: readonly CadCurve[][] = [], z = 0, radial = false): TopoDS_Face {
  const builder = c.own(new c.oc.BRepBuilderAPI_MakeFace(curveWire(c,outer,z,radial),true));
  for (const hole of holes) builder.Add(curveWire(c,hole,z,radial));
  if (!builder.IsDone()) throw new Error("Cannot construct authored curve profile with holes");
  return c.own(builder.Face());
}

export function polygonCurves(points: readonly Point[]): CadCurve[] {
  return points.map((point,index)=>({kind:"line",start:point,end:points[(index+1)%points.length]}));
}

/** Same straight/revolved decomposition as the printing kernel, with true arcs. */
export function sweepRectangularProfile(c: CadContext, profile: readonly CadCurve[], width: number, length: number): CadShape {
  if (!(width > 0 && length > 0)) throw new Error("Sweep path must have positive dimensions");
  const face = curvesFace(c,profile,[],0,true);
  const quarter = c.own(c.own(new c.oc.BRepPrimAPI_MakeRevol(face,c.own(new c.oc.gp_Ax1(c.point(0,0,0),c.own(new c.oc.gp_Dir(0,0,1)))),Math.PI/2,true)).Shape());
  const pieces: CadShape[] = [];
  const corners = [[width/2,length/2],[-width/2,length/2],[-width/2,-length/2],[width/2,-length/2]];
  corners.forEach(([x,y],i)=>pieces.push(c.move(c.rotate(quarter,{x:0,y:0,z:1},i*90),{x,y,z:0})));
  // Canonical +Y extrusion, rotated around Z with its outward radial normal.
  const walks = [
    {height:length,rot:0,x:width/2,y:-length/2},
    {height:width,rot:90,x:width/2,y:length/2},
    {height:length,rot:180,x:-width/2,y:length/2},
    {height:width,rot:270,x:-width/2,y:-length/2},
  ];
  for (const edge of walks) pieces.push(c.move(c.rotate(c.prism(face,{x:0,y:edge.height,z:0}),{x:0,y:0,z:1},edge.rot),{x:edge.x,y:edge.y,z:0}));
  return pieces.reduce((a,b)=>c.boolean("fuse",a,b,"analytic profile sweep"));
}
