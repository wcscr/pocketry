import { describe, expect, it } from "vitest";
import type { Bounds } from "../geometry/types";
import { ringBounds } from "../geometry/rings";
import { binWidthMm } from "./bin-size";
import { labelTabSurfaces, labelTabWritingArea, pointInLabelTabWritingArea } from "./label-tab-surfaces";
import { D_WALL, STACKING_LIP_DEPTH } from "./standard";
import { parseBinSpec, type BinSpec } from "./types";

const WALLS = ["north", "south", "east", "west"] as const;
type Wall = typeof WALLS[number];

/** The UI's default tab on a 2×2 bin, with four sub-bins along each shelf's length. */
function bin(wall: Wall, overrides: Partial<Parameters<typeof parseBinSpec>[0]> = {}): BinSpec {
  const along = wall === "north" || wall === "south" ? { rows: 2, columns: 4 } : { rows: 4, columns: 2 };
  return parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "standard",
    compartments: { enabled: true, ...along },
    labelTab: { wall, scope: "compartments", width: "full", recessMm: 0.5, frontRim: true }, ...overrides });
}

const half = binWidthMm({ gridX: 2, gridPitch: "full" } as BinSpec) / 2;
const sides = (bounds: Bounds) => [-bounds.minX, -bounds.minY, bounds.maxX, bounds.maxY];

/** Shelf edges at the wall's inner face move to the lip's inner face; the rest stay put. */
function expectTrimmedAtWalls(spec: BinSpec, textHeightMm: number, wallMm: number, faceMm: number): number {
  let trimmed = 0;
  for (const surface of labelTabSurfaces(spec)) {
    const area = labelTabWritingArea(spec, surface, textHeightMm)!;
    const shelf = sides(ringBounds(surface.ring)!), writable = sides(area.bounds);
    shelf.forEach((edge, i) => {
      if (Math.abs(edge - (half - wallMm)) < 1e-6 && faceMm > wallMm) {
        trimmed++;
        // Sampled corner arcs leave the lip ring's straight runs up to a few
        // microns inside the exact face; that error only adds clearance.
        expect(writable[i]).toBeLessThanOrEqual(half - faceMm + 1e-9);
        expect(writable[i]).toBeGreaterThan(half - faceMm - 0.01);
      } else {
        expect(writable[i]).toBeCloseTo(edge, 6);
      }
    });
    const centre = { x: (area.bounds.minX + area.bounds.maxX) / 2, y: (area.bounds.minY + area.bounds.maxY) / 2 };
    expect(pointInLabelTabWritingArea(centre, surface, area)).toBe(true);
  }
  return trimmed;
}

describe("label-tab writing area", () => {
  it.each(WALLS)("keeps %s-wall sub-bin lettering inside the stacking lip's inner face", wall => {
    // Each row's two outer shelves lose an end; the four shelves on the wall lose their backs.
    expect(expectTrimmedAtWalls(bin(wall), 0.5, D_WALL, STACKING_LIP_DEPTH)).toBe(8);
  });

  it.each(WALLS)("leaves unlipped %s-wall shelves whole", wall => {
    const spec = bin(wall, { lip: "none" });
    expect(expectTrimmedAtWalls(spec, 0.5, D_WALL, 0)).toBe(0);
    for (const surface of labelTabSurfaces(spec)) expect(labelTabWritingArea(spec, surface, 5)!.clip).toBe(surface.clip);
  });

  it.each(WALLS)("trims both ends and the back of a full-width %s boundary shelf", wall => {
    const spec = bin(wall, { compartments: { enabled: false, rows: 1, columns: 1 },
      labelTab: { wall, scope: "outer", width: "full", recessMm: 0.5, frontRim: true } });
    expect(expectTrimmedAtWalls(spec, 0.5, D_WALL, STACKING_LIP_DEPTH)).toBe(3);
  });

  it("follows the lip's support with the lettering's full height", () => {
    // A 4 mm recess drops the shelf below the support; only tall lettering reaches the lip.
    const deep = bin("north", { labelTab: { wall: "north", scope: "compartments", width: "full", recessMm: 4, frontRim: true } });
    expect(expectTrimmedAtWalls(deep, 0.5, D_WALL, 0)).toBe(0);
    expect(expectTrimmedAtWalls(deep, 3.8, D_WALL, 2.4)).toBe(8);
    expect(expectTrimmedAtWalls(deep, 5, D_WALL, STACKING_LIP_DEPTH)).toBe(8);
  });

  it("leaves shelves alone when the walls are thicker than the lip's reach", () => {
    expect(expectTrimmedAtWalls(bin("north", { wallThicknessMm: 3 }), 0.5, 3, STACKING_LIP_DEPTH)).toBe(0);
  });
});
