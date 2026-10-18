import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BinProvider, useBin, type BinStore, type BinAction } from "@/state/bin-store";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { PocketColorControls } from "./pocket-color-controls";
vi.mock("@/state/experimental-features", () => ({ useExperimentalFeatures: () => ({ enabled: true, setEnabled: vi.fn() }) }));

const cleanup: (()=>void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn=>fn()); vi.unstubAllGlobals(); });
function mount(enabled = true) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const host=document.createElement("div"); document.body.append(host);
  const root=createRoot(host), onEnable=vi.fn(); let store!:BinStore;
  function Probe() {
    store=useBin();
    return store.cutouts[0] ? <PocketColorControls cutout={store.cutouts[0]} enabled={enabled} onEnable={onEnable}/> : null;
  }
  React.act(()=>root.render(<BinProvider><Probe/></BinProvider>));
  const dispatch=(action:BinAction)=>React.act(()=>store.dispatch(action));
  const p=parseCutoutPlacement({id:"p",shapeId:"s",position:{x:0,y:0},depth:{mode:"mm",value:12},elevationMm:7});
  dispatch({type:"ADD_PLACED",cutouts:[{...p,designLink:{id:"link",tilt:false}},{...p,id:"other",designLink:{id:"link",tilt:false}}],gridX:2,gridY:2});
  const select=(label:string,value:string)=>{
    const control=host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    React.act(()=>{control.value=value;control.dispatchEvent(new Event("change",{bubbles:true}));});
  };
  cleanup.push(()=>{React.act(()=>root.unmount());host.remove();});
  return {host,onEnable,select,dispatch,store:()=>store};
}
it("defaults new pockets to insertion, retains a custom axis across coverage changes, and supports undo",()=>{
  const ui=mount(); expect(ui.store().cutouts[0].colorFloorAxis).toBe("insertion");
  const before=ui.store().cutouts[0];
  ui.select("Pocket floor color reference","y");
  expect(ui.store().cutouts[0]).toEqual({...before,colorFloorAxis:"y"});
  expect(ui.store().cutouts[1].colorFloorAxis).toBe("insertion");
  ui.select("Pocket color coverage","interior");
  expect(ui.host.querySelector('[aria-label="Pocket floor color reference"]')).toBeNull();
  ui.select("Pocket color coverage","floor");
  expect(ui.store().cutouts[0].colorFloorAxis).toBe("y");
  ui.dispatch({type:"UNDO"}); expect(ui.store().cutouts[0].colorCoverage).toBe("interior");
  expect(ui.store().pendingPocketClearance).toBeNull();
});
it("explains disabled coloring and lets the user enable it without discarding settings",()=>{
  const ui=mount(false); expect(ui.host.textContent).toContain("Pocket coloring is off");
  ui.select("Pocket color coverage","interior");
  const button=Array.from(ui.host.querySelectorAll('button')).find(b=>b.textContent==="Enable pocket coloring")!;
  React.act(()=>button.click()); expect(ui.onEnable).toHaveBeenCalledOnce();
  expect(ui.store().cutouts[0].colorCoverage).toBe("interior");
});
it("hides color settings for retained-material holes and keeps their dormant choices",()=>{
  const ui=mount();ui.select("Pocket color coverage","interior");
  ui.dispatch({type:"UPDATE_CUTOUT",id:"p",patch:{role:"hole"}});
  expect(ui.host.querySelector('[data-testid="pocket-color-controls"]')).toBeNull();
  ui.dispatch({type:"UNDO"});expect(ui.store().cutouts[0].colorCoverage).toBe("interior");
});
