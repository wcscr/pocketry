import type { Point } from "./types";
import type { ImageAlignment, ImageMatrix } from "./image-alignment";
import { inverseImageMatrix } from "./image-alignment";

/** Row-major projective transform, mapping pixel centres. */
export type Homography = [number,number,number,number,number,number,number,number,number];
export const identityHomography: Homography=[1,0,0,0,1,0,0,0,1];
export const affineHomography=(m:ImageMatrix):Homography=>[m[0],m[2],m[4],m[1],m[3],m[5],0,0,1];
export function composeHomography(a:Homography,b:Homography):Homography {
  const result=new Array<number>(9).fill(0);
  for(let y=0;y<3;y++) for(let x=0;x<3;x++) for(let k=0;k<3;k++) result[y*3+x]+=a[y*3+k]*b[k*3+x];
  return result as Homography;
}
export function inverseHomography(m:Homography):Homography {
  const [a,b,c,d,e,f,g,h,i]=m;
  const adj:Homography=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const det=a*adj[0]+b*adj[3]+c*adj[6];
  if(!Number.isFinite(det)||Math.abs(det)<1e-15) throw new Error("Invalid photo transform");
  return adj.map(v=>v/det) as Homography;
}
export function projectPoint(m:Homography,p:Point):Point {
  const w=m[6]*p.x+m[7]*p.y+m[8];
  if(!Number.isFinite(w)||Math.abs(w)<1e-12) throw new Error("Photo region crosses the perspective horizon");
  return {x:(m[0]*p.x+m[1]*p.y+m[2])/w,y:(m[3]*p.x+m[4]*p.y+m[5])/w};
}
/** Current working pixels to normalized, unrotated original photo coordinates. */
export function workingToPhoto(size:{width:number;height:number},rotation:0|1|2|3,alignment:ImageAlignment|null):Homography {
  const s=alignment?.sourceSize??size;
  const normalize:Homography=[1/s.width,0,0,0,1/s.height,0,0,0,1];
  const turns:Homography[]=[identityHomography,[0,1,0,-1,0,1,0,0,1],[-1,0,1,0,-1,1,0,0,1],[0,-1,1,1,0,0,0,0,1]];
  return composeHomography(turns[rotation],composeHomography(normalize,alignment?affineHomography(inverseImageMatrix(alignment.matrix)):identityHomography));
}
/** Keep a source mapping when the working photo is rotated or translated. */
export const transformPhotoProjection=(m:Homography,transform:ImageMatrix)=>composeHomography(m,affineHomography(inverseImageMatrix(transform)));
