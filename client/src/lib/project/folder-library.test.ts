import { describe, expect, it } from "vitest";
import { FolderConflictError, FolderLibrary, FolderPermissionError } from "./folder-library";
import { MemoryDirectory } from "./folder-test-helpers";
import { parseProjectDoc } from "@shared/gridfinity/project";
import fixture from "@shared/gridfinity/fixtures/airduster-v9.pocketry.json";
import type { StoredProject } from "@shared/gridfinity/library";

const project = (name = "Tools"): StoredProject => ({ id: "tools", name,
  updatedAt: "2026-10-08T12:00:00.000Z", doc: { ...parseProjectDoc(fixture)!, name } });

describe("durable connected-folder revision protocol", () => {
  it("reopens identities and complete documents from a new independent session", async () => {
    const root = new MemoryDirectory();
    const chrome = await FolderLibrary.open(root, true);
    await chrome.write([project()]);
    const edge = await FolderLibrary.open(root, false);
    expect(edge.projects).toEqual([project()]);
    await edge.write([{ ...project(), doc: { ...project().doc, keepBinSize: true } }]);
    const reconnected = await FolderLibrary.open(root, false);
    expect(reconnected.projects[0].doc.keepBinSize).toBe(true);
    expect(root.directories.get("pocketry-library")!.files.size).toBe(2);
  });

  it("rejects stale writes, preserves both versions on explicit recovery, and keeps earlier revisions", async () => {
    const root = new MemoryDirectory();
    const a = await FolderLibrary.open(root, true);
    await a.write([project()]);
    const b = await FolderLibrary.open(root, false);
    await a.write([project("From A")]);
    await expect(b.write([project("From B")])).rejects.toBeInstanceOf(FolderConflictError);
    await b.keepBoth(project("From B"));
    const reopened = await FolderLibrary.open(root, false);
    expect(reopened.projects.map(p => p.name)).toEqual(["From A", "From B (conflict)"]);
    expect(new Set(reopened.projects.map(p => p.id)).size).toBe(2);
    expect(reopened.heads).toHaveLength(1);
    expect(root.directories.get("pocketry-library")!.files.size).toBe(3);
  });

  it("retains two racing writes even when both pass the pre-write check", async () => {
    const root = new MemoryDirectory();
    const a = await FolderLibrary.open(root, true);
    await a.write([project()]);
    const b = await FolderLibrary.open(root, false);
    const dir = root.directories.get("pocketry-library")!;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let waiting = 0;
    dir.beforeClose = async () => { if (++waiting === 2) release(); await barrier; };
    const results = await Promise.allSettled([a.write([project("A")]), b.write([project("B")])]);
    expect(results.some(result => result.status === "rejected")).toBe(true);
    dir.beforeClose = undefined;
    const reopened = await FolderLibrary.open(root, false);
    expect(reopened.heads).toHaveLength(2);
    await expect(reopened.assertCurrent()).rejects.toBeInstanceOf(FolderConflictError);
    await reopened.keepBoth();
    expect(reopened.projects.map(p => p.doc.name).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/^A/), expect.stringMatching(/^B/)]));
    expect(reopened.projects).toHaveLength(2);
    expect(dir.files.size).toBe(4);
  });

  it("does not report interrupted writes as saved or replace the last completed revision", async () => {
    const root = new MemoryDirectory();
    const library = await FolderLibrary.open(root, true);
    await library.write([project()]);
    const dir = root.directories.get("pocketry-library")!;
    const originalFiles = [...dir.files];
    dir.failClose = true;
    await expect(library.write([project("Pending")])).rejects.toThrow("Disk full");
    originalFiles.forEach(([name, text]) => expect(dir.files.get(name)).toBe(text));
    expect((await FolderLibrary.open(root, false)).projects).toEqual([project()]);
    dir.failClose = false;
    await library.write([project("Pending")]);
    expect((await FolderLibrary.open(root, false)).projects[0].name).toBe("Pending");
  });

  it("fails closed on unreadable/newer revisions and missing parents", async () => {
    const root = new MemoryDirectory();
    const library = await FolderLibrary.open(root, true);
    await library.write([project()]);
    const dir = root.directories.get("pocketry-library")!;
    const [name, text] = [...dir.files][0];
    for (const invalid of ["{broken", JSON.stringify({ ...JSON.parse(text), schemaVersion: 2 }),
      JSON.stringify({ ...JSON.parse(text), parents: [crypto.randomUUID()] })]) {
      dir.files.set(name, invalid);
      await expect(library.write([])).rejects.toThrow();
      expect(dir.files.size).toBe(1);
      expect(dir.files.get(name)).toBe(invalid);
    }
  });

  it("retains future-version project documents without trying to migrate them", async () => {
    const root = new MemoryDirectory();
    const library = await FolderLibrary.open(root, true);
    const future = { ...project(), doc: { schemaVersion: 999, important: [1, 2, 3] } };
    await library.write([future]);
    expect((await FolderLibrary.open(root, false)).projects[0]).toEqual(future);
  });

  it("requires renewed permission and does not recreate a deleted library on restore", async () => {
    const root = new MemoryDirectory();
    const library = await FolderLibrary.open(root, true);
    await library.write([project()]);
    root.directories.get("pocketry-library")!.permission = "denied";
    await expect(library.write([])).rejects.toBeInstanceOf(FolderPermissionError);
    root.directories.clear();
    await expect(FolderLibrary.open(root, false)).rejects.toThrow("Missing directory");
    expect(root.directories.size).toBe(0);
  });

  it("keeps the original baseline when restoring a stale browser working copy", async () => {
    const root = new MemoryDirectory();
    const library = await FolderLibrary.open(root, true);
    await library.write([project()]);
    const baseline = [...library.heads];
    await library.write([project("External")]);
    const restored = await FolderLibrary.open(root, false, baseline);
    expect(restored.projects[0].name).toBe("Tools");
    await expect(restored.assertCurrent()).rejects.toBeInstanceOf(FolderConflictError);
  });

  it("detects a valid external edit to an existing revision instead of silently using stale data", async () => {
    const root = new MemoryDirectory();
    const library = await FolderLibrary.open(root, true);
    await library.write([project()]);
    const dir = root.directories.get("pocketry-library")!;
    const [name, text] = [...dir.files][0];
    dir.files.set(name, JSON.stringify({ ...JSON.parse(text), projects: [project("External edit")] }));
    await expect(library.write([project("Pending edit")])).rejects.toBeInstanceOf(FolderConflictError);
    expect(dir.files.size).toBe(1);
    await library.keepBoth(project("Pending edit"));
    expect(library.projects.map(p => p.name)).toEqual(["External edit", "Pending edit (conflict)"]);
  });
});
