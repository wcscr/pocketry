import { EMPTY_PROJECT, flushHydration, openSettingsSection, rectangularShape, renderPage, selectPocket } from "./bin-designer.test-support";
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";

// Drive the same responsive transition as the media-query hook while retaining
// the mounted page and its real selection, inspector, and workspace state.
const viewport = vi.hoisted(() => ({ mobile: false, listeners: new Set<() => void>() }));
vi.mock("@/hooks/use-mobile", async original => ({
  ...await original<typeof import("@/hooks/use-mobile")>(),
  useIsMobile: () => React.useSyncExternalStore(
    notify => { viewport.listeners.add(notify); return () => viewport.listeners.delete(notify); },
    () => viewport.mobile,
    () => false,
  ),
}));
afterEach(() => { viewport.mobile = false; });

const click = (container: ParentNode, selector: string) => React.act(() => container.querySelector<HTMLButtonElement>(selector)!.click());
const currentSpec = () => vi.mocked(useBinGeometry).mock.lastCall![0];
async function finishNavigation() {
  // Let each rendering frame commit before the next one measures/focuses it.
  // The route opens its outer editor before the nested disclosure is revealed.
  for (let frame = 0; frame < 6; frame++) {
    await React.act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  }
}
function resize(mobile: boolean) {
  React.act(() => {
    viewport.mobile = mobile;
    window.innerWidth = mobile ? 390 : 1440;
    for (const notify of viewport.listeners) notify();
    window.dispatchEvent(new Event("resize"));
  });
}

