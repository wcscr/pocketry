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
