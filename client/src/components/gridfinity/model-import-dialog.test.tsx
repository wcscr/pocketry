// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelImportDialog } from "./model-import-dialog";
import { ModelPocketControls } from "./model-pocket-controls";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { ShapeLibraryProvider, useShapeLibrary, type ShapeLibrary } from "@/state/shape-library";
import { ExperimentalFeaturesProvider, useExperimentalFeatures, EXPERIMENTAL_FEATURES_KEY } from "@/state/experimental-features";
import { readModelFile } from "@/lib/gridfinity/model-worker-client";
import type { TracedShape } from "@shared/gridfinity/cutout";

vi.mock("@/lib/gridfinity/model-worker-client", () => ({ readModelFile: vi.fn() }));
const modelShape: TracedShape = {id:"model",name:"Test model",source:"model",sourceMmPerPx:null,
  outlineMm:[{outer:[{x:-10,y:-5},{x:10,y:-5},{x:10,y:5},{x:-10,y:5}],holes:[]}],
  pointCount:4,bboxMm:{minX:-10,maxX:10,minY:-5,maxY:5},
  model:{format:"stl",units:"mm",positions:[-10,-5,-3,10,-5,-3,0,5,-3,0,0,3],indices:[0,2,1,0,1,3,1,2,3,2,0,3]}};
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, store: BinStore, library: ShapeLibrary;
let experimental: ReturnType<typeof useExperimentalFeatures>;
function Probe() {
  experimental = useExperimentalFeatures();
  store = useBin(); library = useShapeLibrary();
  const [open,setOpen] = React.useState(true);
  return <><ModelImportDialog open={open} onOpenChange={setOpen}/>{store.cutouts[0] && <ModelPocketControls shape={library.shapes[0]} cutout={store.cutouts[0]}/>}</>;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); sessionStorage.clear();
  localStorage.setItem(EXPERIMENTAL_FEATURES_KEY,"true");
  vi.mocked(readModelFile).mockReset().mockResolvedValue(modelShape);
  host = document.createElement("div"); document.body.append(host); root=createRoot(host);
  React.act(() => root.render(<ExperimentalFeaturesProvider><ShapeLibraryProvider><BinProvider><Probe/></BinProvider></ShapeLibraryProvider></ExperimentalFeaturesProvider>));
});
afterEach(() => { React.act(()=>root.unmount()); host.remove(); localStorage.removeItem(EXPERIMENTAL_FEATURES_KEY); vi.unstubAllGlobals(); });
async function chooseFile(name="tool.stl") {
  const input=document.querySelector<HTMLInputElement>('[aria-label="STL file"]')!;
  await React.act(async()=>{Object.defineProperty(input,"files",{configurable:true,value:[new File(["test"],name)]}); input.dispatchEvent(new Event("change",{bubbles:true}));});
}
function button(text:string) { return [...document.querySelectorAll("button")].find(b=>b.textContent===text)!; }
function enter(label:string,value:string) {
  const input=document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  React.act(()=>{input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value); input.dispatchEvent(new Event("input",{bubbles:true}));});
  React.act(()=>input.blur());
}
it("confirms units and dimensions, adds the model, and keeps depth independent from XYZ scaling with undo",async()=>{
  expect(button("Add model pocket").disabled).toBe(true);
  await chooseFile();
  expect(document.querySelector('[data-testid="model-import-dimensions"]')?.textContent).toContain("20.00 × 10.00 × 6.00 mm");
  const units=document.querySelector<HTMLSelectElement>('[aria-label="Model file units"]')!;
  await React.act(async()=>{units.value="in"; units.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(vi.mocked(readModelFile).mock.lastCall?.[1]).toBe("in");
  React.act(()=>button("Add model pocket").click());
  expect(library.pendingIds).toEqual([]); expect(library.shapes[0].model).toEqual(modelShape.model);
  const original=store.cutouts[0];
  enter("Model insertion depth in millimetres","4");
  expect(store.cutouts[0].depth).toEqual(original.depth);
  expect(store.cutouts[0].elevationMm).not.toBe(original.elevationMm);
  enter("Model Z size in millimetres","12");
  expect(store.cutouts[0]).toMatchObject({scaleX:2,scaleY:2,modelScaleZ:2});
  React.act(()=>store.dispatch({type:"UNDO"}));
  expect(store.cutouts[0]).toMatchObject({scaleX:1,scaleY:1,modelScaleZ:1});
  React.act(()=>button("Scale together: On").click());
  enter("Model Z size in millimetres","9");
  expect(store.cutouts[0]).toMatchObject({scaleX:1,scaleY:1,modelScaleZ:1.5});
});
it("rejects unsupported files and reports failed repairs without adding anything",async()=>{
  await chooseFile("part.step");
  expect(readModelFile).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("STL");
  vi.mocked(readModelFile).mockRejectedValue(new Error("Repair the open mesh"));
  await chooseFile();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Repair the open mesh");
  expect(button("Add model pocket").disabled).toBe(true); expect(store.cutouts).toEqual([]);
});
it("cancels a pending import when the dialog closes and ignores its late completion",async()=>{
  let resolve!: (shape:TracedShape)=>void;
  vi.mocked(readModelFile).mockImplementation(()=>new Promise(r=>{resolve=r;}));
  await chooseFile();
  const signal=vi.mocked(readModelFile).mock.lastCall![2];
  React.act(()=>button("Cancel").click());
  expect(signal.aborted).toBe(true);
  await React.act(async()=>resolve(modelShape));
  expect(library.shapes).toEqual([]); expect(store.cutouts).toEqual([]);
});

it("switches insertion paths without changing the model pose and supports undo",async()=>{
  await chooseFile();
  React.act(()=>button("Add model pocket").click());
  const original=store.cutouts[0];
  const select=document.querySelector<HTMLSelectElement>('[aria-label="Model insertion path"]')!;
  expect(select.value).toBe("axis");
  React.act(()=>{select.value="vertical";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(store.cutouts[0]).toEqual({...original,modelInsertionMode:"vertical"});
  React.act(()=>store.dispatch({type:"UNDO"}));
  expect(store.cutouts[0]).toEqual(original);
  expect(select.value).toBe("axis");
});

it("edits margin and smoothing independently, persists them, and undoes smoothing as one edit", async () => {
  await chooseFile();
  React.act(() => button("Add model pocket").click());
  const original = store.cutouts[0];
  expect(original).toMatchObject({clearanceMm:0.3,modelSmoothingMm:1});
  enter("Model fit margin in millimetres", "0.5");
  enter("Model detail smoothing in millimetres", "1.75");
  expect(store.cutouts[0]).toMatchObject({clearanceMm:0.5,modelSmoothingMm:1.75,elevationMm:original.elevationMm});
  expect(JSON.parse(JSON.stringify(store.cutouts[0]))).toMatchObject({clearanceMm:0.5,modelSmoothingMm:1.75});
  React.act(() => store.dispatch({type:"UNDO"}));
  expect(store.cutouts[0]).toMatchObject({clearanceMm:0.5,modelSmoothingMm:1});
});

it("cancels importing when experimental features are disabled and does not reopen on re-enable", async () => {
  let resolve!: (shape:TracedShape)=>void;
  vi.mocked(readModelFile).mockImplementation(()=>new Promise(r=>{resolve=r;}));
  await chooseFile();
  const signal=vi.mocked(readModelFile).mock.lastCall![2];
  React.act(()=>experimental.setEnabled(false));
  expect(signal.aborted).toBe(true);
  expect(document.querySelector('[aria-label="STL file"]')).toBeNull();
  await React.act(async()=>resolve(modelShape));
  expect(library.shapes).toEqual([]); expect(store.cutouts).toEqual([]);
  React.act(()=>experimental.setEnabled(true));
  expect(document.querySelector('[aria-label="STL file"]')).toBeNull();
});

it("hides model controls on opt-out while preserving the saved model and placement", async () => {
  await chooseFile();
  React.act(()=>button("Add model pocket").click());
  const before=structuredClone(store.cutouts);
  React.act(()=>experimental.setEnabled(false));
  expect(document.querySelector('[aria-label="Imported model properties"]')).toBeNull();
  expect(host.textContent).toContain("Enable experimental features in Settings");
  expect(store.cutouts).toEqual(before); expect(library.shapes[0]).toEqual(modelShape);
  React.act(()=>button("Show experimental settings").click());
  expect(experimental.settingsOpen).toBe(true);
  React.act(()=>experimental.setEnabled(true));
  expect(document.querySelector('[aria-label="Imported model properties"]')).not.toBeNull();
  expect(store.cutouts).toEqual(before);
});
