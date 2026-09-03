import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";

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
  loadProjectDoc,
  loadProjectLibrary,
  openProjectFromLibrary,
  ProjectNameConflictError,
  saveProjectDoc,
  saveProjectToLibrary,
  startNewProject,
} from "./persist";

const DOC: ProjectDoc = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  shapes: [],
  spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }),
  cutouts: [],
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
    expect(await loadProjectDoc()).toEqual(DOC);
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
