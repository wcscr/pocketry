import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { BasicPocketDialog } from "./basic-pocket-dialog";
import { parseBinSpec } from "@shared/gridfinity/types";
const mocks=vi.hoisted(()=>({dispatch:vi.fn(),storeShape:vi.fn(),close:vi.fn(),draw:vi.fn()}));
vi.mock("@/state/bin-store",()=>({useBin:()=>({spec:parseBinSpec({gridX:2,gridY:2,heightUnits:6}),dispatch:mocks.dispatch})}));
vi.mock("@/state/shape-library",()=>({useShapeLibrary:()=>({storeShape:mocks.storeShape})}));
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{React.act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
function render(kind:"circle"|"rectangle"|"square") {React.act(()=>root.render(<BasicPocketDialog kind={kind} onClose={mocks.close} onDraw={mocks.draw}/>));}
function type(index:number,value:string) {React.act(()=>{const input=document.querySelectorAll('input')[index];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
function submit(){React.act(()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
it("creates an exact 25 mm circle at the bin center through one placement action",()=>{
  render("circle");type(0,"25");type(1,"12");submit();
  const shape=mocks.storeShape.mock.calls[0][0];expect(shape.bboxMm).toEqual({minX:-12.5,minY:-12.5,maxX:12.5,maxY:12.5});
  const actions=mocks.dispatch.mock.calls.map(([a])=>a);const add=actions.find(a=>a.type==="ADD_PLACED");
  expect(add.cutouts[0]).toMatchObject({position:{x:0,y:0},depth:{mode:"mm",value:12},clearanceMm:0});
  expect(actions.filter(a=>a.type==="ADD_PLACED")).toHaveLength(1);expect(mocks.close).toHaveBeenCalledOnce();
});
it("keeps exact rectangle dimensions and accepts a decimal comma",()=>{
  render("rectangle");type(0,"30,5");type(1,"50");submit();
  expect(mocks.storeShape.mock.calls[0][0].bboxMm).toEqual({minX:-15.25,minY:-25,maxX:15.25,maxY:25});
});
it.each(["","0","-1","Infinity","2001"])("does not create a pocket for invalid width %s",value=>{
  render("square");type(0,value);submit();expect(mocks.storeShape).not.toHaveBeenCalled();expect(mocks.dispatch).not.toHaveBeenCalled();
});
it("leaves the library untouched on cancel or choosing canvas drawing",()=>{
  render("circle");React.act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==="Draw on canvas")!.click());
  expect(mocks.draw).toHaveBeenCalledOnce();expect(mocks.storeShape).not.toHaveBeenCalled();
  React.act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==="Close")!.click());
  expect(mocks.close).toHaveBeenCalledOnce();expect(mocks.dispatch).not.toHaveBeenCalled();
});
it("keeps the dimension dialog scrollable above the keyboard", () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  render("rectangle");
  React.act(() => document.querySelector("input")!.focus());
  React.act(() => {
    viewport.height = 330;
    viewport.offsetTop = 20;
    viewport.dispatchEvent(new Event("resize"));
  });
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.style.top).toBe("185px");
  expect(dialog.style.maxHeight).toBe("298px");
  expect(mocks.storeShape).not.toHaveBeenCalled();
});
