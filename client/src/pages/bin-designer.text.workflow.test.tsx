import {
  binGeometryMock,
  projectToast,
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  experimentalSettings,
  renderPage,
  openSettingsSection,
  openMobileProperties,
  binHistoryButton,
  clickBinHistory,
  selectPocket,
  openObjectContext,
  contextCommand,
} from "./bin-designer.test-support";
import { surfaceTextName, surfaceTextSchema } from "@shared/gridfinity/surface-text";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { fingerHoleSchema, parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { downloadBlob } from "@/lib/download";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import * as ProjectPersistence from "@/lib/project/persist";

describe("BinDesignerPage", () => {

  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
  ])("opens the affected label from a thin-stroke warning without changing the design: %o", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const label = surfaceTextSchema.parse({ id: "fine-label", text: "M4 nut", font: "helvetiker", sizeMm: 2, position: { x: 0, y: 0 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, surfaceTexts: [label] }),
    });
    binGeometryMock.validationIssues = [{ code: "surface-text-thin-strokes", severity: "warning", surfaceTextIds: [label.id], message: "Fine detail may disappear at 0.42 mm line width." }];
    const { container, unmount } = renderPage({ mobile, experimental: false });
    try {
      await flushHydration();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="canvas-warnings"] button[aria-expanded]')!.click());
      const action = container.querySelector<HTMLButtonElement>('[data-issue-code="surface-text-thin-strokes"]')!;
      expect(action.textContent).toContain("Edit text or symbol");
      React.act(() => action.click());
      if (mobile) openMobileProperties();
      const size = document.querySelector<HTMLInputElement>('[aria-label="Text size (mm)"]')!;
      expect(size.value).toBe("2");
      expect(size.closest("[hidden]")).toBeNull();
      expect(action.dataset.selected).toBe("true");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts).toEqual([label]);
      expect(binHistoryButton(container, "undo").disabled).toBe(true);
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
  ])("adds text to each slanted shelf and preserves surface selection through undo: %o", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 4, gridY: 4, gridPitch: "half", heightUnits: 5.5, lip: "none", fill: "none",
        wallSlant: { axis: "y", angleDeg: 30 }, bottomFilletRadiusMm: 8,
        compartments: { enabled: true, rows: 2, columns: 3, dividerThicknessMm: 1.2 },
        labelTab: { wall: "south", scope: "compartments", width: "full" } }),
    });
    const { container, unmount } = renderPage({ mobile, experimental: false });
    try {
      await flushHydration();
      if (mobile && layout === "standard") {
        React.act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Adjust")!.click());
        React.act(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "All properties")!.click());
      }
      openSettingsSection(document.body, "text");
      React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-add-surface-text"]')!.click());
      const current = () => vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts;
      expect(container.querySelectorAll('[data-testid="layout-label-tab"]')).toHaveLength(6);
      if (mobile) openMobileProperties();
      expect(document.querySelector('[aria-label="Text surface"]')!.textContent).toBe("Label tabs");
      expect(document.querySelector('[aria-label="Text surface"]')!.closest("[hidden]")).toBeNull();
      for (let i = 1; i < 6; i++) React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-add-surface-text"]')!.click());
      expect(current()).toHaveLength(6);
      expect(current().every(label => label.surface === "label-tab")).toBe(true);
      expect(new Set(current().map(label => JSON.stringify(label.position))).size).toBe(6);
      const added = current();
      clickBinHistory(container, "undo");
      expect(current()).toEqual(added.slice(0, 5));
      clickBinHistory(container, "redo");
      expect(current()).toEqual(added);
      // The 3D manipulation plane must be the shelf, not the hollow floor.
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-3d"]')!.click());
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="button-select-text-3d-${added[0].id}"]`)!.click());
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute("data-text-editor-z")).toBe("38.5");
      if (mobile) openMobileProperties();
      expect(document.querySelector<HTMLButtonElement>('[aria-label="Text surface"]')!.disabled).toBe(true);
      expect(current()).toEqual(added);
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
  ])("opens the clicked text properties from either canvas without changing wording or history: %o", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, surfaceTexts: [{ id: "canvas-label", name: "Tool label", text: "METRIC", symbol: "socket-bolt", symbolRotationDeg: 45, position: { x: 0, y: 25 } }] }),
    });
    const { container, unmount } = renderPage({ mobile, experimental: false });
    try {
      await flushHydration();
      const click3D = () => React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-text-3d-canvas-label"]')!.click());
      const wording = () => document.querySelector<HTMLInputElement>('[data-testid="surface-text-editor"] input[type="text"]')!;
      click3D();
      if (mobile) openMobileProperties();
      expect(wording().value).toBe("METRIC");
      expect(wording().closest("[hidden]")).toBeNull();
      expect(document.querySelector('[aria-label="Hardware symbol"]')!.closest("[hidden]")).toBeNull();
      const symbolRotation = document.querySelector<HTMLInputElement>('[aria-label="Symbol rotation (°)"]')!;
      expect(symbolRotation.closest("[hidden]")).toBeNull();
      expect(symbolRotation.value).toBe("45");
      const textSize = document.querySelector<HTMLInputElement>('[aria-label="Text size (mm)"]')!;
      const symbolSize = document.querySelector<HTMLInputElement>('[aria-label="Symbol size (mm)"]')!;
      const symbolPicker = document.querySelector('[aria-label="Hardware symbol"]')!;
      expect(wording().labels![0].textContent).toBe("Text");
      expect(symbolSize.closest("[hidden]")).toBeNull();
      expect(textSize.compareDocumentPosition(symbolPicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(document.querySelector('[aria-label="Text 1 font"]')!.compareDocumentPosition(symbolPicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(symbolPicker.compareDocumentPosition(symbolSize) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const textGap = document.querySelector<HTMLInputElement>('[aria-label="Text gap (mm)"]')!;
      expect(textGap.closest("[hidden]")).toBeNull();
      expect(textGap.value).toBe("1.5");
      expect(symbolPicker.compareDocumentPosition(textGap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      for (const name of ["X (mm)", "Y (mm)", "Raised height (mm)", "Label rotation (°)"]) {
        const control = document.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
        expect(control.closest("[hidden]")).toBeNull();
        expect(control.compareDocumentPosition(symbolPicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')).not.toBeNull();
      if (layout === "workflow") {
        expect(container.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe("Tool label");
        React.act(() => container.querySelector<HTMLButtonElement>(mobile ? '#objects-panel [data-testid="button-back-to-canvas"]' : '[aria-label="Collapse properties panel"]')!.click());
        click3D();
        if (mobile) openMobileProperties();
        expect(wording().closest("[hidden]")).toBeNull();
      }
      if (mobile) expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull();
      // Selecting in Layout must also reveal the editor when another section is open.
      openSettingsSection(document.body, "size");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      const layer = container.querySelector('[data-testid="surface-text-layer"]')!;
      const hit = layer.querySelector('rect')!;
      vi.stubGlobal("DOMPoint", class { constructor(public x: number, public y: number) {} matrixTransform() { return this; } });
      Object.defineProperty(layer, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperty(hit.parentElement!, "setPointerCapture", { value: vi.fn() });
      for (const type of ["pointerdown", "pointerup"]) React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10 });
        Object.defineProperty(event, "pointerId", { value: 1 });
        hit.dispatchEvent(event);
      });
      expect(wording().value).toBe("METRIC");
      expect(wording().closest("[hidden]")).toBeNull();
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      React.act(() => experimentalSettings.setEnabled(false));
      expect(document.querySelector('[data-testid="surface-text-editor"]')).not.toBeNull();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-3d"]')!.click());
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-select-text-3d-canvas-label"]')!.disabled).toBe(false);
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it("keeps 3D text transforms active, commits each once, and routes its material legend", async () => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", "/bin?layout=workflow");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, surfaceTexts: [{ id: "transform-text", name: "Tool label", text: "METRIC", position: { x: 0, y: 25 } }] }),
    });
    const { container, unmount } = renderPage({ experimental: false });
    try {
      await flushHydration();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-text-3d-transform-text"]')!.click());
      const current = () => vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts[0];
      const initial = structuredClone(current());
      for (const [tool, commit, patch] of [
        ["Move", "move", { position: { x: 8, y: 20 } }], ["Rotate", "rotation", { rotationDeg: 45 }],
      ] as const) {
        const button = container.querySelector<HTMLButtonElement>(`[aria-label="${tool} selected objects"]`)!;
        expect(button.disabled).toBe(false);
        React.act(() => button.click());
        expect(button.getAttribute("aria-pressed")).toBe("true");
        expect(container.querySelector('[data-testid="text-transform-controls"]')!.closest('[hidden]')).toBeNull();
        expect(container.querySelector<HTMLButtonElement>('[aria-label="Arrange selected objects"]')!.disabled).toBe(true);
        React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="commit-text-${commit}"]`)!.click());
        expect(current()).toEqual({ ...initial, ...patch });
        React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
        expect(current()).toEqual(initial);
        expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      }
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="legend-text"]')!.click());
      expect(container.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe("Materials & Colors");
      expect(container.querySelector('[data-testid="input-text-color"]')!.closest('[hidden]')).toBeNull();
      React.act(() => experimentalSettings.setEnabled(false));
      expect(container.querySelector('[data-testid="commit-text-move"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="input-text-color"]')).not.toBeNull();
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each([false, true])("keeps text instances on the left and only the selected properties on the right (mobile=%s)", async mobile => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", "/bin?layout=workflow");
    const shape = rectangularShape("text-pocket-shape", "Tool");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "text-pocket", shapeId: shape.id, position: { x: 0, y: 0 } })],
      fingerHoles: [fingerHoleSchema.parse({ id: "text-finger", center: { x: 0, y: 0 } })],
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, surfaceTexts: [
        { id: "first-text", text: "Metric", position: { x: 0, y: 0 } },
        { id: "second-text", text: "SAE", position: { x: 0, y: 10 } },
      ] }),
    });
    const { container, unmount } = renderPage({ mobile, experimental: false });
    try {
      await flushHydration();
      const left = container.querySelector<HTMLElement>("#workflow-panel")!;
      const right = container.querySelector<HTMLElement>('[data-testid="selection-inspector"]')!;
      const select = (id: string) => React.act(() => left.querySelector<HTMLButtonElement>(`[data-testid="button-select-surface-text-${id}"]`)!.click());
      const current = () => vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts;
      const wording = () => right.querySelector<HTMLInputElement>('[data-testid="surface-text-editor"] input[type="text"]')!;
      expect(left.querySelectorAll('[data-testid^="surface-text-row-"]')).toHaveLength(2);
      expect(left.querySelector('[data-testid="button-add-surface-text"]')).not.toBeNull();
      expect(right.querySelector('[data-testid="button-add-surface-text"]')).toBeNull();
      expect(left.querySelector('[data-testid="surface-text-editor"]')).toBeNull();
      select("first-text");
      if (mobile) openMobileProperties();
      expect(wording().value).toBe("Metric");
      expect(wording().closest("[hidden]")).toBeNull();
      expect(left.hidden).toBe(mobile);
      select("second-text");
      expect(right.querySelectorAll('[data-testid="surface-text-editor"]')).toHaveLength(1);
      expect(wording().value).toBe("SAE");
      expect(right.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe("SAE");
      React.act(() => {
        wording().focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(wording(), "Imperial");
        wording().dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => wording().blur());
      expect(current().map(label => label.text)).toEqual(["Metric", "Imperial"]);
      expect(left.querySelector('[data-testid="surface-text-row-second-text"]')!.textContent).toContain("Imperial");
      React.act(() => left.querySelector<HTMLButtonElement>('#bin-settings-text [data-panel-section-trigger]')!.click());
      expect(wording().value).toBe("Imperial");
      expect(wording().closest("[hidden]")).toBeNull();
      openSettingsSection(container, "text");
      select("first-text");
      selectPocket(container, "text-pocket");
      expect(right.querySelector('[data-testid="surface-text-editor"]')).toBeNull();
      expect(left.querySelector('[data-testid="button-select-surface-text-first-text"]')!.getAttribute("aria-pressed")).toBe("false");
      select("first-text");
      React.act(() => left.querySelector<HTMLButtonElement>('[aria-label="Finger access 1 — edit finger access properties"]')!.click());
      expect(right.querySelector('[data-testid="surface-text-editor"]')).toBeNull();
      select("second-text");
      React.act(() => right.querySelector<HTMLButtonElement>('[aria-label="Remove text 2"]')!.click());
      expect(current().map(label => label.text)).toEqual(["Metric"]);
      expect(right.querySelector('[data-testid="surface-text-editor"]')).toBeNull();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(current().map(label => label.text)).toEqual(["Metric", "Imperial"]);
      select("second-text");
      expect(wording().value).toBe("Imperial");
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each([false, true])("adds surface text from the toolbar by default and enforces the instance limit (mobile=%s)", async mobile => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", "/bin?layout=workflow");
    const { container, unmount } = renderPage({ mobile, experimental: false });
    try {
      await flushHydration();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      const menu = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Surface text");
      const openAdd = () => React.act(() => container.querySelector('[data-testid="toolbar-add-object"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      const closeAdd = () => React.act(() => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      openAdd();
      expect(menu()).toBeDefined();
      closeAdd();
      for (let i = 0; i < 32; i++) {
        openAdd();
        React.act(() => menu()!.click());
      }
      const current = () => vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts;
      expect(current()).toHaveLength(32);
      if (mobile) openMobileProperties();
      expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="surface-text-editor"]')!.closest("[hidden]")).toBeNull();
      expect(container.querySelector('[data-testid="button-select-surface-text-' + current()[31].id + '"]')!.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-add-surface-text"]')!.disabled).toBe(true);
      openAdd();
      expect(menu()!.getAttribute("aria-disabled")).toBe("true");
      closeAdd();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(current()).toHaveLength(31);
      expect(container.querySelector('[data-testid="surface-text-editor"]')).toBeNull();
      React.act(() => experimentalSettings.setEnabled(false));
      openAdd();
      expect(menu()).toBeDefined();
      closeAdd();
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
  ])("allows positioning text over a pocket despite a failed preview: %o", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const pocket = createBasicPocket("rectangle", { x: -8, y: -50 }, { x: 8, y: 50 }, "driver")!;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridPitch: "half", gridX: 2, gridY: 7, heightUnits: 3 }),
      cutouts: [pocket.cutout], shapes: [pocket.shape],
    });
    binGeometryMock.error = 'Text “Wiha” must fit on the flat surface, clear of pockets and openings.';
    const { container, unmount } = renderPage({ mobile, experimental: false });
    try {
      await flushHydration();
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')).not.toBeNull();
      if (mobile && layout === "standard") {
        React.act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Adjust")!.click());
        React.act(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "All properties")!.click());
      }
      openSettingsSection(document.body, "text");
      React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-add-surface-text"]')!.click());
      expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
      if (mobile && layout === "standard") expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull();
      if (!mobile) {
        for (const tool of ['[aria-label="Pan layout"]', '[data-testid="button-layout-ruler"]']) {
          React.act(() => container.querySelector<HTMLButtonElement>(tool)!.click());
          expect(container.querySelector('[data-testid="surface-text-layer"] rect')!.getAttribute("pointer-events")).toBe("none");
          React.act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Position text in Layout")!.click());
          expect(container.querySelector('[data-testid="surface-text-layer"] rect')!.getAttribute("pointer-events")).toBe("all");
        }
      }
      // Recovery must work for a label already stranded in the failed 3D preview.
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-3d"]')!.click());
      React.act(() => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="bin-viewport-stub"] button')].find(button => button.textContent === "Position text in Layout")!.click());
      const layer = container.querySelector('[data-testid="surface-text-layer"]')!;
      const path = layer.querySelector("rect")!;
      const pocketPath = container.querySelector(`[data-cutout-id="${pocket.cutout.id}"]`)!;
      expect(pocketPath.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(path.getAttribute("pointer-events")).toBe("all");
      vi.stubGlobal("DOMPoint", class { constructor(public x: number, public y: number) {} matrixTransform() { return this; } });
      Object.defineProperty(layer, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperty(path.parentElement!, "setPointerCapture", { value: vi.fn() });
      const pointer = (type: string, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 0, clientY: y });
        Object.defineProperty(event, "pointerId", { value: 1 });
        path.dispatchEvent(event);
      });
      pointer("pointerdown", 60);
      pointer("pointermove", 0);
      pointer("pointerup", 0);
      const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
      expect(current().surfaceTexts[0].position).toEqual({ x: 0, y: 60 });
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([pocket.cutout]);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(current().surfaceTexts[0].position).toEqual({ x: 0, y: 0 });
      clickBinHistory(container, "redo");
      expect(current().surfaceTexts[0].position).toEqual({ x: 0, y: 60 });
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
  ])("keeps text controls available without experimental opt-in: %o", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage({ mobile, experimental: false });
    try {
      await flushHydration();
      if (mobile && layout === "standard") {
        React.act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Adjust")!.click());
        React.act(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "All properties")!.click());
      }
      openSettingsSection(document.body, "text");
      React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-add-surface-text"]')!.click());
      const before = structuredClone(vi.mocked(useBinGeometry).mock.lastCall![0]);
      const hit = () => container.querySelector('[data-testid="surface-text-layer"] rect')!;
      expect(hit().getAttribute("pointer-events")).toBe("all");
      React.act(() => experimentalSettings.setEnabled(true));
      React.act(() => experimentalSettings.setEnabled(false));
      expect(hit().getAttribute("pointer-events")).toBe("all");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(before);
      expect(document.querySelector('[data-testid="experimental-design-notice"]')).toBeNull();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-3d"]')!.click());
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="legend-text"]')!.click());
      expect(experimentalSettings.settingsOpen).toBe(false);
      expect(document.querySelector('[aria-label="Text color"]')).not.toBeNull();
      openSettingsSection(document.body, "text");
      expect(document.querySelector<HTMLInputElement>('[data-testid="surface-text-editor"] input[type="text"]')!.value).toBe("Text");
      expect(experimentalSettings.enabled).toBe(false);
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(before);
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each([false, true])("preserves opt-out for restored text projects, including history-only text=%s", async historyOnly => {
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, surfaceTexts: [
      { id: "saved-label", text: "METRIC", position: { x: 0, y: 0 } },
    ] });
    const doc = { spec, cutouts: [], fingerHoles: [] };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: historyOnly ? EMPTY_PROJECT.spec : spec,
      history: { index: historyOnly ? 1 : 0, stack: [
        { doc, label: "Text" }, { doc: { ...doc, spec: EMPTY_PROJECT.spec }, label: "Removed text" },
      ] },
    });
    const { container, unmount } = renderPage({ experimental: false });
    try {
      await flushHydration();
      expect(experimentalSettings.enabled).toBe(false);
      expect(projectToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Experimental features enabled" }));
      expect(container.querySelector('[data-testid="experimental-design-notice"]')).toBeNull();
      if (historyOnly) React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(experimentalSettings.enabled).toBe(false);
      openSettingsSection(container, "text");
      expect(container.querySelector('[data-testid="button-add-surface-text"]')).not.toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts).toEqual(spec.surfaceTexts);
    } finally { unmount(); }
  });

  it.each(["standard", "workflow"])("edits surface text with undo and exports independent 3MF parts (%s)", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage({ experimental: false });
    try {
      await flushHydration();
      React.act(() => {
        const navigation = container.querySelector<HTMLButtonElement>('[data-testid="workflow-section-bin-settings-text"]');
        if (navigation) navigation.click();
        else container.querySelector<HTMLButtonElement>('#bin-settings-text [data-panel-section-trigger]')!.click();
      });
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-add-surface-text"]')!.click());
      const current = () => vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts;
      expect(current()).toHaveLength(1);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      expect(container.querySelector('[data-testid="layout-empty-state"]')).toBeNull();
      expect(container.querySelector('[data-testid="surface-text-layer"] path')).not.toBeNull();
      const field = container.querySelector<HTMLInputElement>('[data-testid="surface-text-editor"] input[type="text"]')!;
      React.act(() => {
        field.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Metric & SAE");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => field.blur());
      expect(current()[0].text).toBe("Metric & SAE");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(current()[0].text).toBe("Text");
      clickBinHistory(container, "redo");
      expect(current()[0].text).toBe("Metric & SAE");
      const textColor = () => vi.mocked(useBinGeometry).mock.lastCall![0].textColor;
      expect(textColor()).toBeNull();
      const fontField = () => container.querySelector<HTMLButtonElement>('[aria-label="Text 1 font"]')!;
      React.act(() => fontField().click());
      const fontOptions = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      expect(fontOptions.map(option => option.textContent)).toEqual([
        "Sans", "Sans Bold", "Helvetiker", "Helvetiker Bold", "Monospace",
      ]);
      React.act(() => fontOptions.find(option => option.textContent === "Sans Bold")!.click());
      expect(current()[0].font).toBe("sans-bold");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(current()[0].font).toBe("helvetiker");
      clickBinHistory(container, "redo");
      expect(current()[0].font).toBe("sans-bold");
      openSettingsSection(container, "materials");
      expect(document.querySelector<HTMLInputElement>('[aria-label="Text color"]')!.value).toBe("#000000");
      expect(document.querySelector('[aria-label="Text color"]')!.closest('[data-testid="view-color-row-text"]')).not.toBeNull();
      const setTextColor = (color: string) => React.act(() => {
        const input = container.querySelector<HTMLInputElement>('[aria-label="Text color"]')!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, color);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(container.querySelectorAll('[aria-label="Text color"]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-testid="surface-text-editor"] input[type="color"]')).toHaveLength(0);
      setTextColor("#ff6600");
      openSettingsSection(container, "text");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-add-surface-text"]')!.click());
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Hardware symbol"]')!.click());
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Washer")!.click());
      const symbolWording = container.querySelector<HTMLInputElement>('[data-testid="surface-text-editor"] input[type="text"]')!;
      React.act(() => {
        symbolWording.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(symbolWording, "");
        symbolWording.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => symbolWording.blur());
      expect(current()[1]).toMatchObject({ symbol: "washer", text: "" });
      openSettingsSection(container, "materials");
      expect([...container.querySelectorAll('[data-testid="surface-text-layer"] path')].map(path => path.getAttribute("fill"))).toEqual(["#ff6600", "#ff6600"]);
      setTextColor("#2244ff");
      expect(textColor()).toBe("#2244ff");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(textColor()).toBe("#ff6600");
      clickBinHistory(container, "redo");
      expect(textColor()).toBe("#2244ff");
      expect([...container.querySelectorAll('[data-testid="surface-text-layer"] path')].map(path => path.getAttribute("fill"))).toEqual(["#2244ff", "#2244ff"]);
      const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), normals: null };
      const textMeshes = current().map(label => ({ label, z: 40.8, mesh }));
      binGeometryMock.buildOnce.mockResolvedValue({ mesh, bodyMesh: mesh, materialMeshes: { body: mesh, stackingRim: mesh }, textMeshes });
      for (const variant of ["single-color", "multicolor", "opted-out", "inherited", "text-only"]) {
        if (variant === "opted-out") React.act(() => experimentalSettings.setEnabled(false));
        if (variant === "inherited") {
          openSettingsSection(container, "materials");
          React.act(() => {
            const input = container.querySelector<HTMLInputElement>('[data-testid="input-stacking-rim-color"]')!;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "#778899");
            input.dispatchEvent(new Event("input", { bubbles: true }));
          });
          expect(container.querySelector('[data-testid="surface-text-layer"] path')!.getAttribute("fill")).toBe("#2244ff");
          React.act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Use edge-band color")!.click());
          expect(textColor()).toBeNull();
          expect([...container.querySelectorAll('[data-testid="surface-text-layer"] path')].map(path => path.getAttribute("fill"))).toEqual(["#778899", "#778899"]);
        }
        if (variant === "text-only") {
          openSettingsSection(container, "materials");
          React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Color stacking rim top"]')!.click());
          binGeometryMock.buildOnce.mockResolvedValue({ mesh, bodyMesh: mesh, textMeshes });
        }
        openSettingsSection(container, "export");
        React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.click());
        const download = document.querySelector<HTMLButtonElement>(`[data-testid="button-export-${variant === "single-color" ? "single-color" : "multicolor"}-3mf"]`)!;
        expect(download.disabled).toBe(false);
        await React.act(async () => download.click());
        const blob = vi.mocked(downloadBlob).mock.lastCall![0];
        const buffer = await new Promise<ArrayBuffer>(resolve => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(blob);
        });
        const entries = unzipSync(new Uint8Array(buffer));
        const model = strFromU8(entries["3D/3dmodel.model"]);
        expect(model).toContain('name="Text: Metric &amp; SAE"');
        expect(model).toContain('name="Text: Washer"');
        expect(model.match(/<component /g)).toHaveLength(["multicolor", "opted-out", "inherited"].includes(variant) ? 4 : 3);
        expect(model.match(/<item /g)).toHaveLength(1);
        const xml = new DOMParser().parseFromString(model, "application/xml");
        const colors = [...xml.getElementsByTagName("m:color")].map(item => item.getAttribute("color"));
        for (const label of current()) {
          const object = [...xml.getElementsByTagName("object")].find(item => item.getAttribute("name") === `Text: ${surfaceTextName(label)}`)!;
          const color = colors[Number(object.getAttribute("pindex"))];
          expect(color).toBe(variant === "single-color" || variant === "text-only" ? "#BFBFBFFF"
            : variant === "inherited" ? "#778899FF" : `${textColor()!.toUpperCase()}FF`);
        }
        expect(strFromU8(entries["Metadata/model_settings.config"])).toContain('value="Text: Metric &amp; SAE"');
        if (variant === "opted-out") React.act(() => experimentalSettings.setEnabled(true));
      }
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });});

