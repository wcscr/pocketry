import { describe, expect, it } from "vitest";
import { maskFromEdges } from "./edge-mask";

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
