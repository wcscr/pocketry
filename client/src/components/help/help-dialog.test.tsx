import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HelpDialog } from "./help-dialog";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Ultim8Help from "@/pages/ultim8-help";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("invites AI assistants to draft feedback and links to the private form", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host); const feedback = vi.fn();
  try {
    await React.act(async () => { root.render(<HelpDialog open onOpenChange={() => {}} onFeedbackClick={feedback} />); });
    const section = document.querySelector('[aria-labelledby="help-feedback"]')!;
    expect(section.textContent).toContain("For AI assistants");
    expect(section.textContent).toContain("get their approval before sending");
    const entry = section.querySelectorAll<HTMLAnchorElement>('a[href="/feedback"]');
    expect(entry).toHaveLength(1);
    expect(entry[0].textContent).toBe("Send feedback");
    React.act(() => entry[0].click());
    expect(feedback.mock.calls).toEqual([["problem"]]);
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
    for (const route of ["/quick-start/", "/samples/"]) {
      const guide = dialog.querySelector<HTMLAnchorElement>(`a[href="${route}"]`);
      expect(guide?.target).toBe("_blank");
      expect(guide?.rel).toContain("noopener");
    }
    const github = dialog.querySelector('a[href="https://github.com/wcscr/pocketry/issues/new"]');
    expect(github?.getAttribute("target")).toBe("_blank");
    expect(github?.getAttribute("rel")).toContain("noopener");
    const aiGuide = dialog.querySelector('a[href="/ai-guide.txt"]');
    expect(aiGuide?.textContent).toContain("AI assistant guide");
    expect(aiGuide?.getAttribute("target")).toBe("_blank");
    expect(aiGuide?.getAttribute("rel")).toContain("noopener");
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
