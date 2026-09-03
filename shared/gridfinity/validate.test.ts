import { describe, expect, it } from "vitest";

import { parseBinSpec, binSpecSchema, type BinSpecInput } from "./types";
import { validateBinSpec } from "./validate";

function spec(partial: Partial<BinSpecInput> = {}) {
  return parseBinSpec({ gridX: 2, gridY: 3, heightUnits: 6, ...partial });
}

describe("binSpecSchema", () => {
  it("applies defaults for lip, fill, and grid pitch", () => {
    const parsed = spec();
    expect(parsed.lip).toBe("standard");
    // Solid by default: this tool's bins exist to have pockets cut into them.
    expect(parsed.fill).toBe("solid");
    expect(parsed.gridPitch).toBe("full");
  });

  it("accepts the supported fractional grid pitches", () => {
    expect(spec({ gridPitch: "half" }).gridPitch).toBe("half");
    expect(spec({ gridPitch: "quarter" }).gridPitch).toBe("quarter");
    expect(() => spec({ gridPitch: "eighth" as never })).toThrow();
  });

  it("rejects non-integer and out-of-range sizes", () => {
    expect(() => spec({ gridX: 0 })).toThrow();
    expect(() => spec({ gridX: 2.5 })).toThrow();
    expect(() => spec({ gridY: 17 })).toThrow();
    expect(() => spec({ heightUnits: 0 })).toThrow();
    expect(() => spec({ heightUnits: 43 })).toThrow();
  });

  it("rejects unknown keys so typos cannot pass silently", () => {
    expect(() =>
      binSpecSchema.parse({ gridX: 1, gridY: 1, heightUnits: 3, grdX: 2 }),
    ).toThrow();
  });
});

describe("validateBinSpec", () => {
  it("accepts the reference 2×3×6 bin without issues", () => {
    const result = validateBinSpec(spec());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("warns when the bin is too short for the full lip support", () => {
    const result = validateBinSpec(spec({ heightUnits: 1 }));
    expect(result.issues.map((issue) => issue.code)).toContain("lip-support-clipped");
    // Warnings never block.
    expect(result.ok).toBe(true);
  });

  it("does not warn about the lip when there is none", () => {
    const result = validateBinSpec(spec({ heightUnits: 1, lip: "none" }));
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      "lip-support-clipped",
    );
  });

  it("warns when solid fill has no room", () => {
    const result = validateBinSpec(spec({ heightUnits: 1, fill: "solid" }));
    expect(result.issues.map((issue) => issue.code)).toContain("no-infill-space");
  });

  it("solid fill on a 2u bin has room and stays quiet", () => {
    const result = validateBinSpec(spec({ heightUnits: 2, fill: "solid" }));
    expect(result.issues.map((issue) => issue.code)).not.toContain("no-infill-space");
  });

  it("warns on footprints beyond a typical print bed", () => {
    const result = validateBinSpec(spec({ gridX: 7 }));
    expect(result.issues.map((issue) => issue.code)).toContain("large-footprint");
  });
});

describe("label tab spec rule (G5)", () => {
  it("warns when the bin is shorter than the tab", () => {
    const stubby = validateBinSpec(
      parseBinSpec({
        gridX: 2,
        gridY: 2,
        heightUnits: 2,
        labelTab: { wall: "north", width: "full" },
      }),
    );
    expect(stubby.issues.map((issue) => issue.code)).toContain("label-tab-clipped");
    // Warning, not error: still exportable.
    expect(stubby.ok).toBe(true);

    const tall = validateBinSpec(
      parseBinSpec({
        gridX: 2,
        gridY: 2,
        heightUnits: 3,
        labelTab: { wall: "north", width: "full" },
      }),
    );
    expect(tall.issues.map((issue) => issue.code)).not.toContain("label-tab-clipped");
  });
});

describe("fractional grid spec rule (G5)", () => {
  it("warns and ignores hole options on fractional sockets", () => {
    const clash = validateBinSpec(
      spec({ gridPitch: "half", magnetHoles: true, screwHoles: true }),
    );
    expect(clash.issues.map((issue) => issue.code)).toContain("fractional-grid-holes");
    expect(clash.ok).toBe(true);

    expect(
      validateBinSpec(spec({ gridPitch: "quarter" })).issues.map((issue) => issue.code),
    ).not.toContain("fractional-grid-holes");
  });
});
