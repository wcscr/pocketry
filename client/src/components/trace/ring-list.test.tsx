import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { RingList } from "./ring-list";

let trace: TraceStore, host: HTMLDivElement, root: Root;
function Probe() { trace = useTrace(); return <RingList />; }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  React.act(() => root.render(<TraceProvider><Probe /></TraceProvider>));
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

it("offers retained-hole actions without changing geometry until a command is chosen, with undo", () => {
  const outer = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const hole = [{ x: 30, y: 30 }, { x: 30, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 30 }];
  React.act(() => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "frame" });
    trace.dispatch({ type: "DETECTED", outline: [{ outer, holes: [hole] }], rawOutline: [{ outer, holes: [hole] }], svg: "", imageUrl: "photo", region: null });
  });
  const outline = trace.outline, history = trace.history;
  React.act(() => host.querySelectorAll('li')[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 })));
  expect(trace.outline).toBe(outline); expect(trace.history).toBe(history);
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain('Hole 1 of shape 1');
  expect(menu.textContent).toContain('Edit contour');
  expect(menu.textContent).not.toContain('Link');
  React.act(() => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === 'Remove hole')!.click());
  expect(trace.outline[0].holes).toHaveLength(0);
  React.act(() => trace.undo()); expect(trace.outline).toEqual(outline);
});
