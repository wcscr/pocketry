// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { curvesFromOutline } from "@shared/geometry/curves";
import type { Calibration } from "@shared/geometry/scale";
import type { Outline } from "@shared/geometry/types";

import { TooltipProvider } from "@/components/ui/tooltip";
import { generateOutlineSVG } from "@/lib/export/svg";
import { normalizeOutline, outlineBounds } from "@/lib/geometry/outline";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";

import { TraceControlsPanel } from "./trace-controls-panel";
import { useTraceHandoff } from "./trace-handoff";
import { TraceOutlineImport } from "./trace-outline-import";

const IMAGE_URL = "data:image/png;base64,photo";
const PHOTO = { width: 800, height: 600 };
/** 0.25 mm per pixel. */
const CALIBRATION: Calibration = { startX: 0, startY: 0, endX: 400, endY: 0, lengthMm: 100 };
const REGION = { x: 400, y: 200, width: 300, height: 200 };

const DETECTED: Outline = normalizeOutline([
  { outer: [{ x: 420, y: 220 }, { x: 680, y: 220 }, { x: 680, y: 380 }, { x: 420, y: 380 }], holes: [] },
]);
/** What a previous session traced from this photo, hole included. */
const SAVED: Outline = normalizeOutline([
  { outer: [{ x: 100.25, y: 80.5 }, { x: 420, y: 80.5 }, { x: 420, y: 300.75 }, { x: 260.13, y: 190 }, { x: 100.25, y: 300.75 }],
    holes: [[{ x: 150, y: 120 }, { x: 200, y: 120 }, { x: 200, y: 160 }, { x: 150, y: 160 }]] },
  { outer: [{ x: 600, y: 400 }, { x: 700, y: 400 }, { x: 650.5, y: 520.25 }], holes: [] },
]);
const SAVED_SVG = generateOutlineSVG(SAVED, { ...PHOTO, calibration: CALIBRATION });
const PHYSICAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="10" y="20" width="60" height="30"/></svg>';

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const imported = vi.fn();
let trace: TraceStore;
let host: HTMLDivElement;
let root: Root;

function Control(): JSX.Element {
  trace = useTrace();
  return <TraceOutlineImport onImported={imported} />;
}

function Panel(): JSX.Element {
  trace = useTrace();
  const handoff = useTraceHandoff();
  return <TraceControlsPanel handoff={handoff} onCanvasInteraction={imported} onReplaceImage={() => {}} onStartOver={() => {}}
    onRotateImage={() => {}} onExport={() => {}} onReprocess={() => {}} onDetectMarkers={() => {}} onApplyPerspective={() => {}} />;
}

function render(node: JSX.Element): void {
  React.act(() => root.render(<TooltipProvider><ShapeLibraryProvider><TraceProvider>{node}</TraceProvider></ShapeLibraryProvider></TooltipProvider>));
}

/** A calibrated photo with a detection region, as the Outline step requires. */
function loadPhoto({ scale = true, region = true, detected = false } = {}): void {
  React.act(() => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: IMAGE_URL, fileName: "wrench" });
    trace.dispatch({ type: "SOURCE_READY", imageSize: PHOTO });
    if (scale) trace.dispatch({ type: "SET_CALIBRATION", calibration: CALIBRATION });
    if (region) {
      trace.dispatch({ type: "SET_REGION", region: REGION });
      trace.dispatch({ type: "REGION_COMMITTED" });
    }
    if (detected) trace.dispatch({ type: "DETECTED", imageUrl: IMAGE_URL, outline: DETECTED, rawOutline: DETECTED, svg: "", region: REGION });
  });
}