it.each(["standard", "workflow"])("phone text transforms use the dock in %s layout without experimental opt-in", async layout => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, surfaceTexts: [{ id: "docked-label", text: "Metric", position: { x: 0, y: 0 } }] });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec });
  const { container, unmount } = renderPage({ mobile: true, experimental: false });
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-text-3d-docked-label"]')!.click());
    const panel = container.querySelector<HTMLElement>(layout === "workflow" ? "#objects-panel" : '[data-testid="mobile-properties-panel"]')!;
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Move selected objects"]')!.click());
    const dock = container.querySelector('[data-testid="mobile-workspace-actions"]')!;
    expect(dock.querySelector('[aria-label="Move text X"]')).toBeNull();
    React.act(() => [...dock.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Adjust')!.click());
    const input = dock.querySelector<HTMLInputElement>('[aria-label="Move text X"]')!;
    expect(input).not.toBeNull();
    expect(panel.hidden).toBe(true);
    React.act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => input.blur());
    expect(vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts[0].position.x).toBe(5);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts[0].position.x).toBe(0);
    React.act(() => experimentalSettings.setEnabled(false));
    expect(dock.querySelector('[data-testid="text-transform-controls"]')).not.toBeNull();
    expect(panel.hidden).toBe(true);
  } finally { unmount(); }
});

