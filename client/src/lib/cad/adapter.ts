import type { OpenCascadeInstance, TopoDS_Shape, TopoDS_Face, TopoDS_Edge, TopoDS_Wire, BRepCheck_Analyzer } from "replicad-opencascadejs";
import type { Point } from "@shared/geometry/types";
import type { Vec3 } from "@shared/gridfinity/object-pose";
import { CadArena, type NativeHandle } from "./arena";

export const CAD_TOLERANCE_MM = 0.000001;
export const CAD_BOOLEAN_RETRY_MM = 0.00001;
export const CAD_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;
export type CadShape = TopoDS_Shape;
export type CadProfile =
  | { kind: "polygon"; outer: Point[]; holes: Point[][] }
  | { kind: "ellipse"; rx: number; ry: number }
  | { kind: "rounded-rectangle"; width: number; length: number; radius: number };

/** A small typed adapter. Modeling receives the runtime, never imports it. */
export class CadContext {
  readonly arena = new CadArena();
  private currentArena = this.arena;
  private validator?: BRepCheck_Analyzer;
  retries = 0;
  peakMemoryBytes = 0;
  maxNativeToleranceMm = 0;
  maxTopologyOccurrences = 0;
  authoredProfileSegments = 0;
  constructor(readonly oc: OpenCascadeInstance, readonly checkpoint: (operation: string) => void = () => {}) {}
  own<T extends { delete(): void }>(value: T): T { return this.currentArena.own(value); }
  /** Only for an owned intermediate that is no longer part of any output. */
  drop(handle: NativeHandle): void { this.currentArena.release(handle).delete(); }
  /** Keep only explicit outputs; borrowed inputs remain in their original scope.
   * Native shapes retain their underlying geometry after builders are deleted. */
  scope<T>(work: () => T, retain: (result: T) => readonly NativeHandle[] = () => []): T {
    const parent = this.currentArena, temporary = new CadArena();
    this.currentArena = temporary;
    try {
      const result = work();
      for (const handle of new Set(retain(result))) {
        if (temporary.has(handle)) parent.own(temporary.release(handle));
      }
      return result;
    } finally { this.currentArena = parent; temporary.dispose(); }
  }
  private scoped<T>(work: () => T, retainShape = false): T {
    return this.scope(work, result => retainShape ? [result as T & NativeHandle] : []);
  }
  point(x: number, y: number, z = 0) { return this.own(new this.oc.gp_Pnt(x, y, z)); }
  vec(x: number, y: number, z: number) { return this.own(new this.oc.gp_Vec(x, y, z)); }
  guard(operation: string): void {
    this.peakMemoryBytes = Math.max(this.peakMemoryBytes, this.oc.wasmMemory.buffer.byteLength);
    if (this.peakMemoryBytes >= CAD_MEMORY_LIMIT_BYTES) throw new Error(`${operation}: CAD memory reached the 512 MiB limit`);
    this.checkpoint(operation);
  }
  line(a: Vec3, b: Vec3): TopoDS_Edge {
    return this.scoped(() => {
    const builder = this.own(new this.oc.BRepBuilderAPI_MakeEdge(this.point(a.x,a.y,a.z), this.point(b.x,b.y,b.z)));
    if (!builder.IsDone()) throw new Error("Cannot construct authored line");
    return this.own(builder.Edge());
    }, true);
  }
  wire(points: readonly Point[], z = 0): TopoDS_Wire {
    return this.scoped(() => {
    const builder = this.own(new this.oc.BRepBuilderAPI_MakeWire());
    points.forEach((a, i) => builder.Add(this.line({ ...a, z }, { ...points[(i+1)%points.length], z })));
    if (!builder.IsDone()) throw new Error("Cannot construct authored ring");
    return this.own(builder.Wire());
    }, true);
  }
  profileWire(profile: CadProfile, z = 0): TopoDS_Wire {
    return this.scoped(() => {
    if (profile.kind === "polygon") return this.wire(profile.outer, z);
    if (profile.kind === "ellipse") {
      const majorX = profile.rx >= profile.ry;
      const axes = this.own(new this.oc.gp_Ax2(this.point(0,0,z), this.own(new this.oc.gp_Dir(0,0,1)), this.own(new this.oc.gp_Dir(majorX ? 1 : 0, majorX ? 0 : 1, 0))));
      const curve = profile.rx === profile.ry
        ? this.own(new this.oc.gp_Circ(axes, profile.rx))
        : this.own(new this.oc.gp_Elips(axes, Math.max(profile.rx, profile.ry), Math.min(profile.rx, profile.ry)));
      const edge = this.own(new this.oc.BRepBuilderAPI_MakeEdge(curve));
      const wire = this.own(new this.oc.BRepBuilderAPI_MakeWire());
      wire.Add(this.own(edge.Edge()));
      return this.own(wire.Wire());
    }
    const { width, length, radius: r } = profile;
    if (r === 0) return this.wire([{x:-width/2,y:-length/2},{x:width/2,y:-length/2},{x:width/2,y:length/2},{x:-width/2,y:length/2}],z);
    if (!(r > 0 && r <= Math.min(width,length)/2)) throw new Error("Rounded rectangle radius exceeds its profile");
    const builder = this.own(new this.oc.BRepBuilderAPI_MakeWire());
    for (let i = 0; i < 4; i++) {
      const centers = [[width/2-r,-length/2+r],[width/2-r,length/2-r],[-width/2+r,length/2-r],[-width/2+r,-length/2+r]];
      const [x,y] = centers[i];
      const a = (i-1)*Math.PI/2, b = i*Math.PI/2;
      const axes = this.own(new this.oc.gp_Ax2(this.point(x,y,z),this.own(new this.oc.gp_Dir(0,0,1))));
      const circ = this.own(new this.oc.gp_Circ(axes,r));
      const arc = this.own(new this.oc.BRepBuilderAPI_MakeEdge(circ,a,b));
      builder.Add(this.own(arc.Edge()));
      const [nx,ny] = centers[(i+1)%4];
      const p = {x:x+r*Math.cos(b),y:y+r*Math.sin(b),z};
      const q = {x:nx+r*Math.cos(b),y:ny+r*Math.sin(b),z};
      if (Math.hypot(q.x-p.x,q.y-p.y)>CAD_TOLERANCE_MM) builder.Add(this.line(p,q));
    }
    if (!builder.IsDone()) throw new Error("Cannot construct analytic corner arcs");
    return this.own(builder.Wire());
    }, true);
  }
  face(profile: CadProfile, z = 0): TopoDS_Face {
    return this.scoped(() => {
    const builder = this.own(new this.oc.BRepBuilderAPI_MakeFace(this.profileWire(profile,z), true));
    if (profile.kind === "polygon") for (const hole of profile.holes) builder.Add(this.wire(hole,z));
    if (!builder.IsDone()) throw new Error("Cannot construct profile with its interior holes");
    return this.own(builder.Face());
    }, true);
  }
  prism(face: TopoDS_Face, vector: Vec3): CadShape {
    return this.scoped(() => {
    const builder = this.own(new this.oc.BRepPrimAPI_MakePrism(face,this.vec(vector.x,vector.y,vector.z),true,true));
    return this.own(builder.Shape());
    }, true);
  }
  extrude(profile: CadProfile, bottom: number, top: number): CadShape {
    return this.scoped(() => {
    if (!(top > bottom)) throw new Error("Cannot extrude a zero or negative depth");
    return this.prism(this.face(profile,bottom),{x:0,y:0,z:top-bottom});
    }, true);
  }
  move(shape: CadShape, delta: Vec3): CadShape {
    return this.scoped(() => {
    const transform = this.own(new this.oc.gp_Trsf());
    transform.SetTranslation(this.vec(delta.x,delta.y,delta.z));
    return this.own(this.own(new this.oc.BRepBuilderAPI_Transform(shape,transform,true)).Shape());
    }, true);
  }
  rotate(shape: CadShape, axis: Vec3, degrees: number): CadShape {
    if (degrees % 360 === 0) return shape;
    return this.scoped(() => {
    const transform = this.own(new this.oc.gp_Trsf());
    transform.SetRotation(this.own(new this.oc.gp_Ax1(this.point(0,0,0),this.own(new this.oc.gp_Dir(axis.x,axis.y,axis.z)))),degrees*Math.PI/180);
    return this.own(this.own(new this.oc.BRepBuilderAPI_Transform(shape,transform,true)).Shape());
    }, true);
  }
  subshapes(shape: CadShape, kind: "face" | "edge" | "solid" | "shell" | "wire"): CadShape[] {
    const type = this.oc.TopAbs_ShapeEnum[kind === "face" ? "TopAbs_FACE" : kind === "edge" ? "TopAbs_EDGE" : kind === "shell" ? "TopAbs_SHELL" : kind === "wire" ? "TopAbs_WIRE" : "TopAbs_SOLID"];
    const explorer = this.own(new this.oc.TopExp_Explorer(shape,type));
    const result: CadShape[] = [];
    for (; explorer.More(); explorer.Next()) result.push(this.own(explorer.Current()));
    return result;
  }
  volume(shape: CadShape): number {
    return this.scoped(() => {
    const props = this.own(new this.oc.GProp_GProps());
    this.oc.BRepGProp.VolumeProperties(shape,props,false,false,false);
    return props.Mass();
    });
  }
  bounds(shape: CadShape): { min: Vec3; max: Vec3 } {
    return this.scoped(() => {
    const box = this.own(new this.oc.Bnd_Box());
    this.oc.BRepBndLib.AddOptimal(shape,box,false,false);
    box.SetGap(0);
    const min = this.own(box.CornerMin()), max = this.own(box.CornerMax());
    return { min: {x:min.X(),y:min.Y(),z:min.Z()}, max:{x:max.X(),y:max.Y(),z:max.Z()} };
    });
  }
  /** Native modeling can increase boundary tolerances internally. Reject
   * results exceeding the documented retry ceiling instead of healing them. */
  inspectTopology(shape: CadShape): void {
    let count = 0, tolerance = 0;
    for (const kind of ["face", "edge", "vertex"] as const) {
      const explorer = new this.oc.TopExp_Explorer(shape, this.oc.TopAbs_ShapeEnum[kind === "face" ? "TopAbs_FACE" : kind === "edge" ? "TopAbs_EDGE" : "TopAbs_VERTEX"]);
      try {
        for (; explorer.More(); explorer.Next()) {
          if (++count > 100_000) throw new Error("Generated CAD topology exceeds 100,000 boundary occurrences");
          const current = explorer.Current();
          const boundary = kind === "face" ? this.oc.TopoDS.Face(current) : kind === "edge" ? this.oc.TopoDS.Edge(current) : this.oc.TopoDS.Vertex(current);
          try { tolerance = Math.max(tolerance, this.oc.BRep_Tool.Tolerance(boundary)); }
          finally { boundary.delete(); current.delete(); }
        }
      } finally { explorer.delete(); }
    }
    this.maxNativeToleranceMm = Math.max(this.maxNativeToleranceMm, tolerance);
    this.maxTopologyOccurrences = Math.max(this.maxTopologyOccurrences, count);
    if (tolerance > CAD_BOOLEAN_RETRY_MM) throw new Error(`Native boundary tolerance ${tolerance} mm exceeds 0.00001 mm; no geometry repair was applied`);
  }
  valid(shape: CadShape, allowEmpty = false): boolean {
    return this.scoped(() => {
    if (shape.IsNull()) return false;
    const solids = this.subshapes(shape,"solid");
    if (!solids.length) return allowEmpty && Math.abs(this.volume(shape)) < CAD_TOLERANCE_MM;
    // Reuse the exact checker; Init clears the prior shape and its analysis data.
    // Keep it in the context arena, outside each temporary validation scope.
    if (this.validator) this.validator.Init(shape,true);
    else this.validator = this.arena.own(new this.oc.BRepCheck_Analyzer(shape,true,false,true));
    const analyzer = this.validator;
    return analyzer.IsValid() && solids.every(s => this.subshapes(s,"shell").every(shell => this.oc.BRep_Tool.IsClosed(shell)) && this.volume(s) > 0);
    });
  }
  boolean(kind: "cut" | "fuse" | "common", left: CadShape, right: CadShape, operation: string, allowEmpty = false): CadShape {
    return this.scoped(() => {
    this.guard(operation);
    for (const tolerance of [CAD_TOLERANCE_MM,CAD_BOOLEAN_RETRY_MM]) {
      const result = this.scope(() => {
      const builder = this.own(new this.oc[kind === "cut" ? "BRepAlgoAPI_Cut" : kind === "fuse" ? "BRepAlgoAPI_Fuse" : "BRepAlgoAPI_Common"]());
      // Append also returns a separately owned shape value in these bindings.
      const args = this.own(new this.oc.NCollection_List_TopoDS_Shape()); this.own(args.Append(left));
      const tools = this.own(new this.oc.NCollection_List_TopoDS_Shape()); this.own(tools.Append(right));
      builder.SetArguments(args); builder.SetTools(tools); builder.SetFuzzyValue(tolerance);
      builder.SetToFillHistory(false);
      builder.SetRunParallel(false); builder.Build(this.own(new this.oc.Message_ProgressRange()));
      this.guard(operation);
      return builder.IsDone() && !builder.HasErrors() ? this.own(builder.Shape()) : undefined;
      }, shape => shape ? [shape] : []);
      if (result) {
        if (this.valid(result,allowEmpty)) { this.inspectTopology(result); if (tolerance === CAD_BOOLEAN_RETRY_MM) this.retries++; this.guard(operation); return result; }
        this.drop(result);
      }
    }
    throw new Error(`${operation}: ${kind} failed at 0.000001 and 0.00001 mm; no geometry repair was applied`);
    }, true);
  }
  fillet(shape: CadShape, radius: number, edges: readonly CadShape[], operation: string): CadShape {
    if (!radius) return shape;
    return this.scoped(() => {
    this.guard(operation);
    const builder = this.own(new this.oc.BRepFilletAPI_MakeFillet(shape));
    builder.SetParams(0.000001,0.000001,0.000001,0.000001,0.000001,0.000001);
    for (const edge of edges) builder.Add(radius,this.own(this.oc.TopoDS.Edge(edge)));
    builder.Build(this.own(new this.oc.Message_ProgressRange()));
    this.guard(operation);
    if (!builder.IsDone()) throw new Error(`${operation}: the requested ${radius} mm rounding failed`);
    const result = this.own(builder.Shape());
    if (!this.valid(result)) throw new Error(`${operation}: rounding produced an invalid solid`);
    this.inspectTopology(result);
    this.guard(operation);
    return result;
    }, true);
  }
  dispose(): void { this.arena.dispose(); }
}
