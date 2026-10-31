// Text editing, portable fonts and history work with experimental tools off.
vi.mock("@/state/experimental-features", () => ({ useExperimentalFeatures: () => ({ enabled: false, setEnabled: vi.fn() }) }));
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
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
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.mocked(extendLocalFont).mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = () => {};
});
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
    const input = host.querySelector<HTMLInputElement>(mode === "properties" ? '[data-testid="surface-text-editor"] input[type="text"]' : '[aria-label="Edit surface text"]')!;
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

it("restricts hollow labels to tabs, preserves their design, and undoes the fill change as one edit", () => {
  const { host, getBin, first, second } = mount("properties");
  const surface = () => host.querySelector<HTMLButtonElement>('[aria-label="Text surface"]')!;
  expect(surface().disabled).toBe(false);
  expect(surface().textContent).toBe("Bin surface");
  const historySize = getBin().history.stack.length;
  React.act(() => getBin().dispatch({ type: "PATCH_SPEC", patch: { fill: "none" }, historyLabel: "Hollow bin" }));
  const retargeted = [first, second].map(label => ({ ...label, surface: "label-tab" }));
  expect(getBin().spec.surfaceTexts).toEqual(retargeted);
  expect(surface().textContent).toBe("Label tabs");
  expect(surface().disabled).toBe(true);
  expect(host.textContent).toContain("Enable label tabs in Construction");
  expect(getBin().history.stack).toHaveLength(historySize + 1);
  const saved = parseProjectDoc(JSON.parse(JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION,
    shapes: [], spec: getBin().spec, cutouts: [], fingerHoles: [], history: getBin().history })))!;
  expect(saved.spec.surfaceTexts).toEqual(retargeted);
  expect(saved.history!.stack.at(-1)!.doc.spec.surfaceTexts).toEqual(retargeted);
  React.act(() => getBin().dispatch({ type: "UNDO" }));
  expect(getBin().spec.fill).toBe("solid");
  expect(getBin().spec.surfaceTexts).toEqual([first, second]);
  expect(surface().disabled).toBe(false);
  React.act(() => getBin().dispatch({ type: "REDO" }));
  expect(getBin().spec.surfaceTexts).toEqual(retargeted);
  expect(surface().disabled).toBe(true);
  React.act(() => getBin().dispatch({ type: "PATCH_SPEC", patch: { labelTab: { wall: "south", width: "full", edge: null } } }));
  expect(host.textContent).not.toContain("Enable label tabs in Construction");
  expect(getBin().spec.surfaceTexts).toEqual(retargeted);
});