it.each(["standard", "workflow"])("selecting text leaves contour editing and restores canvas interaction (%s)", async layout => {
  const originalUrl=window.location.href;
  window.history.replaceState(null,"",`/bin?layout=${layout}`);
  const shape=rectangularShape("audit-shape","Audit pocket");
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT, shapes:[shape],
    cutouts:[parseCutoutPlacement({id:"audit-pocket",shapeId:shape.id,position:{x:0,y:0}})],
    spec:parseBinSpec({...EMPTY_PROJECT.spec,surfaceTexts:[{id:"audit-text",text:"Audit text",position:{x:0,y:20}}]})});
  const {container,unmount}=renderPage();
  try {
    await flushHydration();
    selectPocket(container,"audit-pocket");
    React.act(()=>container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    React.act(()=>container.querySelector<HTMLButtonElement>('[data-testid="button-layout-edit-contour"]')!.click());
    expect(container.querySelector('[data-testid="contour-vertex-handle"]')).not.toBeNull();
    React.act(()=>container.querySelector<HTMLButtonElement>('[data-testid="button-select-surface-text-audit-text"]')!.click());
    expect(container.querySelector('[data-testid="surface-text-editor"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="surface-text-hit-audit-text"]')!.getAttribute("pointer-events")).toBe("all");
  } finally {unmount();window.history.replaceState(null,"",originalUrl);}
});
it.each(["standard", "workflow"])("3D text deletion respects inputs and undo without experimental opt-in (%s)", async layout => {
  const originalUrl=window.location.href; window.history.replaceState(null,"",`/bin?layout=${layout}`);
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,
    spec:parseBinSpec({...EMPTY_PROJECT.spec,surfaceTexts:[{id:"audit-text",text:"Audit text",position:{x:0,y:20}}]})});
  const {container,unmount}=renderPage({experimental:false});
  try {
    await flushHydration();
    React.act(()=>container.querySelector<HTMLButtonElement>('[data-testid="button-select-text-3d-audit-text"]')!.click());
    const current = () => vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts;
    const wording = container.querySelector<HTMLInputElement>('[data-testid="surface-text-editor"] input[type="text"]')!;
    React.act(() => { wording.focus(); wording.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })); });
    expect(current()).toHaveLength(1);
    React.act(() => wording.blur());
    React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", cancelable: true })));
    expect(current()).toHaveLength(0);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(current()).toHaveLength(1);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-text-3d-audit-text"]')!.click());
    React.act(() => experimentalSettings.setEnabled(false));
    React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", cancelable: true })));
    expect(current()).toHaveLength(0);
  } finally {unmount();window.history.replaceState(null,"",originalUrl);}
});

