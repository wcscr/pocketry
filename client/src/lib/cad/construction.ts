import type { TopoDS_Face } from "replicad-opencascadejs";
import type { Vec3 } from "@shared/gridfinity/object-pose";
import { CadContext, type CadShape } from "./adapter";
import type { CadPocket } from "./model";
import { pocketSection, extrudeSection, offsetSection, roundPocketBottom } from "./profile-operations";
import { cadInsertionEnvelope } from "./insertion";

export function halfSpace(c: CadContext, normal: Vec3, point: Vec3): CadShape {
  const plane=c.own(new c.oc.gp_Pln(c.point(point.x,point.y,point.z),c.own(new c.oc.gp_Dir(normal.x,normal.y,normal.z))));
  const face=c.own(c.own(new c.oc.BRepBuilderAPI_MakeFace(plane)).Face());
  return c.own(c.own(new c.oc.BRepPrimAPI_MakeHalfSpace(face,c.point(point.x+normal.x,point.y+normal.y,point.z+normal.z))).Solid());
}
export function clipAbove(c: CadContext, shape: CadShape, floor: number, operation: string): CadShape {
  return c.boolean("common",shape,halfSpace(c,{x:0,y:0,z:1},{x:0,y:0,z:floor}),operation,true);
}
export function clipBelow(c: CadContext, shape: CadShape, ceiling: number, operation: string): CadShape {
  return c.boolean("common",shape,halfSpace(c,{x:0,y:0,z:-1},{x:0,y:0,z:ceiling}),operation,true);
}
function splitSeat(c:CadContext,shape:CadShape,p:CadPocket,index:number):CadShape {
  if(!p.split)return shape;
  const [a,b]=p.split.boundary,sign=(p.split.mirrored?-1:1)*(index===0?1:-1);
  const length=Math.hypot(b.x-a.x,b.y-a.y),normal={x:-(b.y-a.y)/length*sign,y:(b.x-a.x)/length*sign,z:0};
  return c.boolean("common",shape,halfSpace(c,normal,{...a,z:0}),"split seat boundary");
}
function rotate(c:CadContext,shape:CadShape,p:CadPocket):CadShape {
  return c.rotate(c.rotate(c.rotate(shape,{x:1,y:0,z:0},p.rotation.xDeg),{x:0,y:1,z:0},p.rotation.yDeg),{x:0,y:0,z:1},p.rotation.zDeg);
}

export function planarSection(c: CadContext, shape: CadShape, z: number): CadShape | undefined {
  const plane=c.own(new c.oc.gp_Pln(c.point(0,0,z),c.own(new c.oc.gp_Dir(0,0,1))));
  const face=c.own(c.own(new c.oc.BRepBuilderAPI_MakeFace(plane)).Face());
  for(const tolerance of [0.000001,0.00001]) {
    const common=c.own(new c.oc.BRepAlgoAPI_Common());
    const args=c.own(new c.oc.NCollection_List_TopoDS_Shape()),tools=c.own(new c.oc.NCollection_List_TopoDS_Shape());c.own(args.Append(shape));c.own(tools.Append(face));
    common.SetArguments(args);common.SetTools(tools);common.SetFuzzyValue(tolerance);common.SetRunParallel(false);common.Build(c.own(new c.oc.Message_ProgressRange()));
    if(!common.IsDone()||common.HasErrors())continue;
    const result=c.own(common.Shape()),faces=c.subshapes(result,"face");
    if(!faces.length)return undefined;
    const solids=faces.map(f=>c.move(c.prism(c.own(c.oc.TopoDS.Face(f)),{x:0,y:0,z:1}),{x:0,y:0,z:-z}));
    const section=solids.reduce((a,b)=>c.boolean("fuse",a,b,"planar mouth islands"));
    if(c.valid(section))return section;
  }
  throw new Error("Mouth intersection with the bin surface failed");
}

export function mouthFlare(c:CadContext,cutter:CadShape,fillZ:number,top:number,radius:number):CadShape {
  if(!radius)return cutter;
  const mouth=planarSection(c,cutter,fillZ);
  if(!mouth)return cutter; // Submerged finite objects have no surface mouth.
  const expanded=offsetSection(c,mouth,radius);
  const flare=roundPocketBottom(c,extrudeSection(c,expanded,fillZ-radius,Math.max(top,fillZ+radius)),fillZ-radius,radius,"pocket mouth rounding");
  return c.boolean("fuse",cutter,flare,"pocket mouth rounding");
}

