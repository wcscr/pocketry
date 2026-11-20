import { describe, expect, it } from "vitest";
import { binSpecSchema, parseBinSpec } from "./types";
import { libraryBackupSchema } from "./library";
import { D_DIV } from "./standard";

describe("saved schema compatibility across the Zod upgrade", () => {
  it("fills nested compartment defaults in older designs", () => {
    const spec = { gridX: 2, gridY: 3, heightUnits: 6 };
    const expected = { rows: 1, columns: 1, dividerThicknessMm: D_DIV, scoop: false };
    expect(parseBinSpec(spec).compartments).toEqual(expected);
    expect(parseBinSpec({ ...spec, compartments: {} }).compartments).toEqual(expected);
    expect(parseBinSpec({ ...spec, compartments: { rows: 2, scoop: true } }).compartments)
      .toEqual({ ...expected, rows: 2, scoop: true });
  });

  it("keeps opaque project documents for separate version migration", () => {
    const doc = { schemaVersion: 999, futureField: { values: [1, "two", null] } };
    const backup = { format: "pocketry-library", schemaVersion: 1,
      projects: [{ id: "future", name: "Future project", updatedAt: "2026-11-20T12:00:00Z", doc }],
    };
    expect(libraryBackupSchema.parse(backup)).toEqual(backup);
    expect(libraryBackupSchema.safeParse({ ...backup, projects: [{ ...backup.projects[0], doc: [] }] }).success).toBe(false);
  });

  it("bounds errors for excessive invalid surface labels and retains dimension errors", () => {
    const spec = { gridX: 2, gridY: 3, heightUnits: 6 };
    const result = binSpecSchema.safeParse({ ...spec, surfaceTexts: Array(10_000).fill(null) });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Oversized surface labels were accepted");
    expect(result.error.issues).toMatchObject([{ code: "too_big", path: ["surfaceTexts"] }]);
    expect(result.error.issues).toHaveLength(1);
    const invalidDimensions = binSpecSchema.safeParse({ ...spec, gridX: 100 });
    expect(invalidDimensions.success).toBe(false);
    if (invalidDimensions.success) throw new Error("Oversized bin was accepted");
    expect(invalidDimensions.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "too_big", path: ["gridX"] }),
    ]));
  });
});