it.each([false, true])("offers surface text in the Original Layout toolbar by default (mobile=%s)", async mobile => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", "/bin?layout=standard");
  const { container, unmount } = renderPage({ mobile, experimental: false });
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const add = () => container.querySelector('[data-testid="toolbar-add-object"]')!;
    const openAdd = () => React.act(() => add().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const textOption = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Surface text");
    openAdd();
    expect(textOption()).toBeDefined();
    expect([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].some(item => item.textContent === "Finger access")).toBe(true);
    React.act(() => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    openAdd();
    React.act(() => textOption()!.click());
    const labels = vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts;
    expect(labels).toHaveLength(1);
    expect(container.querySelector(`[data-testid="surface-text-hit-${labels[0].id}"]`)!.getAttribute("pointer-events")).toBe("all");
    if (mobile) expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull();
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});

it.each([
  { layout: 'standard', experimental: false }, { layout: 'workflow', experimental: false },
  { layout: 'standard', experimental: true }, { layout: 'workflow', experimental: true },
])('object context menus target the clicked pocket, respect Experimental, and duplicate independently in $layout (experimental: $experimental)', async ({ layout, experimental }) => {
  window.history.replaceState(null, '', `/bin?layout=${layout}`);
  const shape = rectangularShape('context-shape', 'Tool');
  const cutouts = [-20, 20].map((x, i) => parseCutoutPlacement({ id: `context-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id, position: { x, y: 0 } }));
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts });
  const { container, unmount } = renderPage({ experimental });
  try {
    await flushHydration(); openSettingsSection(container, 'tool-cutouts');
    selectPocket(container, cutouts[0].id);
    const menu = openObjectContext(container.querySelector(`[data-testid="cutout-row-${cutouts[1].id}"]`)!);
    expect(menu.textContent).toContain('Tool 2'); expect(menu.textContent).toContain('Properties');
    expect(menu.textContent?.includes('Duplicate linked')).toBe(experimental);
    expect(container.querySelector(`[data-testid="button-select-${cutouts[1].id}"]`)?.getAttribute('aria-pressed')).toBe('true');
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(cutouts);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    contextCommand('Duplicate');
    const copied = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;
    expect(copied).toHaveLength(3); expect(copied[2].name).toBe('Tool 2 (copy)'); expect(copied[2].designLink).toBeUndefined();
    clickBinHistory(container, 'undo'); expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(cutouts);
    openObjectContext(container.querySelector(`[data-testid="cutout-row-${cutouts[0].id}"]`)!);
    contextCommand('Properties');
    expect(container.querySelector('#pocket-properties')).not.toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally { unmount(); }
});

it('context unlink preserves mixed selection and changes both kinds in one undo step', async () => {
  window.history.replaceState(null, '', '/bin?layout=workflow');
  const shape = rectangularShape('mixed-context', 'Tool');
  const cutouts = [-20, 20].map((x, i) => parseCutoutPlacement({ id: `mc-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id, position: { x, y: 0 }, designLink: { id: 'pockets' } }));
  const fingerHoles = [-20, 20].map((x, i) => fingerHoleSchema.parse({ id: `mf-${i}`, name: `Access ${i + 1}`, center: { x, y: 25 }, designLink: { id: 'fingers' } }));
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts, fingerHoles });
  const { container, unmount } = renderPage({ experimental: true });
  const doc = () => vi.mocked(useBinGeometry).mock.lastCall![2]!;
  try {
    await flushHydration(); selectPocket(container, cutouts[0].id);
    openSettingsSection(container, 'finger-holes');
    React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Access 1 in selection"]')!.click());
    const menu = openObjectContext(container.querySelector('[data-testid="finger-hole-row-mf-0"]')!);
    expect(menu.textContent).toContain('2 selected objects'); expect(menu.textContent).not.toContain('Link geometry…');
    contextCommand('Unlink geometry');
    expect(doc().cutouts[0].designLink).toBeUndefined(); expect(doc().fingerHoles[0].designLink).toBeUndefined();
    expect(doc().cutouts[1]).toEqual(cutouts[1]); expect(doc().fingerHoles[1]).toEqual(fingerHoles[1]);
    clickBinHistory(container, 'undo'); expect(doc().cutouts).toEqual(cutouts); expect(doc().fingerHoles).toEqual(fingerHoles);
    expect(binHistoryButton(container, 'undo').disabled).toBe(true);
  } finally { unmount(); }
});

