import type { TopoDS_Face } from "replicad-opencascadejs";
import { CadContext, type CadShape, type CadProfile } from "./adapter";
import { roundBottomExact } from "./exact-rounding";
import { readSectionRegions, sectionSlab } from "./section-chain";

function baseFaces(c: CadContext, solid: CadShape): TopoDS_Face[] {
  return c.subshapes(solid,"face").filter(f=>{const face=c.own(c.oc.TopoDS.Face(f)),surface=c.own(new c.oc.BRepAdaptor_Surface(face,true));if(surface.GetType()!==c.oc.GeomAbs_SurfaceType.GeomAbs_Plane)return false;const plane=c.own(surface.Plane()),axis=c.own(plane.Axis()),normal=c.own(axis.Direction()),location=c.own(plane.Location());return Math.abs(location.Z())<1e-8&&Math.abs(Math.abs(normal.Z())-1)<1e-10;})
    .map(f=>c.own(c.oc.TopoDS.Face(f.Orientation() === c.oc.TopAbs_Orientation.TopAbs_REVERSED ? c.own(f.Reversed()) : f)));
}

/** Reconstruct offset loops by exact CAD containment. Loop winding is not
 * reliably retained by the published offset binding's face constructor.
 * This handles holes and islands without a bounding-box overlap restriction.
 */
function offsetFace(c: CadContext, face: TopoDS_Face, distance: number): CadShape {
  const offset = c.own(new c.oc.BRepOffsetAPI_MakeOffset(face,c.oc.GeomAbs_JoinType.GeomAbs_Arc,false));
  offset.Perform(distance,0);
  if (!offset.IsDone()) throw new Error(`Profile offset ${distance} mm failed`);
  const result = c.own(offset.Shape());
  const loops = c.subshapes(result,"wire").map(w=>{
    const builder=c.own(new c.oc.BRepBuilderAPI_MakeFace(c.own(c.oc.TopoDS.Wire(w)),true));
    const solid=c.prism(c.own(builder.Face()),{x:0,y:0,z:1});
    return {solid,area:c.volume(solid),depth:0};
  }).sort((a,b)=>b.area-a.area);
  if (!loops.length || loops.some(loop=>!c.valid(loop.solid))) throw new Error(`Profile offset ${distance} mm collapsed or is invalid`);
  for (let i=0;i<loops.length;i++) {
    const child=loops[i];
    for (let j=i-1;j>=0;j--) {
      const parent=loops[j];
      const common=c.boolean("common",child.solid,parent.solid,"offset loop containment",true);
      if (Math.abs(c.volume(common)-child.area)<1e-7) { child.depth=parent.depth+1;break; }
    }
  }
  let section: CadShape | undefined;
  for (const loop of loops) {
    if (!section) section=loop.solid;
    else section=c.boolean(loop.depth%2 ? "cut" : "fuse",section,loop.solid,"offset holes and islands");
  }
  return section!;
}

export function offsetSection(c: CadContext, section: CadShape, distance: number): CadShape {
  if (!distance) return section;
  const solids=baseFaces(c,section).map(face=>offsetFace(c,face,distance));
  if (!solids.length) throw new Error("Profile has no planar construction boundary");
  return solids.reduce((a,b)=>c.boolean("fuse",a,b,"offset outline islands"));
}

export function extrudeSection(c: CadContext, section: CadShape, bottom: number, top: number): CadShape {
  if (!(top>bottom)) throw new Error("Profile extrusion depth is not positive");
  const pieces=baseFaces(c,section).map(face=>c.move(c.prism(face,{x:0,y:0,z:top-bottom}),{x:0,y:0,z:bottom}));
  if (!pieces.length) throw new Error("Profile extrusion lost its boundaries");
  return pieces.reduce((a,b)=>c.boolean("fuse",a,b,"extruded islands"));
}

/**
 * The pocket's planar section as a 1 mm slab on z = 0: the authored outline
 * with clearance, then corner rounding applied as an opening.
 *
 * Traced (polygon) outlines take the same planar offsets as the print path and
 * come back fitted with lines and arcs when a section kernel is available; see
 * `section-kernel.ts`. Analytic profiles, and every profile without that
 * kernel, are offset by the solid modeler.
 */
export function pocketSection(c: CadContext, profiles: readonly CadProfile[], clearance: number, cornerRadius: number): CadShape {
  if (c.sections && profiles.every(profile => profile.kind === "polygon")) {
    const outline = profiles.map(profile => profile.kind === "polygon" ? { outer: profile.outer, holes: profile.holes } : { outer: [], holes: [] });
    const fitted = c.sections.pocketSection(outline, clearance, cornerRadius);
    if (!fitted) throw new Error("Profile offset collapsed: clearance and corner rounding leave no pocket section");
    c.maxSectionDeviationMm = Math.max(c.maxSectionDeviationMm, fitted.maxDeviationMm);
    c.fittedSectionElements += fitted.elements;
    c.guard("fitted pocket section");
    return sectionSlab(c, fitted.regions);
  }
  let section=profiles.map(profile=>c.extrude(profile,0,1)).reduce((a,b)=>c.boolean("fuse",a,b,"authored outlines"));
  section=offsetSection(c,section,clearance);
  if (cornerRadius>0) section=offsetSection(c,offsetSection(c,section,-cornerRadius),cornerRadius);
  return section;
}

/** Relative and absolute slack when a rounded solid is held against the planar kernel's figure. */
const ROUNDING_VOLUME_RELATIVE = 0.005;
const ROUNDING_VOLUME_ABSOLUTE_MM3 = 0.05;

/**
 * Rounds the floor of an upright extrusion whose base is at `bottom`. Round
 * only the perimeter before a split trim, so its seam remains sharp.
 *
 * With a section kernel, a base made of lines and circles is rounded by exact
 * construction of the print path's rule (`exact-rounding.ts`) and the removed
 * volume is cross-checked against the planar kernel. Anything else, such as
 * an elliptical base, keeps the modeler's edge fillet.
 */
export function roundPocketBottom(c: CadContext, source: CadShape, bottom: number, radius: number, operation = "pocket bottom rounding"): CadShape {
  if (!radius) return source;
  const regions = c.sections ? readSectionRegions(c, source, bottom) : null;
  if (c.sections && regions?.length) {
    const rounded = roundBottomExact(c, source, regions, bottom, radius, operation, c.rounding);
    const removed = c.volume(source) - c.volume(rounded), expected = c.sections.roundingVolume(regions, radius);
    if (Math.abs(removed - expected) > ROUNDING_VOLUME_ABSOLUTE_MM3 + ROUNDING_VOLUME_RELATIVE * expected) {
      throw new Error(`${operation}: rounded volume differs from the section rule (${removed.toFixed(3)} mm³ removed, ${expected.toFixed(3)} mm³ expected)`);
    }
    return rounded;
  }
  const edges=c.subshapes(source,"edge").filter(edge=>{const b=c.bounds(edge);return Math.abs(b.min.z-bottom)<=0.000001&&Math.abs(b.max.z-bottom)<=0.000001;});
  return c.fillet(source,radius,edges,operation);
}
