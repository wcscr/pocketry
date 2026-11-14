import { projectPoint, type Homography } from "@shared/geometry/projective";
import type { ImageLike } from "./types";
export interface ReprojectionRequest { image: ImageLike; width: number; height: number; toSource: Homography }
/** Bilinear ROI sampling in the worker, with a bounded output and white outside the photo. */
export function reprojectPhoto({image,width,height,toSource}:ReprojectionRequest):ImageLike {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4_194_304||toSource.some(v=>!Number.isFinite(v))) throw new Error("Invalid photo sampling request");
  const data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const p=projectPoint(toSource,{x:x+.5,y:y+.5});
    const sx=p.x-.5,sy=p.y-.5;
    if(sx<0||sy<0||sx>image.width-1||sy>image.height-1) continue;
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,image.width-1),y1=Math.min(y0+1,image.height-1),fx=sx-x0,fy=sy-y0;
    for(let c=0;c<4;c++) data[(y*width+x)*4+c]=
      (image.data[(y0*image.width+x0)*4+c]*(1-fx)+image.data[(y0*image.width+x1)*4+c]*fx)*(1-fy)+
      (image.data[(y1*image.width+x0)*4+c]*(1-fx)+image.data[(y1*image.width+x1)*4+c]*fx)*fy;
  }
  return {width,height,data};
}
