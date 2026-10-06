// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { MobileBinActions } from "./mobile-bin-actions";

it.each(["depth", "clearance"])("keeps the mobile %s slider tied to its pocket and section", property => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let store!: BinStore;
  function Probe() {
    store = useBin();
    return <MobileBinActions open onOpenChange={() => {}} onMore={() => {}} onExport={() => {}} />;
  }
  try {
    React.act(() => root.render(<ShapeLibraryProvider><BinProvider><Probe /></BinProvider></ShapeLibraryProvider>));
    const first = parseCutoutPlacement({ id: "first", shapeId: "source", position: { x: -15, y: 0 }, elevationMm: 3,
      split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }],
        depths: [{ mode: "remaining", floorThicknessMm: 6, sourceDepthMm: 16 }, { mode: "remaining", floorThicknessMm: 4, sourceDepthMm: 20 }] } });
    const second = { ...first, id: "second", position: { x: 15, y: 0 }, clearanceMm: 0.5 };
    React.act(() => store.dispatch({ type: "ADD_PLACED", cutouts: [first, second], gridX: 2, gridY: 2 }));
    React.act(() => store.dispatch({ type: "SELECT_CUTOUT", id: first.id }));
    const slider = () => host.querySelector<HTMLElement>(`#quick-pocket-${property} [role="slider"]`)!;
    const previous = slider();
    React.act(() => previous.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const edited = store.cutouts[0];
    expect(edited).not.toEqual(first);
    expect(edited.split!.depths[0]).toMatchObject({sourceDepthMm:16});
    expect(edited.split!.depths[1]).toMatchObject({sourceDepthMm:20});
    React.act(() => store.dispatch({ type: "SELECT_CUTOUT", id: first.id, section: 1 }));
    expect(slider()).not.toBe(previous);
    React.act(() => store.dispatch({ type: "SELECT_CUTOUT", id: second.id }));
    expect(slider().getAttribute("aria-valuenow")).toBe(property === "depth" ? "6" : "0.5");
    React.act(() => previous.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(store.cutouts).toEqual([edited, second]);
    React.act(() => slider().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(store.cutouts[0]).toEqual(edited);
    expect(store.cutouts[1]).not.toEqual(second);
  } finally {
    React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
