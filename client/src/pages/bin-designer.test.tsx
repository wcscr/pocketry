// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { ExperimentalFeaturesProvider, useExperimentalFeatures, EXPERIMENTAL_FEATURES_KEY } from "@/state/experimental-features";
import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import { AppHeader } from "@/components/layout/app-header";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WORKSPACES } from "@/components/layout/workspaces";
import type { MaterialColorTarget } from "@/components/gridfinity/bin-viewport";
import * as ShapeLibraryModule from "@/state/shape-library";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { PROJECT_SCHEMA_VERSION, parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { fingerHoleSchema, resolvePocketDepth, resolvePlacedPocketDepth, parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import { parseBinSpec } from "@shared/gridfinity/types";
import { downloadBlob } from "@/lib/download";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import { footprintOuterRingMm, occupiedCellCount } from "@shared/gridfinity/footprint";
import ryobiReloadFixture from "@shared/gridfinity/fixtures/ryobi-split-reload.pocketry.json";

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
    measurementSplitBoundaries,
    onEditColor,
    pocketEditor,
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
    measurementSplitBoundaries: readonly unknown[];
    onEditColor: (target: MaterialColorTarget) => void;
    pocketEditor?: unknown;
  }) => (
    <div
      data-testid="bin-viewport-stub"
      data-experimental-editor={Boolean(pocketEditor)}
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
      data-measurement-splits={JSON.stringify(measurementSplitBoundaries)}
    >
      <button
        type="button"
        data-testid="button-3d-ruler"
        disabled={measurementOutlines.length === 0}
      />
      {(["bin", "pocket-floor", "stacking-rim"] as const).map((target) => (
        <button key={target} type="button" data-testid={`legend-${target}`} onClick={() => onEditColor(target)}>
          {target}
        </button>
      ))}
    </div>
  ),
}));