it('context linking reuses source choice, preserves multi-selection, and saves a valid insertion path', async () => {
  window.history.replaceState(null, '', '/bin?layout=workflow');
  const shape = rectangularShape('context-link-shape', 'Tool');
  const cutouts = [parseCutoutPlacement({ id: 'context-source', name: 'Source', shapeId: shape.id, position: { x: -20, y: 0 }, depth: { mode: 'mm', value: 10 }, elevationMm: 7, insertionMode: 'axis' }),
    parseCutoutPlacement({ id: 'context-target', name: 'Target', shapeId: shape.id, position: { x: 20, y: 0 } })];
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts });
  const { container, unmount } = renderPage({ experimental: true });
  try {
    await flushHydration(); selectPocket(container, cutouts[0].id);
    React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Target in selection"]')!.click());
    openObjectContext(container.querySelector('[data-testid="cutout-row-context-source"]')!);
    contextCommand('Link geometry…');
    const dialog = document.querySelector('[role="dialog"]')!;
    const source = dialog.querySelector<HTMLSelectElement>('[aria-label="Linked geometry source"]')!;
    React.act(() => { source.value = cutouts[0].id; source.dispatchEvent(new Event('change', { bubbles: true })); });
    React.act(() => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Link geometry')!.click());
    const linked = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;
    expect(linked[0].designLink).toEqual(linked[1].designLink); expect(linked[1].elevationMm).toBeDefined();
    expect(parseProjectDoc({ ...EMPTY_PROJECT, shapes: [shape], cutouts: linked })).not.toBeNull();
  } finally { unmount(); }
});

