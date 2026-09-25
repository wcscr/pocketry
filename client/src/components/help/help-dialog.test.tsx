import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HelpDialog } from "./help-dialog";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Ultim8Help from "@/pages/ultim8-help";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("opens each private feedback kind from Help", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host); const feedback = vi.fn();
  try {
    await React.act(async () => { root.render(<HelpDialog open onOpenChange={() => {}} onFeedbackClick={feedback} />); });
    for (const text of ["Report a Problem", "Make a Suggestion"]) {
      React.act(() => Array.from(document.querySelectorAll("button")).find((button) => button.textContent === text)!.click());
    }
    expect(feedback.mock.calls).toEqual([["problem"], ["suggestion"]]);
  } finally { React.act(() => root.unmount()); }
});

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
    expect(dialog.querySelector('a[href="/help/ultim8"]')?.textContent).toBe("ULTIM8-compatible fixture guide");
    expect(dialog.textContent?.match(/ULTIM8/g)).toHaveLength(1);
    expect(dialog.querySelector('a[href="/ultim8"]')).toBeNull();
    expect(dialog.querySelector('#ultim8-fixtures')).toBeNull();
  } finally { React.act(() => root.unmount()); }
});

it("closes general Help when following the separate fixture guide", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const route = memoryLocation({ path: "/bin", record: true });
  const onOpenChange = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(<Router hook={route.hook}><HelpDialog open onOpenChange={onOpenChange} /></Router>));
    await React.act(async () => document.querySelector<HTMLAnchorElement>('a[href="/help/ultim8"]')!.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(route.history).toEqual(["/bin", "/help/ultim8"]);
    await React.act(async () => root.render(<Router hook={route.hook}><Ultim8Help /></Router>));
    expect(host.querySelector("h1")?.textContent).toBe("ULTIM8-compatible fixture guide");
    expect(host.querySelector('a[href="/ultim8"]')?.textContent).toBe("Start or open a fixture");
    expect(host.querySelector('a[href="/bin"]')?.textContent).toBe("Return to Bin");
    const ultim8 = host.querySelector('a[href="https://www.whambamsystems.com/pages/ultim8-jig"]');
    expect(ultim8?.getAttribute("target")).toBe("_blank");
    expect(ultim8?.getAttribute("rel")).toContain("noopener");
    expect(host.textContent).toContain("not affiliated with or endorsed");
  } finally { React.act(() => root.unmount()); }
});
