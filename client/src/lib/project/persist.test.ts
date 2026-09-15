import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";
import airdusterV9 from "@shared/gridfinity/fixtures/airduster-v9.pocketry.json";
import { prepareProjectExport } from "./export";

const memory = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => memory.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    memory.set(key, value);
  }),
}));

import {
  createDebouncedProjectSaver,
  deleteProjectFromLibrary,
  duplicateProjectInLibrary,
  loadProjectDoc,
  loadProjectLibrary,
  openProjectFromLibrary,
  ProjectNameConflictError,
  renameProjectInLibrary,
  saveProjectDoc,
  saveProjectToLibrary,
  startNewProject,
} from "./persist";

const DOC: ProjectDoc = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  shapes: [],
  spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }),
  cutouts: [],
  fingerHoles: [],
};

const WIDE_DOC: ProjectDoc = {
  ...DOC,
  spec: parseBinSpec({ gridX: 4, gridY: 2, heightUnits: 6 }),
};

beforeEach(() => {
  memory.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("current project persistence", () => {
  it("opens, saves, reloads and exports every item in the v9 Airduster project", async () => {
    memory.set("tooltrace:project:v1", structuredClone(airdusterV9));
    const migrated = (await loadProjectDoc())!;
    const { liteBase: _removed, ...spec } = airdusterV9.spec;
    expect(migrated).toEqual({ ...airdusterV9, spec: { ...spec, flatBottom: false }, schemaVersion: PROJECT_SCHEMA_VERSION });
    await saveProjectToLibrary(migrated, "New Airduster Layout", null);
    const reloaded = (await loadProjectDoc())!;
    const exported = JSON.parse(await prepareProjectExport(reloaded, reloaded.name!).backup.text());
    expect(exported).toEqual({ ...airdusterV9, spec: { ...spec, flatBottom: false }, schemaVersion: PROJECT_SCHEMA_VERSION, name: "New Airduster Layout" });
  });
  it("never overwrites an unsupported working copy during autosave", async () => {
    const future = { schemaVersion: 999, valuable: { outlines: [1, 2, 3] } };
    memory.set("tooltrace:project:v1", future);
    expect(await saveProjectDoc(DOC)).toBe(false);
    expect(memory.get("tooltrace:project:v1")).toEqual(future);
  });

  it("preserves an unreadable library envelope instead of replacing it with an empty library", async () => {
    const unknownLibrary = { schemaVersion: 99, projects: [{ important: true }] };
    memory.set("tooltrace:project-library:v1", unknownLibrary);
    expect(await saveProjectDoc(DOC)).toBe(false);
    await expect(saveProjectToLibrary(DOC, "New", null)).rejects.toThrow("kept intact");
    expect(memory.get("tooltrace:project-library:v1")).toEqual(unknownLibrary);
  });
  it("round-trips the crash-safe working copy", async () => {
    await saveProjectDoc(DOC);
    const loaded = await loadProjectDoc();
    expect(loaded).not.toBeNull();
    expect(loaded!.spec.gridX).toBe(2);
  });

  it("returns null for an empty or corrupt store", async () => {
    expect(await loadProjectDoc()).toBeNull();
    memory.set("tooltrace:project:v1", { schemaVersion: 99 });
    expect(await loadProjectDoc()).toBeNull();
  });

  it("debounces saves to the trailing edge and can cancel a pending write", async () => {
    vi.useFakeTimers();
    const save = createDebouncedProjectSaver(500);
    save(DOC);
    save({ ...DOC, spec: parseBinSpec({ gridX: 3, gridY: 2, heightUnits: 6 }) });
    save(WIDE_DOC);

    expect(memory.size).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(memory.size).toBe(1);
    expect((memory.get("tooltrace:project:v1") as ProjectDoc).spec.gridX).toBe(4);

    save(DOC);
    save.cancel();
    await vi.advanceTimersByTimeAsync(600);
    expect((memory.get("tooltrace:project:v1") as ProjectDoc).spec.gridX).toBe(4);
  });
});

describe("named project library", () => {
  it("creates a named project, trims its name, and makes it active", async () => {
    const library = await saveProjectToLibrary(DOC, "  Wrench   tray  ", null);

    expect(library.projects).toHaveLength(1);
    expect(library.projects[0].name).toBe("Wrench tray");
    expect(library.activeProjectId).toBe(library.projects[0].id);
    expect(await loadProjectDoc()).toEqual({ ...DOC, name: "Wrench tray" });
  });

  it("renames and updates the active project instead of duplicating it", async () => {
    const created = await saveProjectToLibrary(DOC, "Wrench tray", null);
    const updated = await saveProjectToLibrary(
      WIDE_DOC,
      "Wide wrench tray",
      created.activeProjectId,
    );

    expect(updated.projects).toHaveLength(1);
    expect(updated.projects[0].name).toBe("Wide wrench tray");
    const opened = await openProjectFromLibrary(updated.projects[0].id);
    expect(opened.doc.spec.gridX).toBe(4);
  });

  it("copies pending edits from the current project without opening or changing the original", async () => {
    const saved = await saveProjectToLibrary(DOC, "Tools", null);
    const working = await loadProjectDoc();
    const copied = await duplicateProjectInLibrary(saved.activeProjectId!, WIDE_DOC);
    expect(copied.project.name).toBe("Tools (copy)");
    expect(copied.project.id).not.toBe(saved.activeProjectId);
    expect(copied.library.activeProjectId).toBe(saved.activeProjectId);
    expect(await loadProjectDoc()).toEqual(working);
    expect((await openProjectFromLibrary(copied.project.id)).doc).toEqual({ ...WIDE_DOC, name: "Tools (copy)" });
    await saveProjectDoc({ ...WIDE_DOC, keepBinSize: true });
    expect((await openProjectFromLibrary(saved.activeProjectId!)).doc).toEqual({ ...DOC, name: "Tools" });
  });

  it("copies the stored design of another project, not the current working design", async () => {
    const first = await saveProjectToLibrary(DOC, "Small tray", null);
    const second = await saveProjectToLibrary(WIDE_DOC, "Wide tray", null);
    const copied = await duplicateProjectInLibrary(first.activeProjectId!, WIDE_DOC);
    expect(copied.library.activeProjectId).toBe(second.activeProjectId);
    expect((await loadProjectDoc())!.spec.gridX).toBe(4);
    expect((await openProjectFromLibrary(copied.project.id)).doc).toEqual({ ...DOC, name: "Small tray (copy)" });
  });

  it("gives repeated copies unique names within the project name limit", async () => {
    const saved = await saveProjectToLibrary(DOC, "A".repeat(80), null);
    const first = await duplicateProjectInLibrary(saved.activeProjectId!);
    const second = await duplicateProjectInLibrary(saved.activeProjectId!);
    expect(first.project.name).toHaveLength(80);
    expect(second.project.name).toHaveLength(80);
    expect(first.project.name.endsWith(" (copy)")).toBe(true);
    expect(second.project.name.endsWith(" (copy 2)")).toBe(true);
    expect(new Set(second.library.projects.map(project => project.id)).size).toBe(3);
    expect(second.library.activeProjectId).toBe(saved.activeProjectId);
  });

  it("keeps each copy directly after its source through reloads, renames, and autosave", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const first = await saveProjectToLibrary(DOC, "First", null);
    vi.setSystemTime(new Date("2026-09-12T13:00:00Z"));
    const source = await saveProjectToLibrary(WIDE_DOC, "Source", null);
    vi.setSystemTime(new Date("2026-09-12T14:00:00Z"));
    const last = await saveProjectToLibrary(DOC, "Last", null);
    const originalOrder = [first.activeProjectId, source.activeProjectId, last.activeProjectId];
    expect((await loadProjectLibrary()).projects.map(project => project.id)).toEqual(originalOrder);
    const copy = await duplicateProjectInLibrary(source.activeProjectId!);
    const nextCopy = await duplicateProjectInLibrary(source.activeProjectId!);
    const expectedOrder = [first.activeProjectId, source.activeProjectId, nextCopy.project.id, copy.project.id, last.activeProjectId];
    expect(nextCopy.library.projects.map(project => project.id)).toEqual(expectedOrder);
    await renameProjectInLibrary(copy.project.id, "Renamed copy");
    await saveProjectDoc({ ...DOC, keepBinSize: true });
    expect((await loadProjectLibrary()).projects.map(project => project.id)).toEqual(expectedOrder);
    expect((await loadProjectLibrary()).activeProjectId).toBe(last.activeProjectId);
  });

  it("rejects copying missing or unsupported projects without changing storage", async () => {
    const future = { id: "future", name: "Future project", updatedAt: "2026-09-12T12:00:00.000Z", doc: { schemaVersion: 999 } };
    memory.set("tooltrace:project-library:v1", { schemaVersion: 1, activeProjectId: null, projects: [future] });
    const before = structuredClone([...memory]);
    await expect(duplicateProjectInLibrary("missing")).rejects.toThrow("no longer");
    await expect(duplicateProjectInLibrary("future", DOC)).rejects.toThrow("unsupported");
    expect([...memory]).toEqual(before);
  });

  it("renames another saved project without changing the open project or either design", async () => {
    const first = await saveProjectToLibrary(DOC, "Small tray", null);
    const second = await saveProjectToLibrary(WIDE_DOC, "Wide tray", null);
    const working = await loadProjectDoc();
    const renamed = await renameProjectInLibrary(first.activeProjectId!, "  Socket   tray  ");
    expect(renamed.activeProjectId).toBe(second.activeProjectId);
    expect(renamed.projects).toHaveLength(2);
    expect(renamed.projects.find(project => project.id === first.activeProjectId)?.name).toBe("Socket tray");
    expect(await loadProjectDoc()).toEqual(working);
    expect((await openProjectFromLibrary(first.activeProjectId!)).doc).toEqual({ ...DOC, name: "Socket tray" });
    expect((await openProjectFromLibrary(second.activeProjectId!)).doc).toEqual({ ...WIDE_DOC, name: "Wide tray" });
  });

  it("rejects conflicting library renames without writing any project", async () => {
    const first = await saveProjectToLibrary(DOC, "Small tray", null);
    await saveProjectToLibrary(WIDE_DOC, "Wide tray", null);
    const before = structuredClone([...memory]);
    await expect(renameProjectInLibrary(first.activeProjectId!, "wide TRAY")).rejects.toBeInstanceOf(ProjectNameConflictError);
    expect([...memory]).toEqual(before);
  });

  it.each(["", "x".repeat(81)])("rejects invalid library rename %j without changing storage", async (name) => {
    const saved = await saveProjectToLibrary(DOC, "Tools", null);
    const before = structuredClone([...memory]);
    await expect(renameProjectInLibrary(saved.activeProjectId!, name)).rejects.toThrow();
    expect([...memory]).toEqual(before);
  });

  it("preserves unsupported entries and rejects renaming missing or unsupported projects", async () => {
    const future = { id: "future", name: "Future project", updatedAt: "2026-09-12T12:00:00.000Z", doc: { schemaVersion: 999 } };
    memory.set("tooltrace:project-library:v1", { schemaVersion: 1, activeProjectId: null, projects: [future] });
    const saved = await saveProjectToLibrary(DOC, "Tools", null);
    await renameProjectInLibrary(saved.activeProjectId!, "Renamed tools");
    const before = structuredClone([...memory]);
    await expect(renameProjectInLibrary("missing", "Missing")).rejects.toThrow("no longer");
    await expect(renameProjectInLibrary("future", "Future renamed")).rejects.toThrow("unsupported");
    expect([...memory]).toEqual(before);
    expect((memory.get("tooltrace:project-library:v1") as { projects: unknown[] }).projects).toContainEqual(future);
  });

  it("rejects ambiguous duplicate names", async () => {
    await saveProjectToLibrary(DOC, "Wrench Tray", null);
    await startNewProject(DOC);

    await expect(saveProjectToLibrary(DOC, "wrench tray", null)).rejects.toBeInstanceOf(
      ProjectNameConflictError,
    );
  });

  it("autosaves material changes into the active named project", async () => {
    const created = await saveProjectToLibrary(DOC, "Wrench tray", null);
    await saveProjectDoc(WIDE_DOC);

    const opened = await openProjectFromLibrary(created.projects[0].id);
    expect(opened.doc.spec.gridX).toBe(4);
  });

  it("opens a selected project and uses it as the resumable working copy", async () => {
    const first = await saveProjectToLibrary(DOC, "Small tray", null);
    await startNewProject(WIDE_DOC);
    const second = await saveProjectToLibrary(WIDE_DOC, "Wide tray", null);

    const opened = await openProjectFromLibrary(first.projects[0].id);
    expect(opened.project.name).toBe("Small tray");
    expect(opened.library.activeProjectId).toBe(first.projects[0].id);
    expect((await loadProjectDoc())!.spec.gridX).toBe(2);
    expect(second.projects).toHaveLength(2);
  });

  it("migrates older documents inside the named project library", async () => {
    const version8 = JSON.parse(JSON.stringify(WIDE_DOC)) as Record<string, unknown>;
    version8.schemaVersion = 8;
    memory.set("tooltrace:project-library:v1", {
      schemaVersion: 1,
      activeProjectId: "legacy-project",
      projects: [
        {
          id: "legacy-project",
          name: "Layout 2",
          updatedAt: "2026-09-04T18:30:17.089Z",
          doc: version8,
        },
      ],
    });

    expect(await loadProjectLibrary()).toEqual({
      activeProjectId: "legacy-project",
      projects: [
        {
          id: "legacy-project",
          name: "Layout 2",
          updatedAt: "2026-09-04T18:30:17.089Z",
        },
      ],
    });
    const opened = await openProjectFromLibrary("legacy-project");
    expect(opened.doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(opened.doc.spec.gridX).toBe(4);
  });

  it("preserves unreadable project records when saving a readable project", async () => {
    memory.set("tooltrace:project-library:v1", {
      schemaVersion: 1,
      activeProjectId: null,
      projects: [
        {
          id: "future-project",
          name: "Future project",
          updatedAt: "2026-09-04T18:30:17.089Z",
          doc: { schemaVersion: 999 },
        },
      ],
    });

    expect((await loadProjectLibrary()).projects).toEqual([]);
    await saveProjectToLibrary(DOC, "Current project", null);
    const stored = memory.get("tooltrace:project-library:v1") as {
      projects: Array<{ id: string; doc: unknown }>;
    };
    expect(stored.projects.find((project) => project.id === "future-project")?.doc).toEqual({
      schemaVersion: 999,
    });
  });

  it("deleting the active named project keeps the working copy as an unnamed draft", async () => {
    const created = await saveProjectToLibrary(WIDE_DOC, "Wide tray", null);
    const deleted = await deleteProjectFromLibrary(created.projects[0].id);

    expect(deleted.projects).toEqual([]);
    expect(deleted.activeProjectId).toBeNull();
    expect((await loadProjectDoc())!.spec.gridX).toBe(4);
  });

  it("detaches a new project without deleting saved library entries", async () => {
    await saveProjectToLibrary(WIDE_DOC, "Wide tray", null);
    const library = await startNewProject(DOC);

    expect(library.activeProjectId).toBeNull();
    expect(library.projects.map((project) => project.name)).toEqual(["Wide tray"]);
    expect((await loadProjectDoc())!.spec.gridX).toBe(2);
    expect((await loadProjectLibrary()).projects).toHaveLength(1);
  });

  it("ignores corrupt library data", async () => {
    memory.set("tooltrace:project-library:v1", {
      schemaVersion: 1,
      activeProjectId: "missing",
      projects: [{ id: "broken" }],
    });

    expect(await loadProjectLibrary()).toEqual({
      activeProjectId: null,
      projects: [],
    });
  });

  it("keeps named v4 projects while removing their legacy lite base choice", async () => {
    const legacyDoc = JSON.parse(JSON.stringify(DOC)) as Record<string, unknown>;
    legacyDoc.schemaVersion = 4;
    delete legacyDoc.fingerHoles;
    (legacyDoc.spec as Record<string, unknown>).liteBase = true;
    memory.set("tooltrace:project-library:v1", {
      schemaVersion: 1,
      activeProjectId: "legacy-project",
      projects: [
        {
          id: "legacy-project",
          name: "Legacy tray",
          updatedAt: "2026-09-03T12:00:00.000Z",
          doc: legacyDoc,
        },
      ],
    });

    const library = await loadProjectLibrary();
    expect(library.projects).toHaveLength(1);
    expect(library.activeProjectId).toBe("legacy-project");
    const opened = await openProjectFromLibrary("legacy-project");
    expect(opened.doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(opened.doc.spec).not.toHaveProperty("liteBase");
  });
});
