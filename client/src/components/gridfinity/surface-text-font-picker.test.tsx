import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { surfaceTextSchema, type SurfaceText } from "@shared/gridfinity/surface-text";
import { importLocalFont, inspectSystemFont, type SystemFont } from "@/lib/gridfinity/local-font";
import { SurfaceTextFontPicker } from "./surface-text-font-picker";

vi.mock("@/lib/gridfinity/local-font", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/gridfinity/local-font")>(),
  inspectSystemFont: vi.fn(), importLocalFont: vi.fn(),
}));
const label = surfaceTextSchema.parse({ id: "text", text: "A", position: { x: 0, y: 0 } });
const local = { kind: "local" as const, name: "Test Sans", resolution: 1000,
  glyphs: { A: { ha: 500, o: "m 0 0 l 0 500 l 500 500 l 500 0 l 0 0" } } };
const systemFont = (name: string): SystemFont => ({ family: name, fullName: name, style: "Regular", postscriptName: name, blob: vi.fn(async () => new Blob([name])) });
let root: Root, host: HTMLDivElement;
const change = vi.fn();
const render = (text: SurfaceText = label) => React.act(() => root.render(<TooltipProvider><SurfaceTextFontPicker label={text} id="font" index={0} onChange={change} /></TooltipProvider>));
const open = async () => { await React.act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Text 1 font"]')!.click()); };
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = () => {};
  change.mockReset();
  vi.mocked(inspectSystemFont).mockReset().mockResolvedValue();
  vi.mocked(importLocalFont).mockReset().mockResolvedValue(local);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("unified surface-text font picker", () => {
  it("offers exactly five built-ins without system support or file uploads", async () => {
    render(); await open();
    expect(options().map(option => option.textContent)).toEqual(["Sans", "Sans Bold", "Helvetiker", "Helvetiker Bold", "Monospace"]);
    expect(document.body.textContent).toContain("This browser cannot access system fonts");
    expect(document.querySelector('input[type="file"]')).toBeNull();
    React.act(() => options().find(option => option.textContent === "Sans Bold")!.click());
    expect(change).toHaveBeenCalledWith("sans-bold");
  });

  it("asks on opening, keeps built-ins first, and hides fonts missing the label's characters", async () => {
    const query = vi.fn(async () => [systemFont("Working"), systemFont("Arabic only")]);
    vi.stubGlobal("queryLocalFonts", query);
    vi.mocked(inspectSystemFont).mockImplementation(async (_blob, name) => {
      if (name === "Arabic only") throw new Error("This font does not include A");
    });
    render(); expect(query).not.toHaveBeenCalled(); await open();
    expect(query).toHaveBeenCalledOnce();
    expect(options().slice(0, 5).map(option => option.textContent)).toEqual(["Sans", "Sans Bold", "Helvetiker", "Helvetiker Bold", "Monospace"]);
    expect(options().some(option => option.textContent?.includes("Arabic only"))).toBe(false);
    await React.act(async () => options().find(option => option.textContent === "Working")!.click());
    expect(change).toHaveBeenCalledWith(local);
    expect(importLocalFont).toHaveBeenCalledWith(expect.any(Blob), "Working", "A");
  });

  it("continues past fifty compatible fonts while keeping built-ins first", async () => {
    vi.stubGlobal("queryLocalFonts", vi.fn(async () => Array.from({ length: 75 }, (_, i) => systemFont(`Font ${i.toString().padStart(2, "0")}`))));
    render(); await open();
    expect(options()).toHaveLength(80);
    expect(options().at(-1)!.textContent).toBe("Font 74");
    expect(options()[0].textContent).toBe("Sans");
  });

  it("keeps built-ins usable after permission denial, with an explicit retry", async () => {
    const query = vi.fn().mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError")).mockResolvedValue([]);
    vi.stubGlobal("queryLocalFonts", query);
    render(); await open();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("Font access was not allowed");
    expect(options()).toHaveLength(5);
    await React.act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Retry system font access")!.click());
    expect(query).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("discards a late font import when the selection or wording changes", async () => {
    vi.stubGlobal("queryLocalFonts", vi.fn(async () => [systemFont("Working")]));
    let finish!: (font: typeof local) => void;
    vi.mocked(importLocalFont).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(); await open();
    await React.act(async () => options().find(option => option.textContent === "Working")!.click());
    render({ ...label, id: "other", text: "B" });
    await React.act(async () => finish(local));
    expect(change).not.toHaveBeenCalled();
  });
});

it.each(["saved", "builtin", "close"])("cancels a pending system font import when choosing %s", async choice => {
  vi.stubGlobal("queryLocalFonts", vi.fn(async () => [systemFont("Working")]));
  let finish!: (font: typeof local) => void;
  vi.mocked(importLocalFont).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render({ ...label, font: local }); await open();
  await React.act(async () => options().find(option => option.textContent === "Working")!.click());
  React.act(() => {
    if (choice === "close") host.querySelector<HTMLButtonElement>('[aria-label="Text 1 font"]')!.click();
    else options().find(option => option.textContent === (choice === "saved" ? "Test Sans" : "Sans Bold"))!.click();
  });
  await React.act(async () => finish({ ...local, name: "Working" }));
  if (choice === "builtin") expect(change.mock.calls).toEqual([["sans-bold"]]);
  else expect(change).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="Text 1 font"]')!.getAttribute("aria-expanded")).toBe("false");
});
