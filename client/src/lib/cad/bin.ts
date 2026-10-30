import type { BinSpec } from "@shared/gridfinity/types";
import { cellCenterMm, occupiedCells, footprintCornerGeometry } from "@shared/gridfinity/footprint";
import { BASE_PROFILE, BASE_BOTTOM_RADIUS, BASE_HEIGHT, BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, BASE_GAP_MM, D_WALL,
  STACKING_LIP_DEPTH, STACKING_LIP_HEIGHT, STACKING_LIP_SUPPORT_HEIGHT_MM, STACKING_LIP_SUPPORT_HEIGHT, STACKING_LIP_LINE, STACKING_LIP_FILLET_RADIUS,
  binFootprintMm, binHeightMm, binWallThicknessMm, R_F2 } from "@shared/gridfinity/standard";
import { infillTopZ } from "@shared/gridfinity/fill";
import { CadContext, type CadShape } from "./adapter";
import { offsetSection, extrudeSection } from "./profile-operations";
import { curveWire, curvesFace, polygonCurves, sweepRectangularProfile, type CadCurve } from "./curves";

export function footprintCurves(spec: BinSpec, interior = false): CadCurve[] {
  const corners=footprintCornerGeometry(spec,BASE_GAP_MM/2+(interior?D_WALL:0),interior?R_F2:BASE_TOP_RADIUS,BASE_TOP_RADIUS+(interior?D_WALL:0));
  return corners.flatMap((corner,i):CadCurve[]=>{
    const middleAngle=corner.startAngle+corner.delta/2;
    const middle={x:corner.centre.x+corner.radius*Math.cos(middleAngle),y:corner.centre.y+corner.radius*Math.sin(middleAngle)};
    return [{kind:"arc",start:corner.start,middle,end:corner.end},{kind:"line",start:corner.end,end:corners[(i+1)%corners.length].start}];
  });
}

export function footprintPrism(c: CadContext, spec: BinSpec, bottom: number, top: number, interior = false): CadShape {
  const face=curvesFace(c,footprintCurves(spec,interior),[],bottom);
  return c.prism(face,{x:0,y:0,z:top-bottom});
}

function lipCurves(): CadCurve[] {
  const r=STACKING_LIP_FILLET_RADIUS,cx=STACKING_LIP_DEPTH-r,cy=STACKING_LIP_HEIGHT-r*(1+Math.SQRT2);
  const radial=BASE_TOP_RADIUS-STACKING_LIP_DEPTH;
  const at=(x:number,y:number)=>({x:x+radial,y});
  const arc=(angle:number)=>at(cx+r*Math.cos(angle),cy+r*Math.sin(angle));
  const a=at(0,0),b=at(STACKING_LIP_LINE[1][0],STACKING_LIP_LINE[1][1]),d=at(STACKING_LIP_LINE[2][0],STACKING_LIP_LINE[2][1]);
  const start=arc(Math.PI*3/4),end=arc(0),outerBottom=at(STACKING_LIP_DEPTH,-STACKING_LIP_SUPPORT_HEIGHT_MM),innerBottom=at(0,-STACKING_LIP_SUPPORT_HEIGHT);
  // Clockwise radial profile is reversed to the same orientation as BASE_PROFILE.
  const reverse=(curve:CadCurve):CadCurve=>curve.kind==="line"?{...curve,start:curve.end,end:curve.start}:curve.kind==="arc"?{...curve,start:curve.end,end:curve.start}:{...curve,poles:[...curve.poles].reverse()};
  return ([{kind:"line",start:a,end:b},{kind:"line",start:b,end:d},{kind:"line",start:d,end:start},
    {kind:"arc",start,middle:arc(Math.PI*3/8),end},{kind:"line",start:end,end:outerBottom},
    {kind:"line",start:outerBottom,end:innerBottom},{kind:"line",start:innerBottom,end:a}] as CadCurve[]).reverse().map(reverse);
}

function customLip(c: CadContext, spec: BinSpec): CadShape {
  // Smooth sweep along the analytic outer boundary, profile offset relative to it.
  const curves=footprintCurves(spec);
  const first=curves[0]; if(first.kind!=="arc")throw new Error("Missing footprint corner");
  const radialProfile=lipCurves().map(curve=>{
    const map=(p:{x:number;y:number})=>({x:p.x-BASE_TOP_RADIUS,y:p.y});
    return curve.kind==="line"?{...curve,start:map(curve.start),end:map(curve.end)}:curve.kind==="arc"?{...curve,start:map(curve.start),middle:map(curve.middle),end:map(curve.end)}:{...curve,poles:curve.poles.map(map)};
  });
  const face=curvesFace(c,radialProfile,[],0,true);
  // Start tangent of the first convex corner determines outward radial direction.
  const corner=footprintCornerGeometry(spec,BASE_GAP_MM/2,BASE_TOP_RADIUS,BASE_TOP_RADIUS)[0];
  const positioned=c.move(c.rotate(face,{x:0,y:0,z:1},corner.startAngle*180/Math.PI),{x:first.start.x,y:first.start.y,z:binHeightMm(spec.heightUnits)});
  const pipe=c.own(new c.oc.BRepOffsetAPI_MakePipe(curveWire(c,curves),positioned));
  const shape=c.own(pipe.Shape());
  if (!c.valid(shape))throw new Error("Irregular footprint lip sweep failed; no sampled replacement is used");
  return shape;
}

