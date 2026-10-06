import type { Vec3 } from "@shared/gridfinity/object-pose";
import { BASE_HEIGHT } from "@shared/gridfinity/standard";
import { surfaceTextName } from "@shared/gridfinity/surface-text";
import { surfaceTextZ } from "@/lib/gridfinity/surface-text";
import { CadContext, type CadShape } from "./adapter";
import type { CadDesign } from "./model";
import { buildCadBinBlank, footprintPrism, cadWallInteriorSection } from "./bin";
import { buildCadPocket, clipAbove, clipBelow } from "./construction";
import { buildCadFingerAccess } from "./finger-access";
import { buildCadText } from "./text";
import { extrudeSection } from "./profile-operations";
import type { NamedCadBody } from "./step";

export interface CadObject extends Omit<NamedCadBody,"shape"> {
  shape?:CadShape;role:"bin-blank"|"pocket-source"|"pocket-cutter"|"finger-access-tool"|"text-body";
  sourceId?:string;shapeId?:string;status:"active"|"inactive";reason?:string;
  transform?:{rotation:{xDeg:number;yDeg:number;zDeg:number};position:{x:number;y:number};elevationMm:number};
  designLink?:unknown;order:number;
}
export interface CadMaterialOptions {floorThicknessMm?:number;rimThicknessMm?:number;borderWidthMm?:number}
export interface BuiltCadDesign {
  solid:CadShape;body:CadShape;finished:NamedCadBody[];objects:CadObject[];
  materials?:{body:CadShape;pocketFloors?:CadShape;stackingRim?:CadShape};
  textParts:{label:CadDesign["spec"]["surfaceTexts"][number];shape:CadShape;z:number}[];
}
const nonempty=(c:CadContext,s:CadShape)=>c.subshapes(s,"solid").length>0;

