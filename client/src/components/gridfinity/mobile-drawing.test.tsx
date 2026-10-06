import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { usePocketSplit } from "./use-pocket-split";
import { useBasicPocket } from "./use-basic-pocket";
import { useViewportTransform } from "@/hooks/use-viewport-transform";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), storeShape: vi.fn(), mode: "split" }));
const spec = parseBinSpec({gridX:3,gridY:3,heightUnits:6});
vi.mock("@/state/bin-store", () => ({ useBin: () => ({ spec, editorMode:mocks.mode, dispatch:mocks.dispatch }) }));
vi.mock("@/state/shape-library", () => ({ useShapeLibrary: () => ({ storeShape:mocks.storeShape }) }));
const shape: TracedShape = { id:"shape",name:"Tool",sourceMmPerPx:1,pointCount:4,
  bboxMm:{minX:-50,minY:-50,maxX:50,maxY:50},outlineMm:[{outer:[{x:-50,y:-50},{x:50,y:-50},{x:50,y:50},{x:-50,y:50}],holes:[]}] };
const cutout = parseCutoutPlacement({id:"cutout",shapeId:shape.id,position:{x:0,y:0},clearanceMm:0});
let host: HTMLDivElement, root: Root;
let split: ReturnType<typeof usePocketSplit>, basic: ReturnType<typeof useBasicPocket>, zoom: number;
function Harness() {
  const viewport = useViewportTransform({contentWidth:200,contentHeight:200,containerWidth:248,containerHeight:248,panEnabled:false});
  zoom = viewport.transform.scale;
  split = usePocketSplit({cutout,shape,scale:1,toBin:(x,y)=>({x,y}),viewport:viewport.handlers});
  basic = useBasicPocket({toBin:(x,y)=>({x,y}),viewport:viewport.handlers});
  return <svg />;
}
function pointer(type: "Down"|"Move"|"Up",x:number,y:number,id=1,cancel=false) {
  const target=host.querySelector('svg')!;
  const event={pointerId:id,pointerType:"touch",clientX:x,clientY:y,button:0,shiftKey:false,
    currentTarget:target,target,preventDefault:()=>{},type:cancel?"pointercancel":`pointer${type.toLowerCase()}`} as unknown as React.PointerEvent<SVGSVGElement>;
  React.act(()=> (mocks.mode === "split" ? split : basic)[`pointer${type}`](event));
}
beforeEach(()=> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); mocks.mode="split"; mocks.dispatch.mockClear(); mocks.storeShape.mockClear();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  React.act(()=>root.render(<Harness/>));
  host.querySelector('svg')!.setPointerCapture=()=>{};
});
afterEach(()=>{React.act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it.each(["split","draw-circle"])("hands a %s draft to pinch without adding an edit", mode=>{
  mocks.mode=mode;React.act(()=>root.render(<Harness/>));
  pointer("Down",0,-50);pointer("Move",0,-20);pointer("Down",80,80,2);pointer("Move",120,120,2);
  pointer("Up",120,120,2);pointer("Up",0,-20);
  expect(zoom).toBeGreaterThan(1);expect(mocks.dispatch).not.toHaveBeenCalled();expect(mocks.storeShape).not.toHaveBeenCalled();
});
it("projects a modest touch release miss to the edge and commits one split",()=>{
  pointer("Down",0,-50);pointer("Move",0,50);pointer("Up",0,70);
  const edit=mocks.dispatch.mock.calls.find(([action])=>action.type==="UPDATE_CUTOUT")![0];
  expect(edit.patch.split.boundary).toEqual([{x:0,y:-50},{x:0,y:50}]);
  expect(mocks.dispatch.mock.calls.filter(([action])=>action.type==="UPDATE_CUTOUT")).toHaveLength(1);
});
it("rejects distant release misses without changing the document",()=>{
  pointer("Down",0,-50);pointer("Move",0,50);pointer("Up",0,100);
  expect(mocks.dispatch).not.toHaveBeenCalled();expect(split.error).toContain("outer edge");
});
it.each(["split","draw-circle"])("cancels %s on rotation or pointer cancellation",mode=>{
  mocks.mode=mode;React.act(()=>root.render(<Harness/>));
  pointer("Down",0,-50);pointer("Move",0,50);React.act(()=>window.dispatchEvent(new Event("resize")));pointer("Up",0,50);
  pointer("Down",0,-50);pointer("Move",0,50);pointer("Up",0,50,1,true);
  expect(mocks.dispatch).not.toHaveBeenCalled();expect(mocks.storeShape).not.toHaveBeenCalled();
});