it("keeps both surface choices for solid fill and never restores a floor target while hollow", () => {
  const { host, getBin, first } = mount("properties");
  React.act(() => getBin().dispatch({ type: "PATCH_SPEC", patch: { labelTab: { wall: "south", width: "full", edge: null } } }));
  React.act(() => host.querySelector('[aria-label="Text surface"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(options.map(option => option.textContent)).toEqual(["Bin surface", "Label tabs"]);
  React.act(() => options.find(option => option.textContent === "Label tabs")!.click());
  expect(getBin().spec.surfaceTexts[0].surface).toBe("label-tab");
  React.act(() => getBin().dispatch({ type: "PATCH_SPEC", patch: { fill: "none", surfaceTexts: [{ ...first, surface: "bin" }] } }));
  expect(getBin().spec.surfaceTexts).toEqual([{ ...first, surface: "label-tab" }]);
});

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

const openSymbols = async (host: HTMLElement) => {
  await React.act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Hardware symbol"]')!.click());
};
const symbolOption = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === name)!;

it("chooses a symbol with an empty draft, saves and undoes it, and prevents an empty label", async () => {
  const { host, edit, change, getBin, first } = mount("properties");
  const input = edit(); change(input, ""); React.act(() => input.blur());
  expect(getBin().spec.surfaceTexts[0]).toEqual(first);
  await openSymbols(host);
  expect(document.querySelector('a[href="https://github.com/ndevenish/gflabel"]')).not.toBeNull();
  expect(document.querySelector('a[href="/licenses/gflabel.txt"]')).not.toBeNull();
  React.act(() => symbolOption("Hex nut").click());
  expect(getBin().spec.surfaceTexts[0]).toMatchObject({ text: "", symbol: "hex-nut" });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await openSymbols(host);
  expect(symbolOption("None").getAttribute("aria-disabled")).toBe("true");
  React.act(() => symbolOption("None").click());
  expect(getBin().spec.surfaceTexts[0].symbol).toBe("hex-nut");
  React.act(() => host.querySelector<HTMLButtonElement>('[aria-label="Hardware symbol"]')!.click());
  React.act(() => getBin().dispatch({ type: "UNDO" }));
  expect(getBin().spec.surfaceTexts[0]).toEqual(first);
  React.act(() => getBin().dispatch({ type: "REDO" }));
  expect(getBin().spec.surfaceTexts[0]).toMatchObject({ text: "", symbol: "hex-nut" });
  const wording = edit(); change(wording, "M3"); React.act(() => wording.blur());
  await openSymbols(host); React.act(() => symbolOption("None").click());
  expect(getBin().spec.surfaceTexts[0]).toMatchObject({ text: "M3" });
  expect(getBin().spec.surfaceTexts[0].symbol).toBeUndefined();
});

it("searches by drive alias and selects with the keyboard", async () => {
  const { host, change, getBin } = mount("properties");
  await openSymbols(host);
  const search = document.querySelector<HTMLInputElement>('[aria-label="Search hardware symbols"]')!;
  change(search, "allen");
  await React.act(async () => {});
  expect(document.querySelector('[role="option"]')!.textContent).toBe("Hex socket");
  React.act(() => search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(getBin().spec.surfaceTexts[0].symbol).toBe("hex-drive");
  expect(host.querySelector('[aria-label="Hardware symbol"]')!.getAttribute("aria-expanded")).toBe("false");
});

it("rotates the symbol alone with one undo entry and retains its angle across wording and symbol changes", async () => {
  const { host, edit, change, getBin } = mount("properties");
  const rotation = () => host.querySelector<HTMLInputElement>('[aria-label="Symbol rotation (°)"]');
  expect(rotation()).toBeNull();
  await openSymbols(host); React.act(() => symbolOption("Socket-head bolt").click());
  expect(rotation()!.value).toBe("0");
  const before = getBin().spec.surfaceTexts[0], historySize = getBin().history.stack.length;
  const originalPreview = host.querySelector('[data-symbol-preview]')!.innerHTML;
  React.act(() => rotation()!.focus()); change(rotation()!, "45"); change(rotation()!, "90");
  React.act(() => rotation()!.blur());
  expect(getBin().spec.surfaceTexts[0]).toEqual({ ...before, symbolRotationDeg: 90 });
  expect(getBin().history.stack).toHaveLength(historySize + 1);
  expect(host.querySelector('[data-symbol-preview]')!.innerHTML).not.toBe(originalPreview);
  React.act(() => getBin().dispatch({ type: "UNDO" }));
  expect(getBin().spec.surfaceTexts[0]).toEqual(before);
  expect(rotation()!.value).toBe("0");
  React.act(() => getBin().dispatch({ type: "REDO" }));
  expect(rotation()!.value).toBe("90");
  const wording = edit(); change(wording, "M3"); React.act(() => wording.blur());
  expect(getBin().spec.surfaceTexts[0]).toMatchObject({ text: "M3", symbolRotationDeg: 90, rotationDeg: 0 });
  await openSymbols(host); React.act(() => symbolOption("None").click());
  expect(rotation()).toBeNull();
  expect(getBin().spec.surfaceTexts[0].symbolRotationDeg).toBe(90);
  await openSymbols(host); React.act(() => symbolOption("Self-tapping screw").click());
  expect(rotation()!.value).toBe("90");
});

it("cancels symbol rotation and rejects an invalid angle without changing history", async () => {
  const { host, change, getBin } = mount("properties");
  await openSymbols(host); React.act(() => symbolOption("Pan-head screw").click());
  const input = host.querySelector<HTMLInputElement>('[aria-label="Symbol rotation (°)"]')!;
  const before = getBin().spec.surfaceTexts[0], history = getBin().history;
  React.act(() => input.focus()); change(input, "45");
  React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(getBin().spec.surfaceTexts[0]).toEqual(before);
  expect(getBin().history).toBe(history);
  React.act(() => input.focus()); change(input, "181"); React.act(() => input.blur());
  expect(getBin().spec.surfaceTexts[0]).toEqual(before);
  expect(getBin().history).toBe(history);
  expect(input.getAttribute("aria-invalid")).toBe("true");
});

it("keeps text and symbol sizes independent, retains them across symbol changes, and undoes each edit once", async () => {
  const { host, change, getBin, edit } = mount("properties");
  const field = (name: string) => host.querySelector<HTMLInputElement>(`[aria-label="${name} (mm)"]`)!;
  const resize = (name: string, value: string) => {
    const input = field(name); React.act(() => input.focus()); change(input, value); React.act(() => input.blur());
  };
  expect(field("Symbol size")).toBeNull();
  await openSymbols(host); React.act(() => symbolOption("Socket-head bolt").click());
  expect(field("Symbol size").value).toBe("6");
  const before = getBin().spec.surfaceTexts[0], historySize = getBin().history.stack.length;
  resize("Text size", "10");
  expect(getBin().spec.surfaceTexts[0]).toEqual({ ...before, sizeMm: 10, symbolSizeMm: 6 });
  expect(getBin().history.stack).toHaveLength(historySize + 1);
  React.act(() => getBin().dispatch({ type: "UNDO" }));
  expect(getBin().spec.surfaceTexts[0]).toEqual(before);
  React.act(() => getBin().dispatch({ type: "REDO" }));
  resize("Symbol size", "12");
  expect(getBin().spec.surfaceTexts[0]).toMatchObject({ sizeMm: 10, symbolSizeMm: 12 });
  expect(getBin().history.stack).toHaveLength(historySize + 2);
  React.act(() => getBin().dispatch({ type: "UNDO" }));
  expect(field("Symbol size").value).toBe("6");
  React.act(() => getBin().dispatch({ type: "REDO" }));
  await openSymbols(host); React.act(() => symbolOption("None").click());
  expect(field("Symbol size")).toBeNull();
  resize("Text size", "8");
  await openSymbols(host); React.act(() => symbolOption("Self-tapping screw").click());
  expect(field("Symbol size").value).toBe("12");
  const input = edit(); change(input, ""); React.act(() => input.blur());
  resize("Symbol size", "15");
  expect(getBin().spec.surfaceTexts[0]).toMatchObject({ text: "", sizeMm: 8, symbolSizeMm: 15 });
});

it.each(["Text size", "Symbol size", "Text gap"])("cancels %s drafts and rejects invalid values without undo noise", async name => {
  const { host, change, getBin } = mount("properties");
  await openSymbols(host); React.act(() => symbolOption("Hex nut").click());
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${name} (mm)"]`)!;
  const before = getBin().spec.surfaceTexts[0], history = getBin().history;
  React.act(() => input.focus()); change(input, "12");
  React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(getBin().spec.surfaceTexts[0]).toEqual(before);
  expect(getBin().history).toBe(history);
  React.act(() => input.focus()); change(input, "41"); React.act(() => input.blur());
  expect(getBin().spec.surfaceTexts[0]).toEqual(before);
  expect(getBin().history).toBe(history);
});

it("edits the text gap once, preserves leading spaces, and retains the gap through content changes", async () => {
  const { host, change, getBin, edit } = mount("properties");
  const gap = () => host.querySelector<HTMLInputElement>('[aria-label="Text gap (mm)"]');
  expect(gap()).toBeNull();
  await openSymbols(host); React.act(() => symbolOption("Socket-head bolt").click());
  expect(gap()!.value).toBe("1.5");
  const before = getBin().spec.surfaceTexts[0], historySize = getBin().history.stack.length;
  React.act(() => gap()!.focus()); change(gap()!, "3"); change(gap()!, "4.5");
  React.act(() => gap()!.blur());
  expect(getBin().spec.surfaceTexts[0]).toEqual({ ...before, symbolGapMm: 4.5 });
  expect(getBin().history.stack).toHaveLength(historySize + 1);
  React.act(() => getBin().dispatch({ type: "UNDO" }));
  expect(getBin().spec.surfaceTexts[0]).toEqual(before);
  React.act(() => getBin().dispatch({ type: "REDO" }));
  const wording = edit(); change(wording, "  M3"); React.act(() => wording.blur());
  expect(getBin().spec.surfaceTexts[0]).toMatchObject({ text: "  M3", symbolGapMm: 4.5 });
  const size = host.querySelector<HTMLInputElement>('[aria-label="Text size (mm)"]')!;
  React.act(() => size.focus()); change(size, "10"); React.act(() => size.blur());
  expect(gap()!.value).toBe("4.5");
  const blank = edit(); change(blank, ""); React.act(() => blank.blur());
  expect(gap()).toBeNull();
  const restored = edit(); change(restored, "M3"); React.act(() => restored.blur());
  expect(gap()!.value).toBe("4.5");
  await openSymbols(host); React.act(() => symbolOption("None").click());
  expect(gap()).toBeNull();
  await openSymbols(host); React.act(() => symbolOption("Self-tapping screw").click());
  expect(gap()!.value).toBe("4.5");
  React.act(() => gap()!.focus()); change(gap()!, "0"); React.act(() => gap()!.blur());
  expect(getBin().spec.surfaceTexts[0].symbolGapMm).toBe(0);
});

it("keeps pending wording when choosing a symbol and ignores the superseded font result", async () => {
  const finishes: ((font: LocalFont) => void)[] = [];
  vi.mocked(extendLocalFont).mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
  const { host, edit, change, getBin } = mount("properties", true);
  const input = edit(); change(input, "AB"); React.act(() => input.blur());
  await openSymbols(host); React.act(() => symbolOption("Washer").click());
  expect(finishes).toHaveLength(2);
  await React.act(async () => finishes[0](extended("AB")));
  expect(getBin().spec.surfaceTexts[0].text).toBe("A");
  await React.act(async () => finishes[1](extended("AB")));
  expect(getBin().spec.surfaceTexts[0]).toMatchObject({ text: "AB", symbol: "washer", font: { glyphs: { B: glyph } } });
  React.act(() => getBin().dispatch({ type: "UNDO" }));
  expect(getBin().spec.surfaceTexts[0]).toMatchObject({ text: "A" });
  expect(getBin().spec.surfaceTexts[0].symbol).toBeUndefined();
});
