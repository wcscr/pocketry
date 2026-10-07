import { beforeEach, describe, expect, it, vi } from "vitest";
import { set, setMany } from "idb-keyval";
import { PROJECT_SCHEMA_VERSION, parseProjectDoc } from "@shared/gridfinity/project";
import { type LibraryBackup } from "@shared/gridfinity/library";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import airdusterV9 from "@shared/gridfinity/fixtures/airduster-v9.pocketry.json";
import ryobiReloadFixture from "@shared/gridfinity/fixtures/ryobi-split-reload.pocketry.json";
import {
  exportProjectLibrary, importProjectLibrary, loadProjectDoc,
  loadProjectLibrary, openProjectFromLibrary, saveProjectDoc, saveProjectToLibrary,
} from "./persist";

const memory = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => memory.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { memory.set(key, value); }),
  setMany: vi.fn(async (entries: [IDBValidKey, unknown][]) => {
    for (const [key, value] of entries) memory.set(String(key), value);
  }),
}));
const DOC = parseProjectDoc(airdusterV9)!;
const LIBRARY_KEY = "tooltrace:project-library:v1";
const backup = (docs: Record<string, unknown>[] = [DOC]): LibraryBackup => ({
  format: "pocketry-library", schemaVersion: 1,
  projects: docs.map((doc, index) => ({
    id: `design-${index}`, name: `Design ${index}`, updatedAt: "2026-09-12T12:00:00.000Z", doc,
  })),
});

beforeEach(() => { memory.clear(); vi.clearAllMocks(); });

