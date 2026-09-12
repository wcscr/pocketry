// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import { WORKSPACES } from "@/components/layout/workspaces";
import * as ShapeLibraryModule from "@/state/shape-library";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { PROJECT_SCHEMA_VERSION, parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { fingerHoleSchema, resolvePocketDepth, parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { downloadBlob } from "@/lib/download";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";

/**
 * Structure smoke tests for the bin designer page, following the pattern of
 * layout.test.tsx: jsdom does no layout and has no WebGL, so the r3f viewport
 * and the worker hook are stubbed and the assertions stay on what the panel
 * renders. The real geometry path is covered headless in
 * lib/gridfinity/bin-worker-handlers.test.ts.
 */

vi.mock("@/components/gridfinity/bin-viewport", () => ({
  BinViewport: ({
    fitSize,
    hasPocketFloor,
    hasStackingRim,
    binColor,
    pocketFloorColor,
    stackingRimColor,
    showPocketFloorColor,
    showStackingRimColor,
    measurementOutlines,
  }: {
    fitSize: { widthMm: number; lengthMm: number; heightMm: number };
    hasPocketFloor: boolean;
    hasStackingRim: boolean;
    binColor: string;
    pocketFloorColor: string;
    stackingRimColor: string;
    showPocketFloorColor: boolean;
    showStackingRimColor: boolean;
    measurementOutlines: readonly unknown[];
  }) => (
    <div
      data-testid="bin-viewport-stub"
      data-fit-width={fitSize.widthMm}
      data-fit-length={fitSize.lengthMm}
      data-fit-height={fitSize.heightMm}
      data-pocket-floor-color={
        hasPocketFloor && showPocketFloorColor ? "on" : "off"
      }
      data-stacking-rim-color={
        hasStackingRim && showStackingRimColor ? "on" : "off"
      }
      data-bin-color={binColor}
      data-floor-color={pocketFloorColor}
      data-rim-color={stackingRimColor}
    >
      <button
        type="button"
        data-testid="button-3d-ruler"
        disabled={measurementOutlines.length === 0}
      />
    </div>
  ),
}));

const binGeometryMock = vi.hoisted(() => ({
  building: false,
  progress: 1,
  builtSpec: null as ReturnType<typeof parseBinSpec> | null,
  hasPocketFloor: false,
  hasStackingRim: true,
  buildOnce: vi.fn(),
  buildFitCheck: vi.fn(),
  buildSurfaceFitCheck: vi.fn(),
}));

vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));

vi.mock("@/lib/gridfinity/use-bin-geometry", () => ({
  useBinGeometry: vi.fn(() => ({
    geometry: null,
    hasPocketFloor: binGeometryMock.hasPocketFloor,
    hasStackingRim: binGeometryMock.hasStackingRim,
    builtSpec: binGeometryMock.builtSpec,
    stats: { triangles: 8400, volumeMm3: 82404, buildMs: 45 },
    cutoutReports: [],
    building: binGeometryMock.building,
    progress: binGeometryMock.progress,
    error: null,
    buildOnce: binGeometryMock.buildOnce,
    buildFitCheck: binGeometryMock.buildFitCheck,
    buildSurfaceFitCheck: binGeometryMock.buildSurfaceFitCheck,
  })),
}));

// Deterministic persistence: no stored project, writes are no-ops. Hydration
// still resolves asynchronously, hence the `flushHydration` below.
vi.mock("@/lib/project/persist", () => ({
  loadProjectDoc: vi.fn(async () => null),
  loadProjectLibrary: vi.fn(async () => ({ activeProjectId: null, projects: [] })),
  saveProjectDoc: vi.fn(async () => {}),
  saveProjectToLibrary: vi.fn(),
  openProjectFromLibrary: vi.fn(),
  deleteProjectFromLibrary: vi.fn(),
  exportProjectLibrary: vi.fn(),
  importProjectLibrary: vi.fn(),
  startNewProject: vi.fn(async () => ({ activeProjectId: null, projects: [] })),
  createDebouncedProjectSaver: () => Object.assign(vi.fn(), { cancel: vi.fn() }),
}));

import * as ProjectPersistence from "@/lib/project/persist";

const EMPTY_PROJECT: ProjectDoc = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  shapes: [],
  spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }),
  cutouts: [],
  fingerHoles: [],
};

function rectangularShape(id: string, name: string): TracedShape {
  return {
    id,
    name,
    outlineMm: [
      {
        outer: [
          { x: -15, y: -10 },
          { x: 15, y: -10 },
          { x: 15, y: 10 },
          { x: -15, y: 10 },
        ],
        holes: [],
      },
    ],
    bboxMm: { minX: -15, minY: -10, maxX: 15, maxY: 10 },
    pointCount: 4,
    sourceMmPerPx: 0.5,
  };
}

async function flushHydration() {
  await React.act(async () => {
    await Promise.resolve();
  });
}

