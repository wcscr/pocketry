import { beforeAll, describe, expect, it } from "vitest";

import {
  chainClosureGap,
  chainSignedArea,
  junctionTurns,
  type ArcChain,
  type ArcElement,
} from "@shared/geometry/arc-chain";
import type { Point } from "@shared/geometry/types";

import { CadContext } from "./adapter";
import { offsetSection, pocketSection } from "./profile-operations";
import { loadCad, type OpenCascadeInstance } from "./runtime";
import { readSectionRegions, sectionSlab, type SectionRegion } from "./section-chain";

let oc: OpenCascadeInstance;
beforeAll(async () => {
  oc = await loadCad();
}, 60_000);

const point = (x: number, y: number): Point => ({ x, y });

/** Lines through the given corners, counter-clockwise. */
function polygonChain(corners: Point[]): ArcChain {
  return corners.map((a, index) => ({
    kind: "line",
    a,
    b: corners[(index + 1) % corners.length],
  }));
}

/** A full circle as one clockwise element, the winding a hole needs. */
function circularHole(center: Point, radius: number): ArcChain {
  const start = point(center.x + radius, center.y);
  return [{ kind: "arc", a: start, b: start, center, radius, sweep: -2 * Math.PI }];
}

function withContext<T>(work: (c: CadContext) => T): T {
  const c = new CadContext(oc);
  try {
    return work(c);
  } finally {
    c.dispose();
  }
}

describe("section chains in the CAD kernel", () => {
  it("builds a region with a hole and reads the same boundary back", () => {
    withContext((c) => {
      const region: SectionRegion = {
        outer: polygonChain([point(0, 0), point(40, 0), point(40, 20), point(0, 20)]),
        holes: [circularHole(point(12, 10), 4)],
      };
      const slab = sectionSlab(c, [region]);
      expect(c.valid(slab)).toBe(true);
      expect(c.volume(slab)).toBeCloseTo(40 * 20 - Math.PI * 16, 6);

      const regions = readSectionRegions(c, slab)!;
      expect(regions).toHaveLength(1);
      expect(regions[0].outer.map((element) => element.kind)).toEqual([
        "line",
        "line",
        "line",
        "line",
      ]);
      expect(chainSignedArea(regions[0].outer)).toBeCloseTo(800, 9);
      expect(regions[0].holes).toHaveLength(1);
      const hole = regions[0].holes[0];
      expect(hole).toHaveLength(1);
      expect((hole[0] as ArcElement).radius).toBeCloseTo(4, 9);
      // Holes are wound so the region stays on their left.
      expect(chainSignedArea(hole)).toBeCloseTo(-Math.PI * 16, 9);
    });
  });

  it("reads the kernel's own clearance and corner rounding as lines and tangent arcs", () => {
    withContext((c) => {
      const outer = [point(0, 0), point(60, 0), point(60, 20), point(20, 20), point(20, 40), point(0, 40)];
      // An L with 0.3 mm clearance and 1 mm corner rounding, as the pocket path builds it.
      const slab = pocketSection(c, [{ kind: "polygon", outer, holes: [] }], 0.3, 1);
      const regions = readSectionRegions(c, slab)!;
      expect(regions).toHaveLength(1);
      const chain = regions[0].outer;
      expect(chainClosureGap(chain)).toBeLessThan(1e-6);
      expect(chain.filter((element) => element.kind === "arc")).toHaveLength(5);
      expect(chainSignedArea(chain)).toBeCloseTo(c.volume(slab), 6);
      // Five rounded convex corners join smoothly; the one inside corner stays sharp.
      const turns = junctionTurns(chain);
      expect(turns.filter((turn) => Math.abs(turn) > 1e-6)).toHaveLength(1);
      expect(Math.min(...turns)).toBeCloseTo(-Math.PI / 2, 6);
    });
  });

  it("reads a circular profile as one full-turn arc", () => {
    withContext((c) => {
      const slab = c.extrude({ kind: "ellipse", rx: 6, ry: 6 }, 0, 1);
      const regions = readSectionRegions(c, slab)!;
      expect(regions).toHaveLength(1);
      expect(regions[0].outer).toHaveLength(1);
      const arc = regions[0].outer[0] as ArcElement;
      expect(arc.kind).toBe("arc");
      expect(arc.sweep).toBeCloseTo(2 * Math.PI, 9);
      expect(chainSignedArea(regions[0].outer)).toBeCloseTo(Math.PI * 36, 9);
    });
  });

  it("declines sections whose boundary is not lines and circles", () => {
    withContext((c) => {
      const slab = c.extrude({ kind: "ellipse", rx: 9, ry: 5 }, 0, 1);
      expect(readSectionRegions(c, slab)).toBeNull();
    });
  });

  it("round-trips a region after a kernel offset", () => {
    withContext((c) => {
      const region: SectionRegion = {
        outer: polygonChain([point(0, 0), point(30, 0), point(30, 12), point(0, 12)]),
        holes: [],
      };
      const grown = offsetSection(c, sectionSlab(c, [region]), 2);
      const regions = readSectionRegions(c, grown)!;
      // Four straight sides and four 2 mm corner arcs.
      expect(regions[0].outer).toHaveLength(8);
      expect(chainSignedArea(regions[0].outer)).toBeCloseTo(30 * 12 + 2 * 2 * (30 + 12) + Math.PI * 4, 6);
      const rebuilt = sectionSlab(c, regions);
      expect(c.volume(rebuilt)).toBeCloseTo(c.volume(grown), 6);
    });
  });
});
