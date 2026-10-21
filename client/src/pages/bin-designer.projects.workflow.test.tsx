import {
  TraceHandoff,
  projectToast,
  projectSaveMock,
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  BinDesignerPage,
  render,
  renderPage,
  openSettingsSection,
  binHistoryButton,
  clickBinHistory,
  selectPocket,
  sampleDoc,
  sampleLibrary,
  sampleButton,
  browseSamples,
} from "./bin-designer.test-support";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { Route, Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import { AppHeader } from "@/components/layout/app-header";
import { ProjectStatusBar } from "@/components/layout/project-status-bar";
import { ProjectActivityProvider } from "@/state/project-activity";
import * as TraceStoreReview from "@/state/trace-store";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as ShapeLibraryModule from "@/state/shape-library";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { PROJECT_SCHEMA_VERSION, parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { downloadBlob } from "@/lib/download";
import { projectDestinationKey } from "@/lib/project/destination";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import ryobiReloadFixture from "@shared/gridfinity/fixtures/ryobi-split-reload.pocketry.json";
import * as ProjectPersistence from "@/lib/project/persist";
import { loadSampleLibrary } from "@/lib/project/samples";

describe("BinDesignerPage", () => {

  it("preserves an unnamed draft while browsing or cancelling samples, then saves it before opening a copy", async () => {
    const draft = { ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 3 }) };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(draft);
    const { container } = renderPage();
    await flushHydration();
    await browseSamples(container);
    expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
    await React.act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Open sample Sample tray"]')!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Save or export before continuing?");
    expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
    await React.act(async () => sampleButton("Cancel").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Sample Library");
    expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(draft.spec);
    await React.act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Open sample Sample tray"]')!.click());
    await React.act(async () => sampleButton("Export current project").click());
    expect(downloadBlob).toHaveBeenCalledOnce();
    expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
    const input = document.querySelector<HTMLInputElement>('#sample-backup-project-name')!;
    React.act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "My draft"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await React.act(async () => sampleButton("Save project to Library").click());
    expect(ProjectPersistence.saveProjectToLibrary).toHaveBeenCalledWith(expect.objectContaining({ spec: draft.spec }), "My draft", null);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Project saved");
    expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
    await React.act(async () => sampleButton("Open sample").click());
    expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledExactlyOnceWith(sampleDoc);
    expect(ProjectPersistence.saveProjectDoc).toHaveBeenCalledWith(expect.objectContaining({ name: "My draft" }), "project-1");
    expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(sampleDoc.spec);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the backup prompt and current project if saving before a sample switch fails", async () => {
    const current = { id: "current", name: "My tray", updatedAt: "2026-10-08T12:00:00Z" };
    const doc = { ...EMPTY_PROJECT, name: current.name };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(doc);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: current.id, projects: [current] });
    vi.mocked(ProjectPersistence.saveProjectDoc).mockResolvedValue(false);
    const { container } = renderPage();
    await flushHydration(); await browseSamples(container);
    await React.act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Open sample Sample tray"]')!.click());
    await React.act(async () => sampleButton("Open sample").click());
    expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Save or export before continuing?");
    expect(sampleButton("Open sample").disabled).toBe(false);
    expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(doc.spec);
  });

  it("exports the existing library and merges samples only after explicit confirmation", async () => {
    const current = { id: "current", name: "My tray", updatedAt: "2026-10-08T12:00:00Z" };
    const doc = { ...EMPTY_PROJECT, name: current.name, keepBinSize: true };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(doc);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: current.id, projects: [current] });
    vi.mocked(ProjectPersistence.exportProjectLibrary).mockResolvedValue({ format: "pocketry-library", schemaVersion: 1, projects: [{ ...current, doc }] });
    vi.mocked(ProjectPersistence.importProjectLibrary).mockResolvedValue({ library: { activeProjectId: current.id, projects: [current, sampleLibrary.projects[0]] }, imported: 1, upgraded: 0, renamed: 0 });
    // jsdom lacks Blob.text; exercise the generated File through FileReader.
    const textDescriptor = Object.getOwnPropertyDescriptor(File.prototype, "text");
    Object.defineProperty(File.prototype, "text", { configurable: true, value: function(this: File) {
      return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(this); });
    } });
    try {
      const { container } = renderPage();
      await flushHydration(); await browseSamples(container);
      await React.act(async () => sampleButton("Add all 1 projects to Library").click());
      expect(ProjectPersistence.importProjectLibrary).not.toHaveBeenCalled();
      await React.act(async () => sampleButton("Export existing library").click());
      expect(ProjectPersistence.exportProjectLibrary).toHaveBeenCalledWith(expect.objectContaining({ name: current.name, keepBinSize: true }));
      expect(downloadBlob).toHaveBeenCalledOnce();
      expect(ProjectPersistence.importProjectLibrary).not.toHaveBeenCalled();
      await React.act(async () => { sampleButton("Add sample library").click(); await new Promise(resolve => setTimeout(resolve, 20)); });
      expect(ProjectPersistence.importProjectLibrary).toHaveBeenCalledWith(sampleLibrary, "merge", undefined);
      expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Manage browser library");
      expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).toContain(current.name);
      expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).toContain(sampleDoc.name);
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(doc.spec);
    } finally {
      if (textDescriptor) Object.defineProperty(File.prototype, "text", textDescriptor);
      else Reflect.deleteProperty(File.prototype, "text");
    }
  });

  it("opens a requested sample without a backup prompt when there is no existing work", async () => {
    vi.mocked(loadSampleLibrary).mockResolvedValue(sampleLibrary);
    function RequestSamples() { const { setSampleLibraryRequested } = usePanelState(); React.useEffect(() => setSampleLibraryRequested(true), [setSampleLibraryRequested]); return null; }
    render(<PanelProvider><ShapeLibraryProvider><RequestSamples /><BinDesignerPage /></ShapeLibraryProvider></PanelProvider>);
    await flushHydration();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Sample Library");
    await React.act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Open sample Sample tray"]')!.click());
    expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledExactlyOnceWith(sampleDoc);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(["accept", "open intended project"])("retains traced tools after a destination change until %s", async resolution => {
    const first = { ...EMPTY_PROJECT, name: "Project A" };
    const second = { ...EMPTY_PROJECT, name: "Project B" };
    vi.mocked(ProjectPersistence.readProjectOverview).mockResolvedValue({ doc: first, activeProjectId: "a" });
    // Another tab switches the durable current project after Trace read A.
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(second);
    const projects = [{ id: "a", name: "Project A", updatedAt: "2026-10-08T12:00:00Z" }, { id: "b", name: "Project B", updatedAt: "2026-10-08T12:00:00Z" }];
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "b", projects });
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockResolvedValue({ doc: first, project: projects[0], library: { activeProjectId: "a", projects } });
    const trace = vi.spyOn(TraceStoreReview, "useTrace").mockReturnValue({ ...TraceStoreReview.initialTraceState,
      dispatch: vi.fn(), canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn(), draftSaveStatus: "saved",
      fileName: "Test tool", imageSize: { width: 100, height: 100 },
      calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 },
      outline: [{ outer: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 30 }, { x: 10, y: 30 }], holes: [] }] });
    const route = memoryLocation({ path: "/" });
    const { container, unmount } = render(<Router hook={route.hook}><PanelProvider><ProjectActivityProvider><ShapeLibraryProvider>
      <ProjectStatusBar /><Route path="/"><TraceHandoff /></Route><Route path="/bin"><BinDesignerPage /></Route>
    </ShapeLibraryProvider></ProjectActivityProvider></PanelProvider></Router>);
    try {
      await flushHydration();
      expect(document.body.textContent).toContain("Adding to: Project A");
      React.act(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Add to bin")!.click());
      await flushHydration();
      expect(container.querySelector('[data-testid="global-project-status"]')!.textContent).toContain("Project B");
      // A wrong destination must be rejected, not modified and autosaved.
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toHaveLength(0);
      expect(container.querySelector('[data-testid="queued-destination-changed"]')?.textContent).toContain("Project A");
      const queued = JSON.parse(sessionStorage.getItem("pocketry:queued-tools")!);
      expect(queued).toHaveLength(1);
      expect(queued[0].pendingDestination).toEqual({ key: "project:a", name: "Project A" });
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
      const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
      const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
      expect(JSON.parse(json).shapes).toHaveLength(0);
      if (resolution === "accept") {
        React.act(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Add waiting tools to Project B")!.click());
      } else {
        React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
        await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-a"]')!.click());
        expect(container.querySelector('[data-testid="global-project-status"]')!.textContent).toContain("Project A");
      }
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toHaveLength(1);
      expect(container.querySelector('[data-testid="queued-destination-changed"]')).toBeNull();
    } finally { unmount(); trace.mockRestore(); }
  });

  it("keeps a changed unnamed draft's queue through reload and places it only in the matching draft", async () => {
    const edited = { ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, gridX: 5 } };
    sessionStorage.setItem("pocketry:queued-tools", JSON.stringify([{ ...rectangularShape("draft-tool", "Draft tool"), pendingDepth: { mode: "mm", value: 8 }, pendingDestination: { key: projectDestinationKey(EMPTY_PROJECT, null), name: "Untitled project" } }]));
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(edited);
    const first = renderPage();
    await flushHydration();
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toHaveLength(0);
    expect(first.container.querySelector('[data-testid="queued-destination-changed"]')).not.toBeNull();
    first.unmount();
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(EMPTY_PROJECT);
    const reopened = renderPage();
    await flushHydration();
    expect(reopened.container.querySelector('[data-testid="queued-destination-changed"]')).toBeNull();
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toHaveLength(1);
  });

  it("keeps geometry needed by undo history when the same tool is waiting for another destination", async () => {
    const shape = rectangularShape("historic-tool", "Historic tool");
    const pocket = parseCutoutPlacement({ id: "historic-pocket", shapeId: shape.id, position: { x: 0, y: 0 } });
    const stored: ProjectDoc = { ...EMPTY_PROJECT, shapes: [shape], history: { index: 1, stack: [
      { label: "Add tool", doc: { spec: EMPTY_PROJECT.spec, cutouts: [pocket], fingerHoles: [] } },
      { label: "Remove tool", doc: { spec: EMPTY_PROJECT.spec, cutouts: [], fingerHoles: [] } },
    ] } };
    sessionStorage.setItem("pocketry:queued-tools", JSON.stringify([{ ...shape, pendingDestination: { key: "project:other", name: "Other project" } }]));
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(stored);
    const { container } = render(<PanelProvider><ProjectActivityProvider><ShapeLibraryProvider><ProjectStatusBar /><BinDesignerPage /></ShapeLibraryProvider></ProjectActivityProvider></PanelProvider>);
    await flushHydration();
    openSettingsSection(container, "project");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
    const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
    const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    const exported = parseProjectDoc(JSON.parse(json))!;
    expect(exported.shapes.map(shape => shape.id)).toEqual([shape.id]);
    expect(exported.cutouts).toHaveLength(0);
    expect(exported.history!.stack[0].doc.cutouts).toHaveLength(1);
  });

  it("retains failed edits separately when Manage projects reopens Bin", async () => {
    const stored = { ...EMPTY_PROJECT, name: "Socket tray" };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(stored);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "socket", projects: [{ id: "socket", name: "Socket tray", updatedAt: "2026-10-08T12:00:00Z" }] });
    const route = memoryLocation({ path: "/bin" });
    const { container, unmount } = render(<Router hook={route.hook}><PanelProvider><ProjectActivityProvider><ShapeLibraryProvider>
      <ProjectStatusBar /><Route path="/bin"><BinDesignerPage /></Route>
    </ShapeLibraryProvider></ProjectActivityProvider></PanelProvider></Router>);
    const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;
    const backupWidth = async () => {
      React.act(() => button("Download unsaved work").click());
      const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
      const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
      return JSON.parse(json).spec.gridX;
    };
    try {
      await flushHydration();
      const input = container.querySelector<HTMLInputElement>('[aria-label="Width in standard cells"]')!;
      React.act(() => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "5"); input.dispatchEvent(new Event("input", { bubbles: true })); });
      React.act(() => input.blur());
      React.act(() => projectSaveMock.onSaved?.(false, new Error("Storage is full")));
      React.act(() => route.navigate("/"));
      expect(await backupWidth()).toBe(5);
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Manage project: Socket tray"]')!.click());
      await flushHydration();
      React.act(() => button("Close").click());
      React.act(() => projectSaveMock.onSaved?.(true));
      expect(await backupWidth()).toBe(5);
    } finally { unmount(); }
  });
  it.each(["standard", "workflow"])("keeps an editable hole object through removal, undo and project reload (%s)", async layoutMode => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layoutMode}`);
    const pocket = rectangularShape("independent-tool", "Tool 1");
    const hole = rectangularShape("independent-hole", "Hole 1");
    hole.outlineMm = [{ outer: [{ x: -3, y: -2 }, { x: 3, y: -2 }, { x: 3, y: 2 }, { x: -3, y: 2 }], holes: [] }];
    hole.bboxMm = { minX: -3, minY: -2, maxX: 3, maxY: 2 };
    sessionStorage.setItem("pocketry:queued-tools", JSON.stringify([
      { ...pocket, pendingDepth: { mode: "to-floor" }, pendingPlacement: { batchId: "photo", center: { x: 40, y: 70 } } },
      { ...hole, pendingDepth: { mode: "to-floor" }, pendingPlacement: { batchId: "photo", center: { x: 42, y: 71 }, role: "hole" } },
    ]));
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, fill: "solid" } });
    const first = renderPage();
    const current = () => vi.mocked(useBinGeometry).mock.lastCall![2]!;
    await flushHydration();
    const retained = current().cutouts.find(c => c.role === "hole")!;
    const tool = current().cutouts.find(c => c.role !== "hole")!;
    expect({ x: retained.position.x - tool.position.x, y: retained.position.y - tool.position.y }).toEqual({ x: 2, y: 1 });
    expect(retained.depth).toEqual({ mode: "through" });
    openSettingsSection(first.container, "tool-cutouts");
    selectPocket(first.container, retained.id);
    const type = first.container.querySelector<HTMLSelectElement>('[aria-label="Outline type"]')!;
    expect(type.value).toBe("hole");
    expect(first.container.textContent).toContain("Hole properties");
    React.act(() => { type.value = "pocket"; type.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(current().cutouts.find(c => c.id === retained.id)!.role).toBeUndefined();
    clickBinHistory(first.container, "undo");
    expect(current().cutouts.find(c => c.id === retained.id)!.role).toBe("hole");
    React.act(() => first.container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    React.act(() => first.container.querySelector<HTMLButtonElement>('[data-testid="button-edit-contour"]')!.click());
    const svg = first.container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
      setPointerCapture: { value: () => {} },
    });
    const pointer = (target: Element, type: string, x: number, y: number) => React.act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event);
    });
    const handles = first.container.querySelectorAll<SVGCircleElement>('[data-testid="contour-vertex-handle"]');
    expect(handles.length).toBeGreaterThan(0);
    const handle = handles[0];
    const x = Number(handle.getAttribute("cx")), y = Number(handle.getAttribute("cy"));
    pointer(handle, "pointerdown", x, y);
    pointer(svg, "pointermove", x + 2, y - 1);
    pointer(svg, "pointerup", x + 2, y - 1);
    const edited = current().cutouts.find(c => c.id === retained.id)!;
    expect(edited.role).toBe("hole");
    expect(edited.shapeId).not.toBe(hole.id);
    expect(current().cutouts.find(c => c.id === tool.id)).toEqual(tool);
    React.act(() => first.container.querySelector<HTMLButtonElement>('[data-testid="button-edit-contour"]')!.click());
    openSettingsSection(first.container, "tool-cutouts");
    if (layoutMode === "workflow") {
      React.act(() => first.container.querySelector('[aria-label="Actions for Hole 1"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      await React.act(async () => document.querySelector<HTMLElement>('[role="menuitem"][aria-label="Remove Hole 1"]')!.click());
    } else React.act(() => first.container.querySelector<HTMLButtonElement>(`[data-testid="button-remove-${retained.id}"]`)!.click());
    React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-remove-pocket-only"]')!.click());
    expect(current().cutouts).toEqual([tool]);
    clickBinHistory(first.container, "undo");
    expect(current().cutouts.find(c => c.id === retained.id)).toEqual(edited);
    openSettingsSection(first.container, "project");
    React.act(() => first.container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
    const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
    const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    const saved = parseProjectDoc(JSON.parse(json))!;
    expect(saved.cutouts.find(c => c.id === retained.id)).toEqual(edited);
    first.unmount(); sessionStorage.clear();
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(saved);
    const reopened = renderPage();
    try {
      await flushHydration();
      expect(current().cutouts.find(c => c.id === retained.id)).toEqual(edited);
      clickBinHistory(reopened.container, "redo");
      expect(current().cutouts).toEqual([tool]);
      clickBinHistory(reopened.container, "undo");
      expect(current().cutouts.find(c => c.id === retained.id)).toEqual(edited);
    } finally { reopened.unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it("preserves a photo arrangement and its retained hole through Bin placement, project backup and reload", async () => {
    const firstShape = rectangularShape("photo-first", "Tool 1");
    const secondShape = rectangularShape("photo-second", "Tool 2");
    firstShape.outlineMm[0].holes = [[{ x: -2, y: -2 }, { x: -2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: -2 }]];
    firstShape.pointCount += 4;
    sessionStorage.setItem("pocketry:queued-tools", JSON.stringify([
      { ...firstShape, pendingDepth: { mode: "to-floor" }, pendingPlacement: { batchId: "photo", center: { x: 40, y: 70 } } },
      { ...secondShape, pendingDepth: { mode: "to-floor" }, pendingPlacement: { batchId: "photo", center: { x: 52, y: 64 } } },
    ]));
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, fill: "solid" } });
    const first = renderPage();
    const layout = () => vi.mocked(useBinGeometry).mock.lastCall![2]!;
    const check = () => {
      const a = layout().cutouts.find(c => c.shapeId === firstShape.id)!;
      const b = layout().cutouts.find(c => c.shapeId === secondShape.id)!;
      expect({ x: b.position.x - a.position.x, y: b.position.y - a.position.y }).toEqual({ x: 12, y: -6 });
      expect([a.depth, b.depth]).toEqual(Array(2).fill({ mode: "remaining", floorThicknessMm: 7 }));
      expect([a.depthPending, b.depthPending]).toEqual([undefined, undefined]);
      expect(layout().shapes.find(s => s.id === firstShape.id)!.outlineMm[0].holes).toEqual(firstShape.outlineMm[0].holes);
    };
    await flushHydration(); check();
    React.act(() => first.container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(layout().cutouts).toHaveLength(0);
    React.act(() => first.container.querySelector<HTMLButtonElement>('[data-testid="button-bin-redo"]')!.click());
    check();
    openSettingsSection(first.container, "project");
    React.act(() => first.container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
    const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
    const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    const saved = parseProjectDoc(JSON.parse(json))!;
    expect(saved.shapes.every(shape => !("pendingPlacement" in shape))).toBe(true);
    first.unmount(); sessionStorage.clear();
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(saved);
    const reopened = renderPage();
    await flushHydration(); check();
    reopened.unmount();
  });

  it("restores each pending pocket's own draft after changing selection", async () => {
    const shapes = [rectangularShape("first", "Tool 1"), rectangularShape("second", "Tool 2")];
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes,
      cutouts: shapes.map((shape, index) => parseCutoutPlacement({ id: shape.id, shapeId: shape.id, position: { x: index * 15, y: 0 }, depthPending: true })),
    });
    const { container, unmount } = renderPage();
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!;
    const input = () => container.querySelector<HTMLInputElement>('[aria-label="Pocket depth (mm)"]')!;
    const enter = (value: string) => React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    const select = (id: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="button-select-${id}"]`)!.click());
    try {
      await flushHydration();
      React.act(() => button("Set depth").click());
      enter("50");
      React.act(() => button("Through — no bottom").click());
      select("second"); enter("8");
      select("first");
      expect(input().value).toBe("50");
      expect(button("Through — no bottom").getAttribute("aria-pressed")).toBe("true");
      select("second");
      expect(input().value).toBe("8");
      expect(button("Fixed depth").getAttribute("aria-pressed")).toBe("true");
    } finally { unmount(); }
  });

  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
  ])("explains blocked export and opens Solid fill to fix it: %o", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const shape = rectangularShape("tool", "Wrench");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape],
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none" }),
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: 5 } })] });
    const { container, unmount } = renderPage({ mobile });
    try {
      await flushHydration();
      openSettingsSection(container, "export");
      expect(container.querySelector('[data-testid="export-blocked-reasons"]')?.textContent).toContain("3D export");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.disabled).toBe(true);
      await React.act(async () => container.querySelector<HTMLButtonElement>('[data-export-issue="cutouts-require-solid-fill"]')!.click());
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
      const solidFill = container.querySelector<HTMLButtonElement>('#bin-solid-fill')!;
      expect(solidFill.closest('[hidden], [inert]')).toBeNull();
      expect(document.activeElement).toBe(solidFill);
      React.act(() => solidFill.click());
      openSettingsSection(container, "export");
      expect(container.querySelector('[data-testid="export-blocked-reasons"]')).toBeNull();
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.disabled).toBe(false);
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each([false, true])("shows save failure and downloads a backup outside the controls (mobile=%s)", async mobile => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(EMPTY_PROJECT);
    const { container, unmount } = renderPage({ mobile });
    try {
      await flushHydration();
      React.act(() => projectSaveMock.onSaved?.(false, new Error("Projects changed in another tab. Download a backup, then reload.")));
      const banner = container.querySelector('[data-testid="bin-save-error"]')!;
      expect(banner.getAttribute("role")).toBe("alert");
      expect(banner.closest('[data-testid="bin-canvas"]')).not.toBeNull();
      expect(banner.textContent).toContain("another tab");
      React.act(() => banner.querySelector<HTMLButtonElement>("button")!.click());
      expect(downloadBlob).toHaveBeenCalledOnce();
      const [backup, filename] = vi.mocked(downloadBlob).mock.calls[0];
      expect(filename).toMatch(/\.pocketry\.json$/);
      const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(backup); });
      expect(JSON.parse(text).spec.gridX).toBe(EMPTY_PROJECT.spec.gridX);
      expect(container.querySelector('[data-testid="bin-save-error"]')).not.toBeNull();
      React.act(() => projectSaveMock.onSaved?.(true));
      expect(container.querySelector('[data-testid="bin-save-error"]')).toBeNull();
    } finally { unmount(); }
  });

  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
  ])("uses one editable project header with collapsed controls and preserves recovery after leaving Bin: %o", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, name: "Socket tray" });
    const route = memoryLocation({ path: "/bin" });
    function CollapseControls() {
      const { setPanelOpen } = usePanelState();
      return <button onClick={() => setPanelOpen(false)}>Collapse test controls</button>;
    }
    const { container, unmount } = render(<Router hook={route.hook}><PanelProvider><ProjectActivityProvider>
      <ProjectStatusBar /><CollapseControls /><Route path="/bin"><ShapeLibraryProvider><BinDesignerPage /></ShapeLibraryProvider></Route>
    </ProjectActivityProvider></PanelProvider></Router>, { mobile });
    try {
    await flushHydration();
    const status = container.querySelector('[data-testid="global-project-status"]')!;
    expect(status.textContent).toContain("Socket tray");
    expect(status.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="project-status-title"]')).toHaveLength(1);
    expect(status.querySelector('[aria-label="Manage project: Socket tray"]')).toBeNull();
    React.act(() => [...container.querySelectorAll("button")].find(button => button.textContent === "Collapse test controls")!.click());
    const rename = status.querySelector<HTMLButtonElement>('[aria-label="Edit project name"]')!;
    expect(rename.closest('[hidden], [inert], .hidden')).toBeNull();
    React.act(() => { rename.focus(); rename.click(); });
    expect(document.querySelector<HTMLInputElement>('[data-testid="input-project-name"]')!.value).toBe("Socket tray");
    React.act(() => [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Cancel")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(document.activeElement).toBe(rename);
    expect(document.activeElement?.closest('[hidden], [inert], .hidden')).toBeNull();
    expect(ProjectPersistence.saveProjectToLibrary).not.toHaveBeenCalled();
    React.act(() => projectSaveMock.onSaved?.(false, new Error("Storage is full")));
    expect(status.textContent).toContain("Download unsaved work");
    expect(status.textContent).toContain("Storage is full");
    React.act(() => projectSaveMock.onSaved?.(true));
    const completion = projectSaveMock.onSaved;
    React.act(() => route.navigate("/"));
    expect(status.querySelector('[data-testid="project-status"]')).toBeNull();
    expect(status.querySelector('[aria-label="Manage project: Socket tray"]')).not.toBeNull();
    React.act(() => completion?.(false, new Error("Could not save the last edit")));
    expect(status.textContent).toContain("Project storage needs attention");
    expect(document.body.textContent).toContain("Could not save the last edit");
    React.act(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Download unsaved work")!.click());
    expect(downloadBlob).toHaveBeenCalledOnce();
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each([
    { page: "Trace", path: "/", mobile: false }, { page: "Trace", path: "/", mobile: true },
    { page: "Bin", path: "/bin", mobile: false }, { page: "Bin", path: "/bin", mobile: true },
  ])("starts a new project from the $page header only after resolving the current draft (mobile=$mobile)", async ({ path, mobile }) => {
    const draft = { ...EMPTY_PROJECT, name: "My draft", spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 3 }) };
    vi.mocked(ProjectPersistence.readProjectOverview).mockResolvedValue({ doc: draft, activeProjectId: null });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(draft);
    const route = memoryLocation({ path });
    const { container, unmount } = render(<Router hook={route.hook}><PanelProvider><ProjectActivityProvider><ShapeLibraryProvider>
      <ProjectStatusBar /><Route path="/bin"><BinDesignerPage /></Route>
    </ShapeLibraryProvider></ProjectActivityProvider></PanelProvider></Router>, { mobile });
    try {
      await flushHydration();
      const openNew = async () => {
        React.act(() => [...container.querySelectorAll('[data-testid="global-project-status"] button')].find(button => button.textContent === "New project")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
        await flushHydration();
      };
      await openNew();
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Save this draft before starting over?");
      expect(ProjectPersistence.startNewProject).not.toHaveBeenCalled();
      React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Keep current project")!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].gridX).toBe(3);
      React.act(() => route.navigate(path));
      await openNew();
      expect(document.querySelector<HTMLInputElement>('[data-testid="input-new-project-draft-name"]')!.value).toBe("My draft");
      vi.mocked(ProjectPersistence.startNewProject).mockRejectedValueOnce(new Error("Storage is full"));
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-save-draft-start-new"]')!.click());
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Your current work is still open");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].gridX).toBe(3);
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-save-draft-start-new"]')!.click());
      expect(ProjectPersistence.startNewProject).toHaveBeenLastCalledWith(expect.objectContaining({ shapes: [] }), {
        name: "My draft", doc: expect.objectContaining({ spec: draft.spec }),
      });
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].gridX).toBe(2);
    } finally { unmount(); }
  });

  it("reports a failed project restore without writing an empty replacement", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockRejectedValue(new Error("Saved project is unreadable; it has been kept intact."));
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      expect(container.querySelector('[data-testid="bin-save-error"]')?.textContent).toContain("kept intact");
      expect(container.querySelector('[data-testid="bin-save-error"] button')).toBeNull();
      expect(ProjectPersistence.saveProjectDoc).not.toHaveBeenCalled();
      expect(ProjectPersistence.loadProjectLibrary).toHaveBeenCalledWith();
      openSettingsSection(container, "project");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.disabled).toBe(false);
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-new-project"]')!.disabled).toBe(true);
    } finally { unmount(); }
  });

  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
  ])("offers saving a draft before starting new and retains it on failure: %o", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const draft = { ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 3 }),
      materials: { ...DEFAULT_BIN_MATERIALS, binColor: "#123456" } };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(draft);
    vi.mocked(ProjectPersistence.startNewProject).mockRejectedValueOnce(new Error("Storage is full"));
    const { container, unmount } = renderPage({ mobile });
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-new-project"]')!.click());
      const dialog = document.querySelector('[role="alertdialog"]')!;
      expect(dialog.textContent).toContain("Save this draft before starting over?");
      expect(dialog.textContent).toContain("Discard draft and start new");
      const input = dialog.querySelector<HTMLInputElement>('[data-testid="input-new-project-draft-name"]')!;
      const save = dialog.querySelector<HTMLButtonElement>('[data-testid="button-save-draft-start-new"]')!;
      expect(save.disabled).toBe(true);
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "My draft");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await React.act(async () => save.click());
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("Your current work is still open");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].gridX).toBe(3);
      expect(ProjectPersistence.startNewProject).toHaveBeenCalledWith(expect.objectContaining({ shapes: [] }), {
        name: "My draft", doc: expect.objectContaining({ spec: draft.spec, materials: draft.materials }),
      });
      await React.act(async () => save.click());
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].gridX).toBe(2);
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it("keeps newer and unreadable library entries visible, blocks editing, and retains backup access", async () => {
    const projects: ProjectPersistence.ProjectLibraryItem[] = [
      { id: "future", name: "Future tray", updatedAt: "2026-10-08T00:00:00Z", unavailable: "newer-version" },
      { id: "broken", name: "Unreadable tray", updatedAt: "2026-10-08T00:00:00Z", unavailable: "unreadable" },
    ];
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      await React.act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain("2 saved projects");
      expect(dialog.textContent).toContain("Saved by a newer Pocketry version");
      expect(dialog.textContent).toContain("could not be read by this version");
      for (const project of projects) {
        for (const action of ["open", "rename", "duplicate"]) {
          expect(dialog.querySelector<HTMLButtonElement>(`[data-testid="button-${action}-project-${project.id}"]`)!.disabled).toBe(true);
        }
        const row = dialog.querySelector(`[data-testid="library-project-${project.id}"]`)!;
        await React.act(async () => {
          row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        });
      }
      expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
      expect(dialog.querySelector<HTMLButtonElement>('[data-testid="button-export-library"]')!.disabled).toBe(false);
    } finally { unmount(); }
  });

  it("exports the intact library without an empty fallback after the working copy cannot be restored", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockRejectedValue(new Error("Saved by a newer version"));
    vi.mocked(ProjectPersistence.exportProjectLibrary).mockResolvedValue({ format: "pocketry-library", schemaVersion: 1, projects: [] });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "project");
      await React.act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-export-library"]')!.click());
      expect(ProjectPersistence.exportProjectLibrary).toHaveBeenCalledExactlyOnceWith(undefined);
      expect(downloadBlob).toHaveBeenCalledOnce();
      expect(ProjectPersistence.saveProjectDoc).not.toHaveBeenCalled();
    } finally { unmount(); }
  });

  it("shows a failed library refresh as an error and allows a retry", async () => {
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      vi.mocked(ProjectPersistence.loadProjectLibrary).mockRejectedValueOnce(new Error("Browser storage could not be read."));
      openSettingsSection(container, "project");
      await React.act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain("Browser storage could not be read.");
      expect(dialog.textContent).not.toContain("No named projects yet.");
      await React.act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Try again")!.click());
      expect(dialog.textContent).toContain("No named projects yet.");
    } finally { unmount(); }
  });

  it("keeps this tab's project identity when refreshing a library changed by another tab", async () => {
    const projects = ["First", "Second"].map(name => ({ id: name, name, updatedAt: "2026-10-08T00:00:00Z" }));
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, name: "First" });
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "First", projects });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "Second", projects });
      openSettingsSection(container, "project");
      await React.act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      expect(container.querySelector('[data-testid="button-edit-project-name"]')?.parentElement?.textContent).toContain("First");
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.querySelector('[data-testid="managed-project-list"]')?.textContent).toContain("Second");
    } finally { unmount(); }
  });
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
        React.act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Back to Canvas")!.click());
      } else {
        React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Hide controls"]')!.click());
      }
      await openLibrary();
      expect(document.querySelector('[data-testid="managed-project-list"]')).not.toBeNull();
      expect(ProjectPersistence.loadProjectDoc).toHaveBeenCalledOnce();
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
      expect(names()).toEqual(["Original pocket", "Original pocket (copy)", "Original pocket (copy 2)"]);
      const [, copy] = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;
      rename(copy.id, "  Copy A  ");
      expect(names()).toEqual(["Original pocket", "Copy A", "Original pocket (copy 2)"]);
      expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Copy A");
      expect(container.querySelector('[aria-label="Reference pocket"]')!.textContent).toContain("Original pocket");
      click("button-bin-undo");
      expect(names()).toEqual(["Original pocket", "Original pocket (copy)", "Original pocket (copy 2)"]);
      click("button-bin-redo");
      expect(names()).toEqual(["Original pocket", "Copy A", "Original pocket (copy 2)"]);
      rename("original", "Source placement");
      expect(names()).toEqual(["Source placement", "Copy A", "Original pocket (copy 2)"]);
      rename(copy.id, "Cancelled", "Escape");
      rename(copy.id, "   ");
      expect(names()).toEqual(["Source placement", "Copy A", "Original pocket (copy 2)"]);
      click(`button-duplicate-${copy.id}`);
      expect(names()).toEqual(["Source placement", "Copy A", "Original pocket (copy 2)", "Copy A (copy)"]);
      const newCopy = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts.at(-1)!;
      rename(newCopy.id, "Copy B");
      const expectedNames = ["Source placement", "Copy A", "Original pocket (copy 2)", "Copy B"];
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
      expect(names()).toEqual(["Source placement", "Copy A", "Original pocket (copy 2)", "Copy A (copy)"]);
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
          if (!document.querySelector('[role="alertdialog"]')) {
            React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-new-project"]')!.click());
          }
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
      if (action === "new") expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toContain("Your current work is still open");
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
    expect(manage.previousElementSibling?.textContent).toBe('Save this draft to Library');
    expect(save.closest('section')?.getAttribute("aria-label")).toBe("Browser library");
    for (const action of transfers) {
      expect(action.disabled).toBe(false);
      expect(action.closest('[role="group"]')).toBe(fresh.closest('[role="group"]'));
    }
    expect(container.querySelector('[data-testid="library-file-backup"]')).toBeNull();
    unmount();
  });

  it.each(["current-project-title", "project-status-title", "button-edit-project-name"])("names a new draft from %s without exporting a backup", async (titleId) => {
    const { container, unmount } = renderPage();
    // The status title and pencil also work while Project is collapsed.
    if (titleId === "current-project-title") openSettingsSection(container, "project");
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-edit-project-name"]')!.disabled).toBe(true);
    await flushHydration();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-edit-project-name"]')!.disabled).toBe(false);
    React.act(() => projectSaveMock.onSaved?.(true));
    expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Draft autosaved in this browser · not in Library");

    React.act(() => {
      const trigger = container.querySelector<HTMLElement>(`[data-testid="${titleId}"]`)!;
      if (titleId === "button-edit-project-name") trigger.click();
      else trigger.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
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
    expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Saved to Library in this browser");
    React.act(() => projectSaveMock.onSaved?.(false));
    expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Could not save. Export this project to keep your work.");
    unmount();
  });

  it.each([
    { trigger: 'title', layout: 'standard', mobile: false },
    { trigger: 'pencil', layout: 'standard', mobile: false },
    { trigger: 'pencil', layout: 'standard', mobile: true },
    { trigger: 'pencil', layout: 'workflow', mobile: false },
    { trigger: 'pencil', layout: 'workflow', mobile: true },
  ])("renames a saved project from its $trigger in $layout with mobile=$mobile, preserving its identity and supporting Cancel", async ({ trigger, layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, '', `/bin?layout=${layout}`);
    const project = { id: "current", name: "Stapler", updatedAt: "2026-09-20T12:00:00.000Z" };
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: project.id, projects: [project] });
    const { container, unmount } = renderPage({ mobile });
    try {
      if (trigger === 'title') openSettingsSection(container, "project");
      await flushHydration();
      if (layout === 'standard' && mobile) {
        React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Adjust')!.click());
        React.act(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'All properties')!.click());
      }
      const before = vi.mocked(useBinGeometry).mock.lastCall;
      const openName = () => {
        React.act(() => {
          if (trigger === 'pencil') document.querySelector<HTMLButtonElement>('[data-testid="button-edit-project-name"]')!.click();
          else document.querySelector('[data-testid="current-project-title"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        });
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
      expect(document.querySelector('[data-testid="current-project-title"]')?.textContent).toBe("Stapler");
      input = openName();
      expect(input.value).toBe("Stapler");
      editName(input);
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-save-library"]')!.click());
      expect(ProjectPersistence.saveProjectToLibrary).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: PROJECT_SCHEMA_VERSION }), "Stapler tray", "current");
      expect(document.querySelector('[data-testid="current-project-title"]')?.textContent).toBe("Stapler tray");
      expect(document.querySelector('[data-testid="project-status-title"]')?.textContent).toBe("Stapler tray");
      expect(vi.mocked(useBinGeometry).mock.lastCall).toEqual(before);
      expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
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
      expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Saved to Library in this browser");
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
      expect(document.activeElement?.getAttribute("data-testid")).toBe(row.getAttribute("data-testid"));
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
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Your current project and exported backups will not change");
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
    expect(document.activeElement?.getAttribute("data-testid")).toBe(row.getAttribute("data-testid"));
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
        const row = document.querySelector<HTMLElement>('[data-testid="library-project-saved"]')!;
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
      const keep = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Keep working")!;
      expect(keep.textContent).toBe("Keep working");
      React.act(() => keep.click());
      // Radix restores focus after the closing focus scope has unmounted.
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.activeElement?.getAttribute("data-testid")).toBe(row.getAttribute("data-testid"));
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
      React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Keep working")!.click());
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
        React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Keep working")!.click());
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

  it("keeps a nonempty draft and returns focus to Import Project file when replacement is cancelled", async () => {
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
      React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Keep working")!.click());
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
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="managed-project-list"]')).toBeNull();
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b=>b.textContent==="Cancel")!.click());
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
    expect(document.querySelector('[data-testid="managed-project-list"]')).toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(b=>b.textContent==="Keep project")!.click());
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
    expect(document.activeElement).toBe(document.querySelector('[data-testid="button-save-draft-library"]'));
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
    expect(ProjectPersistence.importProjectLibrary).not.toHaveBeenCalled();
    expect(document.querySelector('#library-import-merge')?.getAttribute('aria-checked')).toBe('true');
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-import-library"]')!.click());
    expect(ProjectPersistence.importProjectLibrary).toHaveBeenCalledWith(data, "merge", undefined);
    expect(input.value).toBe("");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("1 saved project");
    expect(ProjectPersistence.startNewProject).not.toHaveBeenCalled();
    expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).toContain("Imported tray");
    unmount();
  });

  it.each([false, true])("replaces only the saved library after confirmation on mobile=%s", async mobile => {
    const existing = { id: "existing", name: "Current design", updatedAt: "2026-09-12T12:00:00.000Z" };
    const imported = { id: "imported", name: "Imported tray", updatedAt: existing.updatedAt };
    const shape = rectangularShape('current-tool', 'Current tool');
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, name: existing.name, keepBinSize: true,
      shapes: [shape], cutouts: [parseCutoutPlacement({ id: 'current-pocket', shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: 'mm', value: 12 } })] });
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: existing.id, projects: [existing] });
    vi.mocked(ProjectPersistence.importProjectLibrary).mockResolvedValue({ library: { activeProjectId: null, projects: [imported] }, imported: 1, upgraded: 0, renamed: 0 });
    const { container, unmount } = renderPage({ mobile });
    try {
      await flushHydration();
      if (mobile) {
        React.act(() => [...container.querySelectorAll('button')].find(b => b.textContent === 'Adjust')!.click());
        React.act(() => [...container.querySelectorAll('button')].find(b => b.textContent === 'All properties')!.click());
      }
      openSettingsSection(document.body, "project");
      React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await flushHydration();
      const input = document.querySelector<HTMLInputElement>('[data-testid="input-import-library"]')!;
      const data = { format: "pocketry-library", schemaVersion: 1, projects: [] };
      const file = new File([JSON.stringify(data)], 'library.json');
      Object.defineProperty(file, 'text', { value: async () => JSON.stringify(data) });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      const chooseFile = () => React.act(() => { const currentInput=document.querySelector<HTMLInputElement>('[data-testid="input-import-library"]')!; Object.defineProperty(currentInput,'files',{value:[file], configurable:true}); currentInput.dispatchEvent(new Event('change', { bubbles: true })); });
      chooseFile();
      React.act(() => document.querySelector<HTMLButtonElement>('#library-import-replace')!.click());
      expect(ProjectPersistence.importProjectLibrary).not.toHaveBeenCalled();
      const dialog = document.querySelector('[data-testid="button-confirm-import-library"]')!.closest('[role="dialog"]')!;
      expect(dialog.textContent).toContain('unnamed draft');
      expect(dialog.textContent).toContain('Would you like to export a backup before importing?');
      React.act(() => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Export current project')!.click());
      expect(downloadBlob).toHaveBeenCalledOnce();
      expect(ProjectPersistence.importProjectLibrary).not.toHaveBeenCalled();
      expect(document.querySelector('[data-testid="button-confirm-import-library"]')).not.toBeNull();
      React.act(() => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Cancel')!.click());
      expect(ProjectPersistence.importProjectLibrary).not.toHaveBeenCalled();
      chooseFile();
      expect(document.querySelector('#library-import-merge')?.getAttribute('aria-checked')).toBe('true');
      React.act(() => document.querySelector<HTMLButtonElement>('#library-import-replace')!.click());
      const before = vi.mocked(useBinGeometry).mock.lastCall![2]!;
      vi.mocked(ProjectPersistence.importProjectLibrary).mockRejectedValueOnce(new Error('Storage is full'));
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-import-library"]')!.click());
      expect(document.querySelector('[data-testid="current-project-title"]')?.textContent).toBe(existing.name);
      expect(document.querySelector('[data-testid="managed-project-list"]')).toBeNull();
      expect(document.querySelector('#library-import-replace')?.getAttribute('aria-checked')).toBe('true');
      expect(document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-import-library"]')!.disabled).toBe(false);
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-import-library"]')!.click());
      expect(ProjectPersistence.importProjectLibrary).toHaveBeenCalledWith(data, 'replace', expect.objectContaining({ name: existing.name, keepBinSize: true }));
      expect(document.querySelector('[data-testid="button-confirm-import-library"]')).toBeNull();
      expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).toContain(imported.name);
      expect(document.querySelector('[data-testid="managed-project-list"]')?.textContent).not.toContain(existing.name);
      expect(document.querySelector('[data-testid="current-project-title"]')?.textContent).toBe('Untitled project');
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]).toEqual(before);
      expect(ProjectPersistence.openProjectFromLibrary).not.toHaveBeenCalled();
      expect(ProjectPersistence.startNewProject).not.toHaveBeenCalled();
    } finally { unmount(); }
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
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-import-library"]')!.click());
    expect(ProjectPersistence.importProjectLibrary).not.toHaveBeenCalled();
    expect(projectToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not import library" }));
    expect(document.querySelector('[data-testid="button-confirm-import-library"]')).not.toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b=>b.textContent==="Cancel")!.click());
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
  });});

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
  const button = (container: HTMLElement, action: "undo" | "redo") =>
    binHistoryButton(container, action);

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
      clickBinHistory(container, "redo");
      clickBinHistory(container, "undo");
      if (mobile) {
        React.act(() => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Adjust")!.click());
        React.act(() => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "All properties")!.click());
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
      clickBinHistory(container, "undo");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].gridX).toBe(2);
      expect(button(container, "undo").disabled).toBe(true);
      clickBinHistory(container, "redo");
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
  });});

