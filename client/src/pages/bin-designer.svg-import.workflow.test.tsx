import * as React from "react";
import { expect, it, vi } from "vitest";
import { renderPage, flushHydration, clickBinHistory, openSettingsSection } from "./bin-designer.test-support";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import { downloadBlob } from "@/lib/download";
import { parseProjectDoc } from "@shared/gridfinity/project";

it.each([false, true])("imports an editable SVG pocket, saves its geometry, and supports undo (mobile=%s)", async mobile => {
  const { container, unmount } = renderPage({ mobile });
  try {
    await flushHydration();
    React.act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Layout")!.click());
    const trigger = container.querySelector('[data-testid="toolbar-add-object"], [data-testid="button-add-pocket"]')!;
    React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const menuItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Import SVG pocket")!;
    expect(menuItem).toBeTruthy();
    React.act(() => menuItem.click());
    const text = '<svg width="100mm" viewBox="0 0 100 100"><path d="M0 0 H30 L0 20 Z"/></svg>';
    const file = new File([text], "triangle.svg", { type: "image/svg+xml" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
    await React.act(async () => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    React.act(() => document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const layout = () => vi.mocked(useBinGeometry).mock.lastCall![2]!;
    expect(layout().cutouts).toHaveLength(1);
    const cutout = layout().cutouts[0];
    expect(cutout.depth).toEqual({ mode: "mm", value: 12 });
    expect(layout().shapes.find(shape => shape.id === cutout.shapeId)!.bboxMm).toEqual({ minX: -15, minY: -10, maxX: 15, maxY: 10 });
    clickBinHistory(container, "undo");
    expect(layout().cutouts).toHaveLength(0);
    clickBinHistory(container, "redo");
    expect(layout().cutouts).toHaveLength(1);
    openSettingsSection(container, "project");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
    const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
    const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    const saved = parseProjectDoc(JSON.parse(json))!;
    expect(saved.cutouts[0]).toMatchObject({ shapeId: cutout.shapeId, depth: { mode: "mm", value: 12 } });
    expect(saved.shapes.find(shape => shape.id === cutout.shapeId)!.outlineMm).toEqual(layout().shapes.find(shape => shape.id === cutout.shapeId)!.outlineMm);
  } finally { unmount(); }
});
