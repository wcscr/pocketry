import { describe, expect, it } from "vitest";
import { maskFromEdges } from "./edge-mask";
import { traceIsoRings } from "../geometry/trace";
import { buildOutline, pointInOutline } from "../geometry/outline";

const width = 72, height = 88;
function fixture(inside: (x: number, y: number) => boolean, seeded = inside) {
  const edges = new Float32Array(width * height), seeds = new Uint8Array(edges.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    seeds[i] = seeded(x, y) ? 1 : 0;
    if (inside(x, y) && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1))) edges[i] = 1;
  }
  return { edges, seeds };
}
const rectangle = (x: number, y: number) => x >= 12 && x <= 58 && y >= 10 && y <= 76;
describe("learned outer silhouette reconstruction", () => {
  it.each([0, 1, 2, 3])("does not cut a slit through changing edge thickness (quarter-turn %s)", turns => {
    const edges = new Float32Array(width * height), seeds = new Uint8Array(edges.length);
    for (let y = 10; y <= 76; y++) for (let x = 12; x <= 58; x++) {
      const leftWidth = y >= 30 && y <= 60 ? 4 : 3;
      edges[y * width + x] = x < 12 + leftWidth || x > 55 || y < 13 || y > 73 ? 1 : 0;
      seeds[y * width + x] = x >= 20 && x <= 50 && y >= 20 && y <= 66 ? 1 : 0;
    }
    const rotatedWidth = turns % 2 ? height : width, rotatedHeight = turns % 2 ? width : height;
    const rotate = (x: number, y: number) => turns === 0 ? { x, y } : turns === 1 ? { x: height - 1 - y, y: x }
      : turns === 2 ? { x: width - 1 - x, y: height - 1 - y } : { x: y, y: width - 1 - x };
    const unrotate = (x: number, y: number) => turns === 0 ? { x, y } : turns === 1 ? { x: y, y: height - 1 - x }
      : turns === 2 ? { x: width - 1 - x, y: height - 1 - y } : { x: width - 1 - y, y: x };
    const rotatedEdges = new Float32Array(edges.length), rotatedSeeds = new Uint8Array(seeds.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = rotate(x, y), target = p.y * rotatedWidth + p.x;
      rotatedEdges[target] = edges[y * width + x]; rotatedSeeds[target] = seeds[y * width + x];
    }
    const result = maskFromEdges(rotatedEdges, rotatedWidth, rotatedHeight, rotatedSeeds);
    const outline = buildOutline(traceIsoRings(result.score, rotatedWidth, rotatedHeight, { iso: 128 }));
    expect(result.reason).toBeUndefined();
    expect(outline).toHaveLength(1);
    expect(outline[0].holes).toHaveLength(0);
    // This location was inside the filled mask, but the old three-pixel
    // distance cutoff turned it into background beside an outer sliver.
    expect(pointInOutline(outline, rotate(13, 45))).toBe(true);
    const side = outline[0].outer.map(p => unrotate(p.x, p.y)).filter(p => p.x < 16 && p.y > 20 && p.y < 66);
    expect(Math.max(...side.map(p => p.x)) - Math.min(...side.map(p => p.x))).toBeLessThan(0.1);
  });
  it("fills internal lettering while retaining an open jaw recess", () => {
    const inside = (x: number, y: number) => rectangle(x, y) && !(x >= 31 && x <= 39 && y <= 38);
    const { edges, seeds } = fixture(inside);
    for (let y = 50; y < 60; y++) for (let x = 25; x < 45; x++) edges[y * width + x] = 1;
    const result = maskFromEdges(edges, width, height, seeds);
    expect(result.reason).toBeUndefined();
    expect(result.mask[55 * width + 35]).toBe(1);
    expect(result.mask[25 * width + 35]).toBe(0);
    expect(result.mask[45 * width + 35]).toBe(1);
    expect(result.mask[3 * width + 3]).toBe(0);
  });
  it("recovers a thin shaft beyond the original handle mask", () => {
    const handle = (x: number, y: number) => x >= 25 && x <= 45 && y >= 40 && y <= 76;
    const tool = (x: number, y: number) => handle(x, y) || x >= 34 && x <= 37 && y >= 8 && y <= 45;
    const { edges, seeds } = fixture(tool, handle);
    const result = maskFromEdges(edges, width, height, seeds);
    expect(result.reason).toBeUndefined();
    expect(result.score[20 * width + 35]).toBeGreaterThanOrEqual(128);
    expect(result.mask[20 * width + 35]).toBe(1);
    expect(seeds[20 * width + 35]).toBe(0);
  });
  // A dark part with a bright highlight inside it: the model draws an edge round the highlight
  // and, where the part's own edge is faint, leaves a narrow way in from the paper.
  const highlight = (gap: number) => {
    const { edges, seeds } = fixture(rectangle, (x, y) => rectangle(x, y) && !(x >= 26 && x <= 44 && y >= 28 && y <= 60));
    // The highlight's own edge, a ring well inside the part.
    for (let y = 28; y <= 60; y++) for (let x = 26; x <= 44; x++) if (x === 26 || x === 44 || y === 28 || y === 60) edges[y * width + x] = 1;
    // Two walls from the part's top edge down to the highlight make a channel `gap` pixels wide,
    // and the part's top edge and the highlight's are open across it.
    const left = 35 - Math.ceil(gap / 2), right = left + gap + 1;
    for (let y = 10; y <= 28; y++) { edges[y * width + left] = 1; edges[y * width + right] = 1; }
    for (let x = left + 1; x < right; x++) { edges[10 * width + x] = 0; edges[28 * width + x] = 0; }
    return { edges, seeds };
  };

  it.each([1, 2])("does not let paper through a channel %s pixel(s) wide into a highlight", gap => {
    const { edges, seeds } = highlight(gap);
    const result = maskFromEdges(edges, width, height, seeds);
    expect(result.reason).toBeUndefined();
    // The highlight stays part of the tool, and so does the channel that led to it.
    expect(result.mask[44 * width + 35]).toBe(1);
    expect(result.mask[20 * width + 35]).toBe(1);
    expect(result.mask[3 * width + 3]).toBe(0);
  });

  it.each([3, 6])("still follows an opening %s pixels wide, which may be a real recess", gap => {
    const { edges, seeds } = highlight(gap);
    const result = maskFromEdges(edges, width, height, seeds);
    expect(result.reason).toBeUndefined();
    // Paper reaches down the opening and into the area behind it, as it always did.
    expect(result.mask[20 * width + 35]).toBe(0);
    expect(result.mask[44 * width + 35]).toBe(0);
    // The body either side is still tool.
    expect(result.mask[44 * width + 18]).toBe(1);
    expect(result.mask[44 * width + 52]).toBe(1);
  });

  it("keeps two tools apart when at least three pixels of paper lie between them", () => {
    const first = (x: number, y: number) => x >= 8 && x <= 30 && y >= 20 && y <= 72;
    const second = (x: number, y: number) => x >= 34 && x <= 62 && y >= 20 && y <= 72;
    const { edges, seeds } = fixture((x, y) => first(x, y) || second(x, y));
    const result = maskFromEdges(edges, width, height, seeds);
    expect(result.reason).toBeUndefined();
    expect(result.mask[40 * width + 20]).toBe(1);
    expect(result.mask[40 * width + 50]).toBe(1);
    expect(result.mask[40 * width + 32]).toBe(0);
  });

  it("still accepts a tool that ends two pixels inside the region at both ends", () => {
    // Two free pixel rows between each end and the frame: the nearest a tool can come before the
    // gap repair joins it to the frame, which was already reported as a region drawn too tight.
    const tall = (x: number, y: number) => x >= 20 && x <= 50 && y >= 2 && y <= height - 3;
    const { edges, seeds } = fixture(tall);
    const result = maskFromEdges(edges, width, height, seeds);
    expect(result.reason).toBeUndefined();
    expect(result.mask[35]).toBe(0);
    expect(result.mask[(height - 1) * width + 35]).toBe(0);
    expect(result.mask[40 * width + 35]).toBe(1);
  });

  it("repairs a one-pixel edge gap and rejects an unsupported open outline", () => {
    const { edges, seeds } = fixture(rectangle);
    edges[10 * width + 35] = 0;
    expect(maskFromEdges(edges, width, height, seeds).reason).toBeUndefined();
    for (let x = 28; x < 44; x++) edges[10 * width + x] = 0;
    expect(maskFromEdges(edges, width, height, seeds).reason).toBe("open-or-unsupported-boundary");
  });
  it("discards unselected sheet printing and preserves multiple seeded tools", () => {
    const first = (x: number, y: number) => x > 8 && x < 27 && y > 20 && y < 72;
    const second = (x: number, y: number) => x > 40 && x < 62 && y > 20 && y < 72;
    const text = (x: number, y: number) => x > 8 && x < 16 && y > 4 && y < 12;
    const { edges, seeds } = fixture((x, y) => first(x, y) || second(x, y) || text(x, y), (x, y) => first(x, y) || second(x, y));
    const result = maskFromEdges(edges, width, height, seeds);
    expect(result.mask[40 * width + 15]).toBe(1);
    expect(result.mask[40 * width + 50]).toBe(1);
    expect(result.mask[8 * width + 12]).toBe(0);
  });
  it("requires bounded, finite probability fields and valid geometry", () => {
    const { edges, seeds } = fixture(rectangle);
    edges[5] = NaN;
    expect(() => maskFromEdges(edges, width, height, seeds)).toThrow("probability");
    expect(() => maskFromEdges(new Float32Array(513 * 513), 513, 513, new Uint8Array(513 * 513))).toThrow("Invalid edge field");
  });
  it("rejects an enclosure clipped across opposite selection sides", () => {
    const across = (_x: number, y: number) => y >= 20 && y <= 60;
    const { edges, seeds } = fixture(across);
    for (let x = 0; x < width; x++) edges[20 * width + x] = edges[60 * width + x] = 1;
    for (let y = 20; y <= 60; y++) edges[y * width] = edges[y * width + width - 1] = 1;
    expect(maskFromEdges(edges, width, height, seeds).reason).toBe("selection-too-tight");
  });
  it("does not confuse different tools at opposite selection sides with one clipped enclosure", () => {
    const tool = (x: number, y: number) => (x <= 20 && y >= 10 && y <= 30) || (x >= 50 && y >= 50 && y <= 75);
    const { edges, seeds } = fixture(tool);
    for (let y = 10; y <= 30; y++) edges[y * width] = 1;
    for (let y = 50; y <= 75; y++) edges[y * width + width - 1] = 1;
    expect(maskFromEdges(edges, width, height, seeds).reason).toBeUndefined();
  });
});
