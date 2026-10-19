// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CanvasWarnings } from "./canvas-warnings";
import type { ValidationIssue } from "@shared/gridfinity/validate";

it.each([
  { ids: ["hole"], label: "Edit hole" },
  { ids: ["pocket"], label: "Edit pocket" },
  { ids: ["hole", "pocket"], label: "Show objects · click to switch" },
])("identifies the correct object type for a warning action: $label", ({ ids, label }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), reveal = vi.fn();
  const issue: ValidationIssue = { code: "through-island", severity: "error", message: "Retained material is detached.", cutoutIds: ids };
  try {
    React.act(() => root.render(<CanvasWarnings issues={[issue]} holeIds={new Set(["hole"])} selectedCutoutId={null} selectedFingerHoleId={null} onRevealIssue={reveal} />));
    React.act(() => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    const action = host.querySelector<HTMLButtonElement>('[data-issue-code="through-island"]')!;
    expect(action.textContent).toContain(label);
    React.act(() => action.click());
    expect(reveal).toHaveBeenCalledWith(issue);
  } finally { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("offers one explicit arrangement action for oversized axes while retaining size settings", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), arrange = vi.fn(), reveal = vi.fn();
  const issues: ValidationIssue[] = ["x", "y"].map(axis => ({ code: "large-footprint", severity: "warning", message: `Large ${axis} dimension` }));
  try {
    React.act(() => root.render(<CanvasWarnings issues={issues} selectedCutoutId={null} selectedFingerHoleId={null} onRevealIssue={reveal} onAutoArrange={arrange} />));
    React.act(() => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    expect(arrange).not.toHaveBeenCalled();
    expect(host.querySelectorAll('[data-testid="button-warning-auto-arrange"]')).toHaveLength(1);
    expect(host.textContent).toContain("moves and rotates all pockets and may resize the bin");
    expect(host.textContent).toContain("Undo restores your layout");
    React.act(() => host.querySelector<HTMLButtonElement>('[data-issue-code="large-footprint"]')!.click());
    expect(reveal).toHaveBeenCalledWith(issues[0]);
    expect(arrange).not.toHaveBeenCalled();
    React.act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-warning-auto-arrange"]')!.click());
    expect(arrange).toHaveBeenCalledOnce();
    React.act(() => root.render(<CanvasWarnings issues={[{code:"no-infill-space",severity:"warning",message:"No fill"}]} selectedCutoutId={null} selectedFingerHoleId={null} onRevealIssue={reveal} onAutoArrange={arrange} />));
    expect(host.querySelector('[data-testid="compact-layout-action"]')).toBeNull();
  } finally { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