const button = (testId: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
const click = (testId: string) => React.act(() => button(testId)!.click());
const alertText = () => document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? null;
const summary = () => document.querySelector('[data-testid="import-outline-summary"]')?.textContent ?? null;

function selectFile(text: string, options: { size?: number; read?: () => Promise<string> } = {}): void {
  const file = new File([text], "outline.svg", { type: "image/svg+xml" });
  Object.defineProperty(file, "text", { value: options.read ?? (() => Promise.resolve(text)) });
  if (options.size !== undefined) Object.defineProperty(file, "size", { value: options.size });
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Choose a file and let its read settle. */
async function choose(text: string, options: { size?: number; read?: () => Promise<string> } = {}): Promise<void> {
  await React.act(async () => { selectFile(text, options); });
}

function typeWidth(value: string): void {
  React.act(() => {
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input:not([type="file"])')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  imported.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("TraceOutlineImport", () => {
  it("returns an export of this photo to its pixels as one undoable edit", async () => {
    render(<Control />);
    loadPhoto();
    click("button-import-outline");
    expect(button("button-import-outline-confirm")!.disabled).toBe(true);
    await choose(SAVED_SVG);
    expect(alertText()).toBeNull();
    expect(summary()).toContain("149.94 × 109.94 mm, 3 contours");
    expect(summary()).toContain("keep their positions");
    expect(document.querySelector('[role="dialog"] input:not([type="file"])')).toBeNull();
    click("button-import-outline-confirm");

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(imported).toHaveBeenCalledOnce();
    expect(trace.outline).toEqual(SAVED);
    // The existing editing tools take over: edit mode, imported contour selected.
    expect(trace.mode).toBe("edit");
    expect(trace.selection).toEqual({ shapeIndex: 0, ringIndex: -1 });
    expect(trace.history.stack.map(entry => entry.label)).toEqual(["Start", "Import outline"]);
    expect(trace.history.stack[1]).toMatchObject({ hasManualEdits: true, refinementBase: trace.outline });

    React.act(() => trace.undo());
    expect(trace.outline).toEqual([]);
    expect(trace.canUndo).toBe(false);
    React.act(() => trace.redo());
    expect(trace.outline).toEqual(SAVED);
  });

  it("replaces a detected outline, and Undo brings the detection back", async () => {
    render(<Control />);
    loadPhoto({ detected: true });
    React.act(() => trace.dispatch({ type: "SET_MODE", mode: "edit" }));
    click("button-import-outline");
    await choose(SAVED_SVG);
    expect(button("button-import-outline-confirm")).toBeNull();
    click("button-import-outline-replace");

    expect(trace.outline).toEqual(SAVED);
    expect(trace.selection).toEqual({ shapeIndex: 0, ringIndex: -1 });
    expect(trace.history.stack.map(entry => entry.label)).toEqual(["Detected outline", "Replace outline with import"]);
    React.act(() => trace.undo());
    expect(trace.outline).toBe(DETECTED);
    expect(trace.history.index).toBe(0);
  });

  it("adds to the current outline without disturbing existing contours", async () => {
    render(<Control />);
    loadPhoto({ detected: true });
    click("button-import-outline");
    await choose(SAVED_SVG);
    click("button-import-outline-add");

    expect(trace.outline).toHaveLength(3);
    expect(trace.outline[0]).toBe(DETECTED[0]);
    expect(trace.outline.slice(1)).toEqual(SAVED);
    // The largest imported contour is selected, not the one that was already there.
    expect(trace.selection).toEqual({ shapeIndex: 1, ringIndex: -1 });
    expect(trace.history.stack.at(-1)!.label).toBe("Import outline");
    React.act(() => trace.undo());
    expect(trace.outline).toBe(DETECTED);
  });

  it("joins editable curves without disturbing them, and Undo restores them", async () => {
    render(<Control />);
    loadPhoto({ detected: true });
    React.act(() => trace.dispatch({ type: "CURVES_COMMITTED", curves: curvesFromOutline(DETECTED), label: "Enable curves" }));
    const curves = trace.curves!;
    expect(curves).toHaveLength(1);
    click("button-import-outline");
    await choose(SAVED_SVG);
    expect(alertText()).toBeNull();
    click("button-import-outline-add");
    expect(trace.curves).toHaveLength(3);
    expect(trace.curves![0]).toEqual(curves[0]);
    // Straight anchors sample back to exactly the imported points.
    expect(trace.outline.slice(1)).toEqual(SAVED);
    expect(trace.selection).toEqual({ shapeIndex: 1, ringIndex: -1 });
    React.act(() => trace.undo());
    expect(trace.curves).toEqual(curves);
    expect(trace.outline).toEqual(DETECTED);

    click("button-import-outline");
    await choose(SAVED_SVG);
    click("button-import-outline-replace");
    expect(trace.outline).toEqual(SAVED);
    expect(trace.curves).toEqual(curvesFromOutline(SAVED));
    expect(trace.history.stack.at(-1)!.label).toBe("Replace outline with import");
  });

  it("says why it cannot import while editable curves carry a trace margin", async () => {
    render(<Control />);
    loadPhoto();
    React.act(() => {
      trace.dispatch({ type: "SET_MARGIN", margin: 1 });
      trace.dispatch({ type: "DETECTED", imageUrl: IMAGE_URL, outline: DETECTED, rawOutline: DETECTED, curves: curvesFromOutline(DETECTED), svg: "", region: REGION });
    });
    expect(trace.curves).toHaveLength(1);
    expect(trace.margin).toBe(1);
    click("button-import-outline");
    await choose(SAVED_SVG);
    expect(alertText()).toBe("Set Margin to zero before importing while Editable curves are on.");
    expect(button("button-import-outline-add")!.disabled).toBe(true);
    expect(button("button-import-outline-replace")!.disabled).toBe(true);
    click("button-import-outline-replace");
    expect(trace.outline).toBe(DETECTED);
  });

  it("places any other physical file at true size in the center of the region", async () => {
    render(<Control />);
    loadPhoto();
    click("button-import-outline");
    await choose(PHYSICAL_SVG);
    expect(summary()).toContain("60.00 × 30.00 mm, 1 contour.");
    expect(summary()).toContain("true size in the center of the region");
    click("button-import-outline-confirm");
    // 60 × 30 mm at 0.25 mm/px, centered on the region's center (550, 300).
    expect(outlineBounds(trace.outline)).toEqual({ minX: 430, minY: 240, maxX: 670, maxY: 360 });
  });

  it("turns a true-size file to fit the current outline, or leaves it centered when asked", async () => {
    render(<Control />);
    loadPhoto({ detected: true });
    click("button-import-outline");
    // The detected contour is 65 × 40 mm lying on its side; the file draws the same part upright.
    await choose('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="10" y="10" width="40" height="65"/></svg>');
    const fitSwitch = () => document.querySelector<HTMLButtonElement>("#import-outline-fit");
    expect(fitSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(summary()).toContain("40.00 × 65.00 mm, 1 contour.");
    expect(summary()).toMatch(/turned -?90\.0° to fit the current outline \(typical gap 0\.00 mm\)/);
    expect(summary()).toContain("Move & rotate adjusts it afterward.");

    React.act(() => fitSwitch()!.click());
    expect(summary()).toContain("true size in the center of the region");
    React.act(() => fitSwitch()!.click());
    click("button-import-outline-replace");
    const bounds = outlineBounds(trace.outline)!;
    for (const [value, expected] of [[bounds.minX, 420], [bounds.minY, 220], [bounds.maxX, 680], [bounds.maxY, 380]]) expect(value).toBeCloseTo(expected, 1);
    React.act(() => trace.undo());
    expect(trace.outline).toBe(DETECTED);

    click("button-import-outline");
    await choose(SAVED_SVG);
    expect(document.querySelector('[data-testid="import-outline-fit-choice"]')).toBeNull();
  });

  it("asks for a width when a file has neither this photo's canvas nor physical units", async () => {
    render(<Control />);
    loadPhoto();
    click("button-import-outline");
    await choose('<svg viewBox="0 0 4032 3024"><rect x="1000" y="1000" width="2000" height="500"/></svg>');
    expect(alertText()).toContain("physical width/height");
    expect(button("button-import-outline-confirm")!.disabled).toBe(true);
    typeWidth("50");
    expect(alertText()).toBeNull();
    expect(summary()).toContain("50.00 × 12.50 mm");
    click("button-import-outline-confirm");
    const bounds = outlineBounds(trace.outline)!;
    expect(bounds.maxX - bounds.minX).toBeCloseTo(200, 9);
  });

  it("lets the user choose when the file's scale disagrees with the trace", async () => {
    render(<Control />);
    loadPhoto();
    click("button-import-outline");
    await choose(generateOutlineSVG(SAVED, { ...PHOTO, mmPerPx: 0.5 }));
    const choice = () => document.querySelector('[data-testid="import-outline-scale-choice"]');
    expect(choice()?.textContent).toContain("saved at 0.500 mm/px; this trace is set to 0.250 mm/px");
    expect(choice()?.textContent).toContain("take this trace's scale");
    expect(summary()).toContain("keep their positions");
    React.act(() => document.querySelector<HTMLButtonElement>("#import-outline-file-size")!.click());
    expect(choice()).not.toBeNull();
    expect(summary()).toContain("299.88 × 219.88 mm");
    expect(summary()).toContain("true size in the center of the region");
    click("button-import-outline-confirm");
    const bounds = outlineBounds(trace.outline)!;
    expect(bounds.maxX - bounds.minX).toBeCloseTo(1199.5, 6);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(550, 6);
  });

  it("imports an outline that crosses itself and says it needs repair", async () => {
    render(<Control />);
    loadPhoto();
    click("button-import-outline");
    await choose('<svg viewBox="0 0 800 600"><path d="M 100 100 H 400 V 250 L 404 254 L 404 250 L 400 254 V 400 H 100 Z"/></svg>');
    expect(alertText()).toBeNull();
    expect(document.querySelector('[data-testid="import-outline-crossing"]')?.textContent).toContain("crosses or touches itself");
    click("button-import-outline-confirm");
    expect(trace.outline[0].outer).toHaveLength(8);
    expect(trace.mode).toBe("edit");
    click("button-import-outline");
    await choose(SAVED_SVG);
    expect(document.querySelector('[data-testid="import-outline-crossing"]')).toBeNull();
  });

  it("offers no scale choice for a file saved at this trace's scale", async () => {
    render(<Control />);
    loadPhoto();
    click("button-import-outline");
    await choose(SAVED_SVG);
    expect(document.querySelector('[data-testid="import-outline-scale-choice"]')).toBeNull();
  });

  it.each([
    ["a file that is not an SVG", "not an svg at all", /Malformed XML|Expected one SVG root/],
    ["truncated markup", '<svg viewBox="0 0 800 600"><path d="M0 0 L10 0 L10 10 Z">', /Malformed XML/],
    ["an open path", '<svg viewBox="0 0 800 600"><path d="M 10 10 L 200 10 L 200 200"/></svg>', /Open path/],
    ["an embedded image", '<svg viewBox="0 0 800 600"><image href="photo.jpg"/></svg>', /referenced resources/],
  ])("rejects %s with its reason and leaves the outline alone", async (_name, text, message) => {
    render(<Control />);
    loadPhoto({ detected: true });
    click("button-import-outline");
    await choose(text);
    expect(alertText()).toMatch(message);
    expect(summary()).toBeNull();
    expect(button("button-import-outline-add")!.disabled).toBe(true);
    expect(button("button-import-outline-replace")!.disabled).toBe(true);
    click("button-import-outline-replace");
    expect(trace.outline).toBe(DETECTED);
    expect(trace.history.stack).toHaveLength(1);
    expect(imported).not.toHaveBeenCalled();
    // A readable file chosen next clears the rejection.
    await choose(SAVED_SVG);
    expect(alertText()).toBeNull();
    expect(button("button-import-outline-replace")!.disabled).toBe(false);
  });

  it("rejects oversized and unreadable files before parsing", async () => {
    render(<Control />);
    loadPhoto();
    click("button-import-outline");
    await choose(SAVED_SVG, { size: 5_000_001 });
    expect(alertText()).toBe("Choose an SVG smaller than 5 MB.");
    await choose(SAVED_SVG, { read: () => Promise.reject(new Error("disk")) });
    expect(alertText()).toBe("Unable to read this file.");
    expect(button("button-import-outline-confirm")!.disabled).toBe(true);
    expect(trace.outline).toEqual([]);
  });

  it("ignores a slow read once another file has been chosen", async () => {
    render(<Control />);
    loadPhoto();
    click("button-import-outline");
    let resolveFirst: (text: string) => void = () => {};
    React.act(() => selectFile("", { read: () => new Promise<string>(resolve => { resolveFirst = resolve; }) }));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Reading SVG…");
    await choose(SAVED_SVG);
    await React.act(async () => { resolveFirst(PHYSICAL_SVG); });
    expect(summary()).toContain("149.94 × 109.94 mm");
  });

  it("cancels without changing the trace", async () => {
    render(<Control />);
    loadPhoto({ detected: true });
    click("button-import-outline");
    await choose(SAVED_SVG);
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(item => item.textContent === "Close")!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trace.outline).toBe(DETECTED);
    expect(imported).not.toHaveBeenCalled();
  });

  it("explains that true-size placement needs a scale, while a same-photo export does not", async () => {
    render(<Control />);
    loadPhoto({ scale: false, region: false });
    click("button-import-outline");
    await choose(PHYSICAL_SVG);
    expect(alertText()).toContain("Set the scale first");
    expect(button("button-import-outline-confirm")!.disabled).toBe(true);
    await choose(SAVED_SVG);
    expect(alertText()).toBeNull();
    expect(summary()).toContain("600 × 440 px");
    click("button-import-outline-confirm");
    expect(trace.outline).toEqual(SAVED);
  });

  it("is unavailable without a photo, while analyzing, and while a scale is under review", () => {
    render(<Control />);
    expect(button("button-import-outline")!.disabled).toBe(true);
    loadPhoto();
    expect(button("button-import-outline")!.disabled).toBe(false);
    React.act(() => trace.dispatch({ type: "SET_PROCESSING", processing: true }));
    expect(button("button-import-outline")!.disabled).toBe(true);
    React.act(() => trace.dispatch({ type: "SET_PROCESSING", processing: false }));
    React.act(() => trace.dispatch({ type: "AUTO_CALIBRATION_DETECTED", sourceImageUrl: IMAGE_URL, calibration: CALIBRATION }));
    expect(button("button-import-outline")!.disabled).toBe(true);
    React.act(() => trace.dispatch({ type: "ACCEPT_AUTO_CALIBRATION" }));
    React.act(() => trace.dispatch({ type: "SET_MODE", mode: "calibrate" }));
    expect(button("button-import-outline")!.disabled).toBe(true);
  });

  it("closes when the photo changes underneath it", async () => {
    render(<Control />);
    loadPhoto();
    click("button-import-outline");
    await choose(SAVED_SVG);
    React.act(() => trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "data:image/png;base64,other", fileName: "other" }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("Trace controls", () => {
  it("offers Import outline in the Outline step beside Add contour", async () => {
    render(<Panel />);
    loadPhoto({ detected: true });
    const section = host.querySelector<HTMLElement>("#trace-settings-detect")!;
    const actions = [...section.querySelectorAll<HTMLButtonElement>("button[data-testid]")].map(item => item.dataset.testid);
    expect(actions.indexOf("button-import-outline")).toBe(actions.indexOf("button-add-contour") + 1);
    click("button-import-outline");
    await choose(SAVED_SVG);
    click("button-import-outline-replace");
    expect(trace.outline).toEqual(SAVED);
    // The panel hands the canvas back, as it does after Add contour.
    expect(imported).toHaveBeenCalledOnce();
    expect(section.querySelector('[data-testid="detection-contours"]')?.textContent).toContain("Contours");
  });
});
