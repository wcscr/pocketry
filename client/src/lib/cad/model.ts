import type { Outline, Point } from "@shared/geometry/types";
import { ensureOrientation } from "@shared/geometry/rings";
import { analyticProfileMatchesOutline } from "@shared/gridfinity/analytic-profile";
import { pocketName, resolvePocketDepth, resolvePlacedPocketDepth, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { pocketInsertionError, pocketInsertionAxis } from "@shared/gridfinity/pocket-insertion";
import { pocketRotation, hasRigidPocket } from "@shared/gridfinity/rigid-pocket";
import { resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import { binFootprintMm, binTotalHeightMm, binHeightMm } from "@shared/gridfinity/standard";
import type { ProjectDoc } from "@shared/gridfinity/project";
import type { ObjectRotation, Vec3 } from "@shared/gridfinity/object-pose";
import type { CadProfile } from "./adapter";

export const CAD_MODEL_VERSION = 1;
export const CAD_LIMITS = { profileSegments:20_000, authoredObjects:200, modelingMs:120_000, topologyEdges:100_000 } as const;
export interface CadIssue { objectId?: string; objectName?: string; operation: string; message: string }
export interface StepExportStatus { supported: boolean; issues: CadIssue[]; profileSegments: number; authoredObjects: number }
export interface CadPocket {
  id: string; name: string; shapeId: string; profiles: CadProfile[];
  rotation: ObjectRotation; position: Point; elevationMm: number; rigid: boolean;
  depths: number[]; floors: (number|null)[]; sourceBottoms: number[];
  split?: { boundary: [Point,Point]; mirrored: boolean };
  clearanceMm: number; cornerRoundMm: number; bottomFilletMm: number; topFilletMm: number;
  insertion?: Vec3; insertionMode?: CutoutPlacement["insertionMode"];
  designLink?: CutoutPlacement["designLink"];
}
export interface CadDesign {
  version: typeof CAD_MODEL_VERSION; units: "mm"; spec: ProjectDoc["spec"];
  dimensions: { widthMm:number; lengthMm:number; rimZ:number; topZ:number; fillZ:number };
  pockets: CadPocket[]; fingerHoles: ProjectDoc["fingerHoles"];
  operations: { objectId:string; operation:string }[];
}

export class CadDesignError extends Error {
  constructor(readonly issues: readonly CadIssue[]) { super(issues.map(i=>`${i.objectName ? `${i.objectName} (${i.objectId}): ` : ""}${i.operation}: ${i.message}`).join("\n"));this.name="CadDesignError"; }
}

const countOutline = (outline: Outline) => outline.reduce((n,s)=>n+s.outer.length+s.holes.reduce((sum,h)=>sum+h.length,0),0);
export function getStepExportStatus(doc: ProjectDoc): StepExportStatus {
  const issues: CadIssue[]=[];
  const shapes=new Map(doc.shapes.map(s=>[s.id,s]));
  let profileSegments=0;
  const authoredObjects=doc.cutouts.length+doc.fingerHoles.length+doc.spec.surfaceTexts.length;
  for (const p of doc.cutouts) {
    const s=shapes.get(p.shapeId);
    const issue=(operation:string,message:string)=>issues.push({objectId:p.id,objectName:pocketName(p,s),operation,message});
    if (!s) { issue("profile","The source shape is missing");continue; }
    profileSegments+=s.analyticProfile ? 4 : countOutline(s.outlineMm);
    if (!analyticProfileMatchesOutline(s)) issue("primitive provenance","Primitive metadata disagrees with the authored boundary");
    const rotation = pocketRotation(p);
    if ((rotation.xDeg || rotation.yDeg) && p.topFilletMm > 0) issue("pocket mouth rounding", "Tilted mouth rounding is unresolved in this investigation; the requested fillet cannot be omitted");
    if ((rotation.xDeg || rotation.yDeg) && !hasRigidPocket(p) && !p.insertionMode) issue("legacy tilted placement", "Legacy tilted placement needs the shared depth anchor before this investigation can support it");
    if (p.profileBottom) issue("profile bottom","Profile-bottom construction is pending the selected backend milestone");
    const insertionError=pocketInsertionError(p);if(insertionError)issue("insertion",insertionError);
    if (p.split) { const split=resolvePocketSplit(s.outlineMm,p.split.boundary);if(split.error)issue("split",split.error); }
  }
  if (doc.spec.labelTab) issues.push({operation:"label tab",message:"Label-tab construction is pending the selected backend milestone"});
  if (doc.spec.magnetHoles||doc.spec.screwHoles) issues.push({operation:"hardware",message:"Hardware tools are pending the selected backend milestone"});
  if (profileSegments>CAD_LIMITS.profileSegments) issues.push({operation:"resource limit",message:`${profileSegments} profile segments exceeds the ${CAD_LIMITS.profileSegments} limit; the boundary will not be simplified`});
  if (authoredObjects>CAD_LIMITS.authoredObjects) issues.push({operation:"resource limit",message:`${authoredObjects} objects exceeds the ${CAD_LIMITS.authoredObjects} limit`});
  return {supported:issues.length===0,issues,profileSegments,authoredObjects};
}

function profiles(shape: TracedShape, p: CutoutPlacement): CadProfile[] {
  const primitive=shape.analyticProfile;
  if (primitive?.kind==="circle") return [{kind:"ellipse",rx:primitive.radiusMm*p.scaleX,ry:primitive.radiusMm*p.scaleY}];
  if (primitive?.kind==="rectangle") return [{kind:"rounded-rectangle",width:primitive.widthMm*p.scaleX,length:primitive.lengthMm*p.scaleY,radius:0}];
  const scale=(ring:Point[],sign:1|-1)=>ensureOrientation(ring.map(v=>({x:v.x*p.scaleX*(p.mirrored?-1:1),y:v.y*p.scaleY})),sign);
  return shape.outlineMm.map(s=>({kind:"polygon",outer:scale(s.outer,1),holes:s.holes.map(h=>scale(h,-1))}));
}

/** Pure derived construction model: no persisted duplicate document, no mesh inputs. */
export function resolveCadDesign(doc: ProjectDoc): CadDesign {
  const status=getStepExportStatus(doc);if(!status.supported)throw new CadDesignError(status.issues);
  const spec=structuredClone(doc.spec), fillZ=resolvePocketDepth(spec,{mode:"through"}).infillTopZ;
  const shapes=new Map(doc.shapes.map(s=>[s.id,s]));
  const pockets=doc.cutouts.map((p): CadPocket=>{
    const s=shapes.get(p.shapeId)!;
    const rigid=hasRigidPocket(p)||Boolean(p.insertionMode);
    const ds=p.split?.depths??[p.depth];
    const depths=ds.map(d=>rigid ? d.mode==="mm"?d.value:d.sourceDepthMm??(d.mode==="remaining"?fillZ-d.floorThicknessMm:fillZ)
      :resolvePlacedPocketDepth(spec,d,s,p).axialDepthMm??fillZ+1);
    const sourceBottoms=ds.map((d,i)=>rigid?-depths[i]:(resolvePlacedPocketDepth(spec,d,s,p).floorZ??-1));
    return {id:p.id,name:pocketName(p,s),shapeId:p.shapeId,profiles:profiles(s,p),rotation:pocketRotation(p),position:{...p.position},
      rigid,elevationMm:p.elevationMm??0,depths,sourceBottoms,
      floors:ds.map(d=>d.mode==="remaining"?d.floorThicknessMm:d.mode==="through"?null:rigid?null:resolvePlacedPocketDepth(spec,d,s,p).floorZ),
      split:p.split?{boundary:p.split.boundary.map(v=>({x:v.x*p.scaleX*(p.mirrored?-1:1),y:v.y*p.scaleY})) as [Point,Point],mirrored:p.mirrored}:undefined,
      clearanceMm:p.clearanceMm,cornerRoundMm:p.cornerRoundMm,bottomFilletMm:p.bottomFilletMm,topFilletMm:p.topFilletMm,
      insertion:p.insertionMode?pocketInsertionAxis(p):undefined,insertionMode:p.insertionMode,designLink:structuredClone(p.designLink)};
  });
  return {version:CAD_MODEL_VERSION,units:"mm",spec,
    dimensions:{widthMm:binFootprintMm(spec.gridX,spec.gridPitch),lengthMm:binFootprintMm(spec.gridY,spec.gridPitch),rimZ:binHeightMm(spec.heightUnits),topZ:binTotalHeightMm(spec.heightUnits,spec.lip==="standard"),fillZ},
    pockets,fingerHoles:structuredClone(doc.fingerHoles),operations:[{objectId:"bin-blank",operation:"bin construction"},
      ...pockets.flatMap(p=>["clearance","corner rounding","source construction","rigid placement","insertion clearance","floor clipping","mouth rounding"].map(operation=>({objectId:p.id,operation}))),
      ...doc.fingerHoles.map(f=>({objectId:f.id,operation:"finger access"})),...spec.surfaceTexts.map(t=>({objectId:t.id,operation:"surface text"}))]};
}
