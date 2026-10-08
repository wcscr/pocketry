import "@/lib/project/mock-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseProjectDoc, serializeProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import fixture from "@shared/gridfinity/fixtures/airduster-v9.pocketry.json";
import { MemoryDirectory } from "./folder-test-helpers";
import { FolderLibrary } from "./folder-library";

const memory = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => memory.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { memory.set(key, value); }),
  setMany: vi.fn(async (entries: [string, unknown][]) => { entries.forEach(([key, value]) => memory.set(key, value)); }),
}));
const DOC = parseProjectDoc(fixture)!;
const browserKey = "tooltrace:project-library:v1";
const currentKey = "tooltrace:project:v1";
const folderCurrentKey = "pocketry:folder-working-copy:v1";
const load = () => import("./persist");
beforeEach(() => { memory.clear(); vi.resetModules(); });

describe("folder-backed project persistence", () => {
  it("copies the browser library without changing originals, then autosaves only to the folder", async () => {
    const p = await load();
    const browser = await p.saveProjectToLibrary(DOC, "Browser tools", null);
    const original = structuredClone(memory.get(browserKey));
    const originalWorking = structuredClone(memory.get(currentKey));
    const root = new MemoryDirectory();
    const connected = await p.connectLibraryFolder(root, true, DOC);
    expect(connected.activeProjectId).toBeNull();
    expect(connected.projects).toEqual(browser.projects);
    expect(memory.get(browserKey)).toEqual(original);
    expect(memory.get(currentKey)).toEqual(originalWorking);
    await p.openProjectFromLibrary(browser.activeProjectId!);
    const changed = { ...DOC, keepBinSize: true };
    expect(await p.saveProjectDoc(changed, browser.activeProjectId)).toBe(true);
    expect(memory.get(browserKey)).toEqual(original);
    expect((await FolderLibrary.open(root, false)).projects[0].doc.keepBinSize).toBe(true);
    await p.disconnectLibraryFolder(changed);
    expect((await p.loadProjectLibrary()).projects).toEqual(browser.projects);
    expect((await p.loadProjectDoc())?.keepBinSize).toBe(true);
  });

  it("reconnects after clearing all browser data, preserving identity, materials and committed history", async () => {
    const p = await load();
    const root = new MemoryDirectory();
    const baseline = { spec: DOC.spec, cutouts: DOC.cutouts, fingerHoles: DOC.fingerHoles };
    const changed = { ...baseline, spec: { ...DOC.spec, gridX: DOC.spec.gridX + 1 } };
    const doc = { ...DOC, ...changed, history: { stack: [{ doc: baseline, label: "Opened" }, { doc: changed, label: "Wider" }], index: 1 } };
    expect(parseProjectDoc(doc)).not.toBeNull();
    await p.connectLibraryFolder(root, false, DOC);
    const saved = await p.saveProjectToLibrary(doc, "History", null);
    memory.clear();
    vi.resetModules();
    const fresh = await load();
    expect((await fresh.loadProjectLibrary()).projects).toEqual([]);
    await fresh.connectLibraryFolder(root, false, DOC);
    const opened = await fresh.openProjectFromLibrary(saved.activeProjectId!);
    expect(opened.doc.history).toEqual(doc.history);
    expect(opened.doc.shapes).toEqual(doc.shapes);
    expect(opened.doc.spec).toEqual(doc.spec);
    expect(opened.project.id).toBe(saved.activeProjectId);
    vi.resetModules();
    const reloaded = await load();
    expect((await reloaded.loadProjectDoc())?.history).toEqual(doc.history);
    expect((await reloaded.loadProjectLibrary()).activeProjectId).toBe(saved.activeProjectId);
  });

  it("migrates old projects on disk while retaining their original revision", async () => {
    const root = new MemoryDirectory();
    const folder = await FolderLibrary.open(root, true);
    await folder.write([{ id: "old", name: "Old", updatedAt: "2026-10-08T12:00:00.000Z", doc: fixture }]);
    const original = [...root.directories.get("pocketry-library")!.files.values()][0];
    const p = await load();
    await p.connectLibraryFolder(root, false, DOC);
    const opened = await p.openProjectFromLibrary("old");
    expect(opened.doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    await p.saveProjectDoc(opened.doc, "old");
    expect([...root.directories.get("pocketry-library")!.files.values()]).toContain(original);
    expect((await p.exportProjectLibrary()).projects[0].doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it("keeps browser copies with conflicting IDs/names and exposes future projects in exports", async () => {
    const p = await load();
    const local = await p.saveProjectToLibrary(DOC, "Tools", null);
    const root = new MemoryDirectory();
    const folder = await FolderLibrary.open(root, true);
    const project = { id: local.activeProjectId!, name: "Tools", updatedAt: "2026-10-08T12:00:00.000Z", doc: { ...serializeProjectDoc(DOC), keepBinSize: true } };
    await folder.write([project, { ...project, id: "future", name: "Future", doc: { schemaVersion: 999, valuable: [1, 2, 3] } }]);
    const snapshot = await p.connectLibraryFolder(root, true, DOC);
    expect(snapshot.projects.map(p => p.name)).toEqual(["Tools", "Future", "Tools (imported)"]);
    expect(snapshot.projects[1].unavailable).toBe("newer-version");
    expect((await p.exportProjectLibrary()).projects[1].doc).toEqual({ schemaVersion: 999, valuable: [1, 2, 3] });
  });

  it("preserves pending autosave work on permission loss and resumes after a user reconnect", async () => {
    const p = await load();
    const root = new MemoryDirectory();
    await p.connectLibraryFolder(root, false, DOC);
    const saved = await p.saveProjectToLibrary(DOC, "Tools", null);
    const dir = root.directories.get("pocketry-library")!;
    dir.permission = "denied";
    expect(await p.saveProjectDoc({ ...DOC, keepBinSize: true }, saved.activeProjectId)).toBe(false);
    expect(parseProjectDoc(memory.get(folderCurrentKey))?.keepBinSize).toBe(true);
    await expect(p.loadProjectLibrary()).rejects.toThrow("permission");
    dir.permission = "granted";
    await p.reconnectLibraryFolder();
    expect(await p.saveProjectDoc({ ...DOC, keepBinSize: true }, saved.activeProjectId)).toBe(true);
    expect((await FolderLibrary.open(root, false)).projects[0].doc.keepBinSize).toBe(true);
  });

  it("blocks stale reload autosave and resolves without losing the latest external or local edits", async () => {
    const p = await load();
    const root = new MemoryDirectory();
    await p.connectLibraryFolder(root, false, DOC);
    const saved = await p.saveProjectToLibrary(DOC, "Tools", null);
    const external = await FolderLibrary.open(root, false);
    await external.write(external.projects.map(project => ({ ...project, name: "External", doc: { ...project.doc, name: "External" } })));
    vi.resetModules();
    const stale = await load();
    expect(await stale.loadProjectDoc()).not.toBeNull();
    await expect(stale.loadProjectLibrary()).rejects.toThrow("changed");
    const pending = { ...DOC, name: "Local", keepBinSize: true };
    expect(await stale.saveProjectDoc(pending, saved.activeProjectId)).toBe(false);
    const resolved = await stale.resolveLibraryFolderConflict(pending);
    expect(resolved.activeProjectId).toBeNull();
    expect(resolved.projects.map(p => p.name)).toEqual(["External", "Local (conflict)"]);
    const exported = await stale.exportProjectLibrary();
    expect(exported.projects[1].doc.keepBinSize).toBe(true);
    expect((await stale.loadProjectDoc())?.name).toBeUndefined();
  });

  it("does not let a late outgoing autosave replace the new project's recovery copy", async () => {
    const p = await load();
    const root = new MemoryDirectory();
    await p.connectLibraryFolder(root, false, DOC);
    const a = await p.saveProjectToLibrary(DOC, "A", null);
    const b = await p.saveProjectToLibrary({ ...DOC, keepBinSize: true }, "B", null);
    const before = await p.loadProjectDoc();
    expect(await p.saveProjectDoc(DOC, a.activeProjectId)).toBe(false);
    expect(await p.loadProjectDoc()).toEqual(before);
    expect((await p.loadProjectLibrary()).activeProjectId).toBe(b.activeProjectId);
    memory.set(folderCurrentKey, { schemaVersion: 999, valuable: true });
    expect(await p.saveProjectDoc(DOC, b.activeProjectId)).toBe(false);
    expect(memory.get(folderCurrentKey)).toEqual({ schemaVersion: 999, valuable: true });
  });

  it("routes rename, duplicate, removal, import and replacement to the same folder", async () => {
    const p = await load();
    const root = new MemoryDirectory();
    await p.connectLibraryFolder(root, false, DOC);
    const a = await p.saveProjectToLibrary(DOC, "A", null);
    const copied = await p.duplicateProjectInLibrary(a.activeProjectId!);
    await p.renameProjectInLibrary(copied.project.id, "B");
    const backup = await p.exportProjectLibrary();
    await p.deleteProjectFromLibrary(copied.project.id);
    expect((await FolderLibrary.open(root, false)).projects.map(p => p.name)).toEqual(["A"]);
    await p.importProjectLibrary(backup, "replace", DOC);
    const reopened = await FolderLibrary.open(root, false);
    expect(reopened.projects.map(p => p.name)).toEqual(["A", "B"]);
    expect((await p.loadProjectLibrary()).activeProjectId).toBeNull();
    expect(memory.has(browserKey)).toBe(false);
    expect(root.directories.get("pocketry-library")!.files.size).toBe(6);
  });

  it("exports unreadable browser data without parsing or replacing it", async () => {
    const p = await load();
    const raw = { schemaVersion: 999, projects: "unreadable but valuable" };
    memory.set(browserKey, raw);
    memory.set(currentKey, DOC);
    await expect(p.loadProjectLibrary()).rejects.toThrow("unreadable");
    expect(await p.exportBrowserLibraryRecovery()).toEqual({ format: "pocketry-browser-recovery", library: raw, workingCopy: DOC });
    expect(memory.get(browserKey)).toEqual(raw);
  });
});
