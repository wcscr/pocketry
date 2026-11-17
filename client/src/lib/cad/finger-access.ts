import { effectiveFingerHoleDepthMm, effectiveFingerHoleTopFilletMm, effectiveFingerHoleBottomFilletMm, effectiveFingerHoleCornerRoundMm,
  isElongatedFingerHole, hasFlatFingerHoleBottom, hasFlatFingerHoleEnds, elongatedFingerHoleEndpoints, flatEndedScoopRadiusMm, type FingerHole } from "@shared/gridfinity/cutout";
import { fingerAccessRimGeometry } from "@/lib/gridfinity/finger-access-rounding";
import type { TopoDS_Face } from "replicad-opencascadejs";
import { CadContext, type CadShape, type CadProfile } from "./adapter";
import { clipBelow, clipAbove, mouthFlare, planarSection } from "./construction";
import { roundMouthExact, roundMouthRunsExact, type WallRun } from "./exact-rounding";
import { extrudeSection, roundPocketBottom } from "./profile-operations";

/** The print path's rim figures for a scoop: scoop circle, rim circle, and where they touch. */
type ScoopRim = ReturnType<typeof fingerAccessRimGeometry>;

/**
 * Cross-section of a shallow rounded scoop, as the print path defines it
 * (`fingerAccessRimGeometry`): the scoop's circular bottom runs up to where the
 * rim circle touches it, and the rim circle carries on to the top surface. No
 * part of the wall is vertical, so this is not a shaft with a mouth flare.
 *
 * Coordinates are [distance from the centerline, height above the top surface].
 */
function scoopProfile(rim: ScoopRim) {
  const { radius, centerZ, rimRadius, openingHalfWidth: opening, tangentHalfWidth, tangentZ, depth } = rim;
  // Halfway round the scoop circle from its lowest point to the tangent point.
  const scoopAngle = Math.atan2(tangentHalfWidth, centerZ - tangentZ) / 2;
  // Halfway round the rim circle from the tangent point to the surface.
  const rimAngle = (Math.atan2(tangentZ + rimRadius, tangentHalfWidth - opening) + Math.PI / 2) / 2;
  return {
    opening,
    bottom: [0, -depth] as const,
    scoopMiddle: [radius * Math.sin(scoopAngle), centerZ - radius * Math.cos(scoopAngle)] as const,
    tangent: [tangentHalfWidth, tangentZ] as const,
    rimMiddle: [opening + rimRadius * Math.cos(rimAngle), -rimRadius + rimRadius * Math.sin(rimAngle)] as const,
    mouth: [opening, 0] as const,
  };
}

type ProfilePoint = readonly [number, number];
/** One edge of a profile wire: straight to `to`, or an arc to `to` through `through`. */
type ProfileEdge = { to: ProfilePoint; through?: ProfilePoint };

/** A planar face through profile points placed across `direction` from `origin`, at `fillZ`. */
function profileFace(c:CadContext,origin:{x:number;y:number},direction:{x:number;y:number},fillZ:number,start:ProfilePoint,edges:readonly ProfileEdge[]):TopoDS_Face {
  const at=([across,height]:ProfilePoint)=>c.point(origin.x+direction.x*across,origin.y+direction.y*across,fillZ+height);
  const wire=c.own(new c.oc.BRepBuilderAPI_MakeWire());
  let from=start;
  for(const edge of edges){
    if(edge.through){
      const arc=c.own(new c.oc.GC_MakeArcOfCircle(at(from),at(edge.through),at(edge.to)));
      wire.Add(c.own(c.own(new c.oc.BRepBuilderAPI_MakeEdge(c.own(arc.Value()))).Edge()));
    }else wire.Add(c.own(c.own(new c.oc.BRepBuilderAPI_MakeEdge(at(from),at(edge.to))).Edge()));
    from=edge.to;
  }
  if(!wire.IsDone())throw new Error("Finger-access profile did not close");
  const face=c.own(new c.oc.BRepBuilderAPI_MakeFace(c.own(wire.Wire()),true));
  if(!face.IsDone())throw new Error("Finger-access profile is not planar");
  return c.own(face.Face());
}

/** Half of the scoop profile, from the centerline outward, closed up to `top`. */
function halfScoopFace(c:CadContext,rim:ScoopRim,origin:{x:number;y:number},fillZ:number,top:number):TopoDS_Face {
  const p=scoopProfile(rim);
  return profileFace(c,origin,{x:1,y:0},fillZ,p.bottom,[
    {to:p.tangent,through:p.scoopMiddle},{to:p.mouth,through:p.rimMiddle},{to:[p.opening,top]},{to:[0,top]},{to:p.bottom}]);
}

