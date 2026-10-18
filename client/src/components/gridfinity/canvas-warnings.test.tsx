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