describe("library JSON transfer", () => {
  it("keeps independent colors through library backup, import, switches and reload", async () => {
    const first = { ...DOC, materials: { ...DEFAULT_BIN_MATERIALS,
      binColor: "#123456", pocketFloorColor: "#abcdef", stackingRimColor: "#654321",
      colorPocketFloors: false, borderWidthMm: 4,
    } };
    const second = { ...DOC, materials: { ...DEFAULT_BIN_MATERIALS, binColor: "#aabbcc" } };
    const a = await saveProjectToLibrary(first, "A", null);
    const b = await saveProjectToLibrary(second, "B", null);
    const exported = JSON.parse(JSON.stringify(await exportProjectLibrary()));
    memory.clear();
    await importProjectLibrary(exported);
    for (const [id, materials] of [
      [a.activeProjectId!, first.materials], [b.activeProjectId!, second.materials],
      [a.activeProjectId!, first.materials],
    ] as const) {
      expect((await openProjectFromLibrary(id)).doc.materials).toEqual(materials);
      expect((await loadProjectDoc())!.materials).toEqual(materials);
    }
  });
  it("preserves the Ryobi split through repeated project switches, reloads and library exports", async () => {
    const cutter = parseProjectDoc(ryobiReloadFixture)!;
    const imported = await importProjectLibrary(backup([cutter, DOC]));
    const [cutterEntry, otherEntry] = imported.library.projects;
    for (let round = 0; round < 3; round++) {
      await openProjectFromLibrary(otherEntry.id);
      const opened = await openProjectFromLibrary(cutterEntry.id);
      expect(opened.doc.cutouts).toEqual(cutter.cutouts);
      expect(opened.doc.shapes).toEqual(cutter.shapes);
      await saveProjectDoc(opened.doc);
      expect((await loadProjectDoc())!.cutouts).toEqual(cutter.cutouts);
    }
    const exported = JSON.parse(JSON.stringify(await exportProjectLibrary()));
    memory.clear();
    await importProjectLibrary(exported);
    const restored = await openProjectFromLibrary(cutterEntry.id);
    expect(restored.doc.cutouts).toEqual(cutter.cutouts);
    expect(restored.doc.shapes).toEqual(cutter.shapes);
  });

  it("round-trips all named designs, shapes, materials and metadata into an empty library", async () => {
    await saveProjectToLibrary(DOC, "Tools", null);
    await saveProjectToLibrary({ ...DOC, keepBinSize: true }, "Fixed tools", null);
    const exported = JSON.parse(JSON.stringify(await exportProjectLibrary()));
    memory.clear();
    const result = await importProjectLibrary(exported);
    expect(result).toMatchObject({ imported: 2, upgraded: 0, renamed: 0 });
    expect(result.library.activeProjectId).toBeNull();
    expect(await loadProjectDoc()).toBeNull();
    expect(await exportProjectLibrary()).toEqual(exported);
    const opened = await openProjectFromLibrary(result.library.projects.find(p => p.name === "Fixed tools")!.id);
    expect(opened.doc).toEqual({ ...DOC, name: "Fixed tools", keepBinSize: true });
  });

  it("exports the latest active edits before debounce and excludes unnamed drafts", async () => {
    const library = await saveProjectToLibrary(DOC, "Tools", null);
    const updated = { ...DOC, keepBinSize: true };
    const exported = await exportProjectLibrary(updated);
    expect(exported.projects[0]).toMatchObject({ id: library.activeProjectId, doc: { ...updated, name: "Tools" } });
    expect((await loadProjectDoc())!.keepBinSize).toBeUndefined();
    memory.clear();
    await saveProjectDoc(updated);
    expect((await exportProjectLibrary(updated)).projects).toEqual([]);
  });

  it("upgrades mixed historical versions through the existing design migration path", async () => {
    const old: Record<string, unknown>[] = Array.from(
      { length: PROJECT_SCHEMA_VERSION - 1 },
      (_, index) => {
        // The removed liteBase flag belongs only to versions 1–10.
        const source = index < 10 ? airdusterV9 : DOC;
        const doc: Record<string, unknown> = { ...source, schemaVersion: index + 1 };
        // Versions 1–6 predate the project-level finger access array.
        if (index < 6) delete doc.fingerHoles;
        return doc;
      },
    );
    old.push(DOC);
    const result = await importProjectLibrary(backup(old));
    expect(result).toMatchObject({ imported: PROJECT_SCHEMA_VERSION, upgraded: PROJECT_SCHEMA_VERSION - 1 });
    const exported = await exportProjectLibrary();
    exported.projects.forEach((project, index) => {
      expect(project.doc).toEqual({ ...parseProjectDoc(old[index]), name: `Design ${index}` });
      expect(project.doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    });
  });

  it("preserves active work and creates distinct copies for repeated IDs and names", async () => {
    const saved = await saveProjectToLibrary(DOC, "Design 0", null);
    const before = await loadProjectDoc();
    const input = backup();
    input.projects[0].id = saved.activeProjectId!;
    await importProjectLibrary(input);
    const result = await importProjectLibrary(input);
    expect(result.renamed).toBe(1);
    expect(result.library.activeProjectId).toBe(saved.activeProjectId);
    expect(await loadProjectDoc()).toEqual(before);
    const exported = await exportProjectLibrary();
    expect(exported.projects.map(p => p.name)).toEqual(["Design 0", "Design 0 (imported)", "Design 0 (imported 2)"]);
    expect(new Set(exported.projects.map(p => p.id)).size).toBe(3);
    expect(exported.projects[0].doc).toEqual(before);
  });

  it("resolves conflicts within the file and keeps suffixed names within the length limit", async () => {
    const input = backup([DOC, DOC]);
    input.projects.forEach(p => { p.id = "same"; p.name = "A".repeat(80); });
    await importProjectLibrary(input);
    const exported = await exportProjectLibrary();
    expect(new Set(exported.projects.map(p => p.id)).size).toBe(2);
    expect(exported.projects[1].name).toHaveLength(80);
    expect(exported.projects[1].name).toMatch(/ \(imported\)$/);
  });

  it.each([
    null, { ...backup(), schemaVersion: 999 }, { ...backup(), format: "other" },
    backup([DOC, { ...DOC, schemaVersion: 999 }]),
    backup([DOC, { ...DOC, shapes: "broken" }]),
  ])("rejects invalid or future files without writing any designs (%#)", async input => {
    await saveProjectToLibrary(DOC, "Existing", null);
    const before = structuredClone([...memory]);
    vi.mocked(set).mockClear();
    await expect(importProjectLibrary(input)).rejects.toThrow();
    expect(set).not.toHaveBeenCalled();
    expect([...memory]).toEqual(before);
  });

  it("reports storage failure without changing the library or working copy", async () => {
    await saveProjectToLibrary(DOC, "Existing", null);
    const before = structuredClone([...memory]);
    vi.mocked(set).mockRejectedValueOnce(new Error("Storage is full"));
    await expect(importProjectLibrary(backup())).rejects.toThrow("Storage is full");
    expect([...memory]).toEqual(before);
    expect((await loadProjectLibrary()).projects).toHaveLength(1);
  });

  it("preserves unreadable stored designs in exports and on merge", async () => {
    const future = { schemaVersion: 999, important: [1, 2, 3] };
    memory.set(LIBRARY_KEY, { schemaVersion: 1, activeProjectId: null, projects: backup([future]).projects });
    expect((await exportProjectLibrary()).projects[0].doc).toEqual(future);
    await importProjectLibrary(backup());
    expect((await exportProjectLibrary()).projects[0].doc).toEqual(future);
    expect((await exportProjectLibrary()).projects).toHaveLength(2);
  });

  it("rejects an unreadable destination library and supports empty backups", async () => {
    expect(await exportProjectLibrary()).toEqual(backup([]));
    expect((await importProjectLibrary(backup([]))).imported).toBe(0);
    memory.set(LIBRARY_KEY, { schemaVersion: 999 });
    await expect(exportProjectLibrary()).rejects.toThrow("kept intact");
    await expect(importProjectLibrary(backup())).rejects.toThrow("kept intact");
    expect(memory.get(LIBRARY_KEY)).toEqual({ schemaVersion: 999 });
  });

  it("serializes import and autosave so neither loses the other's designs", async () => {
    await saveProjectToLibrary(DOC, "Existing", null);
    await Promise.all([importProjectLibrary(backup()), saveProjectDoc({ ...DOC, keepBinSize: true })]);
    const exported = await exportProjectLibrary();
    expect(exported.projects).toHaveLength(2);
    expect(exported.projects[0].doc.keepBinSize).toBe(true);
  });
  it("replaces the saved library atomically while keeping latest work as an unlinked draft", async () => {
    const saved = await saveProjectToLibrary(DOC, "Design 0", null);
    await saveProjectToLibrary(DOC, "Remove me", null);
    await openProjectFromLibrary(saved.activeProjectId!);
    const currentDoc = { ...DOC, name: "Design 0", keepBinSize: true };
    const input = backup();
    input.projects[0].id = saved.activeProjectId!;
    vi.mocked(setMany).mockClear();
    const result = await importProjectLibrary(input, "replace", currentDoc);
    expect(result).toMatchObject({ imported: 1, renamed: 0, library: { activeProjectId: null } });
    expect(result.library.projects.map(p => p.name)).toEqual(["Design 0"]);
    expect((await exportProjectLibrary()).projects[0].id).toBe(saved.activeProjectId);
    expect((await exportProjectLibrary()).projects[0].doc.keepBinSize).not.toBe(true);
    expect(await loadProjectDoc()).toEqual({ ...DOC, name: undefined, keepBinSize: true });
    expect(currentDoc.name).toBe("Design 0");
    expect(setMany).toHaveBeenCalledOnce();
    expect(await loadProjectLibrary(await loadProjectDoc())).toEqual(result.library);
    // A late autosave for an outgoing ID must not overwrite its imported namesake.
    expect(await saveProjectDoc(currentDoc, saved.activeProjectId)).toBe(false);
    expect((await exportProjectLibrary()).projects).toHaveLength(1);
    expect((await exportProjectLibrary()).projects[0].doc.keepBinSize).not.toBe(true);
  });

  it("can replace with an empty backup and retain the current design as a draft", async () => {
    await saveProjectToLibrary(DOC, "Existing", null);
    const result = await importProjectLibrary(backup([]), "replace");
    expect(result.library).toEqual({ activeProjectId: null, projects: [] });
    expect(await loadProjectDoc()).toEqual({ ...DOC, name: undefined });
    expect(await loadProjectLibrary(await loadProjectDoc())).toEqual(result.library);
  });

  it("replaces a library even when there is no working copy", async () => {
    await importProjectLibrary(backup());
    expect((await importProjectLibrary(backup([]), "replace")).library.projects).toEqual([]);
    expect(await loadProjectDoc()).toBeNull();
  });

  it("keeps both current work and saved library if replacement storage fails", async () => {
    await saveProjectToLibrary(DOC, "Existing", null);
    const before = structuredClone([...memory]);
    vi.mocked(setMany).mockRejectedValueOnce(new Error("Storage is full"));
    await expect(importProjectLibrary(backup(), "replace", { ...DOC, keepBinSize: true })).rejects.toThrow("Storage is full");
    expect([...memory]).toEqual(before);
  });

  it("validates the entire replacement before removing existing projects", async () => {
    await saveProjectToLibrary(DOC, "Existing", null);
    const before = structuredClone([...memory]);
    await expect(importProjectLibrary(backup([DOC, { ...DOC, schemaVersion: 999 }]), "replace")).rejects.toThrow();
    expect([...memory]).toEqual(before);
  });

  it("does not replace a library when its current working copy is unreadable", async () => {
    await saveProjectToLibrary(DOC, "Existing", null);
    memory.set("tooltrace:project:v1", { schemaVersion: 999 });
    const before = structuredClone([...memory]);
    await expect(importProjectLibrary(backup(), "replace")).rejects.toThrow("current design is unreadable");
    expect([...memory]).toEqual(before);
  });

});