// The page is imported after the mocks so it binds to the stubs.
const { default: BinDesignerPage } = await import("./bin-designer");

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function render(ui: React.ReactElement, { mobile = false } = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: mobile,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(window, "innerWidth", {
    value: mobile ? 400 : 1440,
    writable: true,
    configurable: true,
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  React.act(() => root.render(ui));

  const result = {
    container,
    unmount: () => {
      React.act(() => root.unmount());
      container.remove();
    },
  };
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});

beforeEach(() => {
  vi.clearAllMocks();
  binGeometryMock.building = false;
  binGeometryMock.progress = 1;
  binGeometryMock.builtSpec = null;
  binGeometryMock.hasPocketFloor = false;
  binGeometryMock.hasStackingRim = true;
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(null);
  vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({
    activeProjectId: null,
    projects: [],
  });
  vi.mocked(ProjectPersistence.startNewProject).mockResolvedValue({
    activeProjectId: null,
    projects: [],
  });
  vi.mocked(ProjectPersistence.saveProjectToLibrary).mockImplementation(
    async (_doc, name, projectId) => ({
      activeProjectId: projectId ?? "project-1",
      projects: [
        {
          id: projectId ?? "project-1",
          name: name.trim(),
          updatedAt: "2026-08-24T12:00:00.000Z",
        },
      ],
    }),
  );
});

function renderPage(options: { mobile?: boolean } = {}) {
  return render(
    <PanelProvider>
      <ShapeLibraryProvider>
        <BinDesignerPage />
      </ShapeLibraryProvider>
    </PanelProvider>,
    options,
  );
}

function openSettingsSection(
  container: HTMLElement,
  section:
    | "project"
    | "size"
    | "construction"
    | "materials"
    | "tool-cutouts"
    | "finger-holes"
    | "export"
    | "check-fit",
): void {
  React.act(() => {
    (
      container.querySelector(
        `[data-testid="bin-settings-jump-${section === "tool-cutouts" ? "pockets" : section === "finger-holes" ? "finger-access" : section}"]`,
      ) as HTMLButtonElement
    ).click();
  });
}

/** Use the compact pocket list without entering rename or changing geometry. */
function selectPocket(container: HTMLElement, id: string): void {
  React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="button-select-${id}"]`)!.click());
}

describe("BinDesignerPage", () => {
  it("switches pockets in their fixed section without changing section order or entering rename", async () => {
    const first = rectangularShape("first-shape", "Wrench");
    const second = rectangularShape("second-shape", "Pliers");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [first, second],
      cutouts: [
        parseCutoutPlacement({ id: "first-pocket", shapeId: first.id, position: { x: -20, y: 0 }, depth: { mode: "mm", value: 10 } }),
        parseCutoutPlacement({ id: "second-pocket", shapeId: second.id, position: { x: 20, y: 0 }, depth: { mode: "mm", value: 20 } }),
      ],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    const pockets = container.querySelector<HTMLElement>('#bin-settings-pockets')!;
    const scroller = pockets.parentElement!;
    const sections = Array.from(scroller.children);
    expect(pockets.querySelector('[data-testid="pocket-selection-help"]')!.textContent).toContain('Select a pocket');
    scroller.scrollTop = 240;
    selectPocket(container, "second-pocket");
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Pliers");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!.value).toBe("20");
    const editor = container.querySelector<HTMLElement>('#pocket-properties')!;
    const edges = editor.querySelector<HTMLDetailsElement>('[data-testid="pocket-edge-settings"]')!;
    React.act(() => edges.querySelector('summary')!.click());
    selectPocket(container, "first-pocket");
    await React.act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(Array.from(scroller.children)).toEqual(sections);
    expect(container.querySelector('#pocket-properties')).toBe(editor);
    expect(edges.open).toBe(true);
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Wrench");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!.value).toBe("10");
    expect(container.querySelector('[data-testid="input-shape-name"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-rename-second-pocket"]')!.click());
    const name = container.querySelector<HTMLInputElement>('[data-testid="input-shape-name"]')!;
    expect(name.value).toBe("Pliers");
    expect(document.activeElement).toBe(name);
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Pliers");
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Discard this name');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[data-testid="input-shape-name"]')).toBeNull();
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Pliers");
    unmount();
  });

  it("keeps depth first and the size, scale, and other optional settings collapsed, and opens Pockets on selection", async () => {
    const shape = rectangularShape("tool", "Wrench");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: 12 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    selectPocket(container, "pocket");
    const editor = container.querySelector<HTMLElement>('#pocket-properties')!;
    const pockets = container.querySelector<HTMLElement>('#bin-settings-pockets')!;
    const scroller = pockets.parentElement!;
    expect(editor.closest('#bin-settings-pockets')).toBe(pockets);
    const primaryFields = editor.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(primaryFields[0].getAttribute('aria-label')).toBe('Pocket cut depth in millimetres');
    const size = editor.querySelector('[aria-label="Pocket size and scale"]')!;
    for (const label of ["Pocket width in millimetres", "Pocket length in millimetres", "Pocket width scale percent", "Pocket length scale percent"]) {
      expect(size.querySelector(`[aria-label="${label}"]`)!.closest('details')).toBe(size);
    }
    for (const id of ['pocket-size-settings', 'pocket-clearance-settings', 'pocket-edge-settings', 'pocket-position-settings']) {
      expect(editor.querySelector<HTMLDetailsElement>(`[data-testid="${id}"]`)!.open).toBe(false);
    }
    expect(editor.querySelector('[aria-label="Extra pocket clearance in millimetres"]')!.closest('details')!.dataset.testid).toBe('pocket-clearance-settings');
    expect(editor.querySelector('[data-testid="button-inspect-pocket"]')!.closest('details')!.dataset.testid).toBe('pocket-depth-summary');
    expect(editor.querySelector<HTMLDetailsElement>('[data-testid="pocket-depth-summary"]')!.open).toBe(false);
    expect(container.querySelector('[data-testid="button-layout-edit-pocket"]')).toBeNull();
    expect(pockets.getAttribute('data-state')).toBe('open');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    unmount();
  });

  it("keeps bin guidance behind help buttons while retaining dimensions and save status", async () => {
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "size");
    const before = [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map((input) => input.value);
    expect(container.textContent).not.toContain("Pitch changes preserve");
    expect(container.textContent).not.toContain("Snaps to");
    expect(container.textContent).not.toContain("Adding tools keeps these dimensions");
    expect(container.textContent).toContain("Outer size");
    expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toMatch(/Sav(?:ed|ing) in this browser/);
    for (const [name, explanation] of [
      ["grid pitch", "Pitch changes preserve the outer size"],
      ["width", "Snaps to 21 mm grid increments"],
      ["length", "Snaps to 21 mm grid increments"],
      ["keep bin size fixed", "Adding tools keeps these dimensions"],
    ]) {
      const help = container.querySelector<HTMLButtonElement>(`[aria-label="About ${name}"]`)!;
      React.act(() => help.click());
      expect(document.querySelector('[role="tooltip"]')!.textContent).toContain(explanation);
      React.act(() => help.click());
    }
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map((input) => input.value)).toEqual(before);
    expect(container.querySelector('[aria-label="Keep bin size fixed"]')!.getAttribute('aria-checked')).toBe('false');
    unmount();
  });

  it("centers zero clearance and makes inward adjustments undoable without scaling the trace", async () => {
    const shape = rectangularShape("tool", "Wrench");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    selectPocket(container, "pocket");
    const control = container.querySelector('[data-testid="pocket-clearance-settings"]')!;
    const slider = control.querySelector<HTMLElement>('[role="slider"]')!;
    expect(slider.getAttribute('aria-valuemin')).toBe('-2');
    expect(slider.getAttribute('aria-valuemax')).toBe('2');
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    const input = control.querySelector<HTMLInputElement>('input')!;
    React.act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '-0.5');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => input.blur());
    expect(slider.getAttribute('aria-valuenow')).toBe('-0.5');
    expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket width in millimetres"]')!.value).toBe('29');
    expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket width scale percent"]')!.value).toBe('100');
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(input.value).toBe('0');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    unmount();
  });

  it("edits physical dimensions with linked proportions and undoes the committed value once", async () => {
    const shape = rectangularShape("tool", "Wrench");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "tool-cutouts");
    selectPocket(container, "pocket");
    const width = container.querySelector<HTMLInputElement>('[aria-label="Pocket width in millimetres"]')!;
    const length = container.querySelector<HTMLInputElement>('[aria-label="Pocket length in millimetres"]')!;
    React.act(() => {
      width.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(width, '40');
      width.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => width.blur());
    expect(width.value).toBe('40');
    expect(length.value).toBe('26.67');
    const undo = container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!;
    React.act(() => undo.click());
    expect(width.value).toBe('30');
    expect(length.value).toBe('20');
    expect(undo.disabled).toBe(true);
    unmount();
  });

  it.each(["tap", "jitter", "drag", "cancel"] as const)(
    "%s on a pocket opens its fixed settings only for a click and leaves meaningful undo history",
    async (gesture) => {
      const shape = rectangularShape("tool", "Wrench");
      vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
        ...EMPTY_PROJECT, shapes: [shape],
        cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 1.25, y: 0 } })],
      });
      let controls: ReturnType<typeof usePanelState>;
      function PanelProbe() { controls = usePanelState(); return null; }
      const { container, unmount } = render(
        <PanelProvider><PanelProbe /><ShapeLibraryProvider><BinDesignerPage /></ShapeLibraryProvider></PanelProvider>,
        { mobile: gesture === 'tap' },
      );
      await flushHydration();
      // Start from another section with this pocket already selected: clicking
      // it again must still return to its settings.
      if (gesture !== 'tap') {
        selectPocket(container, "pocket");
        openSettingsSection(container, "materials");
      }
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      React.act(() => controls.setPanelOpen(false));
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      const scene = svg.querySelector('g')!;
      const pocket = svg.querySelector('[data-cutout-id="pocket"]')!;
      const before = pocket.getAttribute('d');
      // jsdom lacks SVG coordinate mapping and pointer capture. Identity mapping
      // gives a 1 px/mm canvas, with the 83.5 mm bin centred at (41.75, 41.75).
      Object.defineProperty(scene, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const pointer = (type: string, x: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 41.75, altKey: true });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        pocket.dispatchEvent(event);
      });
      pointer('pointerdown', 43);
      if (gesture === 'drag') pointer('pointermove', 55);
      if (gesture === 'jitter') pointer('pointermove', 44);
      pointer(gesture === 'cancel' ? 'pointercancel' : 'pointerup', gesture === 'drag' ? 55 : gesture === 'jitter' ? 44 : 43);
      expect(controls!.panelOpen).toBe(gesture === 'tap' || gesture === 'jitter');
      if (gesture === 'tap' || gesture === 'jitter') {
        expect(document.querySelector('#bin-settings-pockets')!.getAttribute('data-state')).toBe('open');
        expect(document.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain('Wrench');
      }
      expect(container.querySelector('[data-testid="button-layout-edit-pocket"]')).toBeNull();
      const undo = container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!;
      expect(undo.disabled).toBe(gesture !== 'drag');
      if (gesture === 'drag') {
        expect(pocket.getAttribute('d')).not.toBe(before);
        React.act(() => undo.click());
      }
      expect(pocket.getAttribute('d')).toBe(before);
      unmount();
    },
  );

  it("edits and finishes a selected contour directly in Layout, including after using the ruler", async () => {
    const shape = rectangularShape("tool", "Wrench");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    expect(container.querySelector('[data-testid="button-layout-edit-contour"]')).toBeNull();
    openSettingsSection(container, "tool-cutouts");
    selectPocket(container, "pocket");
    const edit = container.querySelector<HTMLButtonElement>('[data-testid="button-layout-edit-contour"]')!;
    expect(edit.closest('[data-testid="layout-tool-toolbar"]')).not.toBeNull();
    expect(edit.previousElementSibling?.getAttribute('data-testid')).toBe('button-layout-ruler');
    expect(container.querySelector('[data-testid="button-edit-contour"]')!.closest('[data-testid="pocket-properties-heading"]')).not.toBeNull();
    expect(edit.textContent).toBe("");
    expect(edit.getAttribute("aria-label")).toBe("Edit contour");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-layout-ruler"]')!.click());
    expect(container.querySelector('[data-testid="layout-ruler-status"]')).not.toBeNull();
    React.act(() => edit.click());
    expect(edit.getAttribute("aria-label")).toBe("Finish contour editing");
    expect(edit.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-testid="layout-ruler-status"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="contour-vertex-handle"]')).toHaveLength(4);
    expect(container.querySelector('[data-testid="button-edit-contour"]')!.getAttribute("aria-label")).toBe("Finish contour editing");
    React.act(() => edit.click());
    expect(edit.textContent).toBe("");
    expect(edit.getAttribute("aria-label")).toBe("Edit contour");
    expect(container.querySelector('[data-testid="contour-vertex-handle"]')).toBeNull();
    expect(container.querySelector('[data-testid="pocket-resize-handle-ne"]')).not.toBeNull();
    unmount();
  });

  it.each(["stl", "3mf"])("cancels %s without downloads and resets the JSON checkbox for the next request", async (format) => {
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "export");
    const trigger = container.querySelector<HTMLButtonElement>(`[data-testid="button-export-${format}"]`)!;
    React.act(() => trigger.click());
    const checkbox = () => document.querySelector<HTMLButtonElement>('[data-testid="checkbox-export-project"]')!;
    expect(checkbox().getAttribute("aria-checked")).toBe("false");
    React.act(() => checkbox().click());
    expect(checkbox().getAttribute("aria-checked")).toBe("true");
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Cancel")!.click());
    expect(document.querySelector('[data-testid="checkbox-export-project"]')).toBeNull();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(binGeometryMock.buildOnce).not.toHaveBeenCalled();
    React.act(() => trigger.click());
    expect(checkbox().getAttribute("aria-checked")).toBe("false");
    unmount();
  });

  it.each(["button-show-full-bin", "button-inspect-pocket"])(
    "exits pocket inspection from %s and restores the full preview without editing the model",
    async (exitButton) => {
      const shape = rectangularShape("tool", "Wrench");
      vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
        ...EMPTY_PROJECT,
        shapes: [shape],
        cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 12, y: 0 } })],
      });
      const { container, unmount } = renderPage();
      await flushHydration();
      openSettingsSection(container, "tool-cutouts");
      React.act(() => {
        selectPocket(container, "pocket");
        container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click();
      });
      const precision = container.querySelector<HTMLDetailsElement>('[aria-label="X position in millimetres"]')!.closest("details")!;
      expect(precision.open).toBe(false);
      expect(container.querySelector('[data-testid="button-show-full-bin"]')).toBeNull();
      const before = vi.mocked(useBinGeometry).mock.lastCall!;
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-inspect-pocket"]')!.click());
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')).not.toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![3]).toEqual({ axis: "x", offsetMm: 12 });
      expect(container.querySelector('[data-testid="button-inspect-pocket"]')!.textContent).toBe("Show full bin");
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="${exitButton}"]`)!.click());
      const after = vi.mocked(useBinGeometry).mock.lastCall!;
      expect(after[3]).toBeNull();
      expect(after[0]).toBe(before[0]);
      expect(after[2]).toBe(before[2]);
      expect(container.querySelector('[data-testid="button-show-full-bin"]')).toBeNull();
      expect(container.querySelector('[data-testid="button-inspect-pocket"]')!.textContent).toBe("Inspect this pocket in 3D");
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')).not.toBeNull();
      unmount();
    },
  );

  it.each([
    ["stl", "", "stl"],
    ["single-color-3mf", "", "3mf"],
    ["multicolor-3mf", "-multicolor", "3mf"],
    ["surface-fit-test", "-surface-fit-test-1.2mm", "stl"],
    ["fit-check", "-Wrench-fit-template-2mm", "stl"],
    ["layout-svg", "-layout", "svg"],
    ["layout-dxf", "-layout", "dxf"],
  ].flatMap(([kind, suffix, extension]) => [false, true].map((includeProject) => ({ kind, suffix, extension, includeProject }))))(
    "exports $kind with project JSON only when requested ($includeProject)",
    async ({ kind, suffix, extension, includeProject }) => {
    const shape = rectangularShape("tool", "Wrench");
    const project: ProjectDoc = {
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6.5 }),
      shapes: [shape, rectangularShape("unused", "Unplaced tool")],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } })],
      fingerHoles: [fingerHoleSchema.parse({ id: "hole", kind: "straight", center: { x: 40, y: 0 } })],
    };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(project);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({
      activeProjectId: "layout-2",
      projects: [{ id: "layout-2", name: "Layout 2", updatedAt: "2026-09-05T12:00:00Z" }],
    });
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
      normals: null,
    };
    const result = { mesh, materialMeshes: { body: mesh, pocketFloors: mesh, stackingRim: mesh } };
    binGeometryMock.buildOnce.mockResolvedValue(result);
    binGeometryMock.buildFitCheck.mockResolvedValue(result);
    binGeometryMock.buildSurfaceFitCheck.mockResolvedValue(result);
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      if (kind === "fit-check") {
        openSettingsSection(container, "tool-cutouts");
        React.act(() => {
          selectPocket(container, "pocket");
        });
      }
      openSettingsSection(container, kind === "surface-fit-test" || kind === "fit-check" || kind.startsWith("layout-") ? "check-fit" : "export");
      await React.act(async () => {
        const button = kind.startsWith("layout-") ? `button-${kind}` : `button-export-${kind.endsWith("3mf") ? "3mf" : kind}`;
        container.querySelector<HTMLButtonElement>(`[data-testid="${button}"]`)!.click();
      });
      expect(downloadBlob).not.toHaveBeenCalled();
      const checkbox = document.querySelector<HTMLButtonElement>('[data-testid="checkbox-export-project"]')!;
      expect(checkbox.getAttribute("aria-checked")).toBe("false");
      if (includeProject) React.act(() => checkbox.click());
      await React.act(async () => {
        const button = kind.endsWith("3mf") ? `button-export-${kind}` : "button-confirm-export";
        document.querySelector<HTMLButtonElement>(`[data-testid="${button}"]`)!.click();
      });
      expect(downloadBlob).toHaveBeenCalledTimes(includeProject ? 2 : 1);
      const [model, modelName] = vi.mocked(downloadBlob).mock.calls.at(-1)!;
      expect(modelName).toMatch(new RegExp(`^Layout-2-bin-4x4x6\\.5${suffix.replaceAll(".", "\\.")}-\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}-\\d{3}\\.${extension}$`));
      expect(model.size).toBeGreaterThan(84);
      if (!includeProject) return;
      const [backup, backupName] = vi.mocked(downloadBlob).mock.calls[0];
      expect(backupName).toBe(modelName.replace(/\.(stl|3mf|svg|dxf)$/, ".pocketry.json"));
      const json = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(backup);
      });
      expect(parseProjectDoc(JSON.parse(json))).toEqual({ ...project, name: "Layout 2", keepBinSize: false });
    } finally {
      unmount();
    }
  });

  it("does not download an export pair when geometry generation fails", async () => {
    binGeometryMock.buildOnce.mockRejectedValueOnce(new Error("Mesh failed"));
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "export");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-stl"]')!.click());
    await React.act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-export"]')!.click();
    });
    expect(binGeometryMock.buildOnce).toHaveBeenCalledTimes(1);
    expect(downloadBlob).not.toHaveBeenCalled();
    unmount();
  });

  it("is registered as the /bin workspace", () => {
    const entry = WORKSPACES.find((workspace) => workspace.path === "/bin");
    expect(entry).toBeDefined();
    expect(entry!.label).toBe("Bin");
  });

  it("renders the size and feature controls with computed dimensions", () => {
    const { container, unmount } = renderPage();
    const sizeText = container.textContent ?? "";
    for (const label of ["Bin size", "Grid pitch", "Width", "Length", "Height"]) {
      expect(sizeText).toContain(label);
    }
    // Default 2×2×6: 83.5 × 83.5, 42 + 3.55 lip.
    expect(sizeText).toContain("83.5");
    expect(sizeText).toContain("45.6 mm");

    openSettingsSection(container, "construction");
    const constructionText = container.textContent ?? "";
    for (const label of [
      "Stacking lip",
      "Solid fill",
      "Magnet holes",
      "Screw holes",
    ]) {
      expect(constructionText).toContain(label);
    }
    expect(constructionText).not.toContain("Lite base");
    unmount();
  });

  it("toggles flat bottoms without resizing and restores base hole preferences", async () => {
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "construction");
    const control = (label: string) => container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;
    const dimensions = container.querySelector("#bin-settings-size")!.textContent;
    React.act(() => control("Magnet holes").click());
    expect(control("Magnet holes").getAttribute("aria-checked")).toBe("true");
    React.act(() => control("Flat bottom").click());
    expect(control("Flat bottom").getAttribute("aria-checked")).toBe("true");
    expect(control("Magnet holes")).toBeNull();
    expect(control("Screw holes")).toBeNull();
    expect(container.querySelector("#bin-settings-size")!.textContent).toBe(dimensions);
    React.act(() => control("Flat bottom").click());
    expect(control("Magnet holes").getAttribute("aria-checked")).toBe("true");
    unmount();
  });

  it("switches a 3 by 5 bin to quarter pitch and edits beyond 16 small cells", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 6, gridY: 10, gridPitch: "half", heightUnits: 5.5 }),
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      const trigger = container.querySelector<HTMLButtonElement>('[data-testid="select-grid-pitch"]')!;
      React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((node) => node.textContent === "Quarter · 10.5 mm")!;
      expect(option).toBeDefined();
      expect(option.getAttribute("aria-disabled")).not.toBe("true");
      React.act(() => option.click());
      const size = container.querySelector("#bin-settings-size")!;
      expect(size.textContent).toContain("3 × 5 × 5.5u");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ gridX: 12, gridY: 20, gridPitch: "quarter" });
      const input = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      expect(input("Width in standard cells").value).toBe("3");
      expect(input("Length in standard cells").value).toBe("5");
      expect(size.textContent).toContain("Outer size 125.5 × 209.5 × 42.1 mm");

      const length = input("Length in standard cells");
      React.act(() => length.focus());
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(length, "5.25");
        length.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => length.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(size.textContent).toContain("3 × 5.25 × 5.5u");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ gridX: 12, gridY: 21, gridPitch: "quarter" });
      expect(size.textContent).toContain("Outer size 125.5 × 220.0 × 42.1 mm");
    } finally {
      unmount();
    }
  });

  it("sets width, length, and height in half-unit increments", async () => {
    const { container, unmount } = renderPage();
    await flushHydration();

    const width = container.querySelector<HTMLElement>(
      '[aria-label="Width in standard Gridfinity cells"]',
    );
    expect(width).not.toBeNull();
    React.act(() => {
      width!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
      width!.dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }),
      );
    });

    const sizeSection = container.querySelector("#bin-settings-size");
    expect(sizeSection?.textContent).toContain("Outer size 62.5 × 83.5 × 45.6 mm");
    expect(sizeSection?.textContent).toContain("1.5 × 2 × 6u");
    expect(
      container.querySelector('[data-testid="select-grid-pitch"]')?.textContent,
    ).toContain("Half");

    const length = container.querySelector<HTMLElement>(
      '[aria-label="Length in standard Gridfinity cells"]',
    );
    expect(length).not.toBeNull();
    React.act(() => {
      length!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
      length!.dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(sizeSection?.textContent).toContain("1.5 × 1.5 × 6u");

    const height = container.querySelector<HTMLElement>(
      '[aria-label="Height in 0.5u increments"]',
    );
    expect(height).not.toBeNull();
    React.act(() => {
      height!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      height!.dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }),
      );
    });

    expect(container.querySelector<HTMLInputElement>('[aria-label="Bin height in units"]')?.value).toBe("6.5");
    expect(sizeSection?.textContent).toContain("1.5 × 1.5 × 6.5u");
    unmount();
  });

  it("restores a custom L footprint and exposes its cell editor", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({
        gridX: 2,
        gridY: 2,
        heightUnits: 6,
        footprint: {
          kind: "custom",
          cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
        },
      }),
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    expect(container.querySelector("#bin-settings-size")?.textContent)
      .toContain("Custom footprint. Add or remove cells in the Layout view");
    const edit = container.querySelector('[data-testid="button-edit-footprint"]') as HTMLButtonElement;
    React.act(() => edit.click());
    expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="footprint-cell"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-testid="footprint-halo-cell"]')).toHaveLength(6);
    expect(container.querySelector('[data-testid="button-reset-footprint"]')).not.toBeNull();
    unmount();
  });

  it("restores a deep finger scoop with diameter and total-depth controls", async () => {
    const shape = rectangularShape("shape-deep", "Deep pliers");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      shapes: [shape],
      cutouts: [
        parseCutoutPlacement({
          id: "cutout-deep",
          shapeId: shape.id,
          position: { x: 0, y: 0 },
        }),
      ],
      fingerHoles: [
        {
          id: "finger-deep",
          kind: "deep-scoop",
          center: { x: 15, y: 0 },
          diameterMm: 16,
          depthMm: 30,
          topFilletMm: 0,
          bottomFilletMm: 0,
        },
      ],
    });

    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-select-finger-hole-finger-deep"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(
      container.querySelector('[data-testid="selected-finger-hole-kind"]')?.textContent,
    ).toContain("Deep scoop");
    expect(container.querySelector('[aria-label="Diameter"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Total depth"]')).not.toBeNull();
    const fingerHoleSection = container.querySelector(
      '#bin-settings-finger-holes',
    );
    expect(
      fingerHoleSection?.querySelector('[aria-label="Top edge round"]'),
    ).not.toBeNull();
    expect(
      fingerHoleSection?.querySelector('[aria-label="Bottom edge fillet"]'),
    ).toBeNull();
    expect(container.querySelector('[aria-label="Reach"]')).toBeNull();
    expect(container.textContent).toContain("Vertical walls: 22.0 mm");
    expect(container.textContent).toContain("rounded bottom radius: 8.0 mm");

    React.act(() => {
      (container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement).click();
    });
    expect(
      container.querySelector('[data-testid="finger-hole-deep-scoop-finger-deep"]'),
    ).not.toBeNull();
    unmount();
  });

  it.each([
    ["oblong-deep-scoop", 30], ["flat-ended-scoop", 30], ["flat-ended-scoop", 1],
  ] as const)("restores %s with rotation controls and endpoint handles", async (kind, depthMm) => {
    const shape = rectangularShape("shape-oblong-deep", "Long pliers");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      shapes: [shape],
      cutouts: [
        parseCutoutPlacement({
          id: "cutout-oblong-deep",
          shapeId: shape.id,
          position: { x: 0, y: 0 },
        }),
      ],
      fingerHoles: [
        {
          id: "finger-oblong-deep",
          kind,
          center: { x: 0, y: 15 },
          diameterMm: 12,
          depthMm,
          lengthMm: 40,
          rotationDeg: 0,
          topFilletMm: 0,
          bottomFilletMm: 0,
        },
      ],
    });

    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-select-finger-hole-finger-oblong-deep"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(
      container.querySelector('[data-testid="selected-finger-hole-kind"]')?.textContent,
    ).toContain(kind === "flat-ended-scoop" ? "Flat-ended cylindrical scoop" : "Oblong deep scoop");
    expect(container.querySelector('[aria-label="Diameter"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Total depth"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Length"]')).not.toBeNull();
    const rotateClockwise = container.querySelector(
      '[aria-label="Rotate elongated finger hole 90 degrees clockwise"]',
    ) as HTMLButtonElement;
    expect(rotateClockwise).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="Rotate elongated finger hole 90 degrees counterclockwise"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain(`Vertical walls: ${Math.max(0, depthMm - 6).toFixed(1)} mm`);
    expect(container.textContent).toContain(`rounded bottom radius: ${depthMm === 1 ? "18.5" : "6.0"} mm`);
    const depthInput = container.querySelector<HTMLInputElement>('[aria-label="Total depth in millimetres"]')!;
    expect(depthInput.value).toBe(String(depthMm));
    expect(depthInput.min).toBe(kind === "flat-ended-scoop" ? "1" : "6");

    React.act(() => {
      (container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement).click();
    });
    const handle = (endpoint: "start" | "end") =>
      container.querySelector(
        `[data-testid="finger-hole-oblong-end-${endpoint}-finger-oblong-deep"]`,
      ) as SVGCircleElement;
    expect(handle("start")).not.toBeNull();
    expect(handle("end")).not.toBeNull();
    expect(
      Math.abs(Number(handle("end").getAttribute("cx")) - Number(handle("start").getAttribute("cx"))),
    ).toBeGreaterThan(10);

    React.act(() => rotateClockwise.click());
    expect(
      Math.abs(Number(handle("end").getAttribute("cy")) - Number(handle("start").getAttribute("cy"))),
    ).toBeGreaterThan(10);
    unmount();
  });

  it("shows preview processing beside the size controls", () => {
    binGeometryMock.building = true;
    binGeometryMock.progress = 0.4;
    const { container, unmount } = renderPage();

    expect(
      container.querySelector('[data-testid="bin-size-preview-status"]')?.textContent,
    ).toContain("Updating 3D preview");
    expect(
      container.querySelector("#bin-settings-export")?.textContent,
    ).toContain("Updating");
    unmount();
  });

  it("keeps camera framing on the completed mesh while new dimensions build", async () => {
    binGeometryMock.building = true;
    binGeometryMock.progress = 0;
    binGeometryMock.builtSpec = parseBinSpec({
      gridX: 2,
      gridY: 2,
      heightUnits: 6,
    });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 4, gridY: 3, heightUnits: 8 }),
    });

    const { container, unmount } = renderPage();
    await flushHydration();

    expect(container.textContent).toContain("4 × 3 × 8u");
    const viewport = container.querySelector('[data-testid="bin-viewport-stub"]');
    expect(viewport?.getAttribute("data-fit-width")).toBe("83.5");
    expect(viewport?.getAttribute("data-fit-length")).toBe("83.5");
    expect(Number(viewport?.getAttribute("data-fit-height"))).toBeCloseTo(45.5515, 3);
    unmount();
  });

  it("makes the long settings panel scannable by purpose", () => {
    const { container, unmount } = renderPage();
    const index = container.querySelector('[data-testid="bin-settings-index"]');
    expect(index?.textContent).toContain("Find a setting");
    expect(index?.textContent).toContain("Pockets");
    expect(index?.textContent).not.toContain("Color by purpose");

    const expectedSections = [
      ["bin-settings-project", "slate", "closed"],
      ["bin-settings-size", "blue", "open"],
      ["bin-settings-construction", "rose", "closed"],
      ["bin-settings-pockets", "violet", "closed"],
      ["bin-settings-finger-holes", "cyan", "closed"],
      ["bin-settings-view", "amber", "closed"],
      ["bin-settings-export", "emerald", "closed"],
    ] as const;
    for (const [id, tone, state] of expectedSections) {
      const section = container.querySelector(`#${id}`);
      expect(section?.getAttribute("data-tone")).toBe(tone);
      expect(section?.getAttribute("data-state")).toBe(state);
    }
    const tones = [
      ...container.querySelectorAll<HTMLElement>('[id^="bin-settings-"]'),
    ].map((section) => section.dataset.tone);
    expect(tones.every(Boolean)).toBe(true);

    const construction = container.querySelector(
      "#bin-settings-construction",
    ) as HTMLElement;
    const scroller = construction.parentElement!;
    const scrollTo = vi.fn();
    vi.spyOn(construction, "getBoundingClientRect").mockReturnValue({
      top: 290,
    } as DOMRect);
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 100,
    } as DOMRect);
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 50, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    });
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-construction"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container
        .querySelector("#bin-settings-construction")
        ?.getAttribute("data-state"),
    ).toBe("open");
    expect(
      container.querySelector("#bin-settings-size")?.getAttribute("data-state"),
    ).toBe("closed");
    expect(scroller.style.paddingBottom).toBe("400px");
    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: "auto" });
    requestFrame.mockRestore();
    unmount();
  });

  it("lets the user toggle pocket-floor coloring without rebuilding geometry", () => {
    binGeometryMock.hasPocketFloor = true;
    const { container, unmount } = renderPage();

    const viewport = container.querySelector('[data-testid="bin-viewport-stub"]');
    expect(viewport?.getAttribute("data-pocket-floor-color")).toBe("on");

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-materials"]',
        ) as HTMLButtonElement
      ).click();
    });
    const toggle = container.querySelector(
      '[role="switch"][aria-label="Color pocket floors"]',
    ) as HTMLButtonElement;
    expect(toggle?.getAttribute("data-state")).toBe("checked");

    React.act(() => toggle.click());
    expect(viewport?.getAttribute("data-pocket-floor-color")).toBe("off");
    expect(toggle.getAttribute("data-state")).toBe("unchecked");
    unmount();
  });

  it.each([true, false])("sets the correct floor when selecting floor mode with flatBottom=%s", async (flatBottom) => {
    const shape = rectangularShape("tool", "Depth test");
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, flatBottom });
    const depthMm = resolvePocketDepth(spec, { mode: "remaining", floorThicknessMm: 7 }).depthMm!;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, spec, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: depthMm } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "tool-cutouts");
    selectPocket(container, "pocket");
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Pocket depth mode"]')!;
    React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((node) => node.textContent?.includes("Keep floor thickness"))!;
    React.act(() => option.click());
    const floor = container.querySelector<HTMLInputElement>('input[aria-label="Remaining floor thickness in millimetres"]')!;
    expect(floor.value).toBe(flatBottom ? "2" : "7");
    unmount();
  });

  it("keeps error details on the canvas in both views, collapses them, and blocks export", async () => {
    const shape = rectangularShape("tool", "Wrench");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid" }),
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 70, y: 0 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    const warnings = container.querySelector<HTMLElement>('[data-testid="canvas-warnings"]')!;
    expect(warnings.closest('[data-testid="bin-canvas"]')).not.toBeNull();
    const toggle = warnings.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    React.act(() => toggle.click());
    const issue = warnings.querySelector<HTMLButtonElement>('[data-issue-code="out-of-bounds"]')!;
    expect(issue).not.toBeNull();
    expect(container.querySelectorAll('[data-issue-code="out-of-bounds"]')).toHaveLength(1);
    expect(toggle.textContent).toContain('error');
    React.act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(warnings.querySelector('[data-issue-code]')).toBeNull();
    React.act(() => toggle.click());
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    expect(container.querySelector('[data-testid="canvas-warnings"]')).toBe(warnings);
    React.act(() => warnings.querySelector<HTMLButtonElement>('[data-issue-code="out-of-bounds"]')!.click());
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain('Wrench');
    openSettingsSection(container, 'export');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-export-stl"]')!.disabled).toBe(true);
    expect(container.querySelector('#bin-settings-export [data-issue-code]')).toBeNull();
    unmount();
  });

  it("cycles between overlapping pockets from their canvas warning", async () => {
    const first = rectangularShape('first', 'Wrench');
    const second = rectangularShape('second', 'Pliers');
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [first, second],
      spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid" }),
      cutouts: [
        parseCutoutPlacement({ id: 'first-pocket', shapeId: first.id, position: { x: -3, y: 0 } }),
        parseCutoutPlacement({ id: 'second-pocket', shapeId: second.id, position: { x: 3, y: 0 } }),
      ],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="canvas-warnings"] button[aria-expanded]')!.click());
    const issue = container.querySelector<HTMLButtonElement>('[data-testid="canvas-warnings"] [data-issue-code="cutout-overlap"]')!;
    React.act(() => issue.click());
    const firstName = container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent;
    React.act(() => issue.click());
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).not.toBe(firstName);
    expect(issue.getAttribute('data-selected')).toBe('true');
    expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    unmount();
  });

  it.each([false, true])("starts warnings as a compact count and expands the messages on request (mobile: %s)", async (mobile) => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 7, gridY: 2, heightUnits: 6 }),
    });
    const { container, unmount } = renderPage({ mobile });
    await flushHydration();
    const warnings = container.querySelector<HTMLElement>('[data-testid="canvas-warnings"]')!;
    const toggle = warnings.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toContain('Expand');
    expect(warnings.querySelector('[data-issue-code]')).toBeNull();
    React.act(() => toggle.click());
    expect(warnings.querySelector('[data-issue-code="large-footprint"]')).not.toBeNull();
    expect(toggle.getAttribute('aria-label')).toContain('Collapse');
    unmount();
  });

  it("shows live floor-color warnings only on the canvas, with a reminder at export", async () => {
    const shape = rectangularShape("tool", "Air Duster");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6.5, fill: "solid" }),
      shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: 39 } })],
    });
    binGeometryMock.hasPocketFloor = true;
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "export");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="canvas-warnings"] button[aria-expanded]')!.click());
    const issueSelector = '[data-issue-code="floor-color-on-underside"]';
    const issue = container.querySelector<HTMLButtonElement>(issueSelector)!;
    expect(issue.textContent).toContain("Air Duster");
    expect(issue.textContent).toContain("Floor color may show on the underside");
    React.act(() => issue.click());
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Air Duster");
    expect(issue.closest('[data-testid="bin-canvas"]')).not.toBeNull();
    expect(container.querySelectorAll(issueSelector)).toHaveLength(1);
    expect(container.querySelector('[data-testid="selected-object-issues"]')).toBeNull();

    const setNumber = (input: HTMLInputElement, value: string) => React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const depthInput = container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!;
    setNumber(depthInput, "38.8");
    expect(container.querySelector(issueSelector)).toBeNull();
    setNumber(depthInput, "39");
    expect(container.querySelector(issueSelector)).not.toBeNull();

    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="bin-settings-jump-materials"]')!.click());
    expect(container.querySelector('[aria-label="Pocket floor color warnings"]')).toBeNull();
    expect(container.querySelector('[data-testid="canvas-warnings"]')!.textContent).toContain("Air Duster");
    const thicknessInput = container.querySelector<HTMLInputElement>('[data-testid="input-pocket-floor-thickness"]')!;
    setNumber(thicknessInput, "0.4");
    expect(container.querySelector(issueSelector)).toBeNull();
    setNumber(thicknessInput, "0.6");
    expect(container.querySelector(issueSelector)).not.toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Color pocket floors"]')!;
    React.act(() => toggle.click());
    expect(container.querySelector(issueSelector)).toBeNull();
    React.act(() => toggle.click());
    expect(container.querySelector(issueSelector)).not.toBeNull();

    openSettingsSection(container, "export");
    const exportButton = container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!;
    expect(exportButton.disabled).toBe(false);
    React.act(() => exportButton.click());
    expect(document.querySelector('[data-testid="export-floor-color-warning"]')!.textContent).toContain("Floor color may show on the underside");
    expect(document.querySelector<HTMLButtonElement>('[data-testid="button-export-multicolor-3mf"]')!.disabled).toBe(false);
    unmount();
  });

  it("shows compact color swatches and configurable downward material depths", () => {
    binGeometryMock.hasPocketFloor = true;
    const { container, unmount } = renderPage();
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-materials"]',
        ) as HTMLButtonElement
      ).click();
    });

    const body = container.querySelector(
      '[data-testid="input-bin-color"]',
    ) as HTMLInputElement;
    const floor = container.querySelector(
      '[data-testid="input-pocket-floor-color"]',
    ) as HTMLInputElement;
    const rim = container.querySelector(
      '[data-testid="input-stacking-rim-color"]',
    ) as HTMLInputElement;
    expect(body.value).toBe("#bfbfbf");
    expect(floor.value).toBe("#000000");
    expect(rim.value).toBe(floor.value);
    expect(container.textContent).not.toContain("#BFBFBF");
    expect(container.textContent).not.toContain("#000000");
    expect(
      container.querySelector('[data-testid="view-color-row-bin"]')?.contains(body),
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="view-color-row-floor"]')?.contains(floor),
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="view-color-row-rim"]')?.contains(rim),
    ).toBe(true);
    const floorThickness = container.querySelector(
      '[data-testid="input-pocket-floor-thickness"]',
    ) as HTMLInputElement;
    const rimThickness = container.querySelector(
      '[data-testid="input-stacking-rim-thickness"]',
    ) as HTMLInputElement;
    expect(floorThickness.value).toBe("0.6");
    expect(rimThickness.value).toBe("1.25");
    expect(floorThickness.max).toBe("3");
    expect(rimThickness.max).toBe("7.35");
    expect(container.textContent).toContain("mm down");
    expect(container.textContent).not.toContain("never adds height to the bin");
    const thicknessHelp = container.querySelector<HTMLButtonElement>('[data-testid="view-color-row-floor"] [aria-label="About color thickness"]')!;
    React.act(() => thicknessHelp.click());
    expect(document.querySelector('[role="tooltip"]')!.textContent).toContain("never adds height to the bin");
    React.act(() => thicknessHelp.click());

    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        body,
        "#112233",
      );
      body.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        floor,
        "#445566",
      );
      floor.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        rim,
        "#778899",
      );
      rim.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        floorThickness,
        "1.2",
      );
      floorThickness.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        rimThickness,
        "1.4",
      );
      rimThickness.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const viewport = container.querySelector('[data-testid="bin-viewport-stub"]');
    expect(viewport?.getAttribute("data-bin-color")).toBe("#112233");
    expect(viewport?.getAttribute("data-floor-color")).toBe("#445566");
    expect(viewport?.getAttribute("data-rim-color")).toBe("#778899");
    expect(viewport?.getAttribute("data-stacking-rim-color")).toBe("on");
    expect(floorThickness.value).toBe("1.2");
    expect(rimThickness.value).toBe("1.4");
    unmount();
  });

  it("explains the empty Layout and keeps both rulers unavailable", () => {
    const { container, unmount } = renderPage();
    const ruler3d = container.querySelector(
      '[data-testid="button-3d-ruler"]',
    ) as HTMLButtonElement;
    expect(ruler3d).not.toBeNull();
    expect(ruler3d.disabled).toBe(true);
    expect(container.querySelector('[data-testid="button-layout-ruler"]')).toBeNull();

    React.act(() => {
      (
        container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement
      ).click();
    });
    const ruler = container.querySelector(
      '[data-testid="button-layout-ruler"]',
    ) as HTMLButtonElement;
    expect(ruler).not.toBeNull();
    expect(ruler.getAttribute("aria-pressed")).toBe("false");
    expect(ruler.disabled).toBe(true);
    expect(ruler.title).toContain("Add a tool cutout");
    expect(
      container.querySelector('[data-testid="layout-empty-state"]')?.textContent,
    ).toContain("Add a tool pocket or a finger hole");
    expect(container.querySelector('[data-testid="layout-ruler-status"]')).toBeNull();
    expect(container.textContent).toContain("Add a tool pocket or finger hole to begin");
    unmount();
  });

  it("makes autosave/resume, save, open, and new-project paths explicit", async () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    const status = container.querySelector(
      '[data-testid="project-autosave-status"]',
    ) as HTMLElement;
    const save = container.querySelector(
      '[data-testid="button-save-library"]',
    ) as HTMLButtonElement;
    const open = container.querySelector(
      '[data-testid="button-open-library"]',
    ) as HTMLButtonElement;
    const fresh = container.querySelector(
      '[data-testid="button-new-project"]',
    ) as HTMLButtonElement;

    expect(status.textContent).toContain("Checking for saved projects");
    expect(save.disabled).toBe(true);
    await flushHydration();

    expect(status.textContent).toContain("Untitled project");
    expect(status.textContent).not.toContain("draft resumes automatically");
    const autosaveHelp = status.querySelector<HTMLButtonElement>('[aria-label="About project autosave"]')!;
    React.act(() => autosaveHelp.click());
    expect(document.querySelector('[role="tooltip"]')!.textContent).toContain("draft resumes automatically");
    React.act(() => autosaveHelp.click());
    expect(save.textContent).toContain("Save to library");
    expect(open.textContent).toContain("Open library");
    expect(fresh.textContent).toContain("New project");
    expect(save.disabled).toBe(false);
    expect(open.disabled).toBe(false);
    expect(fresh.disabled).toBe(false);
    unmount();
  });

  it("names the current draft in the cross-browser Project Library", async () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-save-library"]',
        ) as HTMLButtonElement
      ).click();
    });
    const name = document.querySelector(
      '[data-testid="input-project-name"]',
    ) as HTMLInputElement;
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        name,
        "Socket wrench tray",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await React.act(async () => {
      (
        document.querySelector(
          '[data-testid="button-confirm-save-library"]',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    expect(ProjectPersistence.saveProjectToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: PROJECT_SCHEMA_VERSION }),
      "Socket wrench tray",
      null,
    );
    expect(
      container.querySelector('[data-testid="project-autosave-status"]')?.textContent,
    ).toContain("Socket wrench tray");
    expect(
      container.querySelector('[data-testid="button-save-library"]')?.textContent,
    ).toContain("Rename");
    unmount();
  });

  it("lists named projects and opens the selected library entry", async () => {
    const projects = [
      { id: "project-1", name: "Socket tray", updatedAt: "2026-08-24T12:00:00.000Z" },
      { id: "project-2", name: "Pliers tray", updatedAt: "2026-08-24T13:00:00.000Z" },
    ];
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({
      activeProjectId: "project-1",
      projects,
    });
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockResolvedValue({
      doc: EMPTY_PROJECT,
      project: projects[1],
      library: { activeProjectId: "project-2", projects },
    });

    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    expect(
      container.querySelector('[data-testid="project-autosave-status"]')?.textContent,
    ).toContain("Socket tray");

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-open-library"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.querySelector('[data-testid="project-list"]')?.textContent).toContain(
      "Pliers tray",
    );
    expect(
      (document.querySelector(
        '[data-testid="button-open-project-project-1"]',
      ) as HTMLButtonElement).disabled,
    ).toBe(true);

    await React.act(async () => {
      (
        document.querySelector(
          '[data-testid="button-open-project-project-2"]',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(ProjectPersistence.openProjectFromLibrary).toHaveBeenCalledWith("project-2");
    expect(
      container.querySelector('[data-testid="project-autosave-status"]')?.textContent,
    ).toContain("Pliers tray");
    unmount();
  });

  it("exports the full library from its dialog with the latest design snapshot", async () => {
    const backup = { format: "pocketry-library" as const, schemaVersion: 1 as const, projects: [] };
    vi.mocked(ProjectPersistence.exportProjectLibrary).mockResolvedValue(backup);
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => { (container.querySelector('[data-testid="button-open-library"]') as HTMLButtonElement).click(); });
    await React.act(async () => { (document.querySelector('[data-testid="button-export-library"]') as HTMLButtonElement).click(); });
    expect(ProjectPersistence.exportProjectLibrary).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: PROJECT_SCHEMA_VERSION }));
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^pocketry-library-.*\.json$/));
    const [blob] = vi.mocked(downloadBlob).mock.calls[0];
    const json = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(JSON.parse(json)).toEqual(backup);
    unmount();
  });

  it("imports library JSON, refreshes the list, and allows selecting the same file again", async () => {
    const project = { id: "imported", name: "Imported tray", updatedAt: "2026-09-12T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.importProjectLibrary).mockResolvedValue({
      library: { activeProjectId: null, projects: [project] }, imported: 1, upgraded: 1, renamed: 0,
    });
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => { (container.querySelector('[data-testid="button-open-library"]') as HTMLButtonElement).click(); });
    await flushHydration();
    const input = document.querySelector('[data-testid="input-import-library"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    React.act(() => { (document.querySelector('[data-testid="button-import-library"]') as HTMLButtonElement).click(); });
    expect(click).toHaveBeenCalledOnce();
    const data = { format: "pocketry-library", schemaVersion: 1, projects: [] };
    const file = new File([JSON.stringify(data)], "library.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(data) });
    Object.defineProperty(input, "files", { value: [file] });
    await React.act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(ProjectPersistence.importProjectLibrary).toHaveBeenCalledWith(data);
    expect(input.value).toBe("");
    expect(document.querySelector('[data-testid="project-list"]')?.textContent).toContain("Imported tray");
    expect(ProjectPersistence.startNewProject).not.toHaveBeenCalled();
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    unmount();
  });

  it("rejects malformed library JSON before persistence", async () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => { (container.querySelector('[data-testid="button-open-library"]') as HTMLButtonElement).click(); });
    const input = document.querySelector('[data-testid="input-import-library"]') as HTMLInputElement;
    const file = new File(["{"], "broken.json");
    Object.defineProperty(file, "text", { value: async () => "{" });
    Object.defineProperty(input, "files", { value: [file] });
    await React.act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(ProjectPersistence.importProjectLibrary).not.toHaveBeenCalled();
    expect((document.querySelector('[data-testid="button-import-library"]') as HTMLButtonElement).disabled).toBe(false);
    unmount();
  });

  it("starts a fresh project only after confirmation and replaces the autosave", async () => {
    let libraryHandle: import("@/state/shape-library").ShapeLibrary | null = null;
    function LibraryProbe() {
      libraryHandle = ShapeLibraryModule.useShapeLibrary();
      return null;
    }

    const { container, unmount } = render(
      <PanelProvider>
        <ShapeLibraryProvider>
          <LibraryProbe />
          <BinDesignerPage />
        </ShapeLibraryProvider>
      </PanelProvider>,
    );
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() =>
      libraryHandle!.addShape({
        id: "shape-to-clear",
        name: "saved wrench",
        outlineMm: [
          {
            outer: [
              { x: -20, y: -8 },
              { x: 20, y: -8 },
              { x: 20, y: 8 },
              { x: -20, y: 8 },
            ],
            holes: [],
          },
        ],
        bboxMm: { minX: -20, minY: -8, maxX: 20, maxY: 8 },
        pointCount: 4,
        sourceMmPerPx: 0.5,
      }),
    );
    expect(container.textContent).toContain("saved wrench");

    openSettingsSection(container, "project");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-new-project"]',
        ) as HTMLButtonElement
      ).click();
    });
    const confirm = document.querySelector(
      '[data-testid="button-confirm-new-project"]',
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    expect(libraryHandle!.shapes.some((shape) => shape.name === "saved wrench")).toBe(true);

    await React.act(async () => {
      confirm!.click();
      await Promise.resolve();
    });

    expect(libraryHandle!.shapes).toEqual([]);
    expect(container.textContent).not.toContain("saved wrench");
    expect(ProjectPersistence.startNewProject).toHaveBeenLastCalledWith(
      expect.objectContaining({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        shapes: [],
        cutouts: [],
        spec: expect.objectContaining({ gridX: 2, gridY: 2, heightUnits: 6 }),
      }),
    );
    expect(
      (container.querySelector('[data-testid="button-bin-undo"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    unmount();
  });

  it("auto-places an arriving shape and shows it in Pockets and the Layout view", async () => {
    // A live handle on the library so a shape can arrive *after* mount, the
    // way the trace workspace hands one over.
    let libraryHandle: import("@/state/shape-library").ShapeLibrary | null = null;
    function LibraryProbe() {
      libraryHandle = ShapeLibraryModule.useShapeLibrary();
      return null;
    }

    const { container, unmount } = render(
      <PanelProvider>
        <ShapeLibraryProvider>
          <LibraryProbe />
          <BinDesignerPage />
        </ShapeLibraryProvider>
      </PanelProvider>,
    );
    await flushHydration();

    React.act(() =>
      libraryHandle!.addShape({
        id: "shape-1",
        name: "test wrench",
        outlineMm: [
          {
            outer: [
              { x: -20, y: -8 },
              { x: 20, y: -8 },
              { x: 20, y: 8 },
              { x: -20, y: 8 },
            ],
            holes: [],
          },
        ],
        bboxMm: { minX: -20, minY: -8, maxX: 20, maxY: 8 },
        pointCount: 4,
        sourceMmPerPx: 0.5,
      }),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("test wrench");
    expect(container.querySelector('[aria-label="Choose a pocket to edit"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Selected pocket properties"]')).not.toBeNull();
    // Selected-pocket controls appear for the auto-selected cutout.
    expect(text).not.toContain("Editing selected tool");
    expect(text).toContain("Rotation");
    expect(text).toContain("Scale");
    const widthScale = container.querySelector(
      '[data-testid="input-pocket-scale-x"]',
    ) as HTMLInputElement;
    const heightScale = container.querySelector(
      '[data-testid="input-pocket-scale-y"]',
    ) as HTMLInputElement;
    expect(widthScale.value).toBe("100");
    expect(heightScale.value).toBe("100");
    const aspectLock = container.querySelector(
      '[aria-label="Unlock pocket aspect ratio"]',
    ) as HTMLButtonElement;
    expect(aspectLock).not.toBeNull();
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        widthScale,
        "150",
      );
      widthScale.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(widthScale.value).toBe("150");
    expect(heightScale.value).toBe("150");
    React.act(() => aspectLock.click());
    expect(
      container.querySelector('[aria-label="Lock pocket aspect ratio"]'),
    ).not.toBeNull();
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        heightScale,
        "80",
      );
      heightScale.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(widthScale.value).toBe("150");
    expect(heightScale.value).toBe("80");
    React.act(() => {
      ([...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Reset 100%",
      ) as HTMLButtonElement).click();
    });
    expect(widthScale.value).toBe("100");
    expect(heightScale.value).toBe("100");
    expect(text).toContain("Extra pocket clearance");
    expect(text).not.toContain("Added after the Trace margin");
    expect(container.querySelector('[aria-label="About extra pocket clearance"]')).not.toBeNull();
    expect(text).toContain("Outline corner rounding");
    expect(text).toContain("Top edge rounding");
    expect(text).toContain("Bottom edge fillet");
    expect(text).toContain("Finger access");
    const pocketTopRound = container.querySelector(
      '#pocket-properties [aria-label="Top edge rounding"] [role="slider"]',
    );
    expect([...container.querySelectorAll('[data-testid="pocket-edge-settings"] input')].map((input) => input.getAttribute('aria-label'))).toEqual([
      'Top edge rounding in millimetres', 'Bottom edge fillet in millimetres', 'Outline corner rounding in millimetres',
    ]);
    expect(pocketTopRound?.getAttribute("aria-valuemax")).toBe("5");
    expect(pocketTopRound?.getAttribute("aria-valuenow")).toBe("1");
    const renameButton = container.querySelector(
      '[data-testid^="button-rename-"]',
    ) as HTMLButtonElement;
    expect(renameButton.closest('[data-testid^="cutout-row-"]')).not.toBeNull();
    expect(container.querySelector('[data-testid^="button-select-"][aria-pressed="true"]')!.textContent).toContain("test wrench");
    React.act(() => renameButton.click());
    const shapeName = container.querySelector(
      '[data-testid="input-shape-name"]',
    ) as HTMLInputElement;
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        shapeName,
        "Bench wrench",
      );
      shapeName.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => {
      shapeName.blur();
    });
    expect(libraryHandle!.shapes.find((shape) => shape.id === "shape-1")?.name).toBe(
      "Bench wrench",
    );
    expect(container.textContent).toContain("Bench wrench");

    openSettingsSection(container, "export");
    expect(container.textContent).toContain("Export printable bin");
    openSettingsSection(container, "check-fit");
    expect(container.textContent).toContain("Fit templates and layout");
    expect(container.textContent).toContain("Complete surface fit test");
    expect(container.textContent).toContain("Save surface fit test STL");
    expect(
      (
        container.querySelector(
          '[data-testid="input-surface-fit-test-thickness"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("1.2");
    expect(
      (
        container.querySelector(
          '[data-testid="button-export-surface-fit-test"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(container.textContent).toContain("Tool fit template");
    expect(container.textContent).toContain("Save fit template STL");
    openSettingsSection(container, "export");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-export-3mf"]',
        ) as HTMLButtonElement
      ).click();
    });
    const multicolorExport = document.querySelector(
      '[data-testid="button-export-multicolor-3mf"]',
    ) as HTMLButtonElement;
    expect(multicolorExport).not.toBeNull();
    expect(multicolorExport.disabled).toBe(false);
    expect(document.body.textContent).toContain(
      "Separate pocket floors (0.6 mm down) and rim top (1.25 mm down) for slicer assignment.",
    );
    const exportDialog = document.querySelector('[role="dialog"]') as HTMLElement;
    React.act(() => {
      (
        [...exportDialog.querySelectorAll("button")].find(
          (button) => button.textContent === "Cancel",
        ) as HTMLButtonElement
      ).click();
    });

    // Finger holes live in their own object list and selection context.
    openSettingsSection(container, "finger-holes");
    const addFingerHole = container.querySelector(
      '[data-testid="button-add-finger-hole"]',
    ) as HTMLButtonElement;
    React.act(() => addFingerHole.click());
    const kind = container.querySelector(
      '[data-testid="selected-finger-hole-kind"]',
    ) as HTMLButtonElement | null;
    expect(kind).not.toBeNull();
    expect(kind!.textContent).toContain("Straight");
    expect(container.textContent).not.toContain("Scoop depth");
    const fingerHoleSection = container.querySelector(
      '#bin-settings-finger-holes',
    );
    expect(
      fingerHoleSection?.querySelector('[aria-label="Top edge round"]'),
    ).not.toBeNull();
    const fingerTopRoundSlider = fingerHoleSection?.querySelector(
      '[aria-label="Top edge round"] [role="slider"]',
    );
    expect(fingerTopRoundSlider?.getAttribute("aria-valuemax")).toBe("5");
    expect(fingerTopRoundSlider?.getAttribute("aria-valuenow")).toBe("1");
    expect(
      fingerHoleSection?.querySelector('[aria-label="Bottom edge fillet"]'),
    ).not.toBeNull();

    React.act(() => {
      (container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid^="finger-hole-straight-"]')).not.toBeNull();
    expect(container.querySelector('[data-testid^="finger-hole-width-"]')).not.toBeNull();

    // Selecting the pocket again is independent and exposes contour editing.
    openSettingsSection(container, "tool-cutouts");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid^="button-select-"]')!.click());
    expect(
      container.querySelectorAll('[data-testid^="pocket-resize-handle-"]'),
    ).toHaveLength(8);
    expect(
      (
        container.querySelector(
          '[data-testid="pocket-resize-handle-ne"]',
        ) as SVGRectElement
      ).style.cursor,
    ).toBe("nesw-resize");
    expect(
      (
        container.querySelector(
          '[data-testid="pocket-resize-handle-e"]',
        ) as SVGRectElement
      ).style.cursor,
    ).toBe("ew-resize");
    expect(container.querySelector('[data-testid="pocket-rotate-handle"]')).not.toBeNull();
    const editContour = container.querySelector(
      '[data-testid="button-edit-contour"]',
    ) as HTMLButtonElement;
    React.act(() => editContour.click());
    expect(editContour.getAttribute("aria-label")).toBe("Finish contour editing");
    expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
    expect(
      (container.querySelector(
        '[data-testid="button-layout-ruler"]',
      ) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(container.querySelector("[data-cutout-id]")).not.toBeNull();
    expect(
      container.querySelectorAll('[data-testid="contour-vertex-handle"]'),
    ).toHaveLength(4);
    expect(container.querySelector('[data-testid^="finger-hole-straight-"]')).not.toBeNull();
    expect(container.querySelector("[data-rotate-handle]")).toBeNull();

    React.act(() => {
      container
        .querySelector('[data-testid="contour-vertex-handle"]')!
        .dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
    });
    expect(
      container.querySelectorAll('[data-testid="contour-vertex-handle"]'),
    ).toHaveLength(3);

    const historyButton = container.querySelector(
      '[data-testid="button-bin-history"]',
    ) as HTMLButtonElement;
    React.act(() => historyButton.click());
    expect(document.body.textContent).toContain("Edit history");
    expect(document.body.textContent).toContain("Remove contour node");
    React.act(() => historyButton.click());

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-bin-undo"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container.querySelectorAll('[data-testid="contour-vertex-handle"]'),
    ).toHaveLength(4);
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-bin-redo"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container.querySelectorAll('[data-testid="contour-vertex-handle"]'),
    ).toHaveLength(3);

    // Finishing restores the normal placement handles and rotation cursor.
    React.act(() => editContour.click());
    const rotateHandle = container.querySelector("[data-rotate-handle]") as SVGElement;
    expect(rotateHandle.style.cursor).toContain("/cursors/rotate.svg");
    unmount();
  });

  it("asks how to resize after removal and fits an off-centre survivor", async () => {
    let libraryHandle: import("@/state/shape-library").ShapeLibrary | null = null;
    function LibraryProbe() {
      libraryHandle = ShapeLibraryModule.useShapeLibrary();
      return null;
    }

    const { container, unmount } = render(
      <PanelProvider>
        <ShapeLibraryProvider>
          <LibraryProbe />
          <BinDesignerPage />
        </ShapeLibraryProvider>
      </PanelProvider>,
    );
    await flushHydration();

    React.act(() => {
      libraryHandle!.addShape(rectangularShape("shape-a", "first part"));
      libraryHandle!.addShape(rectangularShape("shape-b", "second part"));
    });
    await React.act(async () => Promise.resolve());

    const twoCellSize =
      container.querySelector("#bin-settings-size")?.textContent ?? "";
    expect(
      ["2 × 1 × 6u", "1 × 2 × 6u"].some((label) =>
        twoCellSize.includes(label),
      ),
    ).toBe(true);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid^="button-remove-"]')!.click());
    expect(document.body.textContent).toContain(
      "Resize the bin after removing “first part”?",
    );
    expect(container.querySelectorAll('[data-testid^="cutout-row-"]')).toHaveLength(2);

    await React.act(async () => {
      (
        document.querySelector(
          '[data-testid="button-remove-pocket-and-fit"]',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    expect(container.querySelectorAll('[data-testid^="cutout-row-"]')).toHaveLength(1);
    expect(
      container.querySelector("#bin-settings-size")?.textContent,
    ).toContain("1 × 1 × 6u");
    unmount();
  });

  it("shows build stats and enabled export buttons, viewport stubbed in", () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "export");
    const text = container.textContent ?? "";

    expect(text).toContain("8,400 triangles");
    expect(text).toContain("82.4 cm³ model volume");
    expect(text).not.toContain("g solid PLA");
    expect(text).not.toContain("Estimate filament weight in your slicer");
    expect(container.querySelector('[aria-label="About model validation"]')).not.toBeNull();
    expect(
      container.querySelector("#bin-settings-export [data-panel-section-trigger]")
        ?.textContent,
    ).toContain("No cutouts");
    expect(
      container.querySelector('[data-testid="export-no-cutouts-warning"]')
        ?.textContent,
    ).toContain("solid bin");
    expect(container.querySelector('[data-testid="bin-viewport-stub"]')).not.toBeNull();

    const export3mf = container.querySelector(
      '[data-testid="button-export-3mf"]',
    ) as HTMLButtonElement | null;
    expect(export3mf).not.toBeNull();
    expect(export3mf!.disabled).toBe(false);
    expect(
      (container.querySelector('[data-testid="button-export-stl"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    openSettingsSection(container, "check-fit");
    expect(
      container.querySelector('[data-testid="export-preview-empty"]')?.textContent,
    ).toContain("Add a tool cutout");
    expect(
      container.querySelector('[data-testid="button-go-to-trace"]'),
    ).not.toBeNull();
    unmount();
  });

  it("counts only color regions that exist in the current model", () => {
    const { container, unmount } = renderPage();
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-materials"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container.querySelector("#bin-settings-materials [data-panel-section-trigger]")
        ?.textContent,
    ).toContain("2 colors");
    unmount();
  });

  it("asks about 3MF colors and warns before discarding them in STL", () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "export");

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-export-3mf"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.body.textContent).toContain(
      "Include multiple colors in the 3MF?",
    );
    expect(
      document.querySelector('[data-testid="button-export-single-color-3mf"]'),
    ).not.toBeNull();
    expect(
      (
        document.querySelector(
          '[data-testid="button-export-multicolor-3mf"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    React.act(() => {
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Cancel")!.click();
    });
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-export-stl"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.body.textContent).toContain("STL will not include your colors");
    expect(
      document.querySelector('[data-testid="button-confirm-export"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Use multi-color 3MF");
    unmount();
  });
});
