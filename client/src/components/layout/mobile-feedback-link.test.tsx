import * as React from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MobileFeedbackLink } from "./mobile-feedback-link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

it("keeps feedback behind More options and never opens a welcome modal", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    React.act(() => root.render(<DropdownMenu><DropdownMenuTrigger>More options</DropdownMenuTrigger>
      <DropdownMenuContent><MobileFeedbackLink /></DropdownMenuContent></DropdownMenu>));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('a[href="https://github.com/wcscr/pocketry/issues/new"]')).toBeNull();
    React.act(() => host.querySelector('button')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const link = document.querySelector<HTMLAnchorElement>('a[href="https://github.com/wcscr/pocketry/issues/new"]')!;
    expect(link.textContent).toContain("Give mobile feedback");
    expect(link.rel).toBe("noopener noreferrer");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