it.each(['cancel','save','failure'])("empty Library draft naming has one modal and preserves work on %s", async outcome => {
  const {container,unmount}=renderPage();
  try {
    await flushHydration();openSettingsSection(container,'project');
    React.act(()=>container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
    const before=structuredClone(vi.mocked(useBinGeometry).mock.lastCall![0]);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    React.act(()=>document.querySelector<HTMLButtonElement>('[data-testid="button-save-draft-library"]')!.click());
    expect(document.querySelector('[data-testid="managed-project-list"]')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const input=document.querySelector<HTMLInputElement>('[data-testid="input-project-name"]')!;
    const name='Very long but useful project name '.repeat(2);
    React.act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,name);input.dispatchEvent(new Event('input',{bubbles:true}));});
    if(outcome==='cancel') React.act(()=>[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b=>b.textContent==='Cancel')!.click());
    else {
      if(outcome==='failure') vi.mocked(ProjectPersistence.saveProjectToLibrary).mockRejectedValueOnce(new Error('Storage unavailable'));
      await React.act(async()=>document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-save-library"]')!.click());
    }
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(before);
    if(outcome==='failure') {expect(input.value).toBe(name);expect(document.querySelector('[data-testid="managed-project-list"]')).toBeNull();}
    else {
      expect(document.querySelector('[data-testid="managed-project-list"]')).not.toBeNull();
      if(outcome==='save') {
        const row=document.querySelector('[data-testid="library-project-project-1"]')!;
        expect(row.getAttribute('data-selected')).toBe('true');expect(row.textContent).toContain(name.trim());
      } else expect(ProjectPersistence.saveProjectToLibrary).not.toHaveBeenCalled();
    }
  } finally {unmount();}
});
