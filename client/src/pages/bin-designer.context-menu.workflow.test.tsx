import {
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  renderPage,
  selectPocket,
  openObjectContext,
  contextCommand,
} from "./bin-designer.test-support";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";

it('right-clicking a selected split pocket preserves the active section', async () => {
  window.history.replaceState(null, '', '/bin?layout=standard');
  const shape = rectangularShape('split-context-shape', 'Tool');
  const cutout = parseCutoutPlacement({ id: 'split-context', shapeId: shape.id, position: { x: 0, y: 0 }, split: {
    boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [{ mode: 'mm', value: 8 }, { mode: 'mm', value: 12 }],
  } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage({ experimental: false });
  try {
    await flushHydration(); selectPocket(container, cutout.id);
    const sectionB = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Section B')!;
    React.act(() => sectionB().click());
    openObjectContext(container.querySelector('[data-testid="cutout-row-split-context"]')!); contextCommand('Properties');
    expect(sectionB().getAttribute('aria-pressed')).toBe('true');
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([cutout]);
  } finally { unmount(); }
});

it.each(["standard", "workflow"])("selects and moves the visible hole above a later pocket in %s layout", async layoutMode => {
  const { binToCanvas } = await import("@shared/gridfinity/cutout");
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layoutMode}`);
  const pocketShape = rectangularShape("pick-pocket-shape", "Later pocket");
  const holeShape = rectangularShape("pick-hole-shape", "Visible hole");
  holeShape.outlineMm = [{ outer: [{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:-3,y:3}], holes: [] }];
  holeShape.bboxMm = {minX:-3,minY:-3,maxX:3,maxY:3};
  const hole = parseCutoutPlacement({id:"pick-hole",shapeId:holeShape.id,role:"hole",position:{x:0,y:0},depth:{mode:"through"}});
  const pocket = parseCutoutPlacement({id:"pick-pocket",shapeId:pocketShape.id,position:{x:0,y:0},depth:{mode:"mm",value:15}});
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,shapes:[holeShape,pocketShape],cutouts:[hole,pocket]});
  const {container,unmount}=renderPage();
  try {
    await flushHydration();
    React.act(()=>container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const svg=container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', {value:()=>({inverse:()=>({})})});
    Object.defineProperties(svg, {createSVGPoint:{value:()=>({x:0,y:0,matrixTransform(){return {x:this.x,y:this.y}}})},setPointerCapture:{value:()=>{}}});
    const paths=[...container.querySelectorAll('[data-cutout-id]')];
    expect(paths.at(-1)!.getAttribute('data-cutout-id')).toBe(hole.id);
    const center=binToCanvas({x:0,y:0},EMPTY_PROJECT.spec);
    const target=container.querySelector('[data-cutout-id="pick-hole"]')!;
    const pointer=(type:string,x:number,y:number)=>React.act(()=>{
      const e=new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});
      Object.defineProperty(e,'pointerId',{value:1});target.dispatchEvent(e);
    });
    pointer("pointerdown",center.x,center.y);
    pointer("pointerup",center.x,center.y);
    expect(container.querySelector('[data-testid="button-select-pick-hole"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[aria-label="Hole depth mode"]')!.textContent).toContain("Keep full depth");
    expect(container.querySelector('[data-testid="pocket-clearance-settings"]')!.textContent).toContain("Hole offset");
    expect(container.querySelector('[data-testid="pocket-split-settings"]')!.textContent).toContain("Split hole");
    expect(container.querySelector('[aria-label="Hole size and scale"]')).not.toBeNull();
    pointer("pointerdown",center.x,center.y);
    pointer("pointermove",center.x+8,center.y+7);
    pointer("pointerup",center.x+8,center.y+7);
    const current = vi.mocked(useBinGeometry).mock.lastCall![2]!;
    expect(current.cutouts.find(c=>c.id===hole.id)!.position).not.toEqual(hole.position);
    expect(current.cutouts.find(c=>c.id===pocket.id)!.position).toEqual(pocket.position);
  } finally {unmount();window.history.replaceState(null,"",originalUrl);}
});
