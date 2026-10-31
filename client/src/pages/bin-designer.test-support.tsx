// Shared fixtures and lifecycle hooks for the matching test suites.

// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  ExperimentalFeaturesProvider,
  useExperimentalFeatures,
  EXPERIMENTAL_FEATURES_KEY,
} from "@/state/experimental-features";
import { PanelProvider } from "@/components/layout/panel-context";
import { TraceHandoffOptions, useTraceHandoff } from "@/components/trace/trace-handoff";
function TraceHandoff() { const handoff = useTraceHandoff(); return <><TraceHandoffOptions handoff={handoff} /><button disabled={!handoff.ready} onClick={handoff.addToBin}>Add to bin</button></>; }
import * as TraceStoreReview from "@/state/trace-store";
import type { MaterialColorTarget } from "@/components/gridfinity/bin-viewport";
import { SelectionToolButtons } from "@/components/gridfinity/selection-tool-buttons";
import type { SurfaceTextEditor } from "@/components/gridfinity/surface-text-transform-scene";
import type { PocketEditor } from "@/components/gridfinity/pocket-transform-scene";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { generateUltim8JigSVG } from "@/lib/export/layout";
import { downloadBlob } from "@/lib/download";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";

/**
 * Structure smoke tests for the bin designer page, following the pattern of
 * layout.test.tsx: jsdom does no layout and has no WebGL, so the r3f viewport
 * and the worker hook are stubbed and the assertions stay on what the panel
 * renders. The real geometry path is covered headless in
 * lib/gridfinity/bin-worker-handlers.test.ts.
 */

vi.mock("@/hooks/use-pocket-geometry", () => {
  const outlines = new Map();
  return { usePocketGeometry: () => outlines };
});

vi.mock("@/components/gridfinity/bin-viewport", () => ({
  BinViewport: ({
    fitSize,
    hasPocketFloor,
    hasStackingRim,
    binColor,
    pocketFloorColor,
    floorColorLabel,
    stackingRimColor,
    textColor,
    showPocketFloorColor,
    showStackingRimColor,
    measurementOutlines,
    measurementSplitBoundaries,
    onEditColor,
    pocketEditor,
    showPocketOutlines,
    error,
    onPositionText,
    onSelectSurfaceText,
    surfaceTextEditor,
  }: {
    fitSize: { widthMm: number; lengthMm: number; heightMm: number };
    hasPocketFloor: boolean;
    hasStackingRim: boolean;
    binColor: string;
    pocketFloorColor: string;
    floorColorLabel?: string;
    stackingRimColor: string;
    textColor: string;
    showPocketFloorColor: boolean;
    showStackingRimColor: boolean;
    measurementOutlines: readonly unknown[];
    measurementSplitBoundaries: readonly unknown[];
    onEditColor: (target: MaterialColorTarget) => void;
    pocketEditor?: PocketEditor;
    showPocketOutlines?: boolean;
    error: string | null;
    onPositionText?: () => void;
    onSelectSurfaceText?: (id: string) => void;
    surfaceTextEditor?: SurfaceTextEditor;
  }) => (
    <div
      data-testid="bin-viewport-stub"
      data-experimental-editor={Boolean(pocketEditor)}
      data-pocket-outlines={showPocketOutlines ? "on" : "off"}
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
      data-floor-label={floorColorLabel}
      data-rim-color={stackingRimColor}
      data-text-color={textColor}
      data-text-editor-z={surfaceTextEditor?.z}
      data-measurement-splits={JSON.stringify(measurementSplitBoundaries)}
    >
      {pocketEditor && <SelectionToolButtons count={surfaceTextEditor ? 1 : pocketEditor.selection?.length ?? 0} onActivate={() => {}} />}
      {surfaceTextEditor && <>
        <button data-testid="commit-text-move" onClick={() => surfaceTextEditor.onCommit({ ...surfaceTextEditor.label, position: { x: 8, y: 20 } }, "translate")} />
        <button data-testid="commit-text-rotation" onClick={() => surfaceTextEditor.onCommit({ ...surfaceTextEditor.label, rotationDeg: 45 }, "rotate")} />
      </>}
      {pocketEditor?.spec.surfaceTexts.map(label => <button key={label.id} data-testid={`button-select-text-3d-${label.id}`} disabled={!onSelectSurfaceText} onClick={() => onSelectSurfaceText?.(label.id)}>{label.text}</button>)}
      {error && onPositionText && <button onClick={onPositionText}>Position text in Layout</button>}
      <button data-testid="button-clear-3d-selection" onClick={() => pocketEditor?.onSelectionChange?.([])} />
      <button
        type="button"
        data-testid="button-3d-ruler"
        disabled={measurementOutlines.length === 0}
      />
      {(["bin", "pocket-floor", "stacking-rim", "text"] as const).map((target) => (
        <button key={target} type="button" data-testid={`legend-${target}`} onClick={() => onEditColor(target)}>
          {target}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/lib/export/layout", async original => ({
  ...await original<typeof import("@/lib/export/layout")>(),
  generateUltim8JigSVG: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg" width="83.5mm" height="83.5mm"><g id="peg-locations"><circle cx="11.75" cy="11.75" r="2.4"/></g></svg>'),
}));

const binGeometryMock = vi.hoisted(() => ({
  validationIssues: [] as import("@shared/gridfinity/validate").ValidationIssue[],
  building: false,
  statsAreStale: false,
  previewIsDraft: false,
  progress: 1,
  error: null as string | null,
  builtSpec: null as ReturnType<typeof parseBinSpec> | null,
  hasPocketFloor: false,
  hasStackingRim: true,
  buildOnce: vi.fn(),
  buildFitCheck: vi.fn(),
  buildSurfaceFitCheck: vi.fn(),
}));

const projectToast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: projectToast }) }));
vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));