/** The whole scoop profile, side to side across `direction`, closed up to `top`. */
function fullScoopFace(c:CadContext,rim:ScoopRim,origin:{x:number;y:number},direction:{x:number;y:number},fillZ:number,top:number):TopoDS_Face {
  const p=scoopProfile(rim),mirror=([across,height]:ProfilePoint):ProfilePoint=>[-across,height];
  return profileFace(c,origin,direction,fillZ,[-p.opening,top],[
    {to:mirror(p.mouth)},{to:mirror(p.tangent),through:mirror(p.rimMiddle)},{to:p.tangent,through:p.bottom},
    {to:p.mouth,through:p.rimMiddle},{to:[p.opening,top]},{to:[-p.opening,top]}]);
}

/** The scoop profile revolved about the vertical axis through `center`. */
function revolvedScoop(c:CadContext,rim:ScoopRim,center:{x:number;y:number},fillZ:number,top:number):CadShape {
  const axis=c.own(new c.oc.gp_Ax1(c.point(center.x,center.y,0),c.own(new c.oc.gp_Dir(0,0,1))));
  return c.own(c.own(new c.oc.BRepPrimAPI_MakeRevol(halfScoopFace(c,rim,center,fillZ,top),axis,true)).Shape());
}

/**
 * A curved-bottom finger access too shallow for a vertical shaft, with its
 * rounded rim, in the hole's own frame (centered, long axis along x).
 *
 * Round holes revolve the profile. Slots with rounded ends extrude it along
 * the slot and revolve it about each end, as the print path sweeps it along
 * the slot's spine. Flat-ended slots are the extruded profile cut off by end
 * walls whose top edge is rounded over like any vertical wall.
 *
 * One difference from the print path is deliberate. Between the rim's tangent
 * height and one rim radius below the surface, the print mesh blends each plan
 * corner of a flat-ended scoop with an arc that has no simple surface. Here the
 * corner fan keeps its axis, so the corner is at most the rim's outset at that
 * depth sharper: under 0.05 mm, over about 0.3 mm of height, for the samples.
 */
function shallowScoop(c:CadContext,hole:FingerHole,rim:ScoopRim,fillZ:number,top:number):CadShape {
  const length=elongatedFingerHoleEndpoints(hole).lengthMm,height=top-fillZ;
  if(!isElongatedFingerHole(hole))return revolvedScoop(c,rim,{x:0,y:0},fillZ,height);
  if(!hasFlatFingerHoleEnds(hole)){
    const halfSpan=(length-hole.diameterMm)/2;
    const ends=[-halfSpan,halfSpan].map(x=>revolvedScoop(c,rim,{x,y:0},fillZ,height));
    if(!(halfSpan>0.000001))return ends[0];
    const middle=c.prism(fullScoopFace(c,rim,{x:-halfSpan,y:0},{x:0,y:1},fillZ,height),{x:2*halfSpan,y:0,z:0});
    return ends.reduce((joined,end)=>c.boolean("fuse",joined,end,"rounded scoop ends"),middle);
  }
  if(effectiveFingerHoleCornerRoundMm(hole)>0)throw new Error("Shallow flat-ended scoops with rounded plan corners are not supported yet; set the corner rounding to zero or deepen the scoop");
  // Above the height where the rim circle leaves the scoop circle, the whole
  // mouth is a rectangle whose top edge is rounded over: build exactly that.
  // Below it the trough's curved sides take over, stopped by a slab between
  // the two end walls, whose top edges alone are still rounded over, with a
  // fan at each plan corner. The two parts are built separately because the
  // corner fans and the trough's rim touch along a curve above that height,
  // and the modeler cannot intersect two solids that only touch there.
  const half=length/2,side=rim.openingHalfWidth-rim.rimRadius,join=fillZ+rim.tangentZ;
  const rectangle=(y:number)=>[{x:-half,y:-y},{x:half,y:-y},{x:half,y},{x:-half,y}];
  const core=rectangle(side);
  const upper=clipAbove(c,roundMouthExact(c,c.extrude({kind:"polygon",outer:core,holes:[]},join-1,top),
    [{outer:core.map((a,i)=>({kind:"line" as const,a,b:core[(i+1)%core.length]})),holes:[]}],fillZ,rim.rimRadius,"finger-access rim",c.rounding),
    join,"flat-ended scoop rim");

  const reach=half+rim.rimRadius+1;
  const trough=c.prism(fullScoopFace(c,rim,{x:-reach,y:0},{x:0,y:1},fillZ,height),{x:2*reach,y:0,z:0});
  // Wider than the trough, so that no face of one lies on a face of the other.
  const slab=c.extrude({kind:"polygon",outer:rectangle(rim.openingHalfWidth+1),holes:[]},fillZ-rim.depth-1,top);
  const quarter=-Math.PI/2;
  const runs:WallRun[]=[1,-1].map(end=>{
    // Travel each end wall with the bin's material on the left.
    const a={x:end*half,y:end*side},b={x:end*half,y:-end*side};
    return {chain:[{kind:"line",a,b}],corners:[
      {element:0,vertex:a,arriving:{x:end,y:0},turn:quarter},
      {element:0,vertex:b,arriving:{x:0,y:-end},turn:quarter}]};
  });
  const walls=roundMouthRunsExact(c,slab,runs,fillZ,rim.rimRadius,"finger-access end rounding",c.rounding);
  const lower=c.boolean("common",clipBelow(c,trough,join,"flat-ended scoop trough"),clipBelow(c,walls,join,"flat-ended scoop walls"),"flat-ended scoop");
  // Above the surface a finger-access cutter is as wide as its rounded mouth, as in the print path.
  const above=c.extrude({kind:"rounded-rectangle",width:length+2*rim.rimRadius,length:2*rim.openingHalfWidth,radius:rim.rimRadius},fillZ,top);
  return c.boolean("fuse",c.boolean("fuse",lower,upper,"flat-ended scoop rim"),above,"flat-ended scoop mouth");
}

