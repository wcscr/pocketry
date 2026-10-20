import { EMPTY_PROJECT, TraceHandoff, experimentalSettings, flushHydration, openSettingsSection, render, binGeometryMock } from "./bin-designer.test-support";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { Router as WorkspaceRouter } from "@/App";
import { PanelProvider } from "@/components/layout/panel-context";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { ProjectActivityProvider } from "@/state/project-activity";
import { INITIAL_BIN_SPEC } from "@/state/bin-store";
import * as TraceStore from "@/state/trace-store";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as Persistence from "@/lib/project/persist";
import { parseBinSpec } from "@shared/gridfinity/types";
import { type ProjectDoc } from "@shared/gridfinity/project";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import { DEFAULT_PEG_BOTTOM } from "@shared/gridfinity/peg-bottom";
import { ultim8Defaults } from "@shared/gridfinity/ultim8-defaults";

vi.mock("@/pages/trace", () => ({ default: () => <TraceHandoff /> }));

/** Render the real route switch with a preceding page in its recorded history. */
function enterFixture({ mobile = false, path = "/ultim8" } = {}): ReturnType<typeof render> & { route: ReturnType<typeof memoryLocation> } {
  const route = memoryLocation({ path: "/about", record: true });
  route.navigate(path);
  return { route, ...render(<React.StrictMode><Router hook={route.hook}><PanelProvider><ProjectActivityProvider><ShapeLibraryProvider>
    <WorkspaceRouter />
  </ShapeLibraryProvider></ProjectActivityProvider></PanelProvider></Router></React.StrictMode>, { mobile, experimental: false }) };
}

/** Read the spec actually passed to the unchanged geometry boundary. */
function currentSpec(): ReturnType<typeof parseBinSpec> { return vi.mocked(useBinGeometry).mock.lastCall![0]; }

/** Use the existing dialog buttons, including their prevent-default behavior. */
async function clickButton(label: string): Promise<void> {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label);
  expect(button, label).toBeTruthy();
  await React.act(async () => button!.click());
}