vi.mock("@/lib/gridfinity/use-bin-geometry", () => ({
  useBinGeometry: vi.fn(() => ({
    geometry: null,
    hasPocketFloor: binGeometryMock.hasPocketFloor,
    hasStackingRim: binGeometryMock.hasStackingRim,
    builtSpec: binGeometryMock.builtSpec,
    stats: binGeometryMock.previewIsDraft ? null : { triangles: 8400, volumeMm3: 82404, buildMs: 45 },
    previewIsDraft: binGeometryMock.previewIsDraft,
    statsAreStale: binGeometryMock.statsAreStale,
    cutoutReports: [],
    validationIssues: binGeometryMock.validationIssues,
    building: binGeometryMock.building,
    progress: binGeometryMock.progress,
    error: binGeometryMock.error,
    buildOnce: binGeometryMock.buildOnce,
    buildFitCheck: binGeometryMock.buildFitCheck,
    buildSurfaceFitCheck: binGeometryMock.buildSurfaceFitCheck,
  })),
}));

// Deterministic persistence: no stored project, writes are no-ops. Hydration
// still resolves asynchronously, hence the `flushHydration` below.
const projectSaveMock = vi.hoisted(() => ({ onSaved: undefined as ((success: boolean, error?: Error) => void) | undefined }));
vi.mock("@/lib/project/persist", () => ({
  loadProjectDoc: vi.fn(async () => null),
  readProjectOverview: vi.fn(async () => ({ doc: null, activeProjectId: null })),
  loadProjectLibrary: vi.fn(async () => ({ activeProjectId: null, projects: [] })),
  saveProjectDoc: vi.fn(async () => true),
  saveProjectToLibrary: vi.fn(),
  renameProjectInLibrary: vi.fn(),
  openProjectFromLibrary: vi.fn(),
  deleteProjectFromLibrary: vi.fn(),
  duplicateProjectInLibrary: vi.fn(),
  exportProjectLibrary: vi.fn(),
  importProjectLibrary: vi.fn(),
  importProjectToLibrary: vi.fn(),
  startNewProject: vi.fn(async () => ({ activeProjectId: null, projects: [] })),
  createDebouncedProjectSaver: (_delay: number, onSaved?: (success: boolean, error?: Error) => void) => {
    projectSaveMock.onSaved = onSaved;
    return Object.assign(vi.fn(), { cancel: vi.fn(), flush: vi.fn(async () => true) });
  },
}));
import * as ProjectPersistence from "@/lib/project/persist";
import { loadSampleLibrary } from "@/lib/project/samples";
vi.mock("@/lib/project/samples", () => ({ loadSampleLibrary: vi.fn() }));

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

