import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMany } from "idb-keyval";
import { PanelProvider } from "@/components/layout/panel-context";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { recordTransformOrigins } from "@shared/gridfinity/transform-origins";
import { parseProjectDoc } from "@shared/gridfinity/project";
import fixture from "@shared/gridfinity/fixtures/ryobi-split-reload.pocketry.json";
import {
  exportProjectLibrary, loadProjectDoc, loadProjectLibrary,
  saveProjectToLibrary, startNewProject,
} from "@/lib/project/persist";
import BinDesignerPage from "./bin-designer";

// Exercise the real persistence/hydration/autosave path; only the storage
// adapter and WebGL worker are replaced in this jsdom integration test.
const memory = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => structuredClone(memory.get(key))),
  set: vi.fn(async (key: string, value: unknown) => { memory.set(key, structuredClone(value)); }),
  setMany: vi.fn(async (entries: [IDBValidKey, unknown][]) => {
    for (const [key, value] of entries) memory.set(String(key), structuredClone(value));
  }),
}));
vi.mock("@/components/gridfinity/bin-viewport", () => ({ BinViewport: () => <div /> }));
vi.mock("@/lib/gridfinity/use-bin-geometry", () => ({
  useBinGeometry: () => ({
    geometry: null, stats: null, builtSpec: null, cutoutReports: [],
    hasPocketFloor: false, hasStackingRim: false, building: false, progress: 1, error: null,
    buildOnce: vi.fn(), buildFitCheck: vi.fn(), buildSurfaceFitCheck: vi.fn(),
  }),
}));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

beforeEach(() => {
  memory.clear();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media,
    addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  window.localStorage?.clear();
  window.sessionStorage?.clear();
  vi.unstubAllGlobals();
});

async function mountPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => root.render(
    <PanelProvider><ShapeLibraryProvider><BinDesignerPage /></ShapeLibraryProvider></PanelProvider>,
  ));
  return { container, async unmount() {
    await React.act(async () => root.unmount());
    await loadProjectDoc(); // Wait for any final autosave before the next mount.
    container.remove();
  } };
}

async function seedDetachedProject() {
  const original = { ...parseProjectDoc(fixture)!, name: "Ryobi Cutter" };
  const originalLibrary = await saveProjectToLibrary(original, original.name, null);
  const other = await saveProjectToLibrary({ ...original, keepBinSize: false }, "Other project", null);
  const initial = { spec: original.spec, cutouts: original.cutouts, fingerHoles: original.fingerHoles };
  const edited = { ...initial, spec: { ...original.spec, heightUnits: original.spec.heightUnits + 1 } };
  const working = { ...original, ...edited, keepBinSize: true, history: {
    stack: [{ doc: initial, label: "Project opened" }, { doc: edited, label: "Change bin height" }], index: 1,
  } };
  await startNewProject(working);
  return { original, originalId: originalLibrary.activeProjectId!, otherId: other.activeProjectId!, working };
}

describe("named project recovery through the Bin workspace", () => {
  it("recovers newer Ryobi edits, survives a reload, and switches projects without discarding a draft", async () => {
    const { original, originalId, otherId, working } = await seedDetachedProject();
    let page = await mountPage();
    try {
      const recovered = await loadProjectLibrary();
      expect(recovered.activeProjectId).not.toBeNull();
      expect(recovered.activeProjectId).not.toBe(originalId);
      expect(page.container.querySelector('[data-testid="project-status-title"]')!.textContent).toBe("Ryobi Cutter (recovered)");
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Project recovered" }));
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
      expect(page.container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Saved to browser library");
      expect(await loadProjectDoc()).toEqual({ ...working, transformOrigins: recordTransformOrigins({ pockets: [], fingerHoles: [] }, working.history.stack.map(e => e.doc)), name: "Ryobi Cutter (recovered)" });
      expect((await exportProjectLibrary()).projects.find(project => project.id === originalId)!.doc).toEqual(original);

      await page.unmount();
      page = await mountPage();
      expect((await loadProjectLibrary()).activeProjectId).toBe(recovered.activeProjectId);
      expect((await loadProjectLibrary()).projects).toHaveLength(3);
      expect(page.container.querySelector('[data-testid="project-status-title"]')!.textContent).toBe("Ryobi Cutter (recovered)");
      await React.act(async () => page.container.querySelector<HTMLButtonElement>('[data-testid="bin-settings-jump-project"]')!.click());
      await React.act(async () => page.container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>(`[data-testid="button-open-project-${otherId}"]`)!.click());
      expect(document.querySelector('[data-testid="button-discard-draft-open"]')).toBeNull();
      expect((await loadProjectLibrary()).activeProjectId).toBe(otherId);
      const stored = (await exportProjectLibrary()).projects.find(project => project.id === recovered.activeProjectId)!;
      expect(stored.doc).toEqual({ ...working, transformOrigins: recordTransformOrigins({ pockets: [], fingerHoles: [] }, working.history.stack.map(e => e.doc)), name: "Ryobi Cutter (recovered)" });
    } finally { await page.unmount(); }
  });

  it("keeps recovery failures visible and both documents intact until an explicit save succeeds", async () => {
    const { working } = await seedDetachedProject();
    const before = structuredClone([...memory]);
    vi.mocked(setMany).mockClear();
    vi.mocked(setMany).mockRejectedValueOnce(new Error("Storage is full"));
    const page = await mountPage();
    try {
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
      expect(page.container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toContain("Could not save");
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not restore project to library" }));
      expect([...memory]).toEqual(before);
      expect(setMany).toHaveBeenCalledOnce();
      expect(await loadProjectDoc()).toEqual(working);
      await React.act(async () => page.container.querySelector<HTMLButtonElement>('[data-testid="bin-settings-jump-project"]')!.click());
      expect(page.container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.disabled).toBe(false);
      await React.act(async () => page.container.querySelector<HTMLButtonElement>('[data-testid="button-save-library"]')!.click());
      React.act(() => {
        const name = document.querySelector<HTMLInputElement>('[data-testid="input-project-name"]')!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Recovered manually");
        name.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-save-library"]')!.click());
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
      expect(page.container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Saved to browser library");
      expect(await loadProjectDoc()).toEqual({ ...working, transformOrigins: recordTransformOrigins({ pockets: [], fingerHoles: [] }, working.history.stack.map(e => e.doc)), name: "Recovered manually" });
    } finally { await page.unmount(); }
  });
});
