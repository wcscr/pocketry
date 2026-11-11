import { expect,it } from "vitest";
import { reprojectPhoto } from "./reproject";
it("samples original ROI pixels without a low-resolution intermediate",()=>{
  const data=new Uint8ClampedArray(8*4*4).fill(255);
  data.set([0,20,40,255],(1*8+4)*4);
  const result=reprojectPhoto({image:{width:8,height:4,data},width:2,height:2,toSource:[1,0,4,0,1,1,0,0,1]});
  expect([...result.data.slice(0,4)]).toEqual([0,20,40,255]);
  expect([...result.data.slice(4,8)]).toEqual([255,255,255,255]);
});