let experimentalSettings: ReturnType<typeof useExperimentalFeatures>;
function ExperimentalProbe({ children }: { children: React.ReactNode }) {
  experimentalSettings = useExperimentalFeatures(); return <>{children}</>;
}

const renderCleanups: (() => void)[] = [];
function render(ui: React.ReactElement, { mobile = false, experimental = true } = {}) {
  localStorage.setItem(EXPERIMENTAL_FEATURES_KEY, String(experimental));
  // Most workflow cases exercise a deliberate Single panel choice. Layout
  // links still override it; implicit viewport defaults have provider tests.
  if (!localStorage.getItem("pocketry:editor-layout")) localStorage.setItem("pocketry:editor-layout", "standard");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
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
  React.act(() => root.render(<ExperimentalFeaturesProvider><TraceStoreReview.TraceProvider><ExperimentalProbe>{ui}</ExperimentalProbe></TraceStoreReview.TraceProvider></ExperimentalFeaturesProvider>));

  let unmounted = false;
  const result = {
    container,
    unmount: () => {
      if (unmounted) return;
      unmounted = true;
      React.act(() => root.unmount());
      container.remove();
    },
  };
  renderCleanups.push(result.unmount);
  return result;
}

afterEach(() => {
  renderCleanups.splice(0).forEach(cleanup => cleanup());
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});

