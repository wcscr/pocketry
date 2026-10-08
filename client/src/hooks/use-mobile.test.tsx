import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useIsMobile } from "./use-mobile";
import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import { WorkspaceLayout } from "@/components/layout/workspace-layout";

let width = 390, height = 844, touch = true;
let host: HTMLDivElement, root: Root;
const listeners = new Set<() => void>();
const seen: boolean[] = [];
function mediaMatches(query: string) {
  return query.split(",").some(part => {
    if (part.includes("pointer: coarse") && !touch) return false;
    return [...part.matchAll(/\((min|max)-(width|height): (\d+)px\)/g)].every(([, limit, dimension, threshold]) => {
      const value = dimension === "width" ? width : height;
      return limit === "min" ? value >= +threshold : value <= +threshold;
    });
  });
}
function Probe() {
  const mobile = useIsMobile();
  const panel = usePanelState();
  seen.push(mobile);
  return <><output>{mobile ? "mobile" : "desktop"}:{String(panel.panelOpen)}</output><input aria-label="Draft" /></>;
}
function render() { React.act(() => root.render(<PanelProvider><Probe /></PanelProvider>)); }
function resize(w: number, h: number) {
  width = w; height = h;
  vi.stubGlobal("innerWidth", w); vi.stubGlobal("innerHeight", h);
  React.act(() => { for (const listener of listeners) listener(); window.dispatchEvent(new Event("resize")); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  width = 390; height = 844; touch = true; seen.length = 0; listeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ get matches() { return mediaMatches(query); }, media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb), removeEventListener: (_: string, cb: () => void) => listeners.delete(cb) }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each([[390,844,true,true], [667,375,true,true], [844,390,true,true], [915,412,true,true], [932,430,true,true],
  [767,600,false,true], [768,600,true,false], [768,1024,true,false], [1024,768,true,false], [1440,900,false,false],
  [932,430,false,false], [1440,400,true,false]])("chooses the layout on first render at %s×%s (touch=%s)", (w,h,coarse,mobile) => {
  width = w as number; height = h as number; touch = coarse as boolean;
  render();
  expect(seen[0]).toBe(mobile);
  expect(host.querySelector('output')!.textContent).toBe(`${mobile ? "mobile" : "desktop"}:${!mobile}`);
});
it("keeps compact canvas state and closed controls through both orientations", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  function Workspace() {
    const panel = usePanelState();
    return <WorkspaceLayout autoSaveId="orientation-test" panelOpen={panel.panelOpen} onPanelOpenChange={panel.setPanelOpen}
      panel={<div>Settings</div>} canvas={<input aria-label="Canvas state" defaultValue="draft" />} mobileActions={<button>Continue</button>} />;
  }
  React.act(() => root.render(<PanelProvider><Workspace /></PanelProvider>));
  const canvas = host.querySelector('input')!;
  canvas.value = "edited";
  resize(844,390); resize(390,844);
  expect(host.querySelector('input')).toBe(canvas);
  expect(canvas.value).toBe("edited");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("does not remount a tablet workspace while its keyboard shrinks the viewport", () => {
  vi.useFakeTimers(); width = 900; height = 1024;
  render();
  React.act(() => host.querySelector('input')!.focus());
  resize(900,430);
  expect(host.querySelector('output')!.textContent).toBe("desktop:true");
  React.act(() => host.querySelector('input')!.blur());
  resize(900,1024);
  React.act(() => vi.advanceTimersByTime(300));
  expect(host.querySelector('output')!.textContent).toBe("desktop:true");
});
it("unsubscribes its media listeners", () => {
  render(); expect(listeners.size).toBeGreaterThan(0);
  React.act(() => root.render(null)); expect(listeners.size).toBe(0);
});

it.each([false, true])("keeps short touch landscape actions and canvas state in both editor layouts (workflow=%s)", workflow => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("innerWidth", 390); vi.stubGlobal("innerHeight", 844);
  function Workspace() {
    const panel = usePanelState();
    return <WorkspaceLayout autoSaveId="touch-workflow-integration" panelOpen={panel.panelOpen} onPanelOpenChange={panel.setPanelOpen}
      panel={<div>Workflow settings</div>} inspector={workflow ? <input aria-label="Properties" /> : undefined}
      canvas={<input aria-label="Canvas draft" defaultValue="draft" />} mobileActions={<button>Export bin</button>} />;
  }
  React.act(() => root.render(<PanelProvider><Workspace /></PanelProvider>));
  const canvas = host.querySelector<HTMLInputElement>('[aria-label="Canvas draft"]')!;
  canvas.value = "edited";
  resize(932, 430);
  expect(host.querySelector('[data-testid="mobile-workspace-actions"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Canvas draft"]')).toBe(canvas);
  expect(canvas.value).toBe("edited");
  // A tablet's soft keyboard must not substitute phone actions for its panels.
  resize(900, 1024);
  React.act(() => canvas.focus());
  resize(900, 430);
  expect(host.querySelector('[data-testid="mobile-workspace-actions"]')).toBeNull();
  expect(host.querySelector('[aria-label="Canvas draft"]')).toBe(canvas);
});
