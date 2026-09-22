import * as React from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/app-shell";
it("keeps the shell within the visible viewport while typing and restores its normal height", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const viewport = Object.assign(new EventTarget(), {height:844,offsetTop:0,scale:1});
  vi.stubGlobal("visualViewport",viewport);
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    React.act(()=>root.render(<AppShell><input/></AppShell>));
    const shell=host.firstElementChild as HTMLElement;
    React.act(()=>host.querySelector('input')!.focus());
    React.act(()=>{viewport.height=440;viewport.offsetTop=30;viewport.dispatchEvent(new Event("resize"));});
    expect(shell.style.height).toBe("440px");expect(shell.style.marginTop).toBe("30px");
    React.act(()=>host.querySelector('input')!.blur());
    expect(shell.style.height).toBe("");expect(shell.style.marginTop).toBe("");
  } finally {React.act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
