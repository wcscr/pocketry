import { describe, expect, it } from "vitest";
import { parseBinSpec } from "./types";
import { lidContactRibPositions } from "./lid-contact-ribs";
import { binFootprintMm, BASE_TOP_RADIUS } from "./standard";

describe("contact-rib spacing", () => {
  it("preserves original rib counts and positions at the default spacing", () => {
    for (const gridPitch of ["full", "half", "quarter"] as const) for (const gridX of [1, 2, 8]) {
      const spec = parseBinSpec({ gridPitch, gridX, gridY: 1, heightUnits: 2 });
      const usable = Math.max(0, binFootprintMm(gridX, gridPitch) - 2 * BASE_TOP_RADIUS - 16);
      const count = Math.max(1, Math.ceil(usable / 24));
      expect(lidContactRibPositions(spec, "x")).toEqual(Array.from({ length: count }, (_, i) => count === 1 ? 0 : usable * (i / (count - 1) - 0.5)));
    }
  });
  it("adds ribs when spacing decreases and independently fits both edge lengths", () => {
    const spec = parseBinSpec({ gridX: 3, gridY: 2, heightUnits: 2 });
    const counts = [8, 24, 60].map(lidRibSpacingMm => ["x", "y"].map(axis =>
      lidContactRibPositions({ ...spec, lidRibSpacingMm }, axis as "x" | "y").length));
    expect(counts).toEqual([[13, 8], [5, 3], [2, 1]]);
    for (const lidRibSpacingMm of [8, 24, 60]) {
      const positions = lidContactRibPositions({ ...spec, lidRibSpacingMm }, "x");
      expect(positions[0]).toBeCloseTo(-positions.at(-1)!, 6);
      for (let i = 1; i < positions.length; i++) expect(positions[i] - positions[i - 1]).toBeGreaterThan(8);
    }
    for (const lidRibSpacingMm of [0, 7.9, 60.1, Infinity, NaN]) {
      expect(() => parseBinSpec({ ...spec, lidRibSpacingMm })).toThrow();
    }
  });
});