/** Same inner-wall radii and thick-wall lip support as the printing rules. */
export function cadWallInteriorSection(c:CadContext,spec:BinSpec,thickness=binWallThicknessMm(spec)):CadShape|undefined {
  const width=binFootprintMm(spec.gridX,spec.gridPitch),length=binFootprintMm(spec.gridY,spec.gridPitch);
  if(spec.footprint.kind==="custom")return offsetSection(c,footprintPrism(c,spec,0,1,true),D_WALL-thickness);
  if(2*thickness>=Math.min(width,length))return undefined;
  return c.extrude({kind:"rounded-rectangle",width:width-2*thickness,length:length-2*thickness,radius:Math.min(BASE_TOP_RADIUS,(width-2*thickness)/2,(length-2*thickness)/2)},0,1);
}

export interface CadBinBlank { blank: CadShape; lip?: CadShape; interior?: CadShape }
export function buildCadBinBlank(c: CadContext, spec: BinSpec): CadBinBlank {
  return c.scope(() => {
  const width=binFootprintMm(spec.gridX,spec.gridPitch),length=binFootprintMm(spec.gridY,spec.gridPitch),rimZ=binHeightMm(spec.heightUnits);
  let blank:CadShape;
  if(spec.flatBottom)blank=footprintPrism(c,spec,0,BASE_HEIGHT);
  else {
    const cellWidth=binFootprintMm(1,spec.gridPitch),path=cellWidth-2*BASE_TOP_RADIUS;
    const profile=polygonCurves([...BASE_PROFILE.map(([x,y])=>({x:x+BASE_BOTTOM_RADIUS,y})),{x:0,y:BASE_PROFILE_HEIGHT},{x:0,y:0}]);
    const perimeter=sweepRectangularProfile(c,profile,path,path);
    const fill=c.extrude({kind:"rounded-rectangle",width:cellWidth-2*(BASE_TOP_RADIUS-BASE_BOTTOM_RADIUS)-BASE_BOTTOM_RADIUS,length:cellWidth-2*(BASE_TOP_RADIUS-BASE_BOTTOM_RADIUS)-BASE_BOTTOM_RADIUS,radius:0},0,BASE_PROFILE_HEIGHT);
    const cell=c.boolean("fuse",perimeter,fill,"Gridfinity foot fill");
    blank=footprintPrism(c,spec,BASE_PROFILE_HEIGHT,BASE_HEIGHT);
    for(const occupied of occupiedCells(spec)) {
      const previous=blank,center=cellCenterMm(spec,occupied);
      blank=c.scope(()=>c.boolean("fuse",previous,c.move(cell,{...center,z:0}),"Gridfinity feet and bridge"),shape=>[shape]);
      c.drop(previous);
    }
  }
  let interior:CadShape|undefined;
  if(rimZ>BASE_HEIGHT) {
    const outer=footprintPrism(c,spec,BASE_HEIGHT,rimZ);
    const thickness=binWallThicknessMm(spec);
    const originalInner=cadWallInteriorSection(c,spec,D_WALL);
    interior=originalInner?extrudeSection(c,originalInner,BASE_HEIGHT,rimZ):undefined;
    let wall=interior?c.boolean("cut",outer,interior,"hollow walls"):outer;
    const thickTop=spec.lip==="none"?rimZ:Math.max(BASE_HEIGHT,rimZ-STACKING_LIP_SUPPORT_HEIGHT);
    if(thickness>D_WALL&&thickTop>BASE_HEIGHT){
      const thickInner=cadWallInteriorSection(c,spec,thickness);
      const thickOuter=footprintPrism(c,spec,BASE_HEIGHT,thickTop);
      const thickWall=thickInner?c.boolean("cut",thickOuter,extrudeSection(c,thickInner,BASE_HEIGHT,thickTop),"thicker hollow wall"):thickOuter;
      wall=c.boolean("fuse",wall,thickWall,"thick-wall support below lip");
    }
    blank=c.boolean("fuse",blank,wall,"bin walls and base");
    const fillZ=infillTopZ(spec);
    if(spec.fill==="solid"&&fillZ>BASE_HEIGHT)blank=c.boolean("fuse",blank,footprintPrism(c,spec,BASE_HEIGHT,fillZ),"solid fill height");
  }
  let lip:CadShape|undefined;
  if(spec.lip==="standard") {
    lip=spec.footprint.kind==="custom"?customLip(c,spec):c.move(sweepRectangularProfile(c,lipCurves(),width-2*BASE_TOP_RADIUS,length-2*BASE_TOP_RADIUS),{x:0,y:0,z:rimZ});
    if(rimZ-STACKING_LIP_SUPPORT_HEIGHT_MM<BASE_HEIGHT) {
      const keep=footprintPrism(c,spec,BASE_HEIGHT,rimZ+10);lip=c.boolean("common",lip,keep,"short-bin rim support clipping");
    }
    blank=c.boolean("fuse",blank,lip,"stacking rim");
  }
  if(!c.valid(blank))throw new Error("Bin construction did not produce valid closed solids");
  return {blank,lip,interior};
  }, result => [result.blank, ...result.lip ? [result.lip] : [], ...result.interior ? [result.interior] : []]);
}
