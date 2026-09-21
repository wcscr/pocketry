import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HelpDialog } from "./help-dialog";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("keeps GitHub feedback available in Help after the welcome has been dismissed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await React.act(async () => { root.render(<HelpDialog open onOpenChange={() => {}} />); });
    const dialog = document.querySelector('[role="dialog"]')!;
    const github = dialog.querySelector('a[href="https://github.com/wcscr/pocketry/issues/new"]');
    expect(github?.getAttribute("target")).toBe("_blank");
    expect(github?.getAttribute("rel")).toContain("noopener");
  } finally { React.act(() => root.unmount()); }
});