export interface CadPocketBodies { source:CadShape; cutter?:CadShape; status:"active"|"inactive"; reason?:string; floorBand?:CadShape }
export function buildCadPocket(c:CadContext,p:CadPocket,fillZ:number,binTop:number,floorThickness?:number):CadPocketBodies {
  return c.scope(() => {
  c.guard(`${p.name}: profile`);
  const section=pocketSection(c,p.profiles,p.clearanceMm,p.cornerRoundMm);
  const localTop=p.rigid?0:fillZ;
  const shallow=p.sourceBottoms.reduce((best,v,i)=>v>p.sourceBottoms[best]?i:best,0);
  const localSeats=p.sourceBottoms.map((bottom,i)=>{
    const radius=Math.min(p.bottomFilletMm,p.depths[i]/2);
    let shape=roundPocketBottom(c,extrudeSection(c,section,bottom,localTop),bottom,radius);
    // The shallow source extends across the opening; the deep seat is trimmed.
    if(p.split&&i!==shallow)shape=splitSeat(c,shape,p,i);
    return shape;
  });
  const localSource=localSeats.reduce((a,b)=>c.boolean("fuse",a,b,`${p.name}: finite source seats`));
  const rotated=rotate(c,localSource,p),anchor=c.bounds(rotated).min.z;
  const translation={...p.position,z:p.rigid?p.elevationMm-anchor:0};
  const pose=(s:CadShape)=>c.move(rotate(c,s,p),translation);
  const source=c.move(rotated,translation);
  if(c.bounds(source).min.z>=binTop-0.000001)return {source,status:"inactive",reason:"Source is entirely above the bin; no cutter solid is created"};
  const seatCutters=localSeats.map((localSeat,i)=>{
    let cutter:CadShape;
    if(p.insertionMode==="axis"&&p.insertion&&p.rotation.xDeg%360>-90&&p.rotation.xDeg%360<90&&p.rotation.yDeg%360>-90&&p.rotation.yDeg%360<90) {
      // For this authored extrusion every lower rounded section is nested in
      // its top profile. The axial translation envelope extends the top cap.
      // This proof also holds for the joined split seats; no pose sampling.
      const posed=pose(localSeat),bounds=c.bounds(posed);
      const travel=(Math.max(binTop+1,bounds.max.z+1)-bounds.min.z)/p.insertion.z;
      const extension=extrudeSection(c,section,localTop,localTop+travel);
      cutter=c.boolean("fuse",posed,pose(extension),`${p.name}: exact axial insertion cap`);
    }else if(p.insertion) {
      const posed=pose(localSeat),bounds=c.bounds(posed),distance=(Math.max(binTop+1,bounds.max.z+1)-bounds.min.z)/p.insertion.z;
      cutter=cadInsertionEnvelope(c,posed,{x:p.insertion.x*distance,y:p.insertion.y*distance,z:p.insertion.z*distance});
    }else if(p.rigid)cutter=pose(localSeat);
    else {
      const extended=roundPocketBottom(c,extrudeSection(c,section,p.sourceBottoms[i],binTop+1),p.sourceBottoms[i],Math.min(p.bottomFilletMm,p.depths[i]/2));
      cutter=pose(p.split&&i!==shallow?splitSeat(c,extended,p,i):extended);
    }
    const floor=p.floors[i];
    if(floor!==null)cutter=clipAbove(c,cutter,floor,`${p.name}: protected floor`);
    return cutter;
  });
  let cutter=seatCutters.reduce((a,b)=>c.boolean("fuse",a,b,`${p.name}: cutter seats`,true));
  cutter=clipBelow(c,cutter,binTop+1,`${p.name}: cutter ceiling`);
  if(!c.subshapes(cutter,"solid").length)return {source,status:"inactive",reason:"Floor and ceiling constraints leave no cutting volume"};
  let floorBand:CadShape|undefined;
  if(floorThickness&&floorThickness>0) {
    const lowered=c.move(cutter,{x:0,y:0,z:-floorThickness});
    floorBand=c.boolean("cut",lowered,cutter,`${p.name}: floor material region`,true);
  }
  const radius=Math.min(p.topFilletMm,...p.depths.map(d=>d/2),Math.max(0,fillZ-c.bounds(cutter).min.z)/2);
  cutter=mouthFlare(c,cutter,fillZ,binTop+1,radius);
  return {source,cutter,status:"active",floorBand};
  }, result => [result.source, ...result.cutter ? [result.cutter] : [], ...result.floorBand ? [result.floorBand] : []]);
}
