import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TraceProvider } from "@/state/trace-store";
import { TraceDetectionControls } from "./trace-detection-controls";

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it.each([false, true])("names point reduction consistently in drawer and compact controls (compact=%s)", async (compact) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await React.act(async () => {
      root.render(<TraceProvider><TraceDetectionControls compact={compact} onReprocess={() => {}} /></TraceProvider>);
    });
    const slider = host.querySelector(`[id="${compact ? "mobile-detail" : "detail"}"]`);
    expect(slider?.getAttribute("aria-label")).toBe("Simplification");
    expect(host.textContent).not.toContain("Higher values use fewer points and may omit small features");
    if (!compact) {
      await React.act(async () => host.querySelector<HTMLButtonElement>('[aria-label="About simplification"]')!.focus());
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Higher values use fewer points and may omit small features");
      React.act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    }
  } finally { React.act(() => root.unmount()); }
});