const binGeometryMock = vi.hoisted(() => ({
  building: false,
  statsAreStale: false,
  previewIsDraft: false,
  progress: 1,
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
const projectSaveMock = vi.hoisted(() => ({ onSaved: undefined as ((success: boolean) => void) | undefined }));
vi.mock("@/lib/project/persist", () => ({
  loadProjectDoc: vi.fn(async () => null),
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
  createDebouncedProjectSaver: (_delay: number, onSaved?: (success: boolean) => void) => {
    projectSaveMock.onSaved = onSaved;
    return Object.assign(vi.fn(), { cancel: vi.fn(), flush: vi.fn(async () => true) });
  },
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

let experimentalSettings: ReturnType<typeof useExperimentalFeatures>;
function ExperimentalProbe({ children }: { children: React.ReactNode }) {
  experimentalSettings = useExperimentalFeatures(); return <>{children}</>;
}

function render(ui: React.ReactElement, { mobile = false, experimental = true } = {}) {
  localStorage.setItem(EXPERIMENTAL_FEATURES_KEY, String(experimental));
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
  React.act(() => root.render(<ExperimentalFeaturesProvider><ExperimentalProbe>{ui}</ExperimentalProbe></ExperimentalFeaturesProvider>));

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
  binGeometryMock.previewIsDraft = false;
  binGeometryMock.statsAreStale = false;
  vi.clearAllMocks();
  projectSaveMock.onSaved = undefined;
  binGeometryMock.building = false;
  binGeometryMock.progress = 1;
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
    | "tool-cutouts"
    | "finger-holes"
    | "export"
    | "check-fit",
): void {
  React.act(() => {
    (
      container.querySelector(
        `[data-testid="bin-settings-jump-${section === "tool-cutouts" ? "pockets" : section === "finger-holes" ? "finger-access" : section === "materials" ? "materials-&-colors" : section}"]`,
      ) as HTMLButtonElement
    ).click();
  });
}

/** Use the compact pocket list without entering rename or changing geometry. */
function selectPocket(container: HTMLElement, id: string): void {
  React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="button-select-${id}"]`)!.click());
}

describe("BinDesignerPage", () => {
  it.each([false, true])("opens Library from navigation, waits for hydration, and reopens it with mobile=%s", async (mobile) => {
    const { hook } = memoryLocation({ path: "/" });
    function Navigation() {
      const [path] = useLocation();
      const { panelOpen, setPanelOpen } = usePanelState();
      return <>
        <AppHeader panelOpen={panelOpen} onPanelOpenChange={setPanelOpen} onHelpClick={() => {}} />
        <output data-testid="test-route">{path}</output>
        <Route path="/bin"><BinDesignerPage /></Route>
      </>;
    }
    let finishRestore!: (doc: ProjectDoc | null) => void;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockReturnValueOnce(new Promise(resolve => { finishRestore = resolve; }));
    const { container, unmount } = render(<Router hook={hook}>
      <TooltipProvider><PanelProvider><ShapeLibraryProvider><Navigation /></ShapeLibraryProvider></PanelProvider></TooltipProvider>
    </Router>, { mobile });
    try {
      const openLibrary = async () => {
        if (mobile) {
          const menu = container.querySelector<HTMLButtonElement>('[aria-label^="Workspace:"]')!;
          React.act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
          await React.act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
            .find(item => item.textContent === "Library")!.click());
        } else {
          await React.act(async () => [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Workspaces"] a')]
            .find(link => link.textContent === "Library")!.click());
        }
      };
      await openLibrary();
      expect(container.querySelector('[data-testid="test-route"]')!.textContent).toBe("/bin");
      expect(document.querySelector('[data-testid="managed-project-list"]')).toBeNull();
      await React.act(async () => finishRestore(EMPTY_PROJECT));
      expect(document.querySelector('[data-testid="library-manager-header"]')!.textContent).toContain("Manage browser library");
      expect(ProjectPersistence.loadProjectDoc).toHaveBeenCalledOnce();
      React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="library-manager-header"] [aria-label="Close"]')!.click());
      expect(document.querySelector('[data-testid="managed-project-list"]')).toBeNull();
      if (mobile) {
        React.act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Back to canvas")!.click());
      } else {
        React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Hide controls"]')!.click());
      }
      await openLibrary();
      expect(document.querySelector('[data-testid="managed-project-list"]')).not.toBeNull();
      expect(ProjectPersistence.loadProjectDoc).toHaveBeenCalledOnce();
    } finally { unmount(); }
  });

  it.each(["empty", "pockets", "split"] as const)("adds a curved, rounded slot using the %s layout's highest floor", async (layout) => {
    const shape = rectangularShape("shape", "Tool");
    const pocket = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 },
      depth: { mode: "mm", value: 18 },
      ...(layout === "split" ? { split: {
        boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }],
        depths: [{ mode: "mm", value: 8 }, { mode: "mm", value: 24 }],
      } } : {}),
    });
    const existing = fingerHoleSchema.parse({ id: "existing", kind: "straight", center: { x: 0, y: 0 }, depthMm: 3 });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape],
      cutouts: layout === "empty" ? [] : [pocket], fingerHoles: [existing] });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "finger-holes");
      const add = container.querySelector<HTMLButtonElement>('[data-testid="button-add-finger-hole"]')!;
      expect(add.textContent?.trim()).toBe("Add");
      React.act(() => add.click());
      const expectedDepth = layout === "empty" ? 12 : layout === "split" ? 7 : 17;
      const added = vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles[1];
      expect(added).toMatchObject({ kind: "oblong-deep-scoop", slotEnds: "rounded", lengthMm: 36, depthMm: expectedDepth });
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles[0]).toEqual(existing);
      expect(container.querySelector<HTMLInputElement>('[aria-label="Depth in millimetres"]')!.value).toBe(String(expectedDepth));
      const controls = container.querySelector('[data-testid="finger-access-shape-controls"]')!;
      expect(Array.from(controls.querySelectorAll('[aria-labelledby="finger-access-shape-label"] [role="radio"]'), el => el.textContent)).toEqual(["Slot", "Round"]);
      for (const id of ["finger-shape-slot", "finger-bottom-curved", "finger-ends-rounded"]) {
        expect(controls.querySelector(`[data-testid="${id}"]`)?.getAttribute("aria-checked")).toBe("true");
      }
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles).toEqual([existing]);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-redo"]')!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles).toEqual([existing, added]);
    } finally { unmount(); }
  });

  it.each(["trace", "basic-shape"] as const)("renames copied %s pockets independently with undo and project round trips", async (source) => {
    const shape = { ...rectangularShape("shared", "Original pocket"), source,
      sourceMmPerPx: source === "basic-shape" ? null : 0.5 };
    const original = parseCutoutPlacement({ id: "original", shapeId: shape.id, position: { x: 0, y: 0 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [original] });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "tool-cutouts");
      const click = (testId: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click());
      const names = () => Array.from(container.querySelectorAll('[data-testid^="cutout-row-"] [data-testid^="button-select-"]'), el => el.textContent);
      const rename = (id: string, value: string, key = "Enter") => {
        click(`button-rename-${id}`);
        const input = container.querySelector<HTMLInputElement>('[aria-label="Pocket name"]')!;
        React.act(() => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
      };
      click("button-duplicate-original");
      click("button-duplicate-original");
      const [, copy] = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;
      rename(copy.id, "  Copy A  ");
      expect(names()).toEqual(["Original pocket", "Copy A", "Original pocket"]);
      expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Copy A");
      expect(container.querySelector('[aria-label="Reference pocket"]')!.textContent).toContain("Original pocket");
      click("button-bin-undo");
      expect(names()).toEqual(["Original pocket", "Original pocket", "Original pocket"]);
      click("button-bin-redo");
      expect(names()).toEqual(["Original pocket", "Copy A", "Original pocket"]);
      rename("original", "Source placement");
      expect(names()).toEqual(["Source placement", "Copy A", "Original pocket"]);
      rename(copy.id, "Cancelled", "Escape");
      rename(copy.id, "   ");
      expect(names()).toEqual(["Source placement", "Copy A", "Original pocket"]);
      click(`button-duplicate-${copy.id}`);
      expect(names()).toEqual(["Source placement", "Copy A", "Original pocket", "Copy A"]);
      const newCopy = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts.at(-1)!;
      rename(newCopy.id, "Copy B");
      const expectedNames = ["Source placement", "Copy A", "Original pocket", "Copy B"];
      expect(names()).toEqual(expectedNames);
      click(`button-remove-${newCopy.id}`);
      expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain('Resize the bin after removing “Copy B”?');
      React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-cancel-remove-pocket"]')!.click());
      expect(names()).toEqual(expectedNames);
      openSettingsSection(container, "project");
      click("button-export-project");
      const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
      const json = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blob);
      });
      const saved = parseProjectDoc(JSON.parse(json))!;
      expect(saved).not.toBeNull();
      expect(saved.shapes).toEqual([shape]);
      expect(saved.cutouts.map(cutout => cutout.shapeId)).toEqual(Array(4).fill(shape.id));
      const file = new File([json], "Copies.pocketry.json");
      Object.defineProperty(file, "text", { value: async () => json });
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-discard-draft-open"]')!.click());
      openSettingsSection(container, "tool-cutouts");
      expect(names()).toEqual(expectedNames);
      click("button-bin-undo");
      expect(names()).toEqual(["Source placement", "Copy A", "Original pocket", "Copy A"]);
      click("button-bin-redo");
      expect(names()).toEqual(expectedNames);
    } finally { unmount(); }
  });

  it.each(["new", "file"])("saves pending edits before replacing a named project via %s, and stops on save failure", async action => {
    const cutter = parseProjectDoc(ryobiReloadFixture)!;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(cutter);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "cutter", projects: [
      { id: "cutter", name: "Ryobi Cutter", updatedAt: "2026-09-13T14:50:27.853Z" },
    ] });
    let finishSave!: (success: boolean) => void;
    vi.mocked(ProjectPersistence.saveProjectDoc).mockImplementation(() =>
      new Promise(resolve => { finishSave = resolve; }));
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      selectPocket(container, cutter.cutouts[0].id);
      const depth = container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!;
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(depth, "14");
        depth.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => depth.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      const edited = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;
      openSettingsSection(container, "project");
      const replace = async () => {
        if (action === "new") {
          React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-new-project"]')!.click());
          await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-new-project"]')!.click());
        } else {
          const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
          const file = new File([JSON.stringify(EMPTY_PROJECT)], "Other.pocketry.json");
          Object.defineProperty(file, "text", { value: async () => JSON.stringify(EMPTY_PROJECT) });
          Object.defineProperty(input, "files", { value: [file], configurable: true });
          await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
        }
      };
      const replaceProject = action === "new" ? ProjectPersistence.startNewProject : ProjectPersistence.importProjectToLibrary;
      await replace();
      expect(ProjectPersistence.saveProjectDoc).toHaveBeenCalledWith(expect.objectContaining({ cutouts: edited }), "cutter");
      expect(replaceProject).not.toHaveBeenCalled();
      await React.act(async () => finishSave(false));
      expect(replaceProject).not.toHaveBeenCalled();
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(edited);
      await replace();
      expect(replaceProject).not.toHaveBeenCalled();
      await React.act(async () => finishSave(true));
      expect(replaceProject).toHaveBeenCalledOnce();
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([]);
    } finally { unmount(); }
  });

  it("keeps the current design open when saving before a project switch fails", async () => {
    const cutter = parseProjectDoc(ryobiReloadFixture)!;
    const projects = [
      { id: "cutter", name: "Ryobi Cutter", updatedAt: "2026-09-13T14:50:27.853Z" },
      { id: "other", name: "Other bin", updatedAt: "2026-09-13T14:50:27.853Z" },
    ];
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(cutter);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "cutter", projects });
    vi.mocked(ProjectPersistence.saveProjectDoc).mockResolvedValue(false);
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-other"]')!.click());
      expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(cutter.cutouts);
      expect(container.querySelector('[data-testid="project-autosave-status"]')?.textContent).toContain("Ryobi Cutter");
      expect(document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-other"]')!.disabled).toBe(false);
    } finally { unmount(); }
  });

  it("saves both edited section depths before switching projects and reloading the cutter", async () => {
    const intended = parseProjectDoc(ryobiReloadFixture)!;
    const reversed = structuredClone(intended);
    reversed.cutouts[0].split!.depths.reverse();
    const projects = [
      { id: "cutter", name: "Ryobi Cutter", updatedAt: "2026-09-13T14:50:27.853Z" },
      { id: "other", name: "Other bin", updatedAt: "2026-09-13T14:50:27.853Z" },
    ];
    const saved = new Map([["cutter", reversed], ["other", EMPTY_PROJECT]]);
    let activeProjectId = "cutter";
    let finishSave!: (success: boolean) => void;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(reversed);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId, projects });
    // Leave autosave pending so only the project-switch path can preserve edits.
    vi.mocked(ProjectPersistence.saveProjectDoc).mockImplementationOnce(doc =>
      new Promise(resolve => { finishSave = success => {
        if (success) saved.set(activeProjectId, structuredClone(doc));
        resolve(success);
      }; }),
    ).mockImplementation(async doc => { saved.set(activeProjectId, structuredClone(doc)); return true; });
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockImplementation(async id => {
      activeProjectId = id;
      return { doc: structuredClone(saved.get(id)!), project: projects.find(project => project.id === id)!,
        library: { activeProjectId, projects } };
    });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      selectPocket(container, intended.cutouts[0].id);
      const setDepth = (value: string) => {
        const input = container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!;
        React.act(() => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      };
      setDepth("16");
      React.act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent === "Section B")!.click());
      setDepth("55");
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].split).toEqual(intended.cutouts[0].split);
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-other"]')!.click());
      expect(ProjectPersistence.saveProjectDoc).toHaveBeenCalledWith(expect.objectContaining({ cutouts: intended.cutouts }), "cutter");
      expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
      await React.act(async () => finishSave(true));
      expect(activeProjectId).toBe("other");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-cutter"]')!.click());
      expect(activeProjectId).toBe("cutter");
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(intended.cutouts);
    } finally { unmount(); }
  });

  it("keeps a split attached through a neighbouring contour edit and undo/redo", async () => {
    const shape = rectangularShape("tool", "Cutter");
    const cutout = parseCutoutPlacement({ id: "split-test", shapeId: shape.id, position: { x: 0, y: 0 },
      split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [{ mode: "mm", value: 6 }, { mode: "mm", value: 20 }] } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      selectPocket(container, cutout.id);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-edit-contour"]')!.click());
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const guide = () => container.querySelector('[data-testid="pocket-split-split-test"] > path:last-child')!.getAttribute('d');
      const originalGuide = guide();
      const vertex = svg.querySelectorAll('[data-testid="contour-vertex-handle"]')[2];
      const pointer = (target: Element, type: string, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 56.75, clientY: y });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        target.dispatchEvent(event);
      });
      // Move the top-right vertex, away from either split endpoint at x=0.
      pointer(vertex, 'pointerdown', 31.75);
      pointer(svg, 'pointermove', 27.75);
      expect(guide()).toBe('M41.75,51.75 L41.75,29.75');
      pointer(svg, 'pointerup', 27.75);
      expect(guide()).toBe('M41.75,51.75 L41.75,29.75');
      expect(container.querySelector('[data-testid="selected-pocket-section"]')).not.toBeNull();
      const latest = vi.mocked(useBinGeometry).mock.lastCall![2]!;
      expect(latest.cutouts[0].split).toEqual(cutout.split);
      expect(latest.cutouts[0].shapeId).not.toBe(shape.id);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(guide()).toBe(originalGuide);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-redo"]')!.click());
      expect(guide()).toBe('M41.75,51.75 L41.75,29.75');
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].split).toEqual(cutout.split);
      React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '3D')!.click());
      const paths = JSON.parse(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute('data-measurement-splits')!);
      expect(paths).toEqual([[{ x: 0, y: -10 }, { x: 0, y: 12 }]]);
    } finally { unmount(); }
  });

  it("measures from a transformed split to the perimeter without changing the pocket", async () => {
    const shape = rectangularShape("tool", "Cutter");
    const cutout = parseCutoutPlacement({ id: "split-test", shapeId: shape.id, position: { x: 3, y: -2 },
      rotationDeg: 90, mirrored: true, scaleX: 1.5, scaleY: 0.8,
      split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [{ mode: "mm", value: 6 }, { mode: "mm", value: 20 }] } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
    const { container, unmount } = renderPage();
    await flushHydration();
    // The 3D ruler receives the same placed split path as Layout.
    const paths = JSON.parse(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute('data-measurement-splits')!);
    expect(paths).toHaveLength(1);
    expect(paths[0][0].x).toBeCloseTo(11);
    expect(paths[0][0].y).toBeCloseTo(-2);
    expect(paths[0][1].x).toBeCloseTo(-5);
    expect(paths[0][1].y).toBeCloseTo(-2);
    React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Layout')!.click());
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperty(svg, 'createSVGPoint', { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) });
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-layout-ruler"]')!.click());
    for (const y of [43.95, 66.05]) React.act(() => svg.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 44.75, clientY: y }),
    ));
    expect(container.querySelector('[data-testid="layout-measurement-label"]')?.textContent).toBe('22.50 mm');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    unmount();
  });

  it.each(["clicks", "drag"])("creates and edits a split with %s, and removes/undoes it without changing the outline", async gesture => {
    const shape = rectangularShape("tool", "Cutter");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "split-test", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: 20 } })] });
    const { container, unmount } = renderPage();
    await flushHydration();
    selectPocket(container, "split-test");
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!;
    const splitSettings = container.querySelector<HTMLDetailsElement>('[data-testid="pocket-split-settings"]')!;
    expect(splitSettings.closest('[aria-label="Pocket depth"]')).toBeNull();
    expect(splitSettings.open).toBe(false);
    React.act(() => splitSettings.querySelector('summary')!.click());
    React.act(() => button("Split pocket").click());
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
      setPointerCapture: { value: () => {} },
    });
    const path = svg.querySelector('[data-cutout-id="split-test"]')!;
    const outline = path.getAttribute('d');
    const pointer = (type: string, x: number, y: number) => React.act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      path.dispatchEvent(event);
    });
    pointer('pointerdown', 41.75, 31.75);
    if (gesture === 'clicks') {
      pointer('pointerup', 41.75, 31.75);
      pointer('pointerdown', 41.75, 51.75);
    } else pointer('pointermove', 41.75, 51.75);
    pointer('pointerup', 41.75, 51.75);
    expect(container.querySelector('[data-testid="pocket-split-split-test"]')).not.toBeNull();
    expect(path.getAttribute('d')).toBe(outline);
    const depth = () => container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!;
    expect(depth().value).toBe('20');
    React.act(() => button("Section B").click());
    expect(container.querySelector('[aria-label="Pocket depth"]')!.textContent).toContain('Section B');
    expect(splitSettings.open).toBe(true);
    React.act(() => {
      depth().focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(depth(), '6');
      depth().dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => depth().blur());
    expect(depth().value).toBe('6');
    React.act(() => button("Section A").click());
    expect(depth().value).toBe('20');
    // Clicking the corresponding canvas region selects B and exposes its depth.
    pointer('pointerdown', 31.75, 41.75); pointer('pointerup', 31.75, 41.75);
    expect(depth().value).toBe('6');
    // Move the split slightly, drawing from the opposite end. The shallow
    // region must remain on the same physical side, including after undo/redo.
    React.act(() => button("Redraw split").click());
    pointer('pointerdown', 43.75, 51.75);
    if (gesture === 'clicks') {
      pointer('pointerup', 43.75, 51.75);
      pointer('pointerdown', 43.75, 31.75);
    } else pointer('pointermove', 43.75, 31.75);
    pointer('pointerup', 43.75, 31.75);
    pointer('pointerdown', 31.75, 41.75); pointer('pointerup', 31.75, 41.75);
    expect(depth().value).toBe('6');
    expect(path.getAttribute('d')).toBe(outline);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(depth().value).toBe('6');
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-redo"]')!.click());
    pointer('pointerdown', 31.75, 41.75); pointer('pointerup', 31.75, 41.75);
    expect(depth().value).toBe('6');
    React.act(() => button("Remove split").click());
    expect(depth().value).toBe('20');
    expect(container.querySelector('[data-testid="pocket-split-split-test"]')).toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(depth().value).toBe('6');
    expect(path.getAttribute('d')).toBe(outline);
    unmount();
  });

  it("leaves no split or history entry after an invalid boundary or cancellation", async () => {
    const shape = rectangularShape("tool", "Cutter");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "split-test", shapeId: shape.id, position: { x: 0, y: 0 } })] });
    const { container, unmount } = renderPage();
    await flushHydration(); selectPocket(container, "split-test");
    React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Layout')!.click());
    const ruler = container.querySelector<HTMLButtonElement>('[aria-label="Measure between contours"]')!;
    React.act(() => ruler.click());
    expect(ruler.getAttribute('aria-pressed')).toBe('true');
    React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Split pocket')!.click());
    expect(ruler.getAttribute('aria-pressed')).toBe('false');
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
      setPointerCapture: { value: () => {} },
    });
    for (const x of [31.75, 41.75]) React.act(() => {
      const event = new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: 31.75 });
      Object.defineProperty(event, 'pointerId', { value: 1 }); svg.dispatchEvent(event);
    });
    expect(container.textContent).toContain('not along its edge');
    React.act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('[data-testid="pocket-split-draft"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    unmount();
  });

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
    expect(editor.lastElementChild?.getAttribute('data-testid')).toBe('pocket-clearance-settings');
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
    expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Draft — saving locally…");
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

  it("keeps native slider and Manage keyboard interactions from editing the selected pocket", async () => {
    const shape = rectangularShape("tool", "Wrench");
    const pocket = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [pocket] });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      selectPocket(container, "pocket");
      openSettingsSection(container, "size");
      const slider = container.querySelector<HTMLElement>('[role="slider"][aria-label="Width in standard Gridfinity cells"]')!;
      const before = Number(slider.getAttribute("aria-valuenow"));
      React.act(() => {
        slider.focus();
        slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
        slider.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
      });
      expect(Number(slider.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([pocket]);
      const resizedSpec = vi.mocked(useBinGeometry).mock.lastCall![0];
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      const target = dialog.querySelector<HTMLButtonElement>('[data-testid="button-export-library"]')!;
      for (const key of ["ArrowDown", "r", "Delete", "z"]) {
        React.act(() => {
          target.focus();
          target.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: key === "z", bubbles: true, cancelable: true }));
        });
      }
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([pocket]);
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(resizedSpec);
    } finally { unmount(); }
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

  it.each([30, 17.000000000000007])("edits physical dimensions from %s mm with linked proportions and undoes the committed value once", async originalWidth => {
    const shape = rectangularShape("tool", "Wrench");
    shape.bboxMm.minX = -originalWidth / 2;
    shape.bboxMm.maxX = originalWidth / 2;
    shape.outlineMm[0].outer = shape.outlineMm[0].outer.map(point => ({ ...point, x: Math.sign(point.x) * originalWidth / 2 }));
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
    expect(Number(length.value)).toBeCloseTo(20 * 40 / originalWidth, 2);
    const undo = container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!;
    React.act(() => undo.click());
    expect(Number(width.value)).toBeCloseTo(originalWidth, 2);
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
      if (gesture === 'drag') {
        pointer('pointermove', 55);
        const args = vi.mocked(useBinGeometry).mock.lastCall!;
        expect(args[2]!.cutouts[0].position.x).toBe(1.25);
        expect(args[5]!.layout.cutouts[0].position.x).not.toBe(1.25);
        expect(args[5]!.gesture).toBeDefined();
        pointer('pointermove', 57);
        expect(vi.mocked(useBinGeometry).mock.lastCall![5]!.gesture).toBe(args[5]!.gesture);
      }
      if (gesture === 'jitter') pointer('pointermove', 44);
      pointer(gesture === 'cancel' ? 'pointercancel' : 'pointerup', gesture === 'drag' ? 55 : gesture === 'jitter' ? 44 : 43);
      expect(vi.mocked(useBinGeometry).mock.lastCall![5]!.gesture).toBeUndefined();
      expect(controls!.panelOpen).toBe(gesture === 'jitter');
      if (gesture === 'tap') {
        expect(container.querySelector('.mobile-adjustment-tray')?.textContent).toContain('Wrench');
        expect(container.querySelector('#quick-pocket-depth')).not.toBeNull();
      }
      if (gesture === 'jitter') {
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
      if (gesture === 'tap') {
        const cutoutBefore = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
        const slider = container.querySelector('#quick-pocket-depth [role="slider"]')!;
        React.act(() => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
        expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].depth).not.toEqual(cutoutBefore.depth);
        React.act(() => undo.click());
        expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].depth).toEqual(cutoutBefore.depth);
        React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Export bin')!.click());
        expect(document.querySelector('#bin-settings-export')).not.toBeNull();
        expect(document.querySelector('#bin-settings-pockets')).toBeNull();
        expect(document.querySelector('#bin-settings-size')).toBeNull();
        React.act(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Back to canvas')!.click());
        React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Adjust')!.click());
        React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'More settings')!.click());
        expect(document.querySelector('#bin-settings-pockets')).not.toBeNull();
        expect(document.querySelector('#bin-settings-size')).not.toBeNull();
      }
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
    expect(edit.previousElementSibling?.getAttribute('aria-label')).toBe('Object controls');
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

  it.each([
    { ringIndex: -1, mirrored: false }, { ringIndex: 0, mirrored: false },
    { ringIndex: -1, mirrored: true }, { ringIndex: 0, mirrored: true },
  ])("focuses desktop ring $ringIndex (mirrored: $mirrored) while preserving mouse edits and near-edge insertion", async ({ ringIndex, mirrored }) => {
    const shape = rectangularShape("tool", "Wrench");
    shape.outlineMm[0].holes = [[{ x: -7, y: -4 }, { x: -7, y: 4 }, { x: 7, y: 4 }, { x: 7, y: -4 }]];
    shape.pointCount = 8;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, rotationDeg: 30, scaleX: 1.5, scaleY: 0.8, mirrored })],
    });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "tool-cutouts"); selectPocket(container, "pocket");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-edit-contour"]')!.click());
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const handles = () => svg.querySelectorAll(`[data-contour-ring="${ringIndex}"]`);
      const coords = (element: Element) => ({ x: Number(element.getAttribute('cx')), y: Number(element.getAttribute('cy')) });
      const pointer = (target: Element, type: string, point: { x: number; y: number }) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: type === 'pointermove' ? -1 : 0, clientX: point.x, clientY: point.y });
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
        target.dispatchEvent(event);
      });
      const remove = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Delete point');
      const first = coords(handles()[0]);
      pointer(handles()[0], 'pointerdown', first);
      expect(container.querySelector('[data-testid="contour-magnifier"]')).not.toBeNull();
      pointer(svg, 'pointerup', first);
      expect(container.querySelector('[data-testid="contour-magnifier"]')).toBeNull();
      expect(handles()[0].getAttribute('data-point-selected')).toBe('true');
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      pointer(handles()[0], 'pointerdown', first);
      const moved = { x: first.x + 10, y: first.y + 10 };
      pointer(svg, 'pointermove', moved); pointer(svg, 'pointerup', moved);
      expect(coords(handles()[0]).x).toBeCloseTo(moved.x);
      React.act(() => remove()!.click());
      expect(handles()).toHaveLength(3);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(handles()).toHaveLength(4);
      React.act(() => handles()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
      expect(handles()).toHaveLength(3);
      pointer(handles()[0], 'pointerdown', coords(handles()[0])); pointer(svg, 'pointerup', coords(handles()[0]));
      expect(remove()!.disabled).toBe(true);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      const vertices = [...handles()].map(coords);
      const [a, b] = vertices.map((point, index) => [point, vertices[(index + 1) % vertices.length]])
        .sort(([a, b], [c, d]) => Math.hypot(d.x - c.x, d.y - c.y) - Math.hypot(b.x - a.x, b.y - a.y))[0];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const midpoint = { x: (a.x + b.x) / 2 + (b.y - a.y) / length * 2,
        y: (a.y + b.y) / 2 - (b.x - a.x) / length * 2 };
      // Miss the path while staying closer to this edge than the other ring (4.8px away).
      pointer(svg, 'pointerdown', midpoint);
      pointer(svg, 'pointerup', midpoint);
      expect(handles()).toHaveLength(5);
      expect(remove()).toBeDefined();
      expect(coords(svg.querySelector('[data-point-selected="true"]')!).x).toBeCloseTo(midpoint.x);
      expect(coords(svg.querySelector('[data-point-selected="true"]')!).y).toBeCloseTo(midpoint.y);
      const nearVertex = { x: coords(handles()[0]).x + 1, y: coords(handles()[0]).y + 1 };
      pointer(svg, 'pointerdown', nearVertex); pointer(svg, 'pointerup', nearVertex);
      expect(handles()).toHaveLength(5);
      expect(handles()[0].getAttribute('data-point-selected')).toBe('true');
      pointer(svg, 'pointerdown', { x: 1000, y: 1000 }); pointer(svg, 'pointerup', { x: 1000, y: 1000 });
      expect(handles()).toHaveLength(5);
    } finally { unmount(); }
  });

  it.each([-1, 0])("selects and deletes contour ring %s points with undo, minimum size, and direct dragging", async (ringIndex) => {
    const shape = rectangularShape("tool", "Wrench");
    shape.outlineMm[0].holes = [[{ x: -7, y: -4 }, { x: -7, y: 4 }, { x: 7, y: 4 }, { x: 7, y: -4 }]];
    shape.pointCount = 8;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, rotationDeg: 30, scaleX: 1.5, scaleY: 0.8 })],
    });
    const { container, unmount } = renderPage({ mobile: true });
    try {
      await flushHydration();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Adjust')!.click());
      React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'More settings')!.click());
      openSettingsSection(document.body, "tool-cutouts");
      selectPocket(document.body, "pocket");
      React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-edit-contour"]')!.click());
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const ringHandles = () => svg.querySelectorAll(`[data-contour-ring="${ringIndex}"]`);
      const otherHandles = () => svg.querySelectorAll(`[data-contour-ring="${ringIndex === -1 ? 0 : -1}"]`);
      const deleteButton = () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Contour editing tools"] button')].find(button => button.textContent === 'Delete point');
      const pointer = (target: Element, type: string, x: number, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' } });
        target.dispatchEvent(event);
      });
      const tapNearFirst = () => {
        const first = ringHandles()[0];
        // Picking uses screen distance, including rotated and stretched pockets.
        pointer(svg, 'pointerdown', Number(first.getAttribute('cx')) - 2, Number(first.getAttribute('cy')));
        pointer(svg, 'pointerup', Number(first.getAttribute('cx')) - 2, Number(first.getAttribute('cy')));
      };
      const original = svg.querySelector('[data-cutout-id="pocket"]')!.getAttribute('d');
      expect(deleteButton()).toBeUndefined();
      tapNearFirst();
      expect(ringHandles()).toHaveLength(4);
      expect(svg.querySelectorAll('[data-point-selected="true"]')).toHaveLength(1);
      React.act(() => deleteButton()!.click());
      expect(ringHandles()).toHaveLength(3);
      expect(otherHandles()).toHaveLength(4);
      tapNearFirst();
      expect(deleteButton()!.disabled).toBe(true);
      React.act(() => deleteButton()!.click());
      pointer(svg, 'pointerdown', 1000, 1000);
      pointer(svg, 'pointerup', 1000, 1000);
      expect(deleteButton()).toBeUndefined();
      expect(ringHandles()).toHaveLength(3);
      expect(otherHandles()).toHaveLength(4);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(ringHandles()).toHaveLength(4);
      expect(svg.querySelector('[data-cutout-id="pocket"]')!.getAttribute('d')).toBe(original);
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-redo"]')!.click());
      expect(ringHandles()).toHaveLength(3);
      const first = ringHandles()[0];
      const x = Number(first.getAttribute('cx')), y = Number(first.getAttribute('cy'));
      pointer(first, 'pointerdown', x, y);
      pointer(svg, 'pointermove', x + 10, y + 10);
      pointer(svg, 'pointerup', x + 10, y + 10);
      expect(ringHandles()).toHaveLength(3);
      expect(Number(ringHandles()[0].getAttribute('cx'))).toBeCloseTo(x + 10);
      const edit = container.querySelector<HTMLButtonElement>('[data-testid="button-layout-edit-contour"]')!;
      React.act(() => edit.click());
      expect(container.querySelector('[aria-label="Contour editing tools"]')).toBeNull();
      React.act(() => edit.click());
      expect(deleteButton()).toBeUndefined();
    } finally { unmount(); }
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
    ["surface-fit-test", "-surface-fit-test-0.8mm", "stl"],
    ["surface-outline", "-tool-outlines-5mm-wide-0.8mm-thick", "stl"],
    ["fit-check", "-Left-wrench-fit-template-2mm", "stl"],
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
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, name: "Left wrench", position: { x: 0, y: 0 } })],
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
      openSettingsSection(container, kind.startsWith("surface-") || kind === "fit-check" ? "check-fit" : "export");
      if (kind === "surface-fit-test") {
        React.act(() => container.querySelector('[data-testid="select-surface-fit-test-style"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
        React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Full surface")!.click());
      }
      await React.act(async () => {
        const button = kind === "surface-outline" ? "button-export-surface-fit-test"
          : kind.startsWith("layout-") ? `button-${kind}` : `button-export-${kind.endsWith("3mf") ? "3mf" : kind}`;
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
      if (kind.startsWith("surface-")) {
        expect(binGeometryMock.buildSurfaceFitCheck).toHaveBeenCalledWith(0.8, expect.any(Object), kind === "surface-outline" ? "outline" : "full");
      }
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
      expect(parseProjectDoc(JSON.parse(json))).toEqual({
        ...project, name: "Layout 2", keepBinSize: false,
        transformOrigins: { pockets: project.cutouts.map(cutout => ({ cutout, spec: project.spec })), fingerHoles: project.fingerHoles },
        history: { index: 0, stack: [{ label: "Project opened", doc: {
          spec: project.spec, cutouts: project.cutouts, fingerHoles: project.fingerHoles,
        } }] },
      });
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

  it("adjusts fill percentages with exact typing and keyboard, retaining the value while hollow", async () => {
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "construction");
    const input = () => container.querySelector<HTMLInputElement>('[aria-label="Fill height percentage"]')!;
    const dimensions = container.querySelector("#bin-settings-size")!.textContent;
    expect(input().value).toBe("100");
    React.act(() => {
      input().focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "37.5");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => input().blur());
    expect(input().value).toBe("37.5");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[0].fillHeightPercent).toBe(37.5);
    React.act(() => {
      input().focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "50");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => input().blur());
    const thumb = container.querySelector<HTMLElement>('[role="slider"][aria-label="Fill height"]')!;
    React.act(() => thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(input().value).toBe("51");
    const toggle = () => container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Solid fill"]')!;
    React.act(() => toggle().click());
    expect(input()).toBeNull();
    React.act(() => toggle().click());
    expect(input().value).toBe("51");
    expect(container.querySelector("#bin-settings-size")!.textContent).toBe(dimensions);
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

  it("switches a custom bin across full, half and quarter pitches without moving its split pocket", async () => {
    const shape = rectangularShape("tool", "Cutter");
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: -20, y: -20 },
      split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [{ mode: "mm", value: 6 }, { mode: "mm", value: 20 }] } });
    const original = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, flatBottom: true,
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original, shapes: [shape], cutouts: [cutout] });
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      const trigger = container.querySelector<HTMLButtonElement>('[data-testid="select-grid-pitch"]')!;
      expect(trigger.textContent).toBe("Full · 42 mm");
      for (const [label, count] of [["Half · 21 mm", 12], ["Quarter · 10.5 mm", 48], ["Full · 42 mm", 3]] as const) {
        React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
        const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
        expect(options.every(option => option.getAttribute("aria-disabled") !== "true")).toBe(true);
        React.act(() => options.find(option => option.textContent === label)!.click());
        const [spec, , layout] = vi.mocked(useBinGeometry).mock.lastCall!;
        expect(occupiedCellCount(spec)).toBe(count);
        expect(footprintOuterRingMm(spec, 32)).toEqual(footprintOuterRingMm(original, 32));
        expect(layout?.cutouts).toEqual([cutout]);
        expect(container.querySelector("#bin-settings-size")?.textContent).toContain("Outer size 83.5 × 83.5 × 45.6 mm");
      }
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(trigger.textContent).toBe("Quarter · 10.5 mm");
      expect(occupiedCellCount(vi.mocked(useBinGeometry).mock.lastCall![0])).toBe(48);
    } finally { unmount(); }
  });

  it("disables only a pitch that would alter a custom footprint", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, gridPitch: "half",
        footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } }) });
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      const trigger = container.querySelector<HTMLButtonElement>('[data-testid="select-grid-pitch"]')!;
      expect(trigger.textContent).toBe("Half · 21 mm");
      React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      expect(options.find(option => option.textContent === "Full · 42 mm (would change shape)")?.getAttribute("aria-disabled")).toBe("true");
      expect(options.find(option => option.textContent === "Half · 21 mm")?.getAttribute("aria-disabled")).not.toBe("true");
      expect(options.find(option => option.textContent === "Quarter · 10.5 mm")?.getAttribute("aria-disabled")).not.toBe("true");
    } finally { unmount(); }
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

  it.each(["straight", "scoop", "deep-scoop", "oblong-deep-scoop", "flat-ended-scoop", "oblong-straight", "flat-ended-straight"] as const)("edits %s at 1 mm depth without a duplicate heading", async (kind) => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, fingerHoles: [fingerHoleSchema.parse({ id: "shallow", kind, center: { x: 0, y: 0 }, depthMm: 12, lengthMm: 40 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-shallow"]')!.click());
    const properties = container.querySelector('#finger-access-properties')!;
    expect(properties.textContent).toContain("Shape");
    expect(properties.querySelector('[aria-label="Finger access depth"] h4')).toBeNull();
    const input = properties.querySelector<HTMLInputElement>('[aria-label="Depth in millimetres"]')!;
    expect(input.min).toBe("1");
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(input.value).toBe("1");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0]).toMatchObject({ kind: kind === "scoop" ? "deep-scoop" : kind, depthMm: 1 });
    unmount();
  });

  it("groups finger access like pockets and supports renaming, undo, and cancellation", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      fingerHoles: [fingerHoleSchema.parse({ id: "named-hole", center: { x: 0, y: 0 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    const select = () => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-named-hole"]')!;
    React.act(() => select().click());
    expect(select().getAttribute("aria-pressed")).toBe("true");
    const properties = container.querySelector("#finger-access-properties")!;
    expect(properties.firstElementChild?.textContent).toContain("Finger access properties");
    expect(properties.querySelector('[aria-label="Depth in millimetres"]')!.closest('details')).toBeNull();
    for (const id of ["finger-size-settings", "finger-edge-settings", "finger-position-settings"]) {
      expect(properties.querySelector<HTMLDetailsElement>(`[data-testid="${id}"]`)!.open).toBe(false);
    }
    expect(properties.lastElementChild?.getAttribute("data-testid")).toBe("finger-position-settings");
    const editName = (value: string) => {
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-rename-finger-hole-named-hole"]')!.click());
      const input = container.querySelector<HTMLInputElement>('[aria-label="Finger access name"]')!;
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      return input;
    };
    let input = editName("  Thumb access  ");
    React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(select().textContent).toBe("Thumb access");
    expect(properties.firstElementChild?.textContent).toContain("Thumb access");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(select().textContent).toBe("Finger access 1");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-redo"]')!.click());
    expect(select().textContent).toBe("Thumb access");
    input = editName("Cancelled name");
    React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(select().textContent).toBe("Thumb access");
    input = editName("   ");
    React.act(() => input.blur());
    expect(select().textContent).toBe("Thumb access");
    unmount();
  });

  it.each(["flat-ended-scoop", "flat-ended-straight"] as const)("edits %s corner rounding with size limits, undo, and retained shape preferences", async (kind) => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      fingerHoles: [fingerHoleSchema.parse({ id: "corners", kind, center: { x: 0, y: 0 }, diameterMm: 24, lengthMm: 16, depthMm: 20 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-corners"]')!.click());
    const input = () => container.querySelector<HTMLInputElement>('[aria-label="Corner round in millimetres"]');
    const current = () => vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0];
    const edit = (label: string, value: string) => {
      const field = container.querySelector<HTMLInputElement>(`#finger-access-properties [aria-label="${label} in millimetres"]`)!;
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    };
    expect(input()!.closest("details")?.getAttribute("data-testid")).toBe("finger-edge-settings");
    expect(input()!.value).toBe("0");
    expect(input()!.max).toBe("8");
    edit("Corner round", "5");
    expect(current()?.cornerRoundMm).toBe(5);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(input()!.value).toBe("0");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-redo"]')!.click());
    expect(input()!.value).toBe("5");
    edit("Width", "6");
    expect(input()!.max).toBe("3");
    expect(input()!.value).toBe("3");
    expect(current()?.cornerRoundMm).toBe(5);
    edit("Width", "24");
    expect(input()!.value).toBe("5");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="finger-ends-rounded"]')!.click());
    expect(input()).toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="finger-ends-flat"]')!.click());
    expect(input()!.value).toBe("5");
    edit("Corner round", "99");
    expect(input()!.value).toBe("5");
    edit("Corner round", "8");
    expect(input()!.value).toBe("8");
    expect(parseProjectDoc({ ...EMPTY_PROJECT, fingerHoles: [current()] })?.fingerHoles[0].cornerRoundMm).toBe(8);
    unmount();
  });

  it("switches all six shape combinations without losing dimensions and undoes the change", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      fingerHoles: [fingerHoleSchema.parse({ id: "styles", kind: "straight", center: { x: 0, y: 0 }, diameterMm: 18, depthMm: 30, lengthMm: 40, rotationDeg: 37, bottomFilletMm: 2 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-styles"]')!.click());
    const current = () => vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0];
    expect(container.querySelector('[data-testid="finger-ends-flat"]')).toBeNull();
    for (const [option, kind] of [["bottom-curved", "deep-scoop"], ["shape-slot", "oblong-deep-scoop"],
      ["ends-flat", "flat-ended-scoop"], ["bottom-flat", "flat-ended-straight"],
      ["ends-rounded", "oblong-straight"], ["shape-round", "straight"]] as const) {
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="finger-${option}"]`)!.click());
      expect(current()).toMatchObject({ kind, depthMm: 30, diameterMm: 18, lengthMm: 40, rotationDeg: 37, bottomFilletMm: 2 });
      expect(container.querySelector('[data-testid="finger-access-shape-controls"] [role="img"]')).not.toBeNull();
      const bottomRound = container.querySelector('#finger-access-properties [aria-label="Bottom edge round"]');
      expect(bottomRound !== null).toBe(kind.endsWith("straight"));
    }
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(current()).toMatchObject({ kind: "oblong-straight", depthMm: 30 });
    expect(container.querySelector('[data-testid="finger-ends-rounded"]')?.getAttribute("aria-checked")).toBe("true");
    unmount();
  });

  it.each(["scoop", "oblong-deep-scoop", "flat-ended-scoop"] as const)("keeps saved %s geometry until edited and allows an 80 mm opening", async (kind) => {
    const original = fingerHoleSchema.parse({ id: "wide", kind, center: { x: 0, y: 0 }, diameterMm: 18, depthMm: 8, lengthMm: 40 });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, fingerHoles: [original] });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-wide"]')!.click());
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0]).toEqual(original);
    const input = container.querySelector<HTMLInputElement>(`#finger-access-properties [aria-label="${kind === "scoop" ? "Diameter" : "Width"} in millimetres"]`)!;
    expect(input.max).toBe(kind === "scoop" ? "83.5" : "80");
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "80");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    const updated = vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0];
    expect(updated).toMatchObject({ diameterMm: 80, depthMm: 8, kind: kind === "scoop" ? "deep-scoop" : kind });
    expect(parseProjectDoc({ ...EMPTY_PROJECT, fingerHoles: [updated] })?.fingerHoles[0]).toEqual(updated);
    unmount();
  });

  it.each(["straight", "scoop", "deep-scoop"] as const)("edits large %s diameters up to bin width with slider, persistence and undo", async (kind) => {
    const project = { ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, gridX: 4, gridY: 2 },
      fingerHoles: [fingerHoleSchema.parse({ id: "large-round", kind, center: { x: 0, y: 0 }, diameterMm: 18, depthMm: 1 })] };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(project);
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-large-round"]')!.click());
    const field = () => container.querySelector<HTMLInputElement>('[aria-label="Diameter in millimetres"]')!;
    const current = () => vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0];
    const edit = (value: string) => {
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
        field().dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => field().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    };
    expect(field().max).toBe("167.5");
    edit("150");
    expect(current()).toMatchObject({ diameterMm: 150, depthMm: 1 });
    edit("168");
    expect(field().value).toBe("150");
    const slider = container.querySelector<HTMLElement>('[role="slider"][aria-label="Diameter"]')!;
    React.act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(field().value).toBe("167.5");
    expect(current()).toMatchObject({ diameterMm: 167.5, depthMm: 1 });
    expect(parseProjectDoc(JSON.parse(JSON.stringify({ ...project, fingerHoles: [current()] })))?.fingerHoles[0]).toEqual(current());
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(field().value).toBe("150");
    unmount();
  });

  it("updates finger-access field limits with bin height and slot rotation, rejecting oversized input", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: { ...EMPTY_PROJECT.spec, gridX: 1, gridY: 2, heightUnits: 2 },
      fingerHoles: [fingerHoleSchema.parse({ id: "limits", kind: "flat-ended-straight", center: { x: 0, y: 0 }, diameterMm: 18, lengthMm: 30, depthMm: 12 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-limits"]')!.click());
    const input = (name: string) => container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
    const setNumber = (name: string, value: string) => {
      const field = input(name);
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    };
    expect(input("Depth in millimetres").max).toBe("12.8");
    const slider = container.querySelector<HTMLElement>('[role="slider"][aria-label="Depth"]')!;
    expect(input("Length in millimetres").max).toBe("43.57");
    expect(input("Width in millimetres").max).toBe("80");
    setNumber("Depth in millimetres", "20");
    expect(input("Depth in millimetres").value).toBe("12");
    setNumber("Length in millimetres", "100");
    expect(input("Length in millimetres").value).toBe("30");
    setNumber("Elongated finger access rotation", "90");
    expect(input("Length in millimetres").max).toBe("87.67");
    expect(input("Width in millimetres").max).toBe("43.57");
    React.act(() => container.querySelector<HTMLButtonElement>('#bin-settings-size [data-panel-section-trigger]')!.click());
    setNumber("Bin height in units", "1");
    expect(input("Depth in millimetres").max).toBe("5.8");
    expect(input("Depth in millimetres").value).toBe("5.8");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0].depthMm).toBe(5.8);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(input("Bin height in units").value).toBe("2");
    expect(input("Depth in millimetres").value).toBe("12");
    React.act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(input("Depth in millimetres").value).toBe("12.8");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0].depthMm).toBe(12.8);
    unmount();
  });

  it.each([
    { heightUnits: 4, lip: "standard" as const, flatBottom: false, depth: 26.8 },
    { heightUnits: 4, lip: "none" as const, flatBottom: true, depth: 28 },
    { heightUnits: 20, lip: "none" as const, flatBottom: false, depth: 120 },
  ])("keeps the depth cap without a floor indicator for $heightUnits units, $lip lip, flat bottom $flatBottom", async ({ heightUnits, lip, flatBottom, depth }) => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: { ...EMPTY_PROJECT.spec, heightUnits, lip, flatBottom },
      fingerHoles: [fingerHoleSchema.parse({ id: "floor", center: { x: 0, y: 0 }, depthMm: 12 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-floor"]')!.click());
    expect(container.querySelector<HTMLInputElement>('[aria-label="Depth in millimetres"]')?.max).toBe(String(depth));
    expect(container.querySelector('[data-slider-marker]')).toBeNull();
    expect(container.querySelector('[aria-label="Finger access depth"]')?.textContent).not.toContain("Base floor");
    unmount();
  });

  it("flags an oversized saved slot without silently rewriting it or inverting its length range", async () => {
    const hole = fingerHoleSchema.parse({ id: "old-large", kind: "oblong-straight", center: { x: 0, y: 0 }, diameterMm: 80, lengthMm: 160, depthMm: 120 });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: { ...EMPTY_PROJECT.spec, gridX: 1, gridY: 1, heightUnits: 1 }, fingerHoles: [hole],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-old-large"]')!.click());
    expect(container.querySelector('#finger-access-properties')?.textContent).toContain("Opening exceeds this bin's size limits.");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0]).toEqual(hole);
    const length = container.querySelector<HTMLInputElement>('[aria-label="Length in millimetres"]')!;
    expect(Number(length.min)).toBeLessThanOrEqual(Number(length.max));
    unmount();
  });

  it("shows effective shallow rounding and restores the requested radii when depth increases", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      fingerHoles: [fingerHoleSchema.parse({ id: "rounding", center: { x: 0, y: 0 }, depthMm: 1, topFilletMm: 1, bottomFilletMm: 2 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-rounding"]')!.click());
    for (const label of ["Top edge round", "Bottom edge round"]) {
      const input = container.querySelector<HTMLInputElement>(`[aria-label="${label} in millimetres"]`)!;
      expect(input.value).toBe("0.5");
      expect(input.max).toBe("0.5");
    }
    expect(container.textContent).toContain("Requested 1 mm; limited by depth.");
    const depth = container.querySelector<HTMLInputElement>('[aria-label="Depth in millimetres"]')!;
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(depth, "12");
      depth.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => depth.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Top edge round in millimetres"]')!.value).toBe("1");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Bottom edge round in millimetres"]')!.value).toBe("2");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0]).toMatchObject({ depthMm: 12, topFilletMm: 1, bottomFilletMm: 2 });
    unmount();
  });

  it("restores a deep finger scoop as Round with a curved bottom without changing geometry", async () => {
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
      container.querySelector('[data-testid="finger-shape-round"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.querySelector('[data-testid="finger-bottom-curved"]')?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[aria-label="Diameter"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Depth"]')).not.toBeNull();
    const fingerHoleSection = container.querySelector(
      '#bin-settings-finger-holes',
    );
    expect(
      fingerHoleSection?.querySelector('[aria-label="Top edge round"]'),
    ).not.toBeNull();
    expect(
      fingerHoleSection?.querySelector('[aria-label="Bottom edge round"]'),
    ).toBeNull();
    expect(container.querySelector('[aria-label="Reach"]')).toBeNull();
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0]).toMatchObject({ kind: "deep-scoop", depthMm: 30, diameterMm: 16 });

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
    ["oblong-straight", 1], ["flat-ended-straight", 30],
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
      container.querySelector('[data-testid="finger-shape-slot"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.querySelector(`[data-testid="finger-ends-${kind.startsWith("flat-ended") ? "flat" : "rounded"}"]`)?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('#finger-access-properties [aria-label="Width"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Depth"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Length"]')).not.toBeNull();
    const rotateClockwise = container.querySelector(
      '[aria-label="Rotate elongated finger access 90 degrees clockwise"]',
    ) as HTMLButtonElement;
    expect(rotateClockwise).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="Rotate elongated finger access 90 degrees counterclockwise"]',
      ),
    ).not.toBeNull();
    const depthInput = container.querySelector<HTMLInputElement>('[aria-label="Depth in millimetres"]')!;
    expect(depthInput.value).toBe(String(depthMm));
    expect(depthInput.min).toBe("1");

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

  it("shows preview processing beside the size controls after a short delay", async () => {
    binGeometryMock.building = true;
    binGeometryMock.progress = 0.4;
    const { container, unmount } = renderPage();
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 170)); });

    expect(
      container.querySelector('[data-testid="bin-size-preview-status"]')?.textContent,
    ).toContain("Updating 3D preview");
    expect(
      container.querySelector("#bin-settings-export")?.textContent,
    ).toContain("Updating");
    unmount();
  });

  it("withholds model volume while a rounded preview is still a draft", () => {
    binGeometryMock.previewIsDraft = true;
    binGeometryMock.building = true;
    const { container, unmount } = renderPage();
    try {
      openSettingsSection(container, "export");
      const panel = container.querySelector("#bin-settings-export")!;
      expect(panel.textContent).toContain("Model volume will appear when details are ready");
      expect(panel.textContent).not.toContain("cm³ model volume");
      // A preview approximation never disables the independent full-quality export.
      const exportButton = container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]');
      expect(exportButton).not.toBeNull();
      expect(exportButton!.disabled).toBe(false);
    } finally { unmount(); }
  });

  it("retains previous exact volume with an explicit updating label", () => {
    binGeometryMock.statsAreStale = true;
    binGeometryMock.building = true;
    const { container, unmount } = renderPage();
    try {
      openSettingsSection(container, "export");
      const panel = container.querySelector("#bin-settings-export")!;
      expect(panel.textContent).toContain("82.4 cm³ model volume");
      expect(panel.textContent).toContain("Previous model · updating…");
    } finally { unmount(); }
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
      ["bin-settings-fit", "emerald", "closed"],
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

  it.each([false, true])("opens and focuses color controls from the legend with mobile=%s", async (mobile) => {
    let controls: ReturnType<typeof usePanelState>;
    function PanelProbe() { controls = usePanelState(); return null; }
    const { container, unmount } = render(
      <PanelProvider><PanelProbe /><ShapeLibraryProvider><BinDesignerPage /></ShapeLibraryProvider></PanelProvider>,
      { mobile },
    );
    await flushHydration();
    for (const target of ["bin", "pocket-floor", "stacking-rim", "bin"] as const) {
      React.act(() => controls.setPanelOpen(false));
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="legend-${target}"]`)!.click());
      expect(controls!.panelOpen).toBe(true);
      expect(document.querySelector('#bin-settings-materials')?.getAttribute('data-state')).toBe('open');
      await vi.waitFor(() => expect(document.activeElement?.id).toBe(`input-${target}-color`));
      // Returning from another section must also work for the same legend entry.
      openSettingsSection(document.body, "size");
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="legend-${target}"]`)!.click());
      expect(document.querySelector('#bin-settings-materials')?.getAttribute('data-state')).toBe('open');
      await vi.waitFor(() => expect(document.activeElement?.id).toBe(`input-${target}-color`));
    }
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
          '[data-testid="bin-settings-jump-materials-&-colors"]',
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

  it.each([false, true])("preserves tilted seats across depth-mode changes and measures the selected region (split=%s)", async split => {
    const shape = rectangularShape("tool", "Tilted depth test");
    const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 8, lip: "none" });
    const original = parseCutoutPlacement({ id: "tilted", shapeId: shape.id, position: { x: 0, y: 0 }, tilt: { xDeg: 25, yDeg: 20 }, depth: { mode: "remaining", floorThicknessMm: 10 },
      ...(split ? { split: { boundary: [{ x: -15, y: 0 }, { x: 15, y: 0 }], depths: [{ mode: "remaining", floorThicknessMm: 10 }, { mode: "remaining", floorThicknessMm: 20 }] } } : {}) });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: [original] });
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      selectPocket(container, original.id);
      const regions = original.split ? resolvePocketSplit(shape.outlineMm, original.split.boundary).regions! : [shape.outlineMm];
      const changeMode = (label: string) => {
        const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Pocket depth mode"]')!;
        React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === label)!;
        React.act(() => option.click());
      };
      regions.forEach((outlineMm, index) => {
        if (split) React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === `Section ${index === 0 ? "A" : "B"}`)!.click());
        const depth = original.split?.depths[index] ?? original.depth;
        const expected = resolvePlacedPocketDepth(spec, depth, { outlineMm }, original);
        changeMode("Fixed depth");
        const changed = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
        const actualDepth = changed.split?.depths[index] ?? changed.depth;
        expect(actualDepth.mode).toBe("mm");
        expect(actualDepth.mode === "mm" ? actualDepth.value : NaN).toBeCloseTo(expected.axialDepthMm!, 8);
        expect(container.querySelector('[data-testid="pocket-depth-summary"]')!.textContent).toContain(`Floor: ${expected.floorZ!.toFixed(1)} mm`);
        expect(container.querySelector('[data-testid="pocket-depth-summary"]')!.textContent).toContain(`Vertical depth: ${expected.depthMm!.toFixed(1)} mm`);
        changeMode("Keep floor thickness");
        const restored = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
        const restoredDepth = restored.split?.depths[index] ?? restored.depth;
        expect(restoredDepth.mode === "remaining" ? restoredDepth.floorThicknessMm : NaN).toBeCloseTo(expected.floorZ!, 8);
      });
    } finally { unmount(); }
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

    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="bin-settings-jump-materials-&-colors"]')!.click());
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
          '[data-testid="bin-settings-jump-materials-&-colors"]',
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

  it("closes the mobile controls when starting a geometric pocket from the panel", async () => {
    let controls: ReturnType<typeof usePanelState>;
    function PanelProbe() { controls = usePanelState(); return null; }
    const { container, unmount } = render(
      <PanelProvider><PanelProbe /><ShapeLibraryProvider><BinDesignerPage /></ShapeLibraryProvider></PanelProvider>, { mobile: true },
    );
    await flushHydration();
    try {
      React.act(() => controls.setPanelOpen(true));
      openSettingsSection(document.body, "tool-cutouts");
      const add = document.querySelector<HTMLButtonElement>('#bin-settings-pockets button[aria-haspopup="menu"]')!;
      React.act(() => add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Circle")!.click());
      expect(controls!.panelOpen).toBe(false);
      expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
      expect(container.textContent).toContain("Drag from the centre to the edge of the circle");
    } finally { unmount(); }
  });

  it.each(["Rectangle", "Square", "Circle"])("draws a %s as a pocket without a photo or bin growth, with one undo step", async kind => {
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Pan layout"]')!.click());
      const add = container.querySelector<HTMLButtonElement>('[data-testid="layout-add-pocket"] button')!;
      React.act(() => add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === kind)!.click());
      expect(container.querySelector('[aria-label="Pan layout"]')!.getAttribute("aria-pressed")).toBe("false");
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      // A zoomed/panned scene: client -> model coordinates must use the SVG transform.
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: (this.x - 10) / 2, y: (this.y - 20) / 2 }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const pointer = (type: string, x: number, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperty(event, "pointerId", { value: 1 });
        svg.dispatchEvent(event);
      });
      pointer("pointerdown", 73.5, 83.5);
      pointer("pointermove", 113.5, 103.5);
      expect(container.querySelector('[data-testid="basic-pocket-draft"]')).not.toBeNull();
      pointer("pointerup", 113.5, 103.5);
      expect(container.querySelector('[data-testid="basic-pocket-draft"]')).toBeNull();
      expect(container.textContent).toContain(`${kind} pocket`);
      const layout = vi.mocked(useBinGeometry).mock.lastCall![2]!;
      expect(layout.cutouts).toHaveLength(1);
      expect(layout.fingerHoles).toEqual([]);
      const shape = layout.shapes.find(shape => shape.id === layout.cutouts[0].shapeId)!;
      expect(shape.source).toBe("basic-shape");
      expect(shape.sourceMmPerPx).toBeNull();
      expect(shape.bboxMm.maxX - shape.bboxMm.minX).toBeCloseTo(kind === "Circle" ? Math.hypot(20, 10) * 2 : 20);
      expect(shape.bboxMm.maxY - shape.bboxMm.minY).toBeCloseTo(kind === "Circle" ? Math.hypot(20, 10) * 2 : kind === "Square" ? 20 : 10);
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(EMPTY_PROJECT.spec);
      expect(container.textContent).not.toContain("was traced without a scale");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([]);
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-redo"]')!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(layout.cutouts);
    } finally { unmount(); }
  });

  it.each(["Escape", "pointercancel", "tap", "mode change"])("discards a shape draft on %s without changing the library or history", async cancellation => {
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      const add = container.querySelector<HTMLButtonElement>('[data-testid="layout-add-pocket"] button')!;
      React.act(() => add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Rectangle")!.click());
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const pointer = (type: string, x: number) => React.act(() => svg.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: x })));
      pointer("pointerdown", 30);
      if (cancellation === "tap") pointer("pointerup", 31);
      else {
        pointer("pointermove", 50);
        if (cancellation === "Escape") React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        else if (cancellation === "mode change") React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-3d"]')!.click());
        else pointer("pointercancel", 50);
      }
      expect(container.querySelector('[data-testid="basic-pocket-draft"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([]);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.shapes).toEqual([]);
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    } finally { unmount(); }
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
    ).toContain("Use Add simple pocket to draw a shape");
    expect(container.querySelector('[data-testid="layout-ruler-status"]')).toBeNull();
    expect(container.textContent).toContain("Choose Add simple pocket to draw a shape");
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
    const fresh = container.querySelector(
      '[data-testid="button-new-project"]',
    ) as HTMLButtonElement;
    const manage = container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!;

    expect(status.textContent).toContain("Checking for saved projects");
    expect(save.disabled).toBe(true);
    expect(manage.disabled).toBe(true);
    const transfers = ["export-project", "import-project"].map(action =>
      container.querySelector<HTMLButtonElement>(`[data-testid="button-${action}"]`)!,
    );
    for (const action of transfers) expect(action.disabled).toBe(true);
    await flushHydration();

    expect(status.textContent).toContain("Untitled project");
    expect(status.querySelector('[role="group"][aria-labelledby="current-project-label"]')?.textContent).toContain("Untitled project");
    expect(container.querySelector('#current-project-label')?.textContent).toBe("Current Project:");
    expect(container.querySelector('section[aria-label="Browser library"] h3')).toBeNull();
    expect(container.querySelector('section[aria-label="Portable backup"]')).toBeNull();
    expect(status.textContent).not.toContain("draft resumes automatically");
    expect(save.textContent).toBe("");
    expect(save.getAttribute("aria-label")).toBe("Save to library");
    expect(save.title).toBe("Save to library");
    expect(container.querySelector('[data-testid="button-open-library"]')).toBeNull();
    expect(container.querySelector('[data-testid="button-export-library"]')).toBeNull();
    expect(container.querySelector('[data-testid="button-import-library"]')).toBeNull();
    expect(fresh.textContent).toContain("New project");
    expect(save.disabled).toBe(false);
    expect(fresh.disabled).toBe(false);
    expect(manage.disabled).toBe(false);
    expect(manage.textContent).toBe("Manage Browser Library");
    expect(manage.previousElementSibling).toBe(fresh.closest('[role="group"]'));
    expect(save.closest('section')?.getAttribute("aria-label")).toBe("Browser library");
    for (const action of transfers) {
      expect(action.disabled).toBe(false);
      expect(action.closest('[role="group"]')).toBe(fresh.closest('[role="group"]'));
    }
    expect(container.querySelector('[data-testid="library-file-backup"]')).toBeNull();
    unmount();
  });

  it.each(["current-project-title", "project-status-title"])("names a new draft by double-clicking %s without exporting a backup", async (titleId) => {
    const { container, unmount } = renderPage();
    // The status title also works while Project is collapsed.
    if (titleId === "current-project-title") openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => projectSaveMock.onSaved?.(true));
    expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Draft — autosaved locally");

    React.act(() => {
      container.querySelector(`[data-testid="${titleId}"]`)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
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
    expect(ProjectPersistence.exportProjectLibrary).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="project-autosave-status"]')?.textContent,
    ).toContain("Socket wrench tray");
    expect(
      container.querySelector('[data-testid="button-save-library"]')?.getAttribute("aria-label"),
    ).toBe("Rename project");
    expect(container.querySelector('[data-testid="current-project-name-row"] [data-testid="button-save-library"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="current-project-name-row"] p[title]')?.textContent).toBe("Socket wrench tray");
    expect(container.querySelector('[data-testid="button-save-library"]')?.textContent).toBe("");
    React.act(() => projectSaveMock.onSaved?.(true));
    expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Saved to browser library");
    React.act(() => projectSaveMock.onSaved?.(false));
    expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Could not save. Export this project to keep your work.");
    unmount();
  });

  it("renames a saved project from its title, with Cancel preserving its name and identity", async () => {
    const project = { id: "current", name: "Stapler", updatedAt: "2026-09-20T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: project.id, projects: [project] });
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    const before = vi.mocked(useBinGeometry).mock.lastCall;
    const openName = () => {
      React.act(() => container.querySelector('[data-testid="current-project-title"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
      return document.querySelector<HTMLInputElement>('[data-testid="input-project-name"]')!;
    };
    const editName = (input: HTMLInputElement) => React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Stapler tray");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    let input = openName();
    expect(input.value).toBe("Stapler");
    editName(input);
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Cancel")!.click());
    expect(ProjectPersistence.saveProjectToLibrary).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="current-project-title"]')?.textContent).toBe("Stapler");
    input = openName();
    expect(input.value).toBe("Stapler");
    editName(input);
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-save-library"]')!.click());
    expect(ProjectPersistence.saveProjectToLibrary).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: PROJECT_SCHEMA_VERSION }), "Stapler tray", "current");
    expect(container.querySelector('[data-testid="current-project-title"]')?.textContent).toBe("Stapler tray");
    expect(container.querySelector('[data-testid="project-status-title"]')?.textContent).toBe("Stapler tray");
    expect(vi.mocked(useBinGeometry).mock.lastCall).toEqual(before);
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    unmount();
  });

  it("restores library identity before showing the project status or opening another project", async () => {
    const cutter = parseProjectDoc(ryobiReloadFixture)!;
    const projects = [
      { id: "cutter", name: "Ryobi Cutter", updatedAt: "2026-09-23T12:00:00.000Z" },
      { id: "other", name: "Other tray", updatedAt: "2026-09-23T12:00:00.000Z" },
    ];
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(cutter);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockImplementation(async (doc) => ({
      activeProjectId: doc === cutter ? "cutter" : null, projects,
    }));
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockResolvedValue({
      doc: EMPTY_PROJECT, project: projects[1], library: { activeProjectId: "other", projects },
    });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      React.act(() => projectSaveMock.onSaved?.(true));
      expect(ProjectPersistence.loadProjectLibrary).toHaveBeenCalledWith(cutter);
      expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Saved to browser library");
      expect(container.querySelector('[data-testid="current-project-title"]')!.textContent).toBe("Ryobi Cutter");
      // A later refresh reads the identity that restoration already persisted.
      vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "cutter", projects });
      await React.act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-other"]')!.click());
      expect(document.querySelector('[data-testid="button-discard-draft-open"]')).toBeNull();
      expect(ProjectPersistence.saveProjectDoc).toHaveBeenCalledWith(expect.objectContaining({ cutouts: cutter.cutouts }), "cutter");
      expect(ProjectPersistence.openProjectFromLibrary).toHaveBeenCalledWith("other");
    } finally { unmount(); }
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
          '[data-testid="button-manage-library"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).toContain(
      "Pliers tray",
    );
    const picker = document.querySelector('[role="dialog"]')!;
    expect(picker.textContent).toContain("Manage browser library");
    expect(picker.querySelector('[data-testid="button-export-library"]')).not.toBeNull();
    expect(picker.querySelector('[data-testid="button-import-library"]')).not.toBeNull();
    expect(picker.querySelector('[data-testid^="button-remove-project-"]')).not.toBeNull();
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

  it("keeps the manager scrollbar visible while its projects overflow", async () => {
    const projects = Array.from({ length: 8 }, (_, index) => ({
      id: `project-${index}`, name: `Project ${index}`, updatedAt: "2026-09-12T12:00:00.000Z",
    }));
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects });
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    const resizeCallbacks = new Set<() => void>();
    vi.stubGlobal("ResizeObserver", class implements ResizeObserver {
      private notify: () => void;
      constructor(callback: ResizeObserverCallback) { this.notify = () => callback([], this); }
      observe() { resizeCallbacks.add(this.notify); }
      unobserve() { resizeCallbacks.delete(this.notify); }
      disconnect() { resizeCallbacks.delete(this.notify); }
    });
    vi.useFakeTimers();
    try {
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      const scroll = document.querySelector('[data-testid="manage-library-scroll"]')!;
      const viewport = scroll.querySelector('[data-radix-scroll-area-viewport]')!;
      Object.defineProperties(viewport, {
        offsetHeight: { configurable: true, value: 120 },
        scrollHeight: { configurable: true, value: 600 },
      });
      await React.act(async () => {
        for (const resize of resizeCallbacks) resize();
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(scroll.querySelector('[data-orientation="vertical"]')?.getAttribute("data-state")).toBe("visible");
      await React.act(async () => {
        scroll.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(scroll.querySelector('[data-orientation="vertical"]')?.getAttribute("data-state")).toBe("visible");
      Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 80 });
      await React.act(async () => {
        for (const resize of resizeCallbacks) resize();
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(scroll.querySelector('[data-orientation="vertical"]')).toBeNull();
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("focuses and reveals the current project instead of the first library row", async () => {
    const currentId = 'current"[project]';
    const projects = [
      { id: "first", name: "First tray", updatedAt: "2026-09-12T12:00:00.000Z" },
      { id: currentId, name: "Current tray", updatedAt: "2026-09-12T12:00:00.000Z" },
    ];
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: currentId, projects });
    const reveal = vi.fn();
    const previousScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: reveal });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="managed-project-list"] [data-project-id]')];
      expect(document.activeElement).toBe(rows[1]);
      expect(rows[1].dataset.projectId).toBe(currentId);
      expect(rows[1].dataset.selected).toBe("true");
      expect(rows[0].dataset.selected).toBe("false");
      expect(reveal).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
      expect(reveal.mock.contexts.at(-1)).toBe(rows[1]);
    } finally {
      unmount();
      if (previousScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", previousScroll);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("adds an opened project file to the library and highlights it instead of the previous project", async () => {
    const previous = { id: "previous", name: "Previous tray", updatedAt: "2026-09-20T12:00:00.000Z" };
    const imported = { id: "imported", name: "Imported tray (imported)", updatedAt: "2026-09-21T12:00:00.000Z" };
    const doc = { ...EMPTY_PROJECT, name: "Imported tray", spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 4 }) };
    const savedLibrary = { activeProjectId: imported.id, projects: [previous, imported] };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(EMPTY_PROJECT);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: previous.id, projects: [previous] });
    vi.mocked(ProjectPersistence.importProjectToLibrary).mockImplementationOnce(async () => {
      vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue(savedLibrary);
      return { doc: { ...doc, name: imported.name }, project: imported, library: savedLibrary };
    });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      const file = new File([], "Imported tray.pocketry.json");
      Object.defineProperty(file, "text", { value: async () => JSON.stringify(doc) });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      expect(container.querySelector('[data-testid="current-project-title"]')?.textContent).toBe(imported.name);
      expect(ProjectPersistence.saveProjectDoc).toHaveBeenCalledWith(expect.objectContaining({ name: previous.name }), previous.id);
      expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledExactlyOnceWith(doc);
      expect(ProjectPersistence.startNewProject).not.toHaveBeenCalled();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(doc.spec);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await flushHydration();
      const row = document.querySelector<HTMLElement>('[data-testid="library-project-imported"]')!;
      expect(row.dataset.selected).toBe("true");
      expect(document.activeElement).toBe(row);
      expect(document.querySelector('[data-testid="library-project-previous"]')?.getAttribute("data-selected")).toBe("false");
      expect(document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-imported"]')!.disabled).toBe(true);
    } finally { unmount(); }
  });

  it("manages library removal separately, protects the open project, and preserves it when another is removed", async () => {
    const projects = [
      { id: "current", name: "Current tray", updatedAt: "2026-09-12T12:00:00.000Z" },
      { id: "old", name: "Old tray", updatedAt: "2026-09-11T12:00:00.000Z" },
    ];
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(EMPTY_PROJECT);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "current", projects });
    vi.mocked(ProjectPersistence.deleteProjectFromLibrary).mockResolvedValue({ activeProjectId: "current", projects: [projects[0]] });
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    const before = vi.mocked(useBinGeometry).mock.lastCall;
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Manage browser library");
    expect(document.querySelector('[data-testid="project-list"]')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-current"]')!.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-old"]')!.disabled).toBe(false);
    const current = document.querySelector<HTMLButtonElement>('[data-testid="button-remove-project-current"]')!;
    expect(current.disabled).toBe(true);
    expect(current.title).toBe("");
    expect(document.querySelector('[aria-label="About removing the current project"]')).toBeNull();
    React.act(() => current.click());
    expect(ProjectPersistence.deleteProjectFromLibrary).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    const remove = () => document.querySelector<HTMLButtonElement>('[data-testid="button-remove-project-old"]')!;
    React.act(() => remove().click());
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Old tray");
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Your current project will not change");
    const keep = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Keep project")!;
    React.act(() => keep.click());
    expect(ProjectPersistence.deleteProjectFromLibrary).not.toHaveBeenCalled();
    React.act(() => remove().click());
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-remove-project"]')!.click());
    expect(ProjectPersistence.deleteProjectFromLibrary).toHaveBeenCalledExactlyOnceWith("old");
    expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).not.toContain("Old tray");
    expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).toContain("Current tray");
    expect(container.querySelector('[data-testid="project-autosave-status"]')?.textContent).toContain("Current tray");
    expect(vi.mocked(useBinGeometry).mock.lastCall).toEqual(before);
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    expect(ProjectPersistence.startNewProject).not.toHaveBeenCalled();
    unmount();
  });

  it.each(["Open button", "double-click", "Enter"])("opens a saved project from Manage library using %s", async (action) => {
    const projects = [
      { id: "current", name: "Current tray", updatedAt: "2026-09-12T12:00:00.000Z" },
      { id: "saved", name: "Saved tray", updatedAt: "2026-09-11T12:00:00.000Z" },
    ];
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "current", projects });
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockResolvedValue({
      doc: EMPTY_PROJECT,
      project: projects[1],
      library: { activeProjectId: "saved", projects },
    });
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    const row = document.querySelector<HTMLElement>('[data-testid="library-project-saved"]')!;
    React.act(() => row.querySelector<HTMLElement>('p')!.click());
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("data-selected")).toBe("true");
    expect(document.querySelector('[data-testid="library-project-current"]')?.getAttribute("data-selected")).toBe("false");
    expect(container.querySelector('[data-testid="current-project-name-row"] p[title]')?.textContent).toBe("Current tray");
    React.act(() => {
      document.querySelector('[data-testid="library-project-current"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      document.querySelector('[data-testid="button-remove-project-saved"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    await React.act(async () => {
      if (action === "Open button") {
        document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-saved"]')!.click();
      } else if (action === "Enter") {
        row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      } else {
        document.querySelector('[data-testid="library-project-saved"] p')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      }
    });
    expect(ProjectPersistence.openProjectFromLibrary).toHaveBeenCalledExactlyOnceWith("saved");
    expect(document.querySelector('[data-testid="managed-project-list"]')).toBeNull();
    expect(container.querySelector('[data-testid="current-project-name-row"] p[title]')?.textContent).toBe("Saved tray");
    expect(ProjectPersistence.deleteProjectFromLibrary).not.toHaveBeenCalled();
    unmount();
  });

  it("guards repeated manager opens while busy and leaves the manager available after an open failure", async () => {
    const project = { id: "saved", name: "Saved tray", updatedAt: "2026-09-12T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects: [project] });
    let rejectOpen!: (error: Error) => void;
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockReturnValue(new Promise((_, reject) => { rejectOpen = reject; }));
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    const open = () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-saved"]')!;
    await React.act(async () => open().click());
    expect(open().disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-testid="button-remove-project-saved"]')!.disabled).toBe(true);
    React.act(() => document.querySelector('[data-testid="library-project-saved"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(ProjectPersistence.openProjectFromLibrary).toHaveBeenCalledExactlyOnceWith("saved");
    await React.act(async () => rejectOpen(new Error("Storage unavailable")));
    expect(document.querySelector('[data-testid="managed-project-list"]')).not.toBeNull();
    expect(open().disabled).toBe(false);
    expect(container.querySelector('[data-testid="current-project-name-row"] p[title]')?.textContent).toBe("Untitled project");
    unmount();
  });

  it.each(["Open button", "double-click", "Enter"])("protects an unnamed draft before opening with %s", async (action) => {
    const draft = parseProjectDoc(ryobiReloadFixture)!;
    const project = { id: "saved", name: "Saved tray", updatedAt: "2026-09-12T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(draft);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects: [project] });
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockResolvedValue({
      doc: EMPTY_PROJECT, project, library: { activeProjectId: project.id, projects: [project] },
    });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await flushHydration();
      const row = document.querySelector<HTMLElement>('[data-testid="library-project-saved"]')!;
      const requestOpen = async () => React.act(async () => {
        row.focus();
        if (action === "Open button") row.querySelector<HTMLButtonElement>('[data-testid="button-open-project-saved"]')!.click();
        else row.dispatchEvent(action === "Enter"
          ? new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
          : new MouseEvent("dblclick", { bubbles: true }));
      });
      await requestOpen();
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Replace the current draft?");
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Saved tray");
      expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(draft.cutouts);
      const keep = document.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!;
      expect(keep.textContent).toBe("Keep working");
      React.act(() => keep.click());
      // Radix restores focus after the closing focus scope has unmounted.
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.activeElement).toBe(row);
      expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
      await requestOpen();
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-discard-draft-open"]')!.click());
      expect(ProjectPersistence.openProjectFromLibrary).toHaveBeenCalledExactlyOnceWith("saved");
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.querySelector('[data-testid="managed-project-list"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([]);
    } finally { unmount(); }
  });

  it("protects settings-only drafts and preserves the confirmation and draft after a failed open", async () => {
    const draft = { ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 3 }) };
    const project = { id: "saved", name: "Saved tray", updatedAt: "2026-09-12T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(draft);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects: [project] });
    let rejectOpen!: (error: Error) => void;
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockReturnValue(new Promise((_, reject) => { rejectOpen = reject; }));
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-saved"]')!.click());
      expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
      const confirm = () => document.querySelector<HTMLButtonElement>('[data-testid="button-discard-draft-open"]')!;
      await React.act(async () => confirm().click());
      expect(confirm().disabled).toBe(true);
      expect(confirm().textContent).toBe("Opening…");
      React.act(() => confirm().click());
      expect(ProjectPersistence.openProjectFromLibrary).toHaveBeenCalledOnce();
      await React.act(async () => rejectOpen(new Error("Storage unavailable")));
      expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
      expect(confirm().disabled).toBe(false);
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(draft.spec);
      React.act(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!.click());
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.querySelector('[data-testid="managed-project-list"]')).not.toBeNull();
    } finally { unmount(); }
  });

  it.each(["{", JSON.stringify({ schemaVersion: 999 })])("rejects invalid project files without asking to replace the draft: %s", async (json) => {
    const draft = { ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 3 }) };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(draft);
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      const file = new File([json], "Invalid.pocketry.json");
      Object.defineProperty(file, "text", { value: async () => json });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(draft.spec);
    } finally { unmount(); }
  });

  it.each(["draft", "named"])("uses current %s work after a delayed project-file read", async (kind) => {
    if (kind === "named") {
      vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(EMPTY_PROJECT);
      vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "current", projects: [
        { id: "current", name: "Current tray", updatedAt: "2026-09-20T12:00:00.000Z" },
      ] });
    }
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      let finishRead!: (json: string) => void;
      const file = new File([], "Replacement.pocketry.json");
      Object.defineProperty(file, "text", { value: () => new Promise<string>((resolve) => { finishRead = resolve; }) });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      React.act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
      // Expand Size without the index closing/unmounting Project: this read
      // remains live while the current design is edited.
      const sizeTrigger = container.querySelector<HTMLButtonElement>('#bin-settings-size > [data-panel-section-trigger]')!;
      if (sizeTrigger.getAttribute("aria-expanded") === "false") React.act(() => sizeTrigger.click());
      const height = container.querySelector<HTMLInputElement>('[aria-label="Bin height in units"]')!;
      React.act(() => height.focus());
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(height, "9");
        height.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => height.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].heightUnits).toBe(9);
      await React.act(async () => finishRead(JSON.stringify(EMPTY_PROJECT)));
      if (kind === "draft") {
        expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Replace the current draft?");
        expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
        expect(vi.mocked(useBinGeometry).mock.lastCall![0].heightUnits).toBe(9);
        React.act(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!.click());
        expect(vi.mocked(useBinGeometry).mock.lastCall![0].heightUnits).toBe(9);
      } else {
        expect(ProjectPersistence.saveProjectDoc).toHaveBeenCalledWith(expect.objectContaining({
          spec: expect.objectContaining({ heightUnits: 9 }),
        }), "current");
        expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledExactlyOnceWith({ ...EMPTY_PROJECT, name: "Replacement" });
      }
    } finally { unmount(); }
  });

  it("ignores a superseded file read after the newer selected project opens", async () => {
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      let finishFirst!: (json: string) => void;
      const first = new File([], "First.pocketry.json");
      Object.defineProperty(first, "text", { value: () => new Promise<string>((resolve) => { finishFirst = resolve; }) });
      Object.defineProperty(input, "files", { value: [first], configurable: true });
      React.act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
      const second = new File([], "Second.pocketry.json");
      Object.defineProperty(second, "text", { value: async () => JSON.stringify(EMPTY_PROJECT) });
      Object.defineProperty(input, "files", { value: [second], configurable: true });
      await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      await React.act(async () => finishFirst(JSON.stringify(EMPTY_PROJECT)));
      expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledExactlyOnceWith({ ...EMPTY_PROJECT, name: "Second" });
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(container.querySelector('[data-testid="current-project-name-row"] p[title]')?.textContent).toBe("Second");
    } finally { unmount(); }
  });

  it("ignores a file read that finishes after the controls unmount", async () => {
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "project");
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
    let finishRead!: (json: string) => void;
    const file = new File([], "Replacement.pocketry.json");
    Object.defineProperty(file, "text", { value: () => new Promise<string>((resolve) => { finishRead = resolve; }) });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    React.act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    unmount();
    await React.act(async () => finishRead(JSON.stringify(EMPTY_PROJECT)));
    expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
    expect(ProjectPersistence.saveProjectDoc).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it.each(["library", "new"])("ignores a pending file after a later %s project choice", async (choice) => {
    const project = { id: "saved", name: "Saved tray", updatedAt: "2026-09-20T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects: [project] });
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockResolvedValue({
      doc: EMPTY_PROJECT, project, library: { activeProjectId: project.id, projects: [project] },
    });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      let finishRead!: (json: string) => void;
      const file = new File([], "Late.pocketry.json");
      Object.defineProperty(file, "text", { value: () => new Promise<string>((resolve) => { finishRead = resolve; }) });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      React.act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
      if (choice === "library") {
        React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
        await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-saved"]')!.click());
      } else {
        React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-new-project"]')!.click());
        await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-new-project"]')!.click());
      }
      const importsBeforeRead = vi.mocked(ProjectPersistence.importProjectToLibrary).mock.calls.length;
      await React.act(async () => finishRead(JSON.stringify(EMPTY_PROJECT)));
      expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledTimes(importsBeforeRead);
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(container.querySelector('[data-testid="current-project-name-row"] p[title]')?.textContent).toBe(choice === "library" ? "Saved tray" : "Untitled project");
    } finally { unmount(); }
  });

  it("keeps a nonempty draft and returns focus to Open project file when replacement is cancelled", async () => {
    const draft = parseProjectDoc(ryobiReloadFixture)!;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(draft);
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      const button = container.querySelector<HTMLButtonElement>('[data-testid="button-import-project"]')!;
      React.act(() => button.focus());
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      const json = JSON.stringify(EMPTY_PROJECT);
      const file = new File([json], "Replacement.pocketry.json");
      Object.defineProperty(file, "text", { value: async () => json });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Opening “Replacement”');
      expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
      React.act(() => document.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!.click());
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.activeElement).toBe(button);
      expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(draft.cutouts);
    } finally { unmount(); }
  });

  it("keeps the draft and validated file available when confirmed opening fails, then retries successfully", async () => {
    const draft = { ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 3 }) };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(draft);
    let rejectOpen!: (error: Error) => void;
    vi.mocked(ProjectPersistence.importProjectToLibrary).mockReturnValueOnce(new Promise((_, reject) => { rejectOpen = reject; }));
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      const json = JSON.stringify(EMPTY_PROJECT);
      const file = new File([json], "Replacement.pocketry.json");
      const readFile = vi.fn(async () => json);
      Object.defineProperty(file, "text", { value: readFile });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
      const confirm = () => document.querySelector<HTMLButtonElement>('[data-testid="button-discard-draft-open"]')!;
      await React.act(async () => confirm().click());
      expect(confirm().disabled).toBe(true);
      React.act(() => confirm().click());
      expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledExactlyOnceWith({ ...EMPTY_PROJECT, name: "Replacement" });
      await React.act(async () => rejectOpen(new Error("Storage unavailable")));
      expect(confirm().disabled).toBe(false);
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(draft.spec);
      await React.act(async () => confirm().click());
      expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledTimes(2);
      expect(readFile).toHaveBeenCalledOnce();
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(EMPTY_PROJECT.spec);
      expect(container.querySelector('[data-testid="current-project-name-row"] p[title]')?.textContent).toBe("Replacement");
    } finally { unmount(); }
  });

  it("opens a saved project directly from an untouched empty draft", async () => {
    const project = { id: "saved", name: "Saved tray", updatedAt: "2026-09-12T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects: [project] });
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockResolvedValue({
      doc: EMPTY_PROJECT, project, library: { activeProjectId: project.id, projects: [project] },
    });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-saved"]')!.click());
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(ProjectPersistence.openProjectFromLibrary).toHaveBeenCalledExactlyOnceWith("saved");
    } finally { unmount(); }
  });

  it.each(["current", "saved"])("copies the %s project after its source while retaining focus and the open design", async (id) => {
    const projects = [
      { id: "current", name: "Current tray", updatedAt: "2026-09-12T12:00:00.000Z" },
      { id: "saved", name: "Saved tray", updatedAt: "2026-09-11T12:00:00.000Z" },
    ];
    const project = { id: "copy", name: `${projects.find(project => project.id === id)!.name} (copy)`, updatedAt: "2026-09-12T13:00:00.000Z" };
    const copiedProjects = [...projects];
    copiedProjects.splice(projects.findIndex(project => project.id === id) + 1, 0, project);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "current", projects });
    vi.mocked(ProjectPersistence.duplicateProjectInLibrary).mockResolvedValue({ project, library: { activeProjectId: "current", projects: copiedProjects } });
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    const before = vi.mocked(useBinGeometry).mock.lastCall;
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    const copy = document.querySelector<HTMLButtonElement>(`[data-testid="button-duplicate-project-${id}"]`)!;
    expect(copy.disabled).toBe(false);
    await React.act(async () => copy.click());
    expect(ProjectPersistence.duplicateProjectInLibrary).toHaveBeenCalledExactlyOnceWith(id, expect.objectContaining({ schemaVersion: PROJECT_SCHEMA_VERSION }));
    const copiedRow = document.querySelector('[data-testid="library-project-copy"]')!;
    const sourceRow = document.querySelector(`[data-testid="library-project-${id}"]`)!;
    expect(copiedRow.textContent).toContain(project.name);
    expect(copiedRow.getAttribute("data-selected")).toBe("false");
    expect(sourceRow.getAttribute("data-selected")).toBe("true");
    expect(document.activeElement).toBe(sourceRow);
    expect(sourceRow.nextElementSibling).toBe(copiedRow);
    expect([...document.querySelectorAll('[data-testid="managed-project-list"] > [role="group"]')].map(row => row.getAttribute("aria-label"))).toEqual(copiedProjects.map(project => project.name));
    expect(container.querySelector('[data-testid="current-project-name-row"] p[title]')?.textContent).toBe("Current tray");
    expect(vi.mocked(useBinGeometry).mock.lastCall).toEqual(before);
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    expect(ProjectPersistence.saveProjectToLibrary).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>('[data-testid="button-remove-project-current"]')!.disabled).toBe(true);
    unmount();
  });

  it("disables copying while busy and leaves the library unchanged after a copy failure", async () => {
    const project = { id: "saved", name: "Saved tray", updatedAt: "2026-09-12T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "saved", projects: [project] });
    let rejectCopy!: (error: Error) => void;
    vi.mocked(ProjectPersistence.duplicateProjectInLibrary).mockReturnValue(new Promise((_, reject) => { rejectCopy = reject; }));
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    const copy = document.querySelector<HTMLButtonElement>('[data-testid="button-duplicate-project-saved"]')!;
    React.act(() => copy.click());
    expect(copy.disabled).toBe(true);
    const sourceRow = document.querySelector('[data-testid="library-project-saved"]')!;
    expect(document.activeElement).toBe(sourceRow);
    expect(document.querySelector<HTMLButtonElement>('[data-testid="button-rename-project-saved"]')!.disabled).toBe(true);
    await React.act(async () => rejectCopy(new Error("Storage unavailable")));
    expect(copy.disabled).toBe(false);
    expect(document.activeElement).toBe(sourceRow);
    expect(document.querySelectorAll('[data-testid="managed-project-list"] > [role="group"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="current-project-name-row"] p[title]')?.textContent).toBe("Saved tray");
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    unmount();
  });

  it.each(["current", "saved"])("renames the %s project from Manage library without switching designs", async (id) => {
    const projects = [
      { id: "current", name: "Current tray", updatedAt: "2026-09-12T12:00:00.000Z" },
      { id: "saved", name: "Saved tray", updatedAt: "2026-09-11T12:00:00.000Z" },
    ];
    const renamed = { activeProjectId: "current", projects: projects.map(project => project.id === id ? { ...project, name: "Renamed tray" } : project) };
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "current", projects });
    vi.mocked(ProjectPersistence.renameProjectInLibrary).mockResolvedValue(renamed);
    vi.mocked(ProjectPersistence.saveProjectToLibrary).mockResolvedValue(renamed);
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    const before = vi.mocked(useBinGeometry).mock.lastCall;
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    const rename = document.querySelector<HTMLButtonElement>(`[data-testid="button-rename-project-${id}"]`)!;
    expect(rename.disabled).toBe(false);
    expect(rename.parentElement?.getAttribute("data-testid")).toBe(`library-project-name-${id}`);
    React.act(() => rename.click());
    const input = document.querySelector<HTMLInputElement>('[data-testid="input-project-name"]')!;
    expect(input.value).toBe(projects.find(project => project.id === id)!.name);
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Renamed tray");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-save-library"]')!.click());
    if (id === "current") {
      expect(ProjectPersistence.saveProjectToLibrary).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: PROJECT_SCHEMA_VERSION }), "Renamed tray", "current");
      expect(ProjectPersistence.renameProjectInLibrary).not.toHaveBeenCalled();
    } else {
      expect(ProjectPersistence.renameProjectInLibrary).toHaveBeenCalledExactlyOnceWith("saved", "Renamed tray");
      expect(ProjectPersistence.saveProjectToLibrary).not.toHaveBeenCalled();
    }
    expect(document.querySelector('[data-testid="input-project-name"]')).toBeNull();
    expect(document.querySelector(`[data-testid="library-project-${id}"] p`)?.textContent).toBe("Renamed tray");
    expect(container.querySelector('[data-testid="current-project-name-row"] p[title]')?.textContent).toBe(id === "current" ? "Renamed tray" : "Current tray");
    expect(vi.mocked(useBinGeometry).mock.lastCall).toEqual(before);
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>('[data-testid="button-remove-project-current"]')!.disabled).toBe(true);
    unmount();
  });

  it("keeps the rename dialog and existing name after a failed manager rename", async () => {
    const project = { id: "saved", name: "Saved tray", updatedAt: "2026-09-12T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects: [project] });
    vi.mocked(ProjectPersistence.renameProjectInLibrary).mockRejectedValue(new Error("That name already exists."));
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-rename-project-saved"]')!.click());
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-save-library"]')!.click());
    expect(document.querySelector<HTMLInputElement>('[data-testid="input-project-name"]')!.value).toBe("Saved tray");
    expect(document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-save-library"]')!.disabled).toBe(false);
    expect(document.querySelector('[data-testid="library-project-saved"] p')?.textContent).toBe("Saved tray");
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    unmount();
  });

  it("allows removing a formerly open project after starting a new project", async () => {
    const project = { id: "saved", name: "Saved tray", updatedAt: "2026-09-12T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "saved", projects: [project] });
    vi.mocked(ProjectPersistence.startNewProject).mockResolvedValue({ activeProjectId: null, projects: [project] });
    vi.mocked(ProjectPersistence.deleteProjectFromLibrary).mockResolvedValue({ activeProjectId: null, projects: [] });
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-new-project"]')!.click());
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-new-project"]')!.click());
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects: [project] });
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    const remove = document.querySelector<HTMLButtonElement>('[data-testid="button-remove-project-saved"]')!;
    expect(remove.disabled).toBe(false);
    React.act(() => remove.click());
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-remove-project"]')!.click());
    expect(ProjectPersistence.deleteProjectFromLibrary).toHaveBeenCalledExactlyOnceWith("saved");
    expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).toContain("No named projects yet");
    unmount();
  });

  it("keeps a saved project in the manager when removal fails", async () => {
    const project = { id: "saved", name: "Saved tray", updatedAt: "2026-09-12T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects: [project] });
    vi.mocked(ProjectPersistence.deleteProjectFromLibrary).mockRejectedValue(new Error("Storage unavailable"));
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-remove-project-saved"]')!.click());
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-remove-project"]')!.click());
    expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).toContain("Saved tray");
    expect(document.querySelector<HTMLButtonElement>('[data-testid="button-remove-project-saved"]')!.disabled).toBe(false);
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    unmount();
  });

  it("exports the full library from Manage with the latest design snapshot", async () => {
    const backup = { format: "pocketry-library" as const, schemaVersion: 1 as const, projects: [] };
    vi.mocked(ProjectPersistence.exportProjectLibrary).mockResolvedValue(backup);
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[aria-label="Portable backup"] [data-testid="button-export-library"]')).toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    expect(document.querySelector('[role="dialog"] [data-testid="button-export-library"]')).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[data-testid="button-export-library"]'));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await React.act(async () => { (document.querySelector('[data-testid="button-export-library"]') as HTMLButtonElement).click(); });
    expect(ProjectPersistence.exportProjectLibrary).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: PROJECT_SCHEMA_VERSION }));
    expect(ProjectPersistence.saveProjectToLibrary).not.toHaveBeenCalled();
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
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
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
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
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("1 saved project");
    expect(ProjectPersistence.startNewProject).not.toHaveBeenCalled();
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).toContain("Imported tray");
    unmount();
  });

  it("disables project and library actions while exporting and recovers after an export error", async () => {
    let rejectExport!: (error: Error) => void;
    vi.mocked(ProjectPersistence.exportProjectLibrary).mockReturnValue(new Promise((_, reject) => { rejectExport = reject; }));
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
    const button = (action: string) => document.querySelector<HTMLButtonElement>(`[data-testid="button-${action}"]`)!;
    React.act(() => button("export-library").click());
    for (const action of ["save-library", "manage-library", "new-project", "export-project", "import-project", "export-library", "import-library"]) {
      expect(button(action).disabled).toBe(true);
    }
    expect(container.querySelector('[data-testid="project-status"]')?.textContent).toContain("Working");
    await React.act(async () => { rejectExport(new Error("Library unavailable")); });
    expect(button("export-library").disabled).toBe(false);
    expect(button("import-library").disabled).toBe(false);
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(ProjectPersistence.saveProjectToLibrary).not.toHaveBeenCalled();
    unmount();
  });

  it("rejects malformed library JSON before persistence", async () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    await flushHydration();
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
      "test wrench",
    );
    expect(container.textContent).toContain("Bench wrench");

    openSettingsSection(container, "export");
    const exportSection = container.querySelector("#bin-settings-export")!;
    expect(exportSection.querySelector("[data-panel-section-trigger]")?.textContent)
      .toMatch(/^Export/);
    expect(exportSection.textContent).toContain("Export shadow-board layout (top view)");
    expect(exportSection.querySelector('[data-testid="button-layout-dxf"]')).not.toBeNull();
    expect(exportSection.querySelector('[data-testid="button-layout-svg"]')).not.toBeNull();
    openSettingsSection(container, "check-fit");
    const fitSection = container.querySelector("#bin-settings-fit")!;
    expect(fitSection.textContent).toContain("Fit templates");
    expect(fitSection.querySelector('[data-testid="button-layout-dxf"]')).toBeNull();
    expect(fitSection.querySelector('[data-testid="button-layout-svg"]')).toBeNull();
    expect(container.textContent).toContain("Surface fit test");
    expect(container.querySelector('[data-testid="select-surface-fit-test-style"]')?.textContent).toBe("Tool outlines · 5 mm");
    expect(container.textContent).toContain("Save surface fit test STL");
    expect(
      (
        container.querySelector(
          '[data-testid="input-surface-fit-test-thickness"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("0.8");
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

    // Finger access features live in their own object list and selection context.
    openSettingsSection(container, "finger-holes");
    const addFingerHole = container.querySelector(
      '[data-testid="button-add-finger-hole"]',
    ) as HTMLButtonElement;
    React.act(() => addFingerHole.click());
    expect(container.querySelector('[data-testid="finger-shape-slot"]')?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[data-testid="finger-bottom-curved"]')?.getAttribute("aria-checked")).toBe("true");
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
      fingerHoleSection?.querySelector('[aria-label="Bottom edge round"]'),
    ).toBeNull();

    React.act(() => {
      (container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid^="finger-hole-oblong-deep-scoop-"]')).not.toBeNull();
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
    expect(container.querySelector('[data-testid^="finger-hole-oblong-deep-scoop-"]')).not.toBeNull();
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
    expect(container.querySelector('[data-testid="bin-settings-jump-materials-&-colors"]')?.textContent)
      .toBe("Materials & Colors");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-materials-&-colors"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container.querySelector("#bin-settings-materials [data-panel-section-trigger]")
        ?.textContent,
    ).toContain("2 colors");
    expect(container.querySelector("#bin-settings-materials [data-panel-section-trigger]")?.textContent)
      .toContain("Materials & Colors");
    unmount();
  });

  it.each([
    ["standard", "45.6"],
    ["none", "42.0"],
  ] as const)("shows the outer printed dimensions in STL and 3MF confirmations with %s lip", async (lip, height) => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 2, gridY: 3, heightUnits: 6, lip }),
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "export");
    for (const format of ["3mf", "stl"]) {
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="button-export-${format}"]`)!.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain(`Outer size: 83.5 × 125.5 × ${height} mm (width × length × height).`);
      if (format === "3mf") expect(document.activeElement).toBe(dialog.querySelector('h2'));
      React.act(() => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Cancel")!.click());
    }
    expect(binGeometryMock.buildOnce).not.toHaveBeenCalled();
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

describe("project history restoration", () => {
  const material = (width: number) => ({
    spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: width }), cutouts: [], fingerHoles: [],
  });
  const history = { stack: [
    { doc: material(2), label: "Start" },
    { doc: material(3), label: "Widen tray" },
    { doc: material(4), label: "Widen again" },
  ], index: 1 };
  const a: ProjectDoc = { ...EMPTY_PROJECT, ...material(3), history, name: "A" };
  const button = (container: HTMLElement, action: string) =>
    container.querySelector<HTMLButtonElement>(`[data-testid="button-bin-${action}"]`)!;

  it.each([false, true])("restores the cursor and undo/redo controls after A → B → A (mobile: %s)", async (mobile) => {
    const projects = ["A", "B"].map(id => ({ id, name: id, updatedAt: "2026-09-13T12:00:00.000Z" }));
    let activeProjectId = "A";
    const saved = new Map([["A", a], ["B", { ...EMPTY_PROJECT, name: "B" }]]);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(a);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId, projects });
    vi.mocked(ProjectPersistence.saveProjectDoc).mockImplementation(async (doc, id) => {
      expect(id).toBe(activeProjectId);
      const parsed = parseProjectDoc(JSON.parse(JSON.stringify(doc)));
      expect(parsed).not.toBeNull();
      saved.set(id!, parsed!);
      return true;
    });
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockImplementation(async id => {
      activeProjectId = id;
      return { doc: saved.get(id)!, project: projects.find(project => project.id === id)!,
        library: { activeProjectId, projects } };
    });
    const { container, unmount } = renderPage({ mobile });
    try {
      await flushHydration();
      expect(button(container, "undo").getAttribute("aria-label")).toBe("Undo Widen tray");
      expect(button(container, "redo").getAttribute("aria-label")).toBe("Redo Widen again");
      React.act(() => button(container, "redo").click());
      React.act(() => button(container, "undo").click());
      if (mobile) {
        React.act(() => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Adjust")!.click());
        React.act(() => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "More settings")!.click());
      }
      openSettingsSection(document.body, "project");
      const open = async (id: string) => {
        React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
        await React.act(async () => document.querySelector<HTMLButtonElement>(`[data-testid="button-open-project-${id}"]`)!.click());
      };
      await open("B");
      expect(button(container, "undo").disabled).toBe(true);
      expect(button(container, "redo").disabled).toBe(true);
      await open("A");
      expect(button(container, "undo").getAttribute("aria-label")).toBe("Undo Widen tray");
      expect(button(container, "redo").getAttribute("aria-label")).toBe("Redo Widen again");
      React.act(() => button(container, "undo").click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].gridX).toBe(2);
      expect(button(container, "undo").disabled).toBe(true);
      React.act(() => button(container, "redo").click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].gridX).toBe(3);
      expect(saved.get("A")!.history).toEqual(history);
    } finally { unmount(); }
  });

  it("restores exported history through the project file input and preserves it in new exports", async () => {
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(document.body, "project");
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      const file = new File([JSON.stringify(a)], "A.pocketry.json");
      Object.defineProperty(file, "text", { value: async () => JSON.stringify(a) });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      expect(button(container, "undo").getAttribute("aria-label")).toBe("Undo Widen tray");
      expect(button(container, "redo").getAttribute("aria-label")).toBe("Redo Widen again");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
      const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
      const json = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blob);
      });
      expect(parseProjectDoc(JSON.parse(json))?.history).toEqual(history);
    } finally { unmount(); }
  });
});

it("enables restored experimental designs, then respects manual disabling without changing the design", async () => {
  const shape = rectangularShape("experimental-shape", "Target");
  const cutouts = [-18, 18].map((x, i) => parseCutoutPlacement({
    id: `experimental-${i}`, name: `Target ${i}`, shapeId: shape.id, position: { x, y: 0 },
    tilt: { xDeg: 15, yDeg: 0 }, depth: { mode: "mm", value: 8 }, designLink: { id: "targets" },
  }));
  const hole = fingerHoleSchema.parse({ id: "access", name: "Access", center: { x: 0, y: 26 }, designLink: { id: "access-design" } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts, fingerHoles: [hole] });
  const { container, unmount } = renderPage({ experimental: false });
  try {
    await flushHydration();
    const before = structuredClone(vi.mocked(useBinGeometry).mock.lastCall![2]);
    expect(container.querySelector('[data-experimental-editor="true"]')).not.toBeNull();
    expect(projectToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Experimental features enabled" }));
    React.act(() => experimentalSettings.setEnabled(false));
    expect(container.querySelector('[data-experimental-editor="false"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="experimental-design-notice"]')).not.toBeNull();
    openSettingsSection(container, "tool-cutouts"); selectPocket(container, cutouts[0].id);
    expect(container.querySelector('[aria-label="Linked design"]')).toBeNull();
    expect(container.querySelector('[data-testid="pocket-tilt-controls"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Include Target"]')).toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="button-select-${cutouts[1].id}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })));
    expect(container.querySelector(`[data-testid="button-select-${cutouts[0].id}"]`)?.getAttribute("aria-pressed")).toBe("false");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true })));
    expect(container.querySelector('[data-testid="pocket-3d-controls"]')).toBeNull();

    React.act(() => experimentalSettings.setEnabled(true));
    expect(container.querySelector('[aria-label="Linked design"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pocket-tilt-controls"]')).not.toBeNull();
    React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Target 0 in selection"]')!.click());
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Object controls"]')!.click());
    expect(container.querySelector('[data-testid="pocket-3d-controls"]')).not.toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-3d"]')!.click());
    expect(container.querySelector('[data-experimental-editor="true"]')).not.toBeNull();

    React.act(() => experimentalSettings.setEnabled(false));
    expect(container.querySelector('[data-experimental-editor="false"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Linked design"]')).toBeNull();
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]).toEqual(before);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    openSettingsSection(container, "project");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
    const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
    const json = await new Promise<string>(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
    });
    const exported = parseProjectDoc(JSON.parse(json))!;
    expect(exported.cutouts).toEqual(cutouts); expect(exported.fingerHoles).toEqual([hole]);
    expect(localStorage.getItem(EXPERIMENTAL_FEATURES_KEY)).toBe("false");
  } finally { unmount(); }
});

it.each(["release", "Escape", "blur", "pointercancel", "disable experimental"])("%s of a mixed selection drag is one atomic edit or a complete cancellation", async ending => {
  const shape = rectangularShape("multi-shape", "Test pocket");
  const cutouts = [-18, 18].map((x, i) => parseCutoutPlacement({ id: `multi-${i}`, name: `Multi ${i}`, shapeId: shape.id, position: { x, y: 0 } }));
  const hole = fingerHoleSchema.parse({ id: "multi-finger", name: "Test thumb", center: { x: 0, y: 26 }, diameterMm: 8, depthMm: 8 });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts, fingerHoles: [hole] });
  const { container, unmount } = renderPage();
  await flushHydration();
  React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
  openSettingsSection(container, "tool-cutouts");
  for (const name of ["Multi 0", "Multi 1"]) React.act(() => container.querySelector<HTMLInputElement>(`[aria-label="Include ${name} in selection"]`)!.click());
  openSettingsSection(container, "finger-holes");
  React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Test thumb in selection"]')!.click());
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Object controls"]')!.click());
  expect(container.querySelector('[data-testid="pocket-3d-controls"]')?.textContent).toContain("3 objects selected");
  const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
  Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
  Object.defineProperties(svg, {
    createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
    setPointerCapture: { value: () => {} },
  });
  const path = () => svg.querySelector('[data-cutout-id="multi-0"]')!.getAttribute('d');
  const beforePath = path();
  const pointer = (type: string, x: number, y: number) => React.act(() => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, altKey: true });
    Object.defineProperty(event, 'pointerId', { value: 5 }); svg.dispatchEvent(event);
  });
  pointer('pointerdown', 23.75, 41.75); pointer('pointermove', 33.75, 35.75);
  expect(path()).not.toBe(beforePath);
  if (ending === "Escape") React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  else if (ending === "blur") React.act(() => window.dispatchEvent(new Event("blur")));
  else if (ending === "disable experimental") React.act(() => experimentalSettings.setEnabled(false));
  else pointer(ending === "release" ? "pointerup" : "pointercancel", 33.75, 35.75);
  const undo = container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!;
  if (ending === "release") {
    const current = vi.mocked(useBinGeometry).mock.lastCall![2]!;
    expect(current.cutouts.map(c => c.position)).toEqual([{ x: -8, y: 6 }, { x: 28, y: 6 }]);
    expect(current.fingerHoles[0].center).toEqual({ x: 10, y: 32 });
    expect(undo.disabled).toBe(false); React.act(() => undo.click());
  }
  expect(undo.disabled).toBe(true); expect(path()).toBe(beforePath);
  unmount();
});


it.each(["backup", "library"])("enables experimental tools and notifies when opening a %s", async source => {
  const project = { id: "saved", name: "Linked access", updatedAt: "2026-09-23T12:00:00.000Z" };
  const doc: ProjectDoc = { ...EMPTY_PROJECT, name: project.name, fingerHoles: [
    fingerHoleSchema.parse({ id: "access", center: { x: 0, y: 0 }, designLink: { id: "linked-access" } }),
  ] };
  vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects: [project] });
  vi.mocked(ProjectPersistence.openProjectFromLibrary).mockResolvedValue({
    doc, project, library: { activeProjectId: project.id, projects: [project] },
  });
  const { container, unmount } = renderPage({ experimental: false });
  try {
    await flushHydration();
    expect(experimentalSettings.enabled).toBe(false);
    expect(projectToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Experimental features enabled" }));
    openSettingsSection(container, "project");
    if (source === "backup") {
      const json = JSON.stringify(doc);
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      const file = new File([json], "Linked access.pocketry.json");
      Object.defineProperty(file, "text", { value: async () => json });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledOnce();
    } else {
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-saved"]')!.click());
      expect(ProjectPersistence.openProjectFromLibrary).toHaveBeenCalledExactlyOnceWith("saved");
    }
    expect(experimentalSettings.enabled).toBe(true);
    expect(localStorage.getItem(EXPERIMENTAL_FEATURES_KEY)).toBe("true");
    expect(projectToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Experimental features enabled" }));
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles).toEqual(doc.fingerHoles);
  } finally { unmount(); }
});


it.each(["shiftKey", "ctrlKey"])("adds and removes pockets with %s mouse clicks in Layout", async modifier => {
  const shape = rectangularShape("mouse-shape", "Mouse pocket");
  const cutouts = [-18, 18].map((x, i) => parseCutoutPlacement({ id: `mouse-${i}`, shapeId: shape.id, position: { x, y: 0 } }));
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
      setPointerCapture: { value: () => {} }, releasePointerCapture: { value: () => {} },
    });
    const click = (x: number, additive: boolean) => React.act(() => {
      for (const type of ["pointerdown", "pointerup"]) {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 41.75, [modifier]: additive });
        Object.defineProperty(event, "pointerId", { value: 11 }); svg.dispatchEvent(event);
      }
    });
    click(23.75, false); click(59.75, true);
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Object controls"]')!.click());
    expect(container.querySelector('[data-testid="pocket-3d-controls"]')?.textContent).toContain("2 objects selected");
    click(23.75, true);
    expect(container.querySelector('[data-testid="pocket-3d-controls"]')?.textContent).toContain("1 object selected");
  } finally { unmount(); }
});

it("opens Layout object controls with W/E and returns from Links or Arrange to the same mode", async () => {
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const button = (name: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
    for (const [key, mode] of [["w", "Move pocket (W)"], ["e", "Rotate pocket (E)"]] as const) {
      React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key })));
      expect(button(mode).getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelector('[data-testid="layout-add-pocket"]')).toBeNull();
      expect(container.querySelector('.bin-canvas-guidance')).toBeNull();
      for (const tab of ["Link and unlink designs", "Align and distribute objects"]) {
        React.act(() => button(tab).click());
        React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key })));
        expect(button(mode).getAttribute("aria-pressed")).toBe("true");
      }
    }
    React.act(() => button("Close object controls").click());
    expect(container.querySelector('[data-testid="layout-add-pocket"]')).not.toBeNull();
    React.act(() => experimentalSettings.setEnabled(false));
    React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })));
    expect(container.querySelector('[data-testid="pocket-3d-controls"]')).toBeNull();
  } finally { unmount(); }
});

it("rejects overflowing numeric moves without corrupting the document or undo history", async () => {
  const shape = rectangularShape("overflow-shape", "Overflow pocket");
  const cutout = parseCutoutPlacement({ id: "overflow-pocket", shapeId: shape.id, position: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    openSettingsSection(container, "tool-cutouts"); selectPocket(container, cutout.id);
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Object controls"]')!.click());
    const input = container.querySelector<HTMLInputElement>('[aria-label="Move X by"]')!;
    for (const value of ["1e308", "-1e308"]) {
      React.act(() => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => input.blur());
      expect(container.querySelector('[data-testid="pocket-3d-controls"] [role="status"]')?.textContent).toContain("movement is too large");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]?.cutouts).toEqual([cutout]);
    }
  } finally { unmount(); }
});

it.each([false, true])("prototype has one object list and preserves identity when reopening properties on mobile=%s", async mobile => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", "/bin?inspector=1");
  const shape = rectangularShape("workflow-tool", "Tool");
  const cutouts = [0, 1].map(i => parseCutoutPlacement({ id: `workflow-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id, position: { x: i * 40 - 20, y: 0 } }));
  const finger = fingerHoleSchema.parse({ id: "workflow-f", name: "Thumb access", center: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6 }), shapes: [shape], cutouts, fingerHoles: [finger] });
  const { container, unmount } = renderPage({ mobile, experimental: false });
  try {
    await flushHydration();
    const workflow = container.querySelector<HTMLElement>('#workflow-panel')!;
    const inspector = container.querySelector<HTMLElement>('[data-testid="selection-inspector"]')!;
    const leftScroll = workflow.querySelector('#bin-settings-pockets')!.parentElement!;
    expect(inspector.querySelector('[data-testid="object-list-scroll"]')).toBeNull();
    leftScroll.scrollTop = 230;
    const leftButton = (kind: string, id: string) => workflow.querySelector<HTMLButtonElement>(`[data-testid="button-select-${kind === "finger" ? "finger-hole-" : ""}${id}"]`)!;
    const click = (label: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
    const showWorkflow = () => { if (workflow.hidden) React.act(() => container.querySelector<HTMLButtonElement>('nav[aria-label="Editor panels"] button[aria-controls="workflow-panel"]')!.click()); };
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    expect(workflow.querySelectorAll('button[data-testid^="button-select-"]')).toHaveLength(3);
    expect(workflow.querySelector('[aria-label^="Rename "]')).toBeNull();
    expect(workflow.textContent).toContain('Add simple pocket');
    React.act(() => leftButton('pocket', 'workflow-0').click());
    expect(leftButton('pocket', 'workflow-0').getAttribute('aria-pressed')).toBe('true');
    expect(workflow.querySelector<HTMLInputElement>('[aria-label="Include Tool 1 in selection"]')!.checked).toBe(true);
    expect(inspector.querySelector('#pocket-properties')!.closest('[hidden]')).toBeNull();
    expect(workflow.hidden).toBe(mobile);

    // Choosing the same item must reopen the inspector and leave a transform tool.
    click('Rotate selected objects');
    click('Collapse properties panel');
    showWorkflow();
    React.act(() => leftButton('pocket', 'workflow-0').click());
    expect(inspector.closest('[hidden]')).toBeNull();
    expect(inspector.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe('Tool 1');

    // The same tree supports both single and additive selection.
    selectPocket(container, 'workflow-1');
    expect(leftButton('pocket', 'workflow-0').getAttribute('aria-pressed')).toBe('false');
    expect(leftButton('pocket', 'workflow-1').getAttribute('aria-pressed')).toBe('true');
    showWorkflow();
    React.act(() => leftButton('finger', 'workflow-f').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
    expect(inspector.querySelector('[data-testid="batch-properties"]')).not.toBeNull();
    expect(workflow.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
    showWorkflow();
    React.act(() => leftButton('finger', 'workflow-f').click());
    expect(leftButton('pocket', 'workflow-1').getAttribute('aria-pressed')).toBe('false');
    expect(leftButton('finger', 'workflow-f').getAttribute('aria-pressed')).toBe('true');
    expect(inspector.querySelector('#finger-access-properties')!.closest('[hidden]')).toBeNull();
    expect(workflow.querySelector('#pocket-properties, #finger-access-properties')).toBeNull();
    showWorkflow();
    React.act(() => workflow.querySelector<HTMLInputElement>('[aria-label="Include Tool 1 in selection"]')!.click());
    expect(workflow.hidden).toBe(false);
    expect(workflow.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
    expect(leftScroll.scrollTop).toBe(230);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it("keeps finger-access guidance beside the collapsed section title without toggling it", async () => {
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    const section = container.querySelector<HTMLElement>('#bin-settings-finger-holes')!;
    const toggle = section.querySelector<HTMLButtonElement>('[data-panel-section-trigger]')!;
    const hint = section.querySelector<HTMLButtonElement>('[aria-label="About finger access"]')!;
    expect(hint.closest('[data-panel-section-header]')).toBe(toggle.parentElement);
    expect(toggle.contains(hint)).toBe(false);
    expect(section.dataset.state).toBe('closed');
    await React.act(async () => hint.click());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Allow room beside the tool');
    expect(section.dataset.state).toBe('closed');
    React.act(() => hint.click());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    React.act(() => toggle.click());
    expect(section.dataset.state).toBe('open');
    expect(section.querySelector('[aria-label="About openings"]')).toBeNull();
  } finally { unmount(); }
});

it("prototype keeps selection and list position while batch editing, undoing and switching panels", async () => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", "/bin?inspector=1");
  const shape = rectangularShape("proto", "Tool");
  const cutouts = [10, 20].map((value, i) => parseCutoutPlacement({ id: `proto-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id, position: { x: i * 40 - 20, y: 0 }, depth: { mode: "mm", value } }));
  const finger = fingerHoleSchema.parse({ id: "proto-f", name: "Tool access", center: { x: 0, y: 0 }, depthMm: 8 });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6 }), shapes: [shape], cutouts, fingerHoles: [finger] });
  const { container, unmount } = renderPage({ experimental: false });
  try {
    await flushHydration();
    const clickText = (text: string, within: ParentNode = container) => React.act(() => [...within.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!.click());
    const choose = (name: string) => React.act(() => container.querySelector<HTMLInputElement>(`[aria-label="Include ${name} in selection"]`)!.click());
    const list = container.querySelector('[data-testid="object-list-scroll"]')!;
    list.scrollTop = 150;
    selectPocket(container, 'proto-0');
    expect(container.querySelector('#pocket-properties')!.closest('[data-testid="selection-inspector"]')).not.toBeNull();
    const header = container.querySelector('[data-testid="inspector-properties-header"]')!;
    expect(header.querySelector('h3')?.textContent).toBe('Tool 1');
    expect(container.querySelector('[aria-label="Pocket cut depth in millimetres"]')).not.toBeNull();
    expect(container.querySelector<HTMLDetailsElement>('[data-testid="pocket-clearance-settings"]')!.open).toBe(false);
    expect(container.querySelector('#pocket-properties')!.lastElementChild?.getAttribute('data-testid')).toBe('pocket-clearance-settings');
    expect(container.querySelector('[aria-label="Top edge rounding in millimetres"]')!.closest('details')!.dataset.testid).toBe('pocket-edge-settings');
    expect(header.querySelector('[aria-label="Duplicate selection"]')).toBeNull();
    expect(list.querySelector('[aria-label="Actions for Tool 1"]')).not.toBeNull();
    expect(list.scrollTop).toBe(150);
    choose('Tool 2'); choose('Tool access');
    expect(container.querySelector('#pocket-properties')).toBeNull();
    const inspector = container.querySelector('[data-testid="selection-inspector"]')!;
    expect(inspector.textContent).toContain('3 selected');
    const input = inspector.querySelector<HTMLInputElement>('[aria-label="Fixed cut depth for selected pockets"]')!;
    expect(input.value).toBe(''); expect(input.placeholder).toBe('Mixed');
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '14');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => inspector.querySelector<HTMLButtonElement>('[aria-label="Apply fixed cut depth to selected pockets"]')!.click());
    const doc = () => ({ cutouts: vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts, fingers: vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles });
    expect(doc().cutouts.map(c => c.depth)).toEqual([{ mode: 'mm', value: 14 }, { mode: 'mm', value: 14 }]);
    expect(doc().fingers).toEqual([finger]);
    expect(inspector.textContent).toContain('3 selected'); expect(list.scrollTop).toBe(150);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(doc().cutouts.map(c => c.depth)).toEqual(cutouts.map(c => c.depth));
    expect(inspector.textContent).toContain('3 selected');
    const workflow = container.querySelector('#workflow-panel')!;
    expect(workflow.querySelector('[aria-label="Choose a pocket to edit"]')).not.toBeNull();
    expect(workflow.querySelector('#bin-settings-pockets')).not.toBeNull();
    expect(workflow.querySelector('#bin-settings-size, #bin-settings-project, #bin-settings-export')).toBeNull();
    const clickLabel = (label: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
    clickLabel('Collapse objects panel');
    expect(workflow.hasAttribute('hidden')).toBe(true);
    expect(inspector.querySelector('[data-testid="batch-properties"]')).not.toBeNull();
    clickLabel('Expand objects panel');
    expect(container.querySelectorAll('[aria-label^="Include "]:checked')).toHaveLength(3);
    clickText('Layout');
    expect(inspector.querySelector('[data-testid="pocket-3d-controls"]')).not.toBeNull();
    expect(inspector.querySelector('[aria-label="Objects in selection"]')).toBeNull();
    clickLabel('Collapse properties panel');
    clickLabel('Rotate selected objects');
    expect(inspector.closest('[hidden]')).toBeNull();
    expect(inspector.querySelector('[aria-label="Rotate Z by"]')).not.toBeNull();
    expect(header.querySelector('h3')?.textContent).toBe('3 selected');
    expect(inspector.querySelector('[data-testid="inspector-active-tool"]')!.textContent).toContain('Rotate');
    expect(header.querySelector('[aria-label="Duplicate selection"]')).not.toBeNull();
    clickLabel('Back to properties');
    expect(inspector.querySelector('[data-testid="batch-properties"]')!.closest('[hidden]')).toBeNull();
    clickLabel('Move selected objects');
    const moveX = inspector.querySelector<HTMLInputElement>('[aria-label="Move X by"]')!;
    React.act(() => {
      moveX.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(moveX, '5');
      moveX.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(doc().cutouts.map(c => c.position)).toEqual(cutouts.map(c => c.position));
    React.act(() => moveX.blur());
    expect(doc().cutouts.map(c => c.position.x)).toEqual(cutouts.map(c => c.position.x + 5));
    expect(doc().fingers[0].center.x).toBe(finger.center.x + 5);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(doc().cutouts.map(c => c.position)).toEqual(cutouts.map(c => c.position));
    expect(doc().fingers).toEqual([finger]);
    expect(moveX.value).toBe('0');
    expect(list.scrollTop).toBe(150);
    clickLabel('Arrange selected objects');
    expect(inspector.querySelector('[aria-label="Align top edges"]')?.textContent).toBe('');
    clickLabel('Align horizontal centers');
    expect(doc().cutouts[0].position.x).toBe(doc().cutouts[1].position.x);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(doc().cutouts.map(c => c.position)).toEqual(cutouts.map(c => c.position));
    expect(list.scrollTop).toBe(150);
    selectPocket(container, 'proto-0');
    expect(container.querySelector('#pocket-properties')!.closest('[hidden]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Arrange selected objects"]')!.disabled).toBe(true);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each([false, true])("prototype toolbar opens scoped link/unlink controls with undo on mobile=%s", async mobile => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', '/bin?inspector=1');
  const shape = rectangularShape('toolbar-links', 'Tool');
  const cutouts = [10, 20].map((value, i) => parseCutoutPlacement({ id: `linked-tool-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id,
    position: { x: i * 40 - 20, y: 0 }, depth: { mode: 'mm', value } }));
  const finger = fingerHoleSchema.parse({ id: 'toolbar-access', name: 'Tool access', center: { x: 0, y: 0 }, depthMm: 8 });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6 }), shapes: [shape], cutouts, fingerHoles: [finger] });
  const { container, unmount } = renderPage({ mobile, experimental: false });
  try {
    await flushHydration();
    const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    const click = (label: string) => React.act(() => button(label)!.click());
    const choose = (name: string) => React.act(() => container.querySelector<HTMLInputElement>(`[aria-label="Include ${name} in selection"]`)!.click());
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    expect(button('Link and unlink selected objects')!.disabled).toBe(true);
    selectPocket(container, cutouts[0].id);
    expect(button('Link and unlink selected objects')!.disabled).toBe(true);
    choose('Tool 2'); choose('Tool access');
    expect(button('Arrange selected objects')!.nextElementSibling).toBe(button('Link and unlink selected objects'));
    click('Collapse properties panel');
    click('Link and unlink selected objects');
    const inspector = container.querySelector('[data-testid="selection-inspector"]')!;
    const header = () => inspector.querySelector('[data-testid="inspector-active-tool"] span')!.textContent;
    const controls = () => inspector.querySelector('[data-testid="inspector-transforms"]')!;
    const action = (text: string) => React.act(() => [...controls().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!.click());
    const doc = () => ({ cutouts: vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts, fingers: vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles });
    expect(inspector.closest('[hidden]')).toBeNull();
    expect(header()).toBe('Linked designs');
    expect(button('Link and unlink selected objects')!.getAttribute('aria-pressed')).toBe('true');
    expect(controls().querySelector('[aria-label="Move X by"]')).toBeNull();
    expect(controls().querySelectorAll('[aria-label="Linked design"]')).toHaveLength(2);
    const source = controls().querySelector<HTMLSelectElement>('[aria-label="Linked design source"]')!;
    expect(source.value).toBe(cutouts[1].id);
    React.act(() => { source.value = cutouts[0].id; source.dispatchEvent(new Event('change', { bubbles: true })); });
    action('Link 2 pockets');
    expect(doc().cutouts[0].designLink?.id).toBeTruthy();
    expect(doc().cutouts[1].designLink).toEqual(doc().cutouts[0].designLink);
    expect(doc().cutouts.map(c => c.depth)).toEqual([cutouts[0].depth, cutouts[0].depth]);
    expect(doc().cutouts.map(c => ({ name: c.name, position: c.position }))).toEqual(cutouts.map(c => ({ name: c.name, position: c.position })));
    expect(doc().fingers).toEqual([finger]);
    action('Unlink 2 pockets');
    expect(doc().cutouts.every(c => !c.designLink)).toBe(true);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(doc().cutouts.every(c => c.designLink)).toBe(true);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(doc().cutouts).toEqual(cutouts);
    expect(container.querySelectorAll('[aria-label^="Include "]:checked')).toHaveLength(3);
    React.act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })));
    expect(header()).toBe('Move');
    expect(button('Link and unlink selected objects')!.getAttribute('aria-pressed')).toBe('false');
    click('Link and unlink selected objects');
    choose('Tool access'); choose('Tool 2');
    expect(button('Link and unlink selected objects')!.disabled).toBe(true);
    expect(header()).toBe('Properties');
    expect(container.querySelector('#pocket-properties')!.closest('[hidden]')).toBeNull();
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it("prototype compact panels preserve canvas, selection and header actions", async () => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', '/bin?inspector=1');
  const shape = rectangularShape('proto-mobile', 'Mobile tool');
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [parseCutoutPlacement({ id: 'mobile-p', shapeId: shape.id, position: { x: 0, y: 0 } })] });
  const { container, unmount } = renderPage({ mobile: true });
  try {
    await flushHydration();
    const panel = (id: string) => React.act(() => container.querySelector<HTMLButtonElement>(`nav[aria-label="Editor panels"] button[aria-controls="${id}"]`)!.click());
    const canvas = container.querySelector('[data-testid="inspector-workspace-canvas"]')!;
    const workflow = container.querySelector('#workflow-panel')!;
    expect(workflow.hasAttribute('hidden')).toBe(true);
    panel('workflow-panel');
    expect(workflow.hasAttribute('hidden')).toBe(false);
    selectPocket(container, 'mobile-p');
    expect(container.querySelector('#pocket-properties')!.closest('[hidden]')).toBeNull();
    expect(workflow.hasAttribute('hidden')).toBe(true);
    panel('workflow-panel');
    expect(workflow.hasAttribute('hidden')).toBe(false);
    panel('objects-panel');
    expect(container.querySelector('[data-testid="inspector-workspace-canvas"]')).toBe(canvas);
    expect(canvas.closest('#workflow-panel, #objects-panel, [role="dialog"]')).toBeNull();
    const selected = () => container.querySelector<HTMLInputElement>('[aria-label="Include Mobile tool in selection"]')!.checked;
    expect(selected()).toBe(true);
    const header = container.querySelector('[data-testid="editor-project-header"]')!;
    for (const label of ['Check fit', 'Export', 'Project']) {
      React.act(() => [...header.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!.click());
      await flushHydration();
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain(label);
      if (label === 'Export') expect(dialog.querySelector('[data-testid="button-export-3mf"]')).not.toBeNull();
      expect(selected()).toBe(true);
      React.act(() => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Close')!.click());
    }
    // Bin selection reveals settings on the right, never inside the object tree.
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Bin — edit size and construction"]')!.click());
    expect(selected()).toBe(false);
    expect(container.querySelector('#bin-settings-size')!.closest('[hidden]')).toBeNull();
    expect(workflow.querySelector('#bin-settings-size')).toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-edit-footprint"]')!.click());
    expect(container.querySelector('#objects-panel')!.hasAttribute('hidden')).toBe(true);
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Finish canvas editing"]')!.click());
    expect(container.querySelector('#objects-panel')!.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('[data-testid="inspector-workspace-canvas"]')).toBe(canvas);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it("prototype renames from the object menu without losing inline focus or changing selection", async () => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', '/bin?inspector=1');
  const shape = rectangularShape('rename-menu', 'Pliers');
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [parseCutoutPlacement({ id: 'rename-p', shapeId: shape.id, position: { x: 0, y: 0 } })] });
  const { container, unmount } = renderPage({ mobile: true });
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('nav[aria-label="Editor panels"] button[aria-controls="workflow-panel"]')!.click());
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Actions for Pliers"]')!;
    React.act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    React.act(() => document.querySelector<HTMLElement>('[role="menuitem"][aria-label="Rename Pliers"]')!.click());
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    const input = container.querySelector<HTMLInputElement>('[aria-label="Pocket name"]')!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('#workflow-panel')!.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe('Bin');
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Renamed pliers');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => input.blur());
    expect(container.querySelector('[aria-label="Renamed pliers — edit pocket properties"]')).not.toBeNull();
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each([false, true])("workflow layout routes every section to matching properties and preserves selection on mobile=%s", async mobile => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', '/bin?layout=workflow');
  const shape = rectangularShape('flow-tool', 'Tool');
  const finger = fingerHoleSchema.parse({ id: 'flow-finger', name: 'Thumb', center: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [parseCutoutPlacement({ id: 'flow-pocket', shapeId: shape.id, position: { x: 0, y: 0 } })], fingerHoles: [finger] });
  const { container, unmount } = renderPage({ mobile });
  try {
    await flushHydration();
    const left = container.querySelector('#workflow-panel')!;
    const right = container.querySelector('[data-testid="selection-inspector"]')!;
    const canvas = container.querySelector('[data-testid="inspector-workspace-canvas"]');
    const chooseSection = (name: string) => React.act(() => left.querySelector<HTMLButtonElement>(`[aria-label="${name} — show properties"]`)!.click());
    const index = left.querySelector<HTMLElement>('[aria-label="Find bin settings"]')!;
    const jumpTo = (label: string) => React.act(() => Array.from(index.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === label)!.click());
    expect(index.textContent).toContain('Find a setting');
    expect(index.parentElement!.classList.contains('hidden')).toBe(false);
    expect(index.closest('[data-testid="object-list-scroll"]')).toBeNull();
    expect(index.querySelectorAll('button')).toHaveLength(8);
    expect(left.querySelector('#bin-settings-pockets')).not.toBeNull();
    expect(left.querySelector('#bin-settings-finger-holes')).not.toBeNull();
    expect(left.querySelectorAll('button[data-testid^="workflow-section-"]')).toHaveLength(6);
    expect(left.querySelector('[aria-label="Width in standard cells"]')).toBeNull();
    for (const [name, tone, selector] of [
      ['Bin size', 'blue', '[aria-label="Width in standard cells"]'],
      ['Construction', 'rose', '#bin-settings-construction'],
      ['Materials & Colors', 'amber', '#input-bin-color'],
      ['Check fit', 'emerald', '#bin-settings-fit'],
      ['Export', 'emerald', '[data-testid="button-export-3mf"]'],
      ['Project', 'slate', '[aria-label="Browser library"]'],
    ]) {
      chooseSection(name);
      expect(right.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe(name);
      expect(right.querySelector(selector)).not.toBeNull();
      expect(right.querySelector('[data-testid="inspector-properties-header"]')!.getAttribute('data-property-tone')).toBe(tone);
      expect(right.querySelector('[data-testid="inspector-bin-settings"] > [data-property-tone]')!.getAttribute('data-property-tone')).toBe(tone);
      jumpTo('Pockets');
      jumpTo(name === 'Bin size' ? 'Size' : name);
      expect(right.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe(name);
      expect(index.querySelector('[aria-current="location"]')!.textContent).toBe(name === 'Bin size' ? 'Size' : name);
    }
    selectPocket(container, 'flow-pocket');
    expect(right.querySelector('#pocket-properties')!.getAttribute('data-property-tone')).toBe('violet');
    jumpTo('Export');
    expect(left.querySelector<HTMLInputElement>('[aria-label="Include Tool in selection"]')!.checked).toBe(true);
    selectPocket(container, 'flow-pocket');
    expect(right.querySelector('#pocket-properties')!.closest('[hidden]')).toBeNull();
    jumpTo('Finger access');
    React.act(() => left.querySelector<HTMLButtonElement>('[aria-label="Thumb — edit finger access properties"]')!.click());
    expect(right.querySelector('#finger-access-properties')!.getAttribute('data-property-tone')).toBe('cyan');
    React.act(() => left.querySelector<HTMLButtonElement>('[aria-label="Clear object selection"]')!.click());
    expect(left.querySelectorAll('input:checked')).toHaveLength(0);
    expect(right.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe('Bin size');
    if (mobile) React.act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Editor panels"] button')).find(button => button.textContent === 'Workflow')!.click());
    jumpTo('Finger access');
    expect(left.querySelector('#bin-settings-finger-holes')!.getAttribute('data-state')).toBe('open');
    expect(left.querySelector('#bin-settings-pockets')!.getAttribute('data-state')).toBe('closed');
    expect(left.hasAttribute('hidden')).toBe(false);
    jumpTo('Pockets');
    expect(left.querySelector('#bin-settings-pockets')!.getAttribute('data-state')).toBe('open');
    expect(left.querySelector('#bin-settings-finger-holes')!.getAttribute('data-state')).toBe('closed');
    expect(left.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('[data-testid="inspector-workspace-canvas"]')).toBe(canvas);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each(['standard', 'objects', 'workflow'])("keeps the cross-section preview inside Check fit in the %s layout", async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', `/bin?layout=${layout}`);
  const shape = rectangularShape('fit-tool', 'Tool');
  const cutout = parseCutoutPlacement({ id: 'fit-pocket', shapeId: shape.id, position: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    selectPocket(container, cutout.id);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    if (layout === 'standard') openSettingsSection(container, 'check-fit');
    else React.act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Check fit')!.click());
    expect(document.querySelector('#bin-settings-view')).toBeNull();
    const fit = document.querySelector('#bin-settings-fit')!;
    const group = fit.querySelector<HTMLDetailsElement>('[data-testid="cross-section-settings"]')!;
    expect(group.open).toBe(false);
    expect(group.textContent).toContain('Inspect inside');
    React.act(() => group.querySelector('summary')!.click());
    expect(group.open).toBe(true);
    const toggle = group.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Cut the preview open"]')!;
    React.act(() => toggle.click());
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(vi.mocked(useBinGeometry).mock.lastCall![3]).toEqual({ axis: 'x', offsetMm: 0 });
    expect(container.querySelector('[data-testid="button-show-full-bin"]')).not.toBeNull();
    expect(group.querySelector('[aria-label="Cross-section axis"]')).not.toBeNull();
    expect(group.open).toBe(true);
    React.act(() => toggle.click());
    expect(vi.mocked(useBinGeometry).mock.lastCall![3]).toBeNull();
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([cutout]);
    expect(fit.querySelector('[data-testid="button-export-surface-fit-test"]')).not.toBeNull();
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each(['standard', 'objects', 'workflow'])("Pan exclusively owns the canvas tools in the %s layout", async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', `/bin?layout=${layout}`);
  const shape = rectangularShape('pan-tool', 'Tool');
  const cutout = parseCutoutPlacement({ id: 'pan-pocket', shapeId: shape.id, position: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    selectPocket(container, cutout.id);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    React.act(() => button('Measure between contours').click());
    React.act(() => button('Pan layout').click());
    const pan = button('Pan layout');
    expect(pan.getAttribute('aria-pressed')).toBe('true');
    expect(pan.className).toContain('bg-accent');
    expect(button('Fit layout to screen').disabled).toBe(false);
    expect(button('Measure between contours').disabled).toBe(true);
    expect(button('Measure between contours').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-layout-edit-contour"]')!.disabled).toBe(true);
    if (layout !== 'standard') {
      for (const label of ['Select objects', 'Move selected objects', 'Rotate selected objects', 'Arrange selected objects', 'Link and unlink selected objects']) {
        expect(button(label).disabled).toBe(true);
        expect(button(label).getAttribute('aria-pressed')).toBe('false');
      }
    } else expect(button('Object controls').disabled).toBe(true);
    React.act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    });
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([cutout]);
    React.act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(pan.getAttribute('aria-pressed')).toBe('false');
    expect(button('Measure between contours').disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-layout-edit-contour"]')!.disabled).toBe(false);
    if (layout !== 'standard') expect(button('Move selected objects').disabled).toBe(false);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});
