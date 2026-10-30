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
    const ultim8 = dialog.querySelector('#ultim8-help-title a[href="https://www.whambamsystems.com/pages/ultim8-jig"]');
    expect(ultim8?.textContent).toBe("ULTIM8™");
    expect(ultim8?.getAttribute("target")).toBe("_blank");
    expect(ultim8?.getAttribute("rel")).toContain("noopener");
    expect(dialog.querySelector('#ultim8-fixtures a[href="/ultim8"]')).not.toBeNull();
    expect(dialog.querySelector('#ultim8-fixtures')?.textContent).toContain("not affiliated with or endorsed");
  } finally { React.act(() => root.unmount()); }
});
