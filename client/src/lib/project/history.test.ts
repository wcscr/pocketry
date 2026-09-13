import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { set } from "idb-keyval";
import { parseProjectDoc } from "@shared/gridfinity/project";
import fixture from "@shared/gridfinity/fixtures/ryobi-split-reload.pocketry.json";
import { prepareProjectExport } from "./export";
import {
  createDebouncedProjectSaver, duplicateProjectInLibrary, exportProjectLibrary,
  importProjectLibrary, loadProjectDoc, openProjectFromLibrary,
  saveProjectDoc, saveProjectToLibrary, startNewProject,
} from "./persist";

const memory = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => structuredClone(memory.get(key))),
  set: vi.fn(async (key: string, value: unknown) => { memory.set(key, structuredClone(value)); }),
}));
const project = parseProjectDoc(fixture)!;
const baseline = { spec: project.spec, cutouts: [], fingerHoles: [] };
const present = { spec: project.spec, cutouts: project.cutouts, fingerHoles: project.fingerHoles };
const saved = { ...project, history: { stack: [
  { doc: baseline, label: "Project opened" },
  { doc: present, label: "Add split pocket" },
  { doc: baseline, label: "Remove pocket" },
], index: 1 } };
const undone = { ...saved, ...baseline, history: { ...saved.history, index: 0 } };

beforeEach(() => { memory.clear(); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("saved undo/redo history", () => {
  it("preserves independent project histories through switches, duplication and reload", async () => {
    const a = await saveProjectToLibrary(saved, "A", null);
    await startNewProject(project);
    const b = await saveProjectToLibrary(project, "B", null);
    const reopened = await openProjectFromLibrary(a.activeProjectId!);
    expect(reopened.doc.history).toEqual(saved.history);
    expect((await loadProjectDoc())!.history).toEqual(saved.history);
    await saveProjectDoc(undone, a.activeProjectId);
    const copy = await duplicateProjectInLibrary(a.activeProjectId!);
    await openProjectFromLibrary(b.activeProjectId!);
    expect((await loadProjectDoc())!.history).toBeUndefined();
    const restored = await openProjectFromLibrary(a.activeProjectId!);
    expect(restored.doc.history).toEqual(undone.history);
    expect(restored.doc.cutouts).toEqual([]);
    expect(restored.doc.shapes).toEqual(saved.shapes);
    expect((await openProjectFromLibrary(copy.project.id)).doc.history).toEqual(undone.history);
  });

  it("round-trips history and its cursor through editable export and full library backup", async () => {
    const exported = JSON.parse(await prepareProjectExport(undone, "A").backup.text());
    const imported = parseProjectDoc(exported)!;
    expect(imported.history).toEqual(undone.history);
    await startNewProject(imported);
    await saveProjectToLibrary(imported, "A", null);
    await saveProjectToLibrary(saved, "B", null);
    const backup = JSON.parse(JSON.stringify(await exportProjectLibrary()));
    memory.clear();
    const result = await importProjectLibrary(backup);
    const [a, b] = result.library.projects;
    expect((await openProjectFromLibrary(a.id)).doc.history).toEqual(undone.history);
    expect((await openProjectFromLibrary(b.id)).doc.history).toEqual(saved.history);
  });

  it("flushes the final edit on workspace exit before the next load reads it", async () => {
    vi.useFakeTimers();
    const library = await saveProjectToLibrary(saved, "A", null);
    const saver = createDebouncedProjectSaver();
    saver(undone, library.activeProjectId);
    const flushed = saver.flush();
    expect((await loadProjectDoc())!.history).toEqual(undone.history);
    expect(await flushed).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect((await loadProjectDoc())!.history).toEqual(undone.history);
  });

  it("prevents a delayed autosave for A from replacing B after a switch", async () => {
    vi.useFakeTimers();
    const a = await saveProjectToLibrary(saved, "A", null);
    const b = await saveProjectToLibrary(project, "B", null);
    await openProjectFromLibrary(a.activeProjectId!);
    const onSaved = vi.fn();
    const saver = createDebouncedProjectSaver(500, onSaved);
    saver(undone, a.activeProjectId);
    await openProjectFromLibrary(b.activeProjectId!);
    await vi.advanceTimersByTimeAsync(600);
    expect(onSaved).toHaveBeenLastCalledWith(false);
    expect((await loadProjectDoc())!.name).toBe("B");
    expect((await loadProjectDoc())!.history).toBeUndefined();
    expect((await openProjectFromLibrary(a.activeProjectId!)).doc.history).toEqual(saved.history);
  });

  it("retains the last durable history and reports storage failures", async () => {
    const a = await saveProjectToLibrary(saved, "A", null);
    vi.mocked(set).mockRejectedValueOnce(new Error("Quota exceeded"));
    const onSaved = vi.fn();
    const saver = createDebouncedProjectSaver(500, onSaved);
    saver(undone, a.activeProjectId);
    expect(await saver.flush()).toBe(false);
    expect(onSaved).toHaveBeenLastCalledWith(false);
    expect((await loadProjectDoc())!.history).toEqual(saved.history);
    expect(undone.history.index).toBe(0);
  });

  it("preserves a malformed working copy and rejects malformed backups without writes", async () => {
    const invalid = { ...saved, history: { ...saved.history, index: 99 } };
    memory.set("tooltrace:project:v1", invalid);
    expect(await loadProjectDoc()).toBeNull();
    expect(await saveProjectDoc(saved)).toBe(false);
    expect(memory.get("tooltrace:project:v1")).toEqual(invalid);
    expect(set).not.toHaveBeenCalled();
    memory.clear();
    await saveProjectToLibrary(saved, "A", null);
    const backup = await exportProjectLibrary();
    backup.projects[0].doc = invalid;
    const before = structuredClone([...memory]);
    await expect(importProjectLibrary(backup)).rejects.toThrow();
    expect([...memory]).toEqual(before);
  });
});
