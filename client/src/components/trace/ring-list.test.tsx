import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { RingList } from "./ring-list";
import type { Outline } from "@shared/geometry/types";

const role = vi.hoisted(() => ({ change: vi.fn() }));
vi.mock("@/lib/geometry/contour-role", () => ({ changeContourRole: role.change }));
vi.mock("@/lib/manifold/runtime", () => ({ withKernel: async (fn: (kernel: unknown) => unknown) => fn({}) }));

let trace: TraceStore, host: HTMLDivElement, root: Root;
function Probe() { trace = useTrace(); return <RingList />; }
beforeEach(() => {
  role.change.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  React.act(() => root.render(<TraceProvider><Probe /></TraceProvider>));
});

const square = (x: number, size: number) => [{ x, y: x }, { x: x + size, y: x }, { x: x + size, y: x + size }, { x, y: x + size }];
const pockets: Outline = [{ outer: square(0, 100), holes: [] }, { outer: square(30, 20), holes: [] }];
const holed: Outline = [{ outer: pockets[0].outer, holes: [[...pockets[1].outer].reverse()] }];
function detect() {
  React.act(() => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "test" });
    trace.dispatch({ type: "DETECTED", outline: pockets, rawOutline: pockets, svg: "", imageUrl: "photo", region: null });
  });
}
async function chooseHole() {
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Shape 2 type"]')!;
  await React.act(async () => { select.value = "hole"; select.dispatchEvent(new Event("change", { bubbles: true })); });
}

it("exposes pocket/hole roles and keeps conversion in undo/redo history", async () => {
  detect();
  role.change.mockReturnValue(holed);
  await chooseHole();
  expect(trace.outline).toEqual(holed);
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Hole 1 of shape 1 type"]')!.value).toBe("hole");
  expect(trace.history.stack.at(-1)!.label).toBe("Make hole (keep material)");
  expect(trace.processing).toBe(false);
  React.act(() => trace.undo());
  expect(trace.outline).toEqual(pockets);
  React.act(() => trace.redo());
  expect(trace.outline).toEqual(holed);
});

it("shows an invalid-hole explanation without changing the outline", async () => {
  detect();
  role.change.mockImplementation(() => { throw new Error("A hole must overlap another pocket."); });
  await chooseHole();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("must overlap another pocket");
  expect(trace.outline).toEqual(pockets);
  expect(trace.processing).toBe(false);
});

it("does not apply a delayed role change after the source is replaced", async () => {
  detect();
  let finish!: (outline: Outline) => void;
  role.change.mockImplementation(() => new Promise<Outline>(resolve => { finish = resolve; }));
  await chooseHole();
  expect(trace.processing).toBe(true);
  React.act(() => trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "new-photo", fileName: "new" }));
  await React.act(async () => finish(holed));
  expect(trace.outline).toEqual([]);
  expect(trace.processing).toBe(false);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("distinguishes a missing region, active detection, and an empty result", () => {
  expect(host.textContent).toContain("Set a detection region around the tool");
  React.act(() => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "tool" });
    trace.dispatch({ type: "SET_REGION", region: { x: 0, y: 0, width: 100, height: 100 } });
    trace.dispatch({ type: "SET_PROCESSING", processing: true });
  });
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Looking for the tool’s outline…");
  React.act(() => trace.dispatch({ type: "SET_PROCESSING", processing: false }));
  expect(host.querySelector('[role="status"]')?.textContent).toBe("No outline found. Increase Sensitivity or redraw the region around the whole tool.");
  React.act(() => trace.dispatch({ type: "SET_REGION", region: null }));
  expect(host.textContent).toContain("Set a detection region around the tool");
});
