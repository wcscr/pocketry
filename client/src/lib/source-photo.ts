import { composeHomography, projectPoint, type Homography } from "@shared/geometry/projective";
import type { Rect } from "@shared/geometry/types";
import { checkDetectionAbort } from "./detect/grabcut";
import { reprojectPhoto } from "./detect/reproject";
import { reprojectInWorker } from "./detect/worker-client";

/** Decode once; sample a bounded source tile rather than rasterizing the full photo. */
export function createSourcePhotoSampler() {
  let currentUrl: string | undefined, current: Promise<HTMLImageElement> | undefined;
  return async (url:string,toOriginal:Homography,region:Rect,signal?:AbortSignal) => {
    checkDetectionAbort(signal);
    if(url!==currentUrl) {
      currentUrl=url;
      current=new Promise((resolve,reject)=>{
        const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error("Original photo could not be decoded"));image.src=url;
      });
    }
    const image=await current!;
    checkDetectionAbort(signal);
    const toPixels=composeHomography([image.naturalWidth,0,0,0,image.naturalHeight,0,0,0,1],toOriginal);
    const corners=[{x:region.x,y:region.y},{x:region.x+region.width,y:region.y},{x:region.x+region.width,y:region.y+region.height},{x:region.x,y:region.y+region.height}];
    const denominators=corners.map(p=>toPixels[6]*p.x+toPixels[7]*p.y+toPixels[8]);
    if(Math.min(...denominators)<=0 && Math.max(...denominators)>=0) throw new Error("Photo region crosses a perspective horizon");
    const points=corners.map(p=>projectPoint(toPixels,p));
    const x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-2),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-2);
    const width=Math.min(image.naturalWidth,Math.ceil(Math.max(...points.map(p=>p.x)))+2)-x;
    const height=Math.min(image.naturalHeight,Math.ceil(Math.max(...points.map(p=>p.y)))+2)-y;
    if(width<1||height<1) throw new Error("Region is outside the source photo");
    const ratio=Math.min(1,2048/Math.max(width,height));
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
    const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx) throw new Error("Could not sample the original photo");
    ctx.drawImage(image,x,y,width,height,0,0,canvas.width,canvas.height);
    const density=Math.max(Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)/region.width,Math.hypot(points[3].x-points[0].x,points[3].y-points[0].y)/region.height)*ratio;
    const outScale=Math.min(density,2048/Math.max(region.width,region.height));
    const outWidth=Math.max(1,Math.round(region.width*outScale)),outHeight=Math.max(1,Math.round(region.height*outScale));
    const toWorking={x:region.width/outWidth,y:region.height/outHeight};
    const toTile=composeHomography([canvas.width/width,0,-x*canvas.width/width,0,canvas.height/height,-y*canvas.height/height,0,0,1],toPixels);
    const request={image:ctx.getImageData(0,0,canvas.width,canvas.height),width:outWidth,height:outHeight,
      toSource:composeHomography(toTile,[toWorking.x,0,region.x,0,toWorking.y,region.y,0,0,1])};
    const pixels=typeof Worker==="undefined"?reprojectPhoto(request):await reprojectInWorker(request,signal);
    return {imageData:new ImageData(pixels.data,pixels.width,pixels.height),toWorking,region};
  };
}