beforeEach(() => {
  binGeometryMock.previewIsDraft = false;
  binGeometryMock.statsAreStale = false;
  vi.clearAllMocks();
  projectSaveMock.onSaved = undefined;
  binGeometryMock.validationIssues = [];
  binGeometryMock.building = false;
  binGeometryMock.progress = 1;
  binGeometryMock.error = null;
  binGeometryMock.builtSpec = null;
  binGeometryMock.hasPocketFloor = false;
  binGeometryMock.hasStackingRim = true;
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(null);
  vi.mocked(ProjectPersistence.saveProjectDoc).mockResolvedValue(true);
  vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({
    activeProjectId: null,
    projects: [],
  });
  vi.mocked(ProjectPersistence.startNewProject).mockResolvedValue({
    activeProjectId: null,
    projects: [],
  });
  vi.mocked(ProjectPersistence.importProjectToLibrary).mockImplementation(async (doc) => {
    const project = { id: "imported", name: doc.name ?? "Imported project", updatedAt: "2026-09-21T12:00:00.000Z" };
    return { doc: { ...doc, name: project.name }, project, library: { activeProjectId: project.id, projects: [project] } };
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

function renderPage(options: { mobile?: boolean; experimental?: boolean } = {}) {
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
    | "text"
    | "tool-cutouts"
    | "finger-holes"
    | "export"
    | "check-fit",
): void {
  React.act(() => {
    if (container.querySelector('#workflow-panel')) {
      const id = `bin-settings-${section === "tool-cutouts" ? "pockets" : section === "check-fit" ? "fit" : section}`;
      const navigation = container.querySelector<HTMLButtonElement>(`[data-testid="workflow-section-${id}"]`);
      if (navigation) navigation.click();
      else {
        const trigger = container.querySelector<HTMLButtonElement>(`#${id} [data-panel-section-trigger]`)!;
        if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
      }
    } else {
      container.querySelector<HTMLButtonElement>(
        `[data-testid="bin-settings-jump-${section === "tool-cutouts" ? "pockets" : section === "finger-holes" ? "finger-access" : section === "materials" ? "materials-&-colors" : section === "text" ? "surface-text" : section}"]`,
      )!.click();
    }
  });
}

function openUltim8Setup(container: HTMLElement): void {
  openSettingsSection(container, "construction");
  React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="select-bin-bottom"]')!
    .dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
  React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Wham Bam Systems ULTIM8-compatible pegs")!.click());
}

function enterJigThickness(value: string): void {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Jig body thickness in millimetres"]')!;
  React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function jigDialogButton(label: string): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === label)!;
}

function openMobileProperties() {
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!;
  if (!document.querySelector('.mobile-adjustment-tray')) React.act(() => button('Adjust').click());
  React.act(() => button('All properties').click());
}

function toolButton(container: HTMLElement, label: string) {
  let button = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!button) {
    React.act(() => container.querySelector('[aria-label="Tools"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})));
    button = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  }
  return button!;
}

function binHistoryButton(container: HTMLElement, action: "undo" | "redo") {
  const selector = `[data-testid="button-bin-${action}"]`;
  const direct = container.querySelector<HTMLButtonElement>(selector);
  if (direct) {
    const menu = document.querySelector('[role="menu"]');
    if (menu) React.act(() => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    return direct;
  }
  if (!document.querySelector(selector)) React.act(() => container.querySelector('[aria-label="Tools"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  return document.querySelector<HTMLButtonElement>(selector)!;
}

function clickBinHistory(container: HTMLElement, action: "undo" | "redo") {
  const button = binHistoryButton(container, action);
  React.act(() => button.click());
}

/** Use the compact pocket list without entering rename or changing geometry. */
function selectPocket(container: HTMLElement, id: string): void {
  React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="button-select-${id}"]`)!.click());
}

function openObjectContext(node: Element): HTMLElement {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 180, clientY: 120 });
  React.act(() => node.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}
function contextCommand(text: string): void {
  React.act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === text)!.click());
}

const sampleDoc = { ...EMPTY_PROJECT, name: "Sample tray", spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 4 }) };
const sampleLibrary = { format: "pocketry-library" as const, schemaVersion: 1 as const,
  projects: [{ id: "sample", name: "Sample tray", updatedAt: "2026-10-08T12:00:00Z", doc: sampleDoc }] };
const sampleButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;
const browseSamples = async (container: HTMLElement) => {
  vi.mocked(loadSampleLibrary).mockResolvedValue(sampleLibrary);
  openSettingsSection(container, "project");
  await React.act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
  await React.act(async () => sampleButton("Sample Library").click());
};

const pocketFieldCases = [
  ["Pocket rotation in degrees", "180"],
  ["Pocket X rotation in degrees", "25"],
  ["Pocket Y rotation in degrees", "-20"],
  ["Pocket elevation in millimetres", "12"],
  ["X position in millimetres", "8"],
  ["Y position in millimetres", "-6"],
  ["Pocket width in millimetres", "34"],
  ["Pocket length in millimetres", "24"],
  ["Pocket width scale percent", "120"],
  ["Pocket length scale percent", "130"],
  ["Pocket cut depth in millimetres", "18"],
  ["Remaining floor thickness in millimetres", "8"],
  ["Extra pocket clearance in millimetres", "0.6"],
  ["Top edge rounding in millimetres", "1.2"],
  ["Bottom edge fillet in millimetres", "1.4"],
  ["Outline corner rounding in millimetres", "1.5"],
];

export {
  TraceHandoff,
  binGeometryMock,
  projectToast,
  projectSaveMock,
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  BinDesignerPage,
  NoopResizeObserver,
  experimentalSettings,
  ExperimentalProbe,
  renderCleanups,
  render,
  renderPage,
  openSettingsSection,
  openUltim8Setup,
  enterJigThickness,
  jigDialogButton,
  openMobileProperties,
  toolButton,
  binHistoryButton,
  clickBinHistory,
  selectPocket,
  openObjectContext,
  contextCommand,
  sampleDoc,
  sampleLibrary,
  sampleButton,
  browseSamples,
  pocketFieldCases,
};
