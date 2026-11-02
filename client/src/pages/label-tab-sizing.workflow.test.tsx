import { EMPTY_PROJECT, binHistoryButton, clickBinHistory, flushHydration, openConstructionGroup, openSettingsSection, renderPage, setBinInterior } from "./bin-designer.test-support";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";

const contexts = [
  { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
  { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
] as const;

function openTabs(container: HTMLElement, mobile: boolean): void {
  if (mobile) {
    const properties = container.querySelector<HTMLElement>('#objects-panel, [data-testid="mobile-properties-panel"]');
    const workflow = container.querySelector<HTMLElement>("#workflow-panel");
    if (workflow?.hidden || !workflow && properties?.hidden) {
      React.act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Workflow")!.click());
    }
  }
  openSettingsSection(container, "construction");
  openConstructionGroup(container, "labels");
}

function draft(input: HTMLInputElement, value: string): void {
  expect(input.closest("[hidden]")).toBeNull();
  React.act(() => input.focus());
  React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(input: HTMLInputElement, value: string): void {
  React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
}

function style(container: HTMLElement, option: string): void {
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Label tab style"]')!.focus());
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Label tab style"]')!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(element => element.textContent === option)!.click());
}

it.each(contexts)("edits tab dimensions with undo, cancellation and retained width in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const original = parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none", gridX: 2, gridY: 2, heightUnits: 6,
    compartments: { rows: 2, columns: 3 }, labelTab: { wall: "north", scope: "compartments", width: "center", recessMm: 0.5, frontRim: true },
    surfaceTexts: [surfaceTextSchema.parse({ id: "authored-label", text: "M3", sizeMm: 3.2, rotationDeg: 5, position: { x: 12, y: 18 } })] });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original });
  const { container, unmount } = renderPage({ mobile });
  const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
  const depth = () => container.querySelector<HTMLInputElement>("#bin-label-tab-depth")!;
  const width = () => container.querySelector<HTMLInputElement>("#bin-label-tab-width");
  try {
    await flushHydration(); openTabs(container, mobile);
    expect(depth().value).toBe("15.85"); expect(width()!.value).toBe("42");
    expect(container.querySelector('[data-testid="label-tab-size-controls"]')!.textContent).toContain("Width limited to");
    expect(current()).toEqual(original);
    draft(depth(), "8"); expect(vi.mocked(useBinGeometry).mock.lastCall![5]?.spec.labelTab!.depthMm).toBe(8);
    key(depth(), "Escape");
    expect(current()).toEqual(original);
    expect(binHistoryButton(container, "undo").disabled).toBe(true);
    draft(depth(), "0"); React.act(() => depth().blur());
    expect(current()).toEqual(original);
    expect(container.querySelector('[data-testid="label-tab-size-controls"]')!.textContent).toContain("Change not applied");
    draft(depth(), "8"); key(depth(), "Enter");
    clickBinHistory(container, "undo"); expect(depth().value).toBe("15.85");
    clickBinHistory(container, "redo"); expect(depth().value).toBe("8");
    draft(width()!, "18"); React.act(() => width()!.blur());
    expect(current().labelTab).toMatchObject({ depthMm: 8, widthMm: 18, scope: "compartments" });
    style(container, "Full width"); expect(width()).toBeNull();
    expect(current().labelTab!.widthMm).toBe(18);
    style(container, "Center · 18 mm"); expect(width()!.value).toBe("18");
    draft(width()!, "16");
    style(container, "Full width");
    expect(current().labelTab).toMatchObject({ width: "full", widthMm: 16 });
    style(container, "Center · 16 mm");
    draft(width()!, "18"); draft(width()!, "100");
    style(container, "Full width");
    expect(current().labelTab).toMatchObject({ width: "full", widthMm: 16 });
    style(container, "Center · 16 mm");
    draft(width()!, "18"); key(width()!, "Enter");
    draft(depth(), "6");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="construction-labels-trigger"]')!.click());
    openConstructionGroup(container, "labels");
    expect(depth().value).toBe("6");
    clickBinHistory(container, "undo"); expect(depth().value).toBe("8");
    setBinInterior(container, "solid"); setBinInterior(container, "none");
    expect(current().labelTab).toMatchObject({ depthMm: 8, widthMm: 18 });
    expect(current().surfaceTexts).toEqual(original.surfaceTexts);
    const reset = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Use standard tab size")!;
    draft(depth(), "15.85"); draft(depth(), "100");
    React.act(() => reset.focus());
    React.act(() => reset.click());
    expect(depth().value).toBe("15.85"); expect(width()!.value).toBe("42");
    clickBinHistory(container, "undo");
    expect(current().labelTab).toMatchObject({ depthMm: 8, widthMm: 18 });
    expect(current().surfaceTexts).toEqual(original.surfaceTexts);
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});

it.each(contexts)("explains capped tab depth and reloads requested dimensions in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none", gridX: 1, gridY: 1, heightUnits: 6, wallThicknessMm: 2,
    compartments: { rows: 3, columns: 3 }, labelTab: { wall: "north", width: "left", scope: "compartments", depthMm: 12, widthMm: 8, recessMm: 0.5, frontRim: true } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec });
  let page = renderPage({ mobile });
  const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
  try {
    await flushHydration(); openTabs(page.container, mobile);
    const controls = () => page.container.querySelector<HTMLElement>('[data-testid="label-tab-size-controls"]')!;
    const depth = () => page.container.querySelector<HTMLInputElement>("#bin-label-tab-depth")!;
    expect(controls().textContent).toContain("Depth limited to");
    expect(depth().value).toBe("12");
    draft(depth(), "1"); key(depth(), "Enter");
    expect(controls().textContent).toContain("front rim uses the entire tab depth");
    expect(current().labelTab!.depthMm).toBe(1);
    clickBinHistory(page.container, "undo");
    const saved = parseProjectDoc({ ...EMPTY_PROJECT, spec: current() })!;
    page.unmount();
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(saved);
    page = renderPage({ mobile });
    await flushHydration(); openTabs(page.container, mobile);
    expect(depth().value).toBe("12");
    expect(page.container.querySelector<HTMLInputElement>("#bin-label-tab-width")!.value).toBe("8");
    expect(current()).toEqual(spec);
  } finally { page.unmount(); window.history.replaceState(null, "", originalUrl); }
});
