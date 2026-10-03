import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import type { LocalFont } from "@shared/gridfinity/local-font";
import { extendLocalFont } from "@/lib/gridfinity/local-font";
import { SurfaceTextProperties } from "./surface-text-controls";
import { SurfaceTextLayer } from "./surface-text-layer";

vi.mock("./surface-text-font-picker", () => ({ SurfaceTextFontPicker: () => null }));
vi.mock("@/lib/gridfinity/local-font", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/gridfinity/local-font")>(), extendLocalFont: vi.fn(),
}));
const glyph = { ha: 600, o: "m 0 0 l 0 500 l 500 500 l 500 0 l 0 0" };
const localFont: LocalFont = { kind: "local", name: "Saved font", resolution: 1000,
  source: { data: "AA==", byteLength: 1 }, glyphs: { A: glyph } };
const extended = (text: string): LocalFont => ({ ...localFont, glyphs: Object.fromEntries([...text].map(char => [char, glyph])) });
const cleanups: (() => void)[] = [];
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.mocked(extendLocalFont).mockReset(); });
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });

function mount(mode: "properties" | "inline", system = false) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let bin!: BinStore;
  function Scene() { bin = useBin(); return mode === "properties" ? <SurfaceTextProperties /> : <svg><SurfaceTextLayer interactive /></svg>; }
  React.act(() => root.render(<BinProvider><Scene /></BinProvider>));
  const first = surfaceTextSchema.parse({ id: "first", text: "A", font: system ? localFont : "sans", position: { x: 0, y: 0 } });
  const second = surfaceTextSchema.parse({ id: "second", text: "Second", position: { x: 0, y: 15 } });
  React.act(() => {
    bin.dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: [first, second] }, historyLabel: "Add labels" });
    bin.dispatch({ type: "SELECT_SURFACE_TEXT", id: first.id });
  });
  const edit = () => {
    if (mode === "inline") React.act(() => host.querySelector('[data-testid="surface-text-hit-first"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 })));
    const input = host.querySelector<HTMLInputElement>(mode === "properties" ? '[data-testid="surface-text-editor"] input[type="text"]' : '[aria-label="Edit surface text wording"]')!;
    React.act(() => input.focus());
    return input;
  };
  const change = (input: HTMLInputElement, value: string) => React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const select = (id: string) => React.act(() => bin.dispatch({ type: "SELECT_SURFACE_TEXT", id }));
  cleanups.push(() => { React.act(() => root.unmount()); host.remove(); });
  return { getBin: () => bin, host, first, second, edit, change, select };
}

describe.each(["properties", "inline"] as const)("%s wording ownership", mode => {
  it("commits a valid draft when canvas selection unmounts the focused editor before blur", () => {
    const { getBin, first, second, edit, change, select } = mount(mode);
    const historySize = getBin().history.stack.length;
    change(edit(), "Edited first");
    select(second.id);
    expect(getBin().selectedSurfaceTextId).toBe(second.id);
    expect(getBin().spec.surfaceTexts).toEqual([{ ...first, text: "Edited first" }, second]);
    expect(getBin().history.stack).toHaveLength(historySize + 1);
    React.act(() => getBin().dispatch({ type: "UNDO" }));
    expect(getBin().spec.surfaceTexts).toEqual([first, second]);
  });

  it("finishes saved-font glyph extension after changing selection, with one undo entry", async () => {
    let finish!: (font: LocalFont) => void;
    vi.mocked(extendLocalFont).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { getBin, second, edit, change, select } = mount(mode, true);
    const historySize = getBin().history.stack.length;
    change(edit(), "AB"); select(second.id);
    expect(extendLocalFont).toHaveBeenCalledExactlyOnceWith(localFont, "AB");
    expect(getBin().spec.surfaceTexts[0].text).toBe("A");
    await React.act(async () => finish(extended("AB")));
    expect(getBin().selectedSurfaceTextId).toBe(second.id);
    expect(getBin().spec.surfaceTexts[0]).toMatchObject({ text: "AB", font: { glyphs: { B: glyph } } });
    expect(getBin().spec.surfaceTexts[1]).toEqual(second);
    expect(getBin().history.stack).toHaveLength(historySize + 1);
    React.act(() => getBin().dispatch({ type: "UNDO" }));
    expect(getBin().spec.surfaceTexts[0].text).toBe("A");
  });

  it.each(["undo", "new document edit", "active preview", "project replacement"])("discards late glyph extension after %s", async interruption => {
    let finish!: (font: LocalFont) => void;
    vi.mocked(extendLocalFont).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { getBin, second, edit, change, select } = mount(mode, true);
    change(edit(), "AB"); select(second.id);
    React.act(() => {
      if (interruption === "undo") getBin().dispatch({ type: "UNDO" });
      else if (interruption === "active preview") getBin().dispatch({ type: "PATCH_SPEC", patch: { textColor: "#123456" }, transient: true, historyLabel: "Change color" });
      else if (interruption === "new document edit") getBin().dispatch({ type: "PATCH_SPEC", patch: { textColor: "#123456" }, historyLabel: "Change color" });
      else getBin().dispatch({ type: "HYDRATE", spec: { ...getBin().spec, surfaceTexts: [] }, cutouts: [], fingerHoles: [] });
    });
    const spec = getBin().spec, history = getBin().history;
    await React.act(async () => finish(extended("AB")));
    expect(getBin().spec).toBe(spec);
    expect(getBin().history).toBe(history);
  });

  it("a newer draft cancels old conversion even before the new draft is committed", async () => {
    const finishes: ((font: LocalFont) => void)[] = [];
    vi.mocked(extendLocalFont).mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
    const { getBin, first, second, edit, change, select } = mount(mode, true);
    change(edit(), "AB"); select(second.id);
    select(first.id);
    const input = edit(); change(input, "AC");
    await React.act(async () => finishes[0](extended("AB")));
    expect(getBin().spec.surfaceTexts[0].text).toBe("A");
    React.act(() => input.blur());
    await React.act(async () => finishes[1](extended("AC")));
    expect(getBin().spec.surfaceTexts[0].text).toBe("AC");
  });

  it("does not commit invalid wording when selection changes", () => {
    const { getBin, first, second, edit, change, select } = mount(mode);
    const history = getBin().history;
    change(edit(), " "); select(second.id);
    expect(getBin().spec.surfaceTexts).toEqual([first, second]);
    expect(getBin().history).toBe(history);
  });
});

it("Escape cancels a pending inline glyph conversion", async () => {
  let finish!: (font: LocalFont) => void;
  vi.mocked(extendLocalFont).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { getBin, host, edit, change } = mount("inline", true);
  const input = edit(); change(input, "AB");
  React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector("input")).toBeNull();
  const history = getBin().history;
  await React.act(async () => finish(extended("AB")));
  expect(getBin().spec.surfaceTexts[0].text).toBe("A");
  expect(getBin().history).toBe(history);
});
