import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HelpDialog } from "./help-dialog";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("keeps feedback destinations available in Help after the welcome has been dismissed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await React.act(async () => { root.render(<HelpDialog open onOpenChange={() => {}} />); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('a[href="mailto:pocketry@sugarcreekresearch.com"]')?.textContent).toBe("Email feedback");
    const github = dialog.querySelector('a[href="https://github.com/wcscr/pocketry/issues/new"]');
    expect(github?.getAttribute("target")).toBe("_blank");
    expect(github?.getAttribute("rel")).toContain("noopener");
    expect(dialog.textContent).toContain("Higher Simplification values use fewer points");
  } finally { React.act(() => root.unmount()); }
});
