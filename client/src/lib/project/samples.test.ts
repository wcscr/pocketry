import "@/lib/project/mock-storage";
import { beforeEach, expect, it, vi } from "vitest";
import { PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { loadSampleLibrary, parseSampleLibrary } from "./samples";
import { exportProjectLibrary, importProjectLibrary, loadProjectDoc, saveProjectToLibrary } from "./persist";

const memory = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => memory.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { memory.set(key, value); }),
  setMany: vi.fn(async (entries: [IDBValidKey, unknown][]) => {
    for (const [key, value] of entries) memory.set(String(key), value);
  }),
}));
beforeEach(async () => { memory.clear(); await loadProjectDoc(); });

it("loads and migrates every bundled sample without writing to the browser library", async () => {
  const before = new Map(memory);
  const samples = await loadSampleLibrary();
  expect(samples.projects).toHaveLength(16);
  expect(new Set(samples.projects.map(project => project.id)).size).toBe(16);
  for (const project of samples.projects) {
    expect(project.doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(project.doc.name).toBe(project.name);
    expect(project.doc.cutouts.length).toBeGreaterThan(0);
  }
  expect(memory).toEqual(before);
});

it("adds the full collection without replacing an existing project or its active document", async () => {
  const samples = await loadSampleLibrary();
  const first = samples.projects[0];
  const existing = await saveProjectToLibrary({ ...first.doc, keepBinSize: true }, first.name, null);
  const before = await exportProjectLibrary();
  const active = await loadProjectDoc();
  const result = await importProjectLibrary(samples, "merge");
  expect(result.imported).toBe(16);
  expect(result.renamed).toBe(1);
  expect(result.library.activeProjectId).toBe(existing.activeProjectId);
  expect(result.library.projects).toHaveLength(17);
  expect(await loadProjectDoc()).toEqual(active);
  const exported = await exportProjectLibrary();
  expect(exported.projects.find(project => project.id === existing.activeProjectId)).toEqual(before.projects[0]);
  for (const sample of samples.projects) {
    const imported = exported.projects.find(project => project.id === sample.id)!;
    expect(imported.doc.shapes).toEqual(sample.doc.shapes);
    expect(imported.doc.cutouts).toEqual(sample.doc.cutouts);
    expect(imported.doc.materials).toEqual(sample.doc.materials);
  }
});

it("rejects malformed and unsupported samples before any import", async () => {
  expect(() => parseSampleLibrary({})).toThrow("could not be read");
  const samples = await loadSampleLibrary();
  expect(() => parseSampleLibrary({ ...samples, projects: [{ ...samples.projects[0], doc: { schemaVersion: 999 } }] })).toThrow("could not be opened");
});
