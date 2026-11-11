// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createSourcePhotoSampler } from "./source-photo";
import { projectPoint, type Homography } from "@shared/geometry/projective";
import { reprojectPhoto } from "./detect/reproject";
import { reprojectInWorker } from "./detect/worker-client";
vi.mock("./detect/worker-client",()=>({reprojectInWorker:vi.fn(async payload=>reprojectPhoto(payload))}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.mocked(reprojectInWorker).mockClear();});
it("samples a bounded original-photo tile with an exact ROI transform and reuses the decode", async () => {
  const decoded=vi.fn();
  vi.stubGlobal("Image",class {
    naturalWidth=4000;naturalHeight=3000;onload?:()=>void;
    set src(_value:string){decoded();queueMicrotask(()=>this.onload?.());}
  });
  vi.stubGlobal("Worker",class {});
  vi.stubGlobal("ImageData",class {constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
  const draw=vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockImplementation(function(this:HTMLCanvasElement){
    return {drawImage:draw,getImageData:()=>({width:this.width,height:this.height,data:new Uint8ClampedArray(this.width*this.height*4).fill(255)})} as unknown as CanvasRenderingContext2D;
  } as never);
  const sample=createSourcePhotoSampler(),region={x:20,y:40,width:100,height:50};
  const map:Homography=[.001,0,0,0,.001,0,0,0,1];
  const result=await sample("original",map,region);
  expect(result.imageData.width).toBe(400);expect(result.imageData.height).toBe(200);
  expect(result.toWorking).toEqual({x:.25,y:.25});
  expect(draw.mock.calls[0].slice(1,5)).toEqual([78,118,404,154]);
  const request=vi.mocked(reprojectInWorker).mock.calls[0][0];
  expect(projectPoint(request.toSource,{x:0,y:0})).toEqual({x:2,y:2});
  expect(projectPoint(request.toSource,{x:400,y:200})).toEqual({x:402,y:152});
  await sample("original",map,region);expect(decoded).toHaveBeenCalledOnce();
  const controller=new AbortController();controller.abort();
  await expect(sample("other",map,region,controller.signal)).rejects.toThrow();
  expect(decoded).toHaveBeenCalledOnce();
});
