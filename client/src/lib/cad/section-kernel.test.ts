import { beforeAll, describe, expect, it } from "vitest";

import {
  chainSignedArea,
  distanceToChain,
  flattenChain,
  junctionTurns,
  type ArcElement,
} from "@shared/geometry/arc-chain";
import { pointInRing } from "@shared/geometry/rings";
import type { Outline, Point, Ring } from "@shared/geometry/types";

import { loadManifold, type ManifoldToplevel } from "@/lib/manifold/runtime";

import {
  createSectionKernel,
  SECTION_FIT_TOLERANCE_MM,
  type SectionKernel,
} from "./section-kernel";

let wasm: ManifoldToplevel;
let sections: SectionKernel;
beforeAll(async () => {
  wasm = await loadManifold();
  sections = createSectionKernel(wasm);
});

const point = (x: number, y: number): Point => ({ x, y });
const rectangle = (width: number, height: number): Ring => [
  point(0, 0),
  point(width, 0),
  point(width, height),
  point(0, height),
];
const outlineOf = (outer: Ring, holes: Ring[] = []): Outline => [{ outer, holes }];

describe("pocket sections from the planar kernel", () => {
  it("recovers clearance and corner rounding as lines and tangent arcs", () => {
    const fitted = sections.pocketSection(outlineOf(rectangle(40, 20)), 0.3, 1)!;
    expect(fitted.regions).toHaveLength(1);
    const chain = fitted.regions[0].outer;
    expect(chain.filter((element) => element.kind === "line")).toHaveLength(4);
    const arcs = chain.filter((element): element is ArcElement => element.kind === "arc");
    expect(arcs).toHaveLength(4);
    // Opening by 1 mm leaves 1 mm corners; the fit sits half the tolerance outside.
    const grow = SECTION_FIT_TOLERANCE_MM / 2;
    for (const arc of arcs) expect(arc.radius).toBeCloseTo(1 + grow, 4);
    for (const turn of junctionTurns(chain)) expect(Math.abs(turn)).toBeLessThan(1e-4);
    expect(fitted.maxDeviationMm).toBeLessThanOrEqual(SECTION_FIT_TOLERANCE_MM);
    expect(fitted.maxDeviationMm).toBeGreaterThanOrEqual(grow);
  });

  it("never fits inside the print path's section", () => {
    // A lobed outline with ripples smaller than the fit tolerance, as a trace leaves it.
    const outer: Ring = Array.from({ length: 360 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 360;
      const radius = 14 + 2.5 * Math.sin(3 * angle) + 0.004 * Math.sin(47 * angle);
      return point(radius * Math.cos(angle), radius * Math.sin(angle));
    });
    const fitted = sections.pocketSection(outlineOf(outer), 0.2, 1)!;
    expect(fitted.regions).toHaveLength(1);
    const chain = fitted.regions[0].outer;
    const boundary = flattenChain(chain, 1e-5);

    // The print path's own section for the same outline, straight from the planar kernel.
    const raw = new wasm.CrossSection([outer.map((p): [number, number] => [p.x, p.y])]);
    const cleared = raw.offset(0.2, "Round", 2, 720);
    const eroded = cleared.offset(-1, "Round", 2, 720);
    const opened = eroded.offset(1, "Round", 2, 720);
    const printed = opened.toPolygons();
    for (const handle of [raw, cleared, eroded, opened]) handle.delete();
    expect(printed).toHaveLength(1);

    let farthest = 0;
    for (const [x, y] of printed[0]) {
      const vertex = point(x, y);
      // Inside the fitted boundary, never outside it.
      expect(pointInRing(boundary, vertex)).toBe(true);
      farthest = Math.max(farthest, distanceToChain(vertex, chain));
    }
    expect(farthest).toBeLessThanOrEqual(SECTION_FIT_TOLERANCE_MM + 1e-6);
    expect(fitted.maxDeviationMm).toBeGreaterThanOrEqual(farthest - 1e-4);
    // The trace's ripples are fitted through, not reproduced facet by facet.
    expect(fitted.elements).toBeLessThan(printed[0].length / 10);
  });

  it("keeps holes and their winding", () => {
    const hole = rectangle(8, 6).map((p) => point(p.x + 10, p.y + 7));
    const fitted = sections.pocketSection(outlineOf(rectangle(40, 20), [hole]), 0, 0)!;
    expect(fitted.regions[0].holes).toHaveLength(1);
    expect(chainSignedArea(fitted.regions[0].outer)).toBeGreaterThan(0);
    expect(chainSignedArea(fitted.regions[0].holes[0])).toBeLessThan(0);
  });

  it("reports a collapsed section as empty", () => {
    // A 1.5 mm strip cannot survive a 1 mm opening.
    expect(sections.pocketSection(outlineOf(rectangle(30, 1.5)), 0, 1)).toBeNull();
  });
});

describe("rounding volume from planar insets", () => {
  it("matches the closed form for a square pocket", () => {
    const fitted = sections.pocketSection(outlineOf(rectangle(30, 30)), 0, 0)!;
    const side = 30 + SECTION_FIT_TOLERANCE_MM;
    const radius = 2;
    // Inset area of a square is (side - 2d)²; integrate the loss over the rounding height.
    let expected = 0;
    const steps = 20_000;
    for (let step = 0; step < steps; step++) {
      const height = (radius * (step + 0.5)) / steps;
      const inset = radius - Math.sqrt(radius * radius - (radius - height) ** 2);
      expected += ((side * side - (side - 2 * inset) ** 2) * radius) / steps;
    }
    expect(sections.roundingVolume(fitted.regions, radius)).toBeCloseTo(expected, 1);
  });
});