it.each([
  { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
  { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
])("settings warnings preserve the canvas and model in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  viewport.mobile = mobile;
  const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, heightUnits: 2, labelTab: { wall: "north", width: "full", recessMm: 0.5 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec });
  const { container, unmount } = renderPage({ mobile });
  try {
    await flushHydration();
    openSettingsSection(container, "construction");
    await finishNavigation();
    click(container, '[data-testid="construction-base-trigger"]');
    const expanded = (key: string) => container.querySelector(`[data-testid="construction-${key}-trigger"]`)!.getAttribute("aria-expanded");
    expect(expanded("base")).toBe("true");
    expect(expanded("walls")).toBe("true");
    expect(expanded("labels")).toBe("false");
    click(container, '[data-testid="canvas-warnings"] button[aria-expanded]');
    for (const view of ["3d", "2d"] as const) {
      click(container, `[data-testid="view-toggle-${view}"]`);
      const canvasSelector = view === "3d" ? '[data-testid="bin-viewport-stub"]' : '[data-testid="layout-canvas"]';
      const canvas = container.querySelector(canvasSelector);
      expect(canvas).not.toBeNull();
      click(container, '[data-issue-code="label-tab-clipped"]');
      await finishNavigation();
      expect(container.querySelector(canvasSelector)).toBe(canvas);
      expect(container.querySelector('#bin-settings-construction')!.closest('[hidden]')).toBeNull();
      const target = container.querySelector('#bin-label-tab-recess')!;
      expect(target.closest('[hidden]')).toBeNull();
      expect(document.activeElement).toBe(target);
      expect(expanded("labels")).toBe("true");
      expect(expanded("base")).toBe("true");
      expect(expanded("walls")).toBe("true");
      expect(currentSpec()).toEqual(spec);
      if (layout === "workflow") expect(container.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe("Construction");
      // Repeating the same warning is a fresh navigation request, including
      // after the user has deliberately closed its destination group again.
      click(container, '[data-testid="construction-labels-trigger"]');
      click(container, '[data-issue-code="label-tab-clipped"]');
      await finishNavigation();
      expect(expanded("labels")).toBe("true");
      expect(document.activeElement).toBe(container.querySelector('#bin-label-tab-recess'));
    }
  } finally { unmount(); }
});

it.each(["standard", "workflow"])("a newer section choice supersedes a pending warning reveal in %s", async layout => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, heightUnits: 2, labelTab: { wall: "north", width: "full", recessMm: 0.5 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    click(container, '[data-testid="canvas-warnings"] button[aria-expanded]');
    click(container, '[data-issue-code="label-tab-clipped"]');
    openSettingsSection(container, "materials");
    const color = container.querySelector<HTMLInputElement>('#input-bin-color')!;
    React.act(() => color.focus());
    await finishNavigation();
    expect(color.closest('[hidden]')).toBeNull();
    expect(document.activeElement).toBe(color);
    if (layout === "workflow") expect(container.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe("Materials & Colors");
    else expect(container.querySelector('#bin-settings-construction')!.getAttribute("data-state")).toBe("closed");
    expect(currentSpec()).toEqual(spec);
  } finally { unmount(); }
});

it.each([
  { layout: "standard", input: "pointer" }, { layout: "workflow", input: "pointer" },
  { layout: "standard", input: "keyboard" }, { layout: "workflow", input: "keyboard" },
])("a deliberate $input group close supersedes a pending warning reveal in $layout", async ({ layout, input }) => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, heightUnits: 2, labelTab: { wall: "north", width: "full", recessMm: 0.5 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    openSettingsSection(container, "construction");
    await finishNavigation();
    const disclosure = container.querySelector<HTMLButtonElement>('[data-testid="construction-labels-trigger"]')!;
    React.act(() => disclosure.click());
    click(container, '[data-testid="canvas-warnings"] button[aria-expanded]');
    click(container, '[data-issue-code="label-tab-clipped"]');
    React.act(() => {
      disclosure.dispatchEvent(input === "pointer" ? new MouseEvent("pointerdown", { bubbles: true }) : new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      disclosure.click();
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    await finishNavigation();
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(disclosure);
    expect(currentSpec()).toEqual(spec);
  } finally { unmount(); }
});

it.each([
  { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
  { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
])("the solid-fill warning focuses its choice without changing the interior in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  viewport.mobile = mobile;
  const shape = rectangularShape("hollow-tool", "Tool");
  const cutout = parseCutoutPlacement({ id: "hollow-pocket", shapeId: shape.id, position: { x: 0, y: 0 } });
  const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none" });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage({ mobile });
  try {
    await flushHydration();
    const canvas = container.querySelector('[data-testid="bin-viewport-stub"]');
    click(container, '[data-testid="canvas-warnings"] button[aria-expanded]');
    click(container, '[data-issue-code="cutouts-require-solid-fill"]');
    await finishNavigation();
    const choice = container.querySelector('#bin-solid-fill')!;
    expect(document.activeElement).toBe(choice);
    expect(choice.closest('[hidden]')).toBeNull();
    expect(choice.getAttribute("aria-checked")).toBe("false");
    expect(currentSpec()).toEqual(spec);
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([cutout]);
    expect(container.querySelector('[data-testid="bin-viewport-stub"]')).toBe(canvas);
  } finally { unmount(); }
});

it.each(["construction", "export"] as const)("keeps explicitly chosen %s properties while resizing with text selected", async section => {
  window.history.replaceState(null, "", "/bin?layout=workflow");
  const first = surfaceTextSchema.parse({ id: "first-label", text: "M3", position: { x: 0, y: 0 } });
  const second = surfaceTextSchema.parse({ id: "second-label", text: "M4", position: { x: 10, y: 0 } });
  const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, surfaceTexts: [first, second] });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    click(container, '[data-testid="button-select-text-3d-first-label"]');
    openSettingsSection(container, section);
    const title = () => container.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent;
    const expectedTitle = section === "construction" ? "Construction" : "Export";
    expect(title()).toBe(expectedTitle);
    const canvas = container.querySelector('[data-testid="bin-viewport-stub"]');
    for (const mobile of [true, false, true]) {
      resize(mobile);
      expect(title()).toBe(expectedTitle);
      expect(container.querySelector('#objects-panel')!.hasAttribute("hidden")).toBe(false);
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')).toBe(canvas);
      expect(container.querySelector('[data-testid="button-select-surface-text-first-label"]')!.getAttribute("aria-pressed")).toBe("true");
      expect(currentSpec()).toEqual(spec);
    }
    // A genuine selection change still replaces global settings with the
    // selected object's properties; resizing must not disable that behavior.
    click(container, '[data-testid="button-select-text-3d-second-label"]');
    expect(title()).toBe("M4");
    expect(container.querySelector('[data-testid="button-select-surface-text-second-label"]')!.getAttribute("aria-pressed")).toBe("true");
  } finally { unmount(); }
});

it.each(["standard", "workflow"])("retains Construction disclosure choices across responsive transitions in %s", async layout => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    openSettingsSection(container, "construction");
    const original = currentSpec();
    click(container, '[data-testid="construction-base-trigger"]');
    click(container, '[data-testid="construction-labels-trigger"]');
    click(container, '[data-testid="construction-walls-trigger"]');
    const canvas = container.querySelector('[data-testid="bin-viewport-stub"]');
    for (const mobile of [true, false, true]) {
      resize(mobile);
      // Standard layout may need its outer section reopened after changing
      // layout; its inner disclosure choices should still be remembered.
      openSettingsSection(container, "construction");
      for (const key of ["base", "labels", "walls"]) {
        expect(container.querySelector(`[data-testid="construction-${key}-trigger"]`)!.getAttribute("aria-expanded")).toBe(key === "walls" ? "false" : "true");
      }
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')).toBe(canvas);
      expect(currentSpec()).toEqual(original);
    }
  } finally { unmount(); }
});

it.each([false, true])("pocket warnings still enter Layout and select the affected object (mobile: %s)", async mobile => {
  window.history.replaceState(null, "", "/bin?layout=workflow");
  viewport.mobile = mobile;
  const shape = rectangularShape("tool", "Tool");
  const cutout = parseCutoutPlacement({ id: "outside", shapeId: shape.id, position: { x: 70, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage({ mobile });
  try {
    await flushHydration();
    click(container, '[data-testid="canvas-warnings"] button[aria-expanded]');
    click(container, '[data-issue-code="out-of-bounds"]');
    expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="button-select-outside"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([cutout]);
    selectPocket(container, cutout.id);
    expect(container.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe("Tool");
  } finally { unmount(); }
});