it('Layout context menus expose retained-hole actions through the parent and undo the immutable revision', async () => {
  window.history.replaceState(null, '', '/bin?layout=workflow');
  const shape = rectangularShape('retained-context', 'Frame');
  shape.outlineMm[0].holes = [[{ x: -2, y: -2 }, { x: -2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: -2 }]]; shape.pointCount += 4;
  const cutout = parseCutoutPlacement({ id: 'frame-pocket', shapeId: shape.id, position: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage({ experimental: false });
  try {
    await flushHydration(); React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperty(svg, 'createSVGPoint', { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) });
    React.act(() => svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 41.75, clientY: 41.75 })));
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain('Hole 1'); expect(menu.textContent).toContain('Pocket properties');
    expect(menu.textContent).not.toContain('Duplicate');
    contextCommand('Remove hole');
    const doc = vi.mocked(useBinGeometry).mock.lastCall![2]!;
    expect(doc.cutouts[0].shapeId).not.toBe(shape.id);
    expect(doc.shapes.find(s => s.id === doc.cutouts[0].shapeId)!.outlineMm[0].holes).toHaveLength(0);
    clickBinHistory(container, 'undo'); expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([cutout]);
  } finally { unmount(); }
});

it.each(["pocket", "hole"])("context menus leave native name editing alone and rename the clicked %s with matching wording", async kind => {
  window.history.replaceState(null, '', '/bin?layout=standard');
  const shape = rectangularShape('name-context', 'Tool');
  const cutout = parseCutoutPlacement({ id: 'name-context-pocket', shapeId: shape.id, role: kind === 'hole' ? 'hole' : undefined, position: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage({ experimental: false });
  try {
    await flushHydration(); selectPocket(container, cutout.id);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-rename-name-context-pocket"]')!.click());
    const native = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    React.act(() => container.querySelector('[aria-label="Pocket name"]')!.dispatchEvent(native));
    expect(native.defaultPrevented).toBe(false); expect(document.querySelector('[role="menu"]')).toBeNull();
    React.act(() => container.querySelector('[aria-label="Pocket name"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    openObjectContext(container.querySelector('[data-testid="cutout-row-name-context-pocket"]')!); contextCommand('Rename…');
    expect(document.querySelector('[role="dialog"] h2')!.textContent).toBe(`Rename ${kind}`);
    const input = document.querySelector<HTMLInputElement>('[aria-label="Object name"]')!;
    React.act(() => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(input, 'Socket'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    React.act(() => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([{ ...cutout, name: 'Socket' }]);
    expect(binHistoryButton(container, 'undo').getAttribute('aria-label')).toBe(`Undo Rename ${kind}`);
    clickBinHistory(container, 'undo'); expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([cutout]);
  } finally { unmount(); }
});

it('surface text context actions stay independent, obey bounds, and undo normally', async () => {
  window.history.replaceState(null, '', '/bin?layout=standard');
  const label = surfaceTextSchema.parse({ id: 'context-label', text: 'Jig', position: { x: 672, y: -672 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, surfaceTexts: [label] }) });
  const { container, unmount } = renderPage({ experimental: true });
  try {
    await flushHydration(); openSettingsSection(container, 'text');
    const menu = openObjectContext(container.querySelector('[data-testid="surface-text-row-context-label"]')!);
    expect(menu.textContent).not.toContain('linked'); contextCommand('Duplicate');
    const spec = vi.mocked(useBinGeometry).mock.lastCall![0];
    expect(spec.surfaceTexts).toHaveLength(2); expect(spec.surfaceTexts[1].name).toBe('Jig (copy)');
    expect(parseProjectDoc({ ...EMPTY_PROJECT, spec })).not.toBeNull();
    clickBinHistory(container, 'undo'); expect(vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts).toEqual([label]);
  } finally { unmount(); }
});
