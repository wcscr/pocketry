import "@/lib/project/mock-storage";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { importLocalFont, extendLocalFont } from "@/lib/gridfinity/local-font";
import { surfaceTextOutline } from "@/lib/gridfinity/surface-text";
import { prepareProjectExport } from "./export";
import { exportProjectLibrary, importProjectLibrary, loadProjectDoc, openProjectFromLibrary, saveProjectDoc, saveProjectToLibrary } from "./persist";

const memory = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => structuredClone(memory.get(key))),
  set: vi.fn(async (key: string, value: unknown) => { memory.set(key, structuredClone(value)); }),
  setMany: vi.fn(async (entries: [IDBValidKey, unknown][]) => {
    for (const [key, value] of entries) memory.set(String(key), structuredClone(value));
  }),
}));
beforeEach(async () => { memory.clear(); await loadProjectDoc(); });
const bytes = readFileSync(createRequire(import.meta.url).resolve("three/examples/fonts/ttf/kenpixel.ttf"));
async function document(): Promise<ProjectDoc> {
  const font = await importLocalFont(new Blob([new Uint8Array(bytes)]), "Kenpixel", "A");
  const label = surfaceTextSchema.parse({ id: "one", text: "A", font, position: { x: 0, y: 0 } });
  const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, surfaceTexts: [label, { ...label, id: "two", position: { x: 10, y: 0 } }] });
  const doc = { spec, cutouts: [], fingerHoles: [] };
  const history = { index: 24, stack: Array.from({ length: 50 }, (_, index) => ({ label: `Move ${index}`, doc: {
    ...doc, spec: { ...spec, surfaceTexts: spec.surfaceTexts.map(text => ({ ...text, rotationDeg: index })) },
  } })) };
  return { schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [], ...history.stack[24].doc, history };
}

describe("portable deduplicated font sources", () => {
  it("exports all fifty undo steps and two labels with one source, then edits new glyphs offline", async () => {
    const doc = await document();
    const backup = await prepareProjectExport(doc, null).backup.text();
    expect(backup.match(/"data":/g)).toHaveLength(1);
    const restored = parseProjectDoc(JSON.parse(backup))!;
    expect(restored).toEqual(doc);
    // Evict the original parsed font so extending genuinely uses the saved data.
    for (const suffix of [1, 2]) await importLocalFont(new Blob([new Uint8Array(bytes), new Uint8Array([suffix])]), `Other ${suffix}`, "A");
    const text = restored.spec.surfaceTexts[0];
    if (typeof text.font === "string") throw new Error("Expected saved font");
    const font = await extendLocalFont(text.font, "B8");
    expect(surfaceTextOutline({ ...text, text: "B8", font }).length).toBeGreaterThan(0);
  });

  it("compacts working copies, saved projects, and library backups, preserving full history on reload", async () => {
    const doc = await document();
    const named = { ...doc, name: "Font test" };
    const library = await saveProjectToLibrary(doc, named.name, null);
    expect(await saveProjectDoc(named, library.activeProjectId)).toBe(true);
    expect(JSON.stringify(memory.get("tooltrace:project:v1")).match(/"data":/g)).toHaveLength(1);
    expect(JSON.stringify(memory.get("tooltrace:project-library:v1")).match(/"data":/g)).toHaveLength(1);
    expect(await loadProjectDoc()).toEqual(named);
    const backup = JSON.stringify(await exportProjectLibrary(named));
    expect(backup.match(/"data":/g)).toHaveLength(1);
    memory.clear(); await loadProjectDoc();
    const imported = await importProjectLibrary(JSON.parse(backup));
    const opened = await openProjectFromLibrary(imported.library.projects[0].id);
    expect(opened.doc).toEqual(named);
    expect(opened.doc.history!.stack).toHaveLength(50);
    expect(opened.doc.history!.index).toBe(24);
  });

  it("exports a large supported source without repeating it past the JavaScript string limit", async () => {
    const doc = await document();
    // A real accepted font produced this source size in the adversarial audit.
    // Synthetic bytes keep the regression platform-independent and licence-free.
    const data = "A".repeat(8_446_316);
    for (const spec of [doc.spec, ...doc.history!.stack.map(entry => entry.doc.spec)]) {
      spec.surfaceTexts = spec.surfaceTexts.map(text => {
        if (typeof text.font === "string") throw new Error("Expected saved font");
        return { ...text, font: { ...text.font, source: { data, byteLength: 15_255_648 } } };
      });
    }
    const backup = prepareProjectExport(doc, null).backup;
    expect(backup.size).toBeLessThan(9_000_000);
    const restored = parseProjectDoc(JSON.parse(await backup.text()));
    expect(restored?.history?.stack).toHaveLength(50);
    expect(restored?.history?.index).toBe(24);
  });
});
