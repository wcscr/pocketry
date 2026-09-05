import { describe, expect, it } from "vitest";

import { PROJECT_SCHEMA_VERSION, parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";
import { prepareProjectExport } from "./export";

const doc: ProjectDoc = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6.5 }),
  shapes: [],
  cutouts: [],
  fingerHoles: [],
};
const date = new Date(2026, 8, 5, 14, 30, 12, 456);

describe("portable model export naming", () => {
  it("includes the project, full bin size, and local timestamp", () => {
    expect(prepareProjectExport(doc, "Layout 2", "", date).baseName)
      .toBe("Layout-2-bin-4x4x6.5-2026-09-05_14-30-12-456");
  });

  it.each([null, "  ", "../:*?"])("falls back to the bin size for name %s", (name) => {
    expect(prepareProjectExport(doc, name, "", date).baseName)
      .toBe("bin-4x4x6.5-2026-09-05_14-30-12-456");
  });

  it("keeps Unicode names and exact test thickness while removing path characters", () => {
    expect(prepareProjectExport(doc, "../Café / Tools: 2?", "surface-fit-test-0.75mm", date).baseName)
      .toBe("Café-Tools-2-bin-4x4x6.5-surface-fit-test-0.75mm-2026-09-05_14-30-12-456");
  });

  it("distinguishes partial pitches and custom bin footprints", () => {
    const custom = { ...doc, spec: parseBinSpec({
      gridX: 2, gridY: 2, heightUnits: 3, gridPitch: "half",
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
    }) };
    expect(prepareProjectExport(custom, null, "multicolor", date).baseName)
      .toBe("bin-2x2x3-half-custom-3cell-multicolor-2026-09-05_14-30-12-456");
  });

  it("captures an importable snapshot before later edits", async () => {
    const source = structuredClone(doc);
    const project = prepareProjectExport(source, "Layout 2", "", date);
    source.spec.gridX = 6;
    expect(parseProjectDoc(JSON.parse(await project.backup.text()))).toEqual(doc);
    expect(project.backup.type).toBe("application/json");
  });
});
