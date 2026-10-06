import { LineCurve, QuadraticBezierCurve, CubicBezierCurve, type Curve, type Vector2 } from "three";
import type { SurfaceText } from "@shared/gridfinity/surface-text";
import { surfaceTextShapes } from "@/lib/gridfinity/surface-text";
import { signedArea } from "@shared/geometry/rings";
import type { Point } from "@shared/geometry/types";
import { CadContext, type CadShape } from "./adapter";
import { curvesFace, type CadCurve } from "./curves";

function convert(curve: Curve<Vector2>): CadCurve {
  const point=(p:Vector2):Point=>({x:p.x,y:p.y});
  if(curve instanceof LineCurve)return {kind:"line",start:point(curve.v1),end:point(curve.v2)};
  if(curve instanceof QuadraticBezierCurve)return {kind:"bezier",poles:[curve.v0,curve.v1,curve.v2].map(point)};
  if(curve instanceof CubicBezierCurve)return {kind:"bezier",poles:[curve.v0,curve.v1,curve.v2,curve.v3].map(point)};
  throw new Error(`Unsupported original font curve: ${curve.type}`);
}
function reverse(curve:CadCurve):CadCurve {
  return curve.kind==="bezier"?{...curve,poles:[...curve.poles].reverse()}:{...curve,start:curve.end,end:curve.start};
}

/** FontLoader's original line/quadratic/cubic outlines, including portable fonts.
 * Sample points only retain the existing layout centering and classify winding;
 * they never become CAD boundary edges or a fitted curve.
 */
export function buildCadText(c:CadContext,label:SurfaceText,z:number):CadShape {
  const shapes=surfaceTextShapes(label);
  const segments=shapes.reduce((count,shape)=>count+shape.curves.length+shape.holes.reduce((n,hole)=>n+hole.curves.length,0),0);
  c.authoredProfileSegments+=segments;
  if(c.authoredProfileSegments>20_000)throw new Error("Original font outlines exceed the 20,000 profile-segment limit; text will not be simplified");
  const points=shapes.flatMap(shape=>shape.extractPoints(12).shape);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  if(!points.length)throw new Error("Text has no visible font outlines");
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2,a=label.rotationDeg*Math.PI/180;
  const transform=(p:Point):Point=>({x:(p.x-cx)*Math.cos(a)-(p.y-cy)*Math.sin(a)+label.position.x,y:(p.x-cx)*Math.sin(a)+(p.y-cy)*Math.cos(a)+label.position.y});
  const ring=(curves:Curve<Vector2>[],reference:Vector2[],sign:number)=>{
    let result=curves.map(convert);
    if(signedArea(reference)*sign<0)result=result.reverse().map(reverse);
    return result.map((curve):CadCurve=>curve.kind==="line"?{...curve,start:transform(curve.start),end:transform(curve.end)}:
      curve.kind==="arc"?{...curve,start:transform(curve.start),middle:transform(curve.middle),end:transform(curve.end)}:{...curve,poles:curve.poles.map(transform)});
  };
  const solids=shapes.map(shape=>{
    const extracted=shape.extractPoints(12),outer=ring(shape.curves,extracted.shape,1),holes=shape.holes.map((h,i)=>ring(h.curves,extracted.holes[i],-1));
    return c.prism(curvesFace(c,outer,holes,z),{x:0,y:0,z:label.heightMm});
  });
  const result=solids.reduce((a,b)=>c.boolean("fuse",a,b,"font outline islands"));
  if(!c.valid(result))throw new Error(`Text ${label.text}: original font outline is not a valid solid`);
  return result;
}