/** Native input events exercise the same draft state as typing. */
function enterName(value: string): void {
  const input = document.querySelector<HTMLInputElement>("#new-project-draft-name")!;
  React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("/ultim8 entry", () => {
  it.each([false, true])("starts one fixture after hydration and replaces history (mobile=%s)", async mobile => {
    const { route, container } = enterFixture({ mobile });
    await flushHydration();
    expect(Persistence.startNewProject).toHaveBeenCalledOnce();
    const defaults = ultim8Defaults(INITIAL_BIN_SPEC, 42, DEFAULT_BIN_MATERIALS.binColor);
    expect(currentSpec()).toEqual(parseBinSpec({ ...INITIAL_BIN_SPEC, ...defaults.patch }));
    expect(vi.mocked(Persistence.startNewProject).mock.lastCall![0].materials).toEqual({ ...DEFAULT_BIN_MATERIALS, ...defaults.materialPatch });
    expect(route.history).toEqual(["/about", "/bin"]);
    expect(Persistence.loadProjectDoc).toHaveBeenCalledTimes(2); // StrictMode only; URL replacement does not remount.
    expect(container.querySelector('[data-testid="jig-empty-state"]')?.textContent).toContain("Trace an object from a photo");
    expect(experimentalSettings.enabled).toBe(false);
    // Back's destination is the preceding page, with no /ultim8 entry to loop through.
    React.act(() => route.navigate(route.history![route.history!.length - 2], { replace: true }));
    expect(Persistence.startNewProject).toHaveBeenCalledOnce();
  });

  it.each(["flat", "sloped", "bridged"] as const)("opens an existing %s fixture without changing specs or export inputs", async underside => {
    binGeometryMock.buildOnce.mockResolvedValue({ mesh: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), normals: null } });
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, pegBottom: { ...DEFAULT_PEG_BOTTOM, underside, density: underside === "flat" ? "corners" : 1 } });
    vi.mocked(Persistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec });
    const { route, container } = enterFixture();
    await flushHydration();
    expect(Persistence.startNewProject).not.toHaveBeenCalled();
    expect(currentSpec()).toEqual(spec);
    expect(route.history).toEqual(["/about", "/bin"]);
    openSettingsSection(container, "export");
    expect(container.textContent).toContain(underside === "flat" ? "STL / 3MF · pegs up" : "STL / 3MF · pegs down");
    await React.act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-export-stl"]')!.click());
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-export"]')!.click());
    expect(binGeometryMock.buildOnce).toHaveBeenCalledOnce();
    expect(currentSpec()).toEqual(spec);
  });

  it("saves named Gridfinity work before creating a fixture", async () => {
    const doc = { ...EMPTY_PROJECT, name: "My tray", spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 4 }) };
    vi.mocked(Persistence.loadProjectDoc).mockResolvedValue(doc);
    vi.mocked(Persistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "tray", projects: [{ id: "tray", name: "My tray", updatedAt: "2026-10-19T00:00:00Z" }] });
    const { route } = enterFixture();
    await flushHydration();
    expect(currentSpec()).toEqual(doc.spec);
    expect(Persistence.startNewProject).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Saves the latest changes");
    await clickButton("Start new project");
    expect(Persistence.saveProjectDoc).toHaveBeenCalledWith(expect.objectContaining({ name: "My tray", spec: doc.spec }), "tray");
    expect(vi.mocked(Persistence.saveProjectDoc).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(Persistence.startNewProject).mock.invocationCallOrder[0]);
    expect(currentSpec().pegBottom).toEqual(DEFAULT_PEG_BOTTOM);
    expect(route.history).toEqual(["/about", "/bin"]);
  });

  it.each(["keep", "save", "discard"])("protects an unnamed draft: %s", async action => {
    const doc = { ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 3 }) };
    vi.mocked(Persistence.loadProjectDoc).mockResolvedValue(doc);
    const { route } = enterFixture();
    await flushHydration();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Save this draft before starting over?");
    expect(Persistence.startNewProject).not.toHaveBeenCalled();
    expect(currentSpec()).toEqual(doc.spec);
    if (action === "keep") {
      await clickButton("Keep current project");
      expect(Persistence.startNewProject).not.toHaveBeenCalled();
      expect(currentSpec()).toEqual(doc.spec);
    } else if (action === "save") {
      enterName("Original draft");
      await clickButton("Save and start new");
      expect(Persistence.startNewProject).toHaveBeenCalledWith(expect.objectContaining({ spec: expect.objectContaining({ pegBottom: DEFAULT_PEG_BOTTOM }) }), { doc: expect.objectContaining({ spec: doc.spec }), name: "Original draft" });
    } else {
      await clickButton("Discard draft and start new");
      expect(Persistence.startNewProject).toHaveBeenCalledWith(expect.objectContaining({ spec: expect.objectContaining({ pegBottom: DEFAULT_PEG_BOTTOM }) }));
    }
    expect(route.history).toEqual(["/about", "/bin"]);
  });

  it("keeps the draft and prompt when creating the new project fails", async () => {
    vi.mocked(Persistence.startNewProject).mockRejectedValueOnce(new Error("Storage unavailable"));
    const { route } = enterFixture();
    await flushHydration();
    expect(currentSpec()).toEqual(INITIAL_BIN_SPEC);
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Could not start a new project");
    expect(route.history).toEqual(["/about", "/ultim8"]);
    await clickButton("Start new project");
    expect(route.history).toEqual(["/about", "/bin"]);
  });

  it("never creates a fixture if the saved project cannot be restored", async () => {
    vi.mocked(Persistence.loadProjectDoc).mockRejectedValueOnce(new Error("Unreadable project")).mockRejectedValueOnce(new Error("Unreadable project"));
    const { container } = enterFixture();
    await flushHydration();
    expect(Persistence.startNewProject).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="bin-save-error"]')?.textContent).toContain("Unreadable project");
  });

  it("retains named work if its save fails", async () => {
    vi.mocked(Persistence.loadProjectDoc).mockResolvedValue(EMPTY_PROJECT);
    vi.mocked(Persistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: "tray", projects: [{ id: "tray", name: "My tray", updatedAt: "2026-10-19T00:00:00Z" }] });
    vi.mocked(Persistence.saveProjectDoc).mockResolvedValue(false);
    const { route } = enterFixture();
    await flushHydration(); await clickButton("Start new project");
    expect(Persistence.startNewProject).not.toHaveBeenCalled();
    expect(currentSpec()).toEqual(EMPTY_PROJECT.spec);
    expect(route.history).toEqual(["/about", "/ultim8"]);
  });

  it.each(["standard", "workflow"])("uses jig controls on /bin with Experimental off (%s)", async layout => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, pegBottom: DEFAULT_PEG_BOTTOM });
    vi.mocked(Persistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec });
    const { container } = enterFixture({ path: "/bin" });
    await flushHydration();
    openSettingsSection(container, "size");
    expect(container.textContent).toContain("Fixture size");
    expect(container.querySelector('[aria-label="Fixture width in millimetres"]')).not.toBeNull();
    for (const selector of ['[aria-label="Grid pitch"]', '[aria-label="Bin height in units"]', '[data-testid="button-edit-footprint"]']) expect(container.querySelector(selector)).toBeNull();
    openSettingsSection(container, "construction");
    expect(container.querySelector('[aria-label="Peg underside"]')).not.toBeNull();
    for (const label of ["Stacking lip", "Magnet holes", "Crush ribs", "Screw holes", "Label tab", "Slanted walls (prototype)", "Wall thickness"]) expect(container.querySelector(`[aria-label="${label}"]`)).toBeNull();
    expect(container.querySelector('[data-testid="experimental-design-notice"]')).toBeNull();
    expect(experimentalSettings.enabled).toBe(false);
    expect(currentSpec()).toEqual(spec);
  });

  it("does not offer pegs to a regular project with Experimental off", async () => {
    const { container } = enterFixture({ path: "/bin" });
    await flushHydration(); openSettingsSection(container, "construction");
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Bottom"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    expect([...document.querySelectorAll('[role="option"]')].some(option => option.textContent?.includes("ULTIM8"))).toBe(false);
    expect(container.querySelector('[data-testid="jig-empty-state"]')).toBeNull();
  });

  it("edits legacy fixture thickness in millimetres on mobile and restores it with undo", async () => {
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, heightUnits: 1, lip: "standard", pegBottom: DEFAULT_PEG_BOTTOM });
    vi.mocked(Persistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec });
    const { container } = enterFixture({ mobile: true });
    await flushHydration(); await clickButton("Adjust");
    expect(container.textContent).toContain("Body thickness");
    const slider = container.querySelector<HTMLElement>('#quick-bin-height [role="slider"]')!;
    expect(slider.getAttribute("aria-valuenow")).toBe("7");
    React.act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(currentSpec().heightUnits * 7).toBe(6.5);
    expect(currentSpec().lip).toBe("none");
    expect(currentSpec().arbitrarySizeMm).toEqual({ width: 83.5, length: 83.5 });
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(currentSpec()).toEqual(spec);
  });

  it("produces the same spec through setup as through the entry", async () => {
    const { container } = enterFixture();
    await flushHydration();
    const entrySpec = currentSpec();
    // Returning to an ordinary project exposes the same opt-in setup dialog.
    openSettingsSection(container, "construction");
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Bottom"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Flat bottom")!.click());
    React.act(() => experimentalSettings.setEnabled(true));
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Bottom"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "ULTIM8 jig pegs")!.click());
    await clickButton("Use jig settings");
    expect(currentSpec()).toEqual(entrySpec);
  });

  it("saves the fixture before Trace and returns the object into the same unnamed fixture", async () => {
    let saved: ProjectDoc | null = null;
    vi.mocked(Persistence.loadProjectDoc).mockImplementation(async () => saved);
    vi.mocked(Persistence.saveProjectDoc).mockImplementation(async doc => { saved = doc; return true; });
    const trace = vi.spyOn(TraceStore, "useTrace").mockReturnValue({ ...TraceStore.initialTraceState,
      dispatch: vi.fn(), canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn(), draftSaveStatus: "saved",
      fileName: "Test object", imageSize: { width: 100, height: 100 },
      calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 },
      outline: [{ outer: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 30 }, { x: 10, y: 30 }], holes: [] }] });
    try {
      const { route, container } = enterFixture();
      await flushHydration();
      const original = currentSpec();
      await clickButton("Trace an object from a photo");
      expect(Persistence.saveProjectDoc).toHaveBeenCalledWith(expect.objectContaining({ spec: original }), null);
      await clickButton("Add to bin");
      await flushHydration();
      expect(route.history?.at(-1)).toBe("/bin");
      expect(currentSpec()).toEqual(original);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toHaveLength(1);
      expect(container.querySelector('[data-testid="queued-destination-changed"]')).toBeNull();
      expect(Persistence.startNewProject).toHaveBeenCalledOnce();
    } finally { trace.mockRestore(); }
  });

  it("keeps the fixture open when saving before Trace fails", async () => {
    vi.mocked(Persistence.saveProjectDoc).mockResolvedValue(false);
    const { route } = enterFixture();
    await flushHydration(); await clickButton("Trace an object from a photo");
    expect(route.history).toEqual(["/about", "/bin"]);
    expect(currentSpec().pegBottom).toEqual(DEFAULT_PEG_BOTTOM);
  });
});