export function buildCadDesign(c:CadContext,design:CadDesign,materials:CadMaterialOptions={},progress:(phase:string)=>void=()=>{}):BuiltCadDesign {
  const spec=design.spec,objects:CadObject[]=[],floorRegions:CadShape[]=[];
  const add=(object:Omit<CadObject,"order">)=>objects.push({...object,order:objects.length});
  progress("Building bin blank");const {blank,lip,interior}=buildCadBinBlank(c,spec);
  add({id:"bin-blank",name:"Bin blank",role:"bin-blank",status:"active",shape:blank});
  let body=blank;
  for(const pocket of design.pockets) {
    progress(`Building ${pocket.name}`);
    try {
      const built=buildCadPocket(c,pocket,design.dimensions.fillZ,design.dimensions.topZ,materials.floorThicknessMm);
      add({id:`source:${pocket.id}`,sourceId:pocket.id,shapeId:pocket.shapeId,name:pocket.name,role:"pocket-source",shape:built.source,status:"active",designLink:pocket.designLink,
        transform:{rotation:pocket.rotation,position:pocket.position,elevationMm:pocket.elevationMm}});
      let active=built.status==="active"&&Boolean(built.cutter);
      if(active) {
        const overlap=c.boolean("common",blank,built.cutter!,`${pocket.name}: cutting-volume intersection`,true);
        active=nonempty(c,overlap);
      }
      add({id:`cutter:${pocket.id}`,sourceId:pocket.id,shapeId:pocket.shapeId,name:`${pocket.name} — cutter`,role:"pocket-cutter",shape:active?built.cutter:undefined,
        status:active?"active":"inactive",reason:active?undefined:built.reason??"Cutter does not intersect the bin blank",designLink:pocket.designLink});
      if(active) {
        body=c.boolean("cut",body,built.cutter!,`${pocket.name}: subtract actual cutter`,true);
        if(built.floorBand)floorRegions.push(built.floorBand);
      }
    }catch(error){throw new Error(`${pocket.name} (${pocket.id}): ${error instanceof Error?error.message:String(error)}`);}
  }
  for(const hole of design.fingerHoles) {
    const name=hole.name??`Finger access ${hole.id}`;progress(`Building ${name}`);
    try {
      const shape=buildCadFingerAccess(c,hole,design.dimensions.fillZ,design.dimensions.topZ);
      add({id:`finger:${hole.id}`,sourceId:hole.id,name,role:"finger-access-tool",status:"active",shape,designLink:hole.designLink});
      body=c.boolean("cut",body,shape,`${name}: subtract finger-access tool`,true);
    }catch(error){throw new Error(`${name} (${hole.id}): ${error instanceof Error?error.message:String(error)}`);}
  }
  if(!nonempty(c,body)||!c.valid(body))throw new Error("The finished bin is empty or invalid; no STEP package can be created");
  progress("Separating material volumes");
  let pocketFloors:CadShape|undefined,stackingRim:CadShape|undefined;
  if(spec.fill==="none"&&materials.floorThicknessMm&&interior) {
    const section=cadWallInteriorSection(c,spec);
    if(section)floorRegions.push(extrudeSection(c,section,BASE_HEIGHT-materials.floorThicknessMm,BASE_HEIGHT));
  }
  if(floorRegions.length) {
    const requested=floorRegions.reduce((a,b)=>c.boolean("fuse",a,b,"floor material regions",true));
    const clipped=c.boolean("common",requested,body,"floor material partition",true);
    if(nonempty(c,clipped))pocketFloors=clipped;
  }
  if(materials.rimThicknessMm) {
    const bottom=design.dimensions.topZ-materials.rimThicknessMm;
    let requested=lip??body;
    requested=clipAbove(c,requested,bottom,"rim material band");
    if(!lip) {
      const inner=cadWallInteriorSection(c,spec,materials.borderWidthMm??0.95);
      if(inner)requested=c.boolean("cut",requested,extrudeSection(c,inner,bottom-1,design.dimensions.topZ+1),"flush rim border",true);
    }
    let clipped=c.boolean("common",requested,body,"rim material partition",true);
    if(pocketFloors)clipped=c.boolean("cut",clipped,pocketFloors,"nonoverlapping material partitions",true);
    if(nonempty(c,clipped))stackingRim=clipped;
  }
  let materialBody=body;
  for(const part of [pocketFloors,stackingRim])if(part)materialBody=c.boolean("cut",materialBody,part,"remove accent material from body",true);
  const textParts:BuiltCadDesign["textParts"]=[];
  let solid=body;
  for(const label of spec.surfaceTexts) {
    const name=surfaceTextName(label);progress(`Building text ${name}`);
    try {
      const z=surfaceTextZ(spec),shape=buildCadText(c,label,z);
      const supportTest=c.move(shape,{x:0,y:0,z:-0.001});
      const required=clipBelow(c,supportTest,z,"text support footprint");
      const unsupported=c.boolean("cut",required,body,"text support check",true);
      if(c.volume(unsupported)>0.000001)throw new Error("Text must fit on the flat surface, clear of pockets and openings");
      if(c.volume(c.boolean("common",shape,body,"text wall overlap",true))>0.000001 || textParts.some(other=>c.volume(c.boolean("common",shape,other.shape,"text overlap",true))>0.000001))throw new Error("Text overlaps a wall or another label");
      textParts.push({label,shape,z});
      add({id:`text:${label.id}`,sourceId:label.id,name,role:"text-body",shape,status:"active",color:spec.textColor??undefined});
      solid=c.boolean("fuse",solid,shape,`${name}: attach text`);
    }catch(error){throw new Error(`${name} (${label.id}): ${error instanceof Error?error.message:String(error)}`);}
  }
  progress("Validating closed CAD solids");
  c.guard("final validation");
  const finished:NamedCadBody[]=[{id:"bin",name:"Finished bin",shape:body},...textParts.map(part=>({id:`text:${part.label.id}`,name:surfaceTextName(part.label),shape:part.shape,color:spec.textColor??undefined}))];
  return {solid,body,objects,finished,textParts,materials:pocketFloors||stackingRim?{body:materialBody,pocketFloors,stackingRim}:undefined};
}
