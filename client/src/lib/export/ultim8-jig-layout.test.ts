import { describe, expect, it } from "vitest";
import { fingerHoleSchema, parseCutoutPlacement, type CutoutPlacement } from "@shared/gridfinity/cutout";
import { DEFAULT_PEG_BOTTOM, PEG_DENSITIES, pegBottomRootHeightMm, ultim8PegCenters } from "@shared/gridfinity/peg-bottom";
import { parseBinSpec } from "@shared/gridfinity/types";
import { footprintOuterRingMm } from "@shared/gridfinity/footprint";
import { withKernel } from "@/lib/manifold/runtime";
import { buildBinWithCutouts, EXPORT_QUALITY } from "@/lib/gridfinity/bin";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { generateLayoutSVG, generateUltim8JigSVG } from "./layout";

const spec = (patch: Record<string, unknown> = {}) => parseBinSpec({
  gridX: 1, gridY: 1, heightUnits: 8.5 / 7, lip: "none", fill: "solid", fillHeightPercent: 100,
  arbitrarySizeMm: { width: 51, length: 31 }, pegBottom: DEFAULT_PEG_BOTTOM, ...patch,
});
const group = (svg: string, id: string) => svg.match(new RegExp(`<g id="${id}"[^>]*>([\\s\\S]*?)</g>`))![1];
const paths = (svg: string, id: string) => [...group(svg, id).matchAll(/d="([^"]+)"/g)].map(match => {
  const values = match[1].match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  return Array.from({ length: values.length / 2 }, (_, i) => ({ x: values[i * 2], y: values[i * 2 + 1] }));
});
const pegCircles = (svg: string) => [...group(svg, "peg-locations").matchAll(/cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)]
  .map(match => ({ x: +match[1] - 25.5, y: 15.5 - +match[2], radius: +match[3] }));

it("exports actual openings, independent finger access, and corner shafts in one mm top view", async () => {
  const pocket = createBasicPocket("rectangle", { x: 3, y: -5 }, { x: 11, y: -1 }, "opening")!;
  const cutout = parseCutoutPlacement({ ...pocket.cutout, clearanceMm: 0.35, topFilletMm: 0, cornerRoundMm: 0 });
  const finger = fingerHoleSchema.parse({ id: "finger", kind: "oblong-deep-scoop", center: { x: -10, y: 0 }, diameterMm: 6, lengthMm: 12, depthMm: 3, topFilletMm: 0 });
  const svg = await generateUltim8JigSVG(spec(), [cutout], new Map([[pocket.shape.id, pocket.shape]]), [finger]);
  expect(svg).toContain('width="51mm" height="31mm" viewBox="0 0 51 31"');
  expect(svg).toContain("Installed top view");
  expect(svg).toContain("does not assign a bed position");
  const opening = paths(svg, "pocket-openings")[0];
  expect(Math.min(...opening.map(p => p.x))).toBeCloseTo(3 - 0.35 + 25.5, 4);
  expect(Math.max(...opening.map(p => p.y))).toBeCloseTo(15.5 - (-5 - 0.35), 4);
  const access = paths(svg, "finger-access")[0];
  expect(Math.min(...access.map(p => p.x))).toBeCloseTo(-10 - 6 + 25.5, 3);
  expect(Math.max(...access.map(p => p.y))).toBeCloseTo(15.5 + 3, 3);
  expect(pegCircles(svg)).toEqual([
    { x: -20, y: -10, radius: 2.4 }, { x: 20, y: -10, radius: 2.4 },
    { x: -20, y: 10, radius: 2.4 }, { x: 20, y: 10, radius: 2.4 },
  ]);
});

describe("printed peg registration", () => {
  it.each(PEG_DENSITIES)("matches actual printed shafts at density %s after a partial corner overlap", async density => {
    const s = spec({ pegBottom: { ...DEFAULT_PEG_BOTTOM, density } });
    const pocket = createBasicPocket("rectangle", { x: -18.5, y: -11 }, { x: -17.5, y: -9 }, "through-corner")!;
    const cutout = parseCutoutPlacement({ ...pocket.cutout, depth: { mode: "through" }, clearanceMm: 0.3, topFilletMm: 0 });
    const shapes = new Map([[pocket.shape.id, pocket.shape]]);
    const svg = await generateUltim8JigSVG(s, [cutout], shapes);
    const pegs = pegCircles(svg);
    expect(pegs.some(p => p.x === -20 && p.y === -10)).toBe(false);
    expect(pegs.some(p => p.x === -15 && p.y === -5)).toBe(true);
    await withKernel(kernel => {
      const { arena, CrossSection } = kernel;
      const solid = buildBinWithCutouts(kernel, s, { shapesById: shapes, cutouts: [cutout], fingerHoles: [] }, EXPORT_QUALITY).solid;
      const shafts = arena.track(solid.slice(-1));
      const fullArea = arena.track(CrossSection.circle(2.4, 64)).area();
      expect(shafts.area()).toBeCloseTo(pegs.length * fullArea, 5);
      for (const center of ultim8PegCenters(s)) {
        const disk = arena.track(arena.track(CrossSection.circle(2.4, 64)).translate([center.x, center.y]));
        const exported = pegs.some(p => p.x === center.x && p.y === center.y);
        expect(arena.track(shafts.intersect(disk)).area()).toBeCloseTo(exported ? fullArea : 0, 5);
      }
    });
  });

  it.each(["sloped", "bridged"] as const)("keeps installed coordinates for the %s underside", async underside => {
    const s = spec({ pegBottom: { ...DEFAULT_PEG_BOTTOM, underside, density: 1 } });
    const svg = await generateUltim8JigSVG(s, [], new Map());
    expect(pegCircles(svg)).toHaveLength(ultim8PegCenters(s).length);
    expect(pegBottomRootHeightMm(s)).toBeGreaterThan(0);
  });
});

it("retains the actual custom footprint and exports a jig without pockets", async () => {
  const s = spec({ gridX: 2, gridY: 2, arbitrarySizeMm: null, heightUnits: 2,
    footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
  const svg = await generateUltim8JigSVG(s, [], new Map());
  expect(paths(svg, "bin-outline")[0]).toHaveLength(footprintOuterRingMm(s, 64).length);
  expect(group(svg, "pocket-openings")).not.toContain("<path");
  expect(group(svg, "peg-locations")).toContain("<circle");
});

it("keeps ordinary layout SVGs free of jig information", async () => {
  const svg = await generateLayoutSVG(spec({ pegBottom: null, flatBottom: true }), [], new Map());
  expect(svg).not.toContain("ULTIM8");
  expect(svg).not.toContain("<circle");
});

it("rejects non-jigs and unresolved depths instead of producing guessed peg locations", async () => {
  await expect(generateUltim8JigSVG(spec({ pegBottom: null, flatBottom: true }), [], new Map())).rejects.toThrow(/ULTIM8 jig pegs/);
  const pocket = createBasicPocket("rectangle", { x: -5, y: -2 }, { x: 5, y: 2 }, "pending")!;
  const pending: CutoutPlacement = { ...pocket.cutout, depthPending: true };
  await expect(generateUltim8JigSVG(spec(), [pending], new Map([[pocket.shape.id, pocket.shape]]))).rejects.toThrow(/depth/i);
});
