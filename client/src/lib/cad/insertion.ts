import type { Vec3 } from "@shared/gridfinity/object-pose";
import { CadContext, type CadShape } from "./adapter";

/** Continuous translation envelope from boundary faces, never mesh facets.
 * S + [0,v] = S union {F + [0,v] for every boundary face F}.
 * Silhouette edges split curved faces where a sweep would fold over itself.
 * Occlusion is deliberately not computed: every silhouette must be retained.
 */
export function cadInsertionEnvelope(c: CadContext, source: CadShape, vector: Vec3): CadShape {
  if (!(vector.z > 0)) throw new Error("Insertion direction must reach above the bin");
  c.guard("insertion silhouette partition");
  const oc = c.oc;
  const hlr = c.own(new oc.HLRBRep_Algo());
  const axes = c.own(new oc.gp_Ax2(c.point(0,0,0),c.own(new oc.gp_Dir(vector.x,vector.y,vector.z))));
  hlr.Projector(c.own(new oc.HLRAlgo_Projector(axes)));
  hlr.Add(source,0); hlr.Update(); hlr.ShowAll();
  const extractor = c.own(new oc.HLRBRep_HLRToShape(hlr));
  const silhouettes = c.own(extractor.OutLineVCompound3d());
  let boundary: CadShape = source;
  if (!silhouettes.IsNull()) {
    const splitter = c.own(new oc.BRepAlgoAPI_Splitter());
    const args = c.own(new oc.NCollection_List_TopoDS_Shape()); c.own(args.Append(source));
    const tools = c.own(new oc.NCollection_List_TopoDS_Shape());
    for (const edge of c.subshapes(silhouettes,"edge")) c.own(tools.Append(edge));
    splitter.SetArguments(args); splitter.SetTools(tools);
    splitter.SetFuzzyValue(0.000001); splitter.SetRunParallel(false);
    splitter.Build(c.own(new oc.Message_ProgressRange()));
    if (!splitter.IsDone() || splitter.HasErrors()) throw new Error("Insertion silhouette partition failed");
    boundary = c.own(splitter.Shape());
  }
  let result = source;
  for (const [index,shape] of c.subshapes(boundary,"face").entries()) {
    c.guard(`insertion face ${index+1}`);
    const face = c.own(oc.TopoDS.Face(shape));
    const surface = c.own(new oc.BRepAdaptor_Surface(face,true));
    if (surface.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
      const normal = c.own(c.own(c.own(surface.Plane()).Axis()).Direction());
      // A parallel planar face sweeps no volume; excluding it changes no solid.
      if (Math.abs(normal.X()*vector.x+normal.Y()*vector.y+normal.Z()*vector.z) < 1e-12) continue;
    }
    let swept = c.prism(face,vector);
    const volume = c.volume(swept);
    if (Math.abs(volume) < 1e-12) {
      // Only exact extrusion surfaces parallel to their native axis are zero.
      if (surface.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
        const axis = c.own(c.own(c.own(surface.Cylinder()).Axis()).Direction());
        const cross = Math.hypot(axis.Y()*vector.z-axis.Z()*vector.y,axis.Z()*vector.x-axis.X()*vector.z,axis.X()*vector.y-axis.Y()*vector.x);
        if (cross < 1e-12) continue;
      }
      throw new Error(`Insertion face ${index+1}: unresolved degenerate boundary sweep`);
    }
    if (volume < 0) continue;
    if (!c.valid(swept)) throw new Error(`Insertion face ${index+1}: curved boundary sweep is not a valid solid`);
    result = c.boolean("fuse",result,swept,`insertion envelope face ${index+1}`);
  }
  if (!c.valid(result)) throw new Error("Insertion envelope is not a valid solid");
  return result;
}