export function buildCadFingerAccess(c:CadContext,hole:FingerHole,fillZ:number,binTop:number,floorThicknessMm=0):{cutter:CadShape;floorBand?:CadShape} {
  const depth=effectiveFingerHoleDepthMm(hole),r=hole.diameterMm/2,elongated=isElongatedFingerHole(hole),flatEnds=hasFlatFingerHoleEnds(hole),flatBottom=hasFlatFingerHoleBottom(hole);
  const length=elongatedFingerHoleEndpoints(hole).lengthMm;
  const profile:CadProfile=!elongated?{kind:"ellipse",rx:r,ry:r}:{kind:"rounded-rectangle",width:length,length:hole.diameterMm,radius:flatEnds?effectiveFingerHoleCornerRoundMm(hole):r};
  const radius=effectiveFingerHoleTopFilletMm(hole);
  // Too shallow for a vertical shaft: the rim is part of the scoop's own profile.
  const rim=fingerAccessRimGeometry(hole,radius),rimInProfile=!flatBottom&&radius>0&&!rim.verticalJoin;
  let cutter:CadShape;
  if(rimInProfile) {
    cutter=shallowScoop(c,hole,rim,fillZ,binTop+1);
    if(!c.valid(cutter))throw new Error("Shallow finger-access scoop is not a valid solid");
  }else if(flatBottom) {
    cutter=roundPocketBottom(c,c.extrude(profile,fillZ-depth,binTop+1),fillZ-depth,effectiveFingerHoleBottomFilletMm(hole));
  }else {
    const sphereR=depth<r?flatEndedScoopRadiusMm(hole):r;
    const centerZ=fillZ-depth+sphereR;
    if(!elongated) {
      const sphere=c.move(c.own(c.own(new c.oc.BRepPrimAPI_MakeSphere(sphereR)).Shape()),{x:0,y:0,z:centerZ});
      const cap=clipBelow(c,sphere,fillZ,"finger scoop surface cap");
      const shaftBottom=Math.min(fillZ,centerZ);
      const mouth=c.extrude(profile,shaftBottom,binTop+1);
      cutter=c.boolean("fuse",cap,mouth,"analytic spherical finger scoop");
    }else {
      const halfSpan=(length-(flatEnds?0:hole.diameterMm))/2;
      let trough=c.own(c.own(new c.oc.BRepPrimAPI_MakeCylinder(sphereR,halfSpan*2)).Shape());
      trough=c.move(c.rotate(trough,{x:0,y:1,z:0},90),{x:-halfSpan,y:0,z:centerZ});
      if(!flatEnds)for(const x of [-halfSpan,halfSpan])trough=c.boolean("fuse",trough,c.move(c.own(c.own(new c.oc.BRepPrimAPI_MakeSphere(sphereR)).Shape()),{x,y:0,z:centerZ}),"rounded scoop ends");
      trough=clipBelow(c,trough,fillZ,"elongated scoop surface cap");
      // Shallow spherical/cylindrical cuts are clipped to the authored mouth.
      const mouth=c.extrude(profile,fillZ-depth,binTop+1);
      trough=c.boolean("common",trough,mouth,"finger scoop mouth width");
      const shaft=c.extrude(profile,Math.min(fillZ,centerZ),binTop+1);
      cutter=c.boolean("fuse",trough,shaft,"analytic elongated scoop");
    }
  }
  const floorBand=floorThicknessMm>0?c.boolean("cut",c.move(cutter,{x:0,y:0,z:-floorThicknessMm}),cutter,"finger-access floor material region",true):undefined;
  if(!rimInProfile&&radius>0) {
    cutter=mouthFlare(c,cutter,fillZ,binTop+1,radius);
    // Above the surface a finger-access cutter is as wide as its rounded mouth, as in the print path.
    const opening=planarSection(c,cutter,fillZ);
    if(opening)cutter=c.boolean("fuse",cutter,extrudeSection(c,opening,fillZ,binTop+1),"finger-access mouth");
  }
  const place=(shape:CadShape)=>c.move(c.rotate(shape,{x:0,y:0,z:1},hole.rotationDeg??0),{...hole.center,z:0});
  return {cutter:place(cutter),floorBand:floorBand?place(floorBand):undefined};
}
