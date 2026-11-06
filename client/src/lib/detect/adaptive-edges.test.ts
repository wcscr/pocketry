import { describe, expect, it } from "vitest";
import { selectAutomaticEdges } from "./adaptive-edges";
import { labelMaskComponents, maskFromEdges } from "./edge-mask";

const width = 128, height = 128;
function fixture(tool: (x: number, y: number) => boolean, weak: (x: number, y: number) => boolean = () => false) {
  const edges = new Float32Array(width * height), seeds = new Uint8Array(edges.length), background = new Uint8Array(edges.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, inside = tool(x, y);
    seeds[i] = inside ? 1 : 0;
    if (inside && (!tool(x - 1, y) || !tool(x + 1, y) || !tool(x, y - 1) || !tool(x, y + 1))) edges[i] = weak(x, y) ? .58 : .9;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) background[y * width + x] = tool(x, y) ? 0 : 1;
  return { edges, seeds, background };
}
const body = (x: number, y: number) => x >= 20 && x <= 105 && y >= 15 && y <= 112 && !(x >= 52 && x <= 68 && y < 43);
const weakSide = (x: number, y: number) => x >= 104 && y >= 55 && y <= 80;
function addSurfaceDetail(edges: Float32Array) {
  for (let y = 55; y <= 73; y++) for (let x = 35; x <= 48; x++) if (x === 35 || x === 48 || y === 55 || y === 73) edges[y * width + x] = .9;
}

describe("automatic learned-edge sensitivity", () => {
  it("preserves a complete outline byte-for-byte with a single threshold", () => {
    const f = fixture(body), before = maskFromEdges(f.edges, width, height, f.seeds);
    const result = selectAutomaticEdges(f.edges, width, height, f.seeds, f.background);
    expect(result.result).toEqual(before); expect(result.selection.edgeThresholdTrials).toBe(1);
    expect(result.result.mask[25 * width + 60]).toBe(0); // Open jaw remains paper.
  });

  it.each([0, 1, 2, 3])("recovers missing material and keeps a real recess at rotation %s", turns => {
    const f = fixture(body, weakSide); addSurfaceDetail(f.edges);
    const rotated = { edges: new Float32Array(f.edges.length), seeds: new Uint8Array(f.edges.length), background: new Uint8Array(f.edges.length) };
    const target = (x: number, y: number) => turns === 0 ? y * width + x : turns === 1 ? x * width + width - 1 - y
      : turns === 2 ? (height - 1 - y) * width + width - 1 - x : (height - 1 - x) * width + y;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * width + x, j = target(x, y);
      rotated.edges[j] = f.edges[i]; rotated.seeds[j] = f.seeds[i]; rotated.background[j] = f.background[i]; }
    const before = maskFromEdges(rotated.edges, width, height, rotated.seeds);
    const result = selectAutomaticEdges(rotated.edges, width, height, rotated.seeds, rotated.background);
    expect(before.mask[target(85, 85)]).toBe(0);
    expect(result.result.mask[target(85, 85)]).toBe(1); expect(result.result.mask[target(60, 25)]).toBe(0);
    expect(result.result.mask[target(5, 60)]).toBe(0);
    expect(result.selection).toMatchObject({ edgeThreshold: .57, edgeThresholdTrials: 3, seedCoverage: 1 });
    expect(f.edges[60 * width + 105]).toBeCloseTo(.58); // No mutation of the evidence.
  });

  it("recovers a weak tool while retaining two independent tools", () => {
    const first = (x: number, y: number) => x >= 15 && x <= 45 && y >= 20 && y <= 105;
    const second = (x: number, y: number) => x >= 78 && x <= 108 && y >= 20 && y <= 105;
    const f = fixture((x, y) => first(x, y) || second(x, y), (x, y) => x === 45 && y > 45 && y < 75);
    const result = selectAutomaticEdges(f.edges, width, height, f.seeds, f.background);
    expect(result.result.mask[60 * width + 25]).toBe(1); expect(result.result.mask[60 * width + 95]).toBe(1);
    expect(result.result.mask[60 * width + 60]).toBe(0);
    expect(labelMaskComponents(result.result.mask, width, height, 4).sizes.filter(n => n > 20)).toHaveLength(2);
  });

  it("does not absorb a small independent tool when paper evidence is uncertain", () => {
    const large = (x: number, y: number) => x >= 10 && x <= 100 && y >= 20 && y <= 110;
    const small = (x: number, y: number) => x >= 105 && x <= 109 && y >= 35 && y <= 39;
    const f = fixture((x, y) => large(x, y) || small(x, y), (x, y) => x === 100 && y > 55 && y < 75);
    f.background.fill(0); // Shadow/poor contrast supplies no definite paper veto.
    addSurfaceDetail(f.edges);
    for (let x = 101; x <= 112; x++) f.edges[20 * width + x] = f.edges[110 * width + x] = .58;
    for (let y = 20; y <= 110; y++) f.edges[y * width + 112] = .58;
    const before = maskFromEdges(f.edges, width, height, f.seeds);
    expect(before.mask[36 * width + 107]).toBe(1);
    const result = selectAutomaticEdges(f.edges, width, height, f.seeds, f.background);
    const labels = labelMaskComponents(result.result.mask, width, height, 4).labels;
    expect(labels[36 * width + 107]).not.toBe(labels[60 * width + 40]);
    expect(result.result).toEqual(before);
  });

  it("allows a small color island already enclosed within the same object", () => {
    const f = fixture(body, weakSide);
    for (let y = 40; y <= 95; y++) for (let x = 25; x <= 95; x++)
      if (x === 25 || x === 95 || y === 40 || y === 95) f.edges[y * width + x] = .9;
    // A small disconnected color patch sits inside that existing enclosure.
    for (let y = 59; y <= 65; y++) for (let x = 49; x <= 55; x++)
      if (x === 49 || x === 55 || y === 59 || y === 65) f.seeds[y * width + x] = 0;
    const result = selectAutomaticEdges(f.edges, width, height, f.seeds, f.background);
    expect(result.selection.edgeThreshold).toBe(.57);
    expect(result.result.mask[85 * width + 85]).toBe(1);
  });

  it("repairs a thin artificial split even when nearly all foreground is covered", () => {
    const w = 128, h = 512, edges = new Float32Array(w * h), seeds = new Uint8Array(edges.length), background = new Uint8Array(edges.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, inside = x >= 20 && x <= 105 && y >= 20 && y <= 490;
      seeds[i] = inside ? 1 : 0; background[i] = inside ? 0 : 1;
      if (inside && (x === 20 || x === 105 || y === 20 || y === 490)) edges[i] = y >= 254 && y <= 258 ? .58 : .9;
      if (inside && (y === 254 || y === 258)) edges[i] = .9;
    }
    const before = maskFromEdges(edges, w, h, seeds);
    const covered = before.mask.reduce((sum, value, i) => sum + (value && seeds[i] ? 1 : 0), 0) / seeds.reduce((sum, value) => sum + value, 0);
    expect(covered).toBeGreaterThan(.98);
    expect(labelMaskComponents(before.mask, w, h, 4).sizes.filter(n => n > 20)).toHaveLength(2);
    const result = selectAutomaticEdges(edges, w, h, seeds, background);
    expect(result.selection.edgeThreshold).toBe(.57);
    expect(labelMaskComponents(result.result.mask, w, h, 4).sizes.filter(n => n > 20)).toHaveLength(1);
  });

  it.each([3, 8])("does not join independent tools across a %s-pixel paper gap", gap => {
    const right = 46 + gap;
    const tool = (x: number, y: number) => y >= 20 && y <= 105 && (x >= 15 && x <= 45 || x >= right && x <= right + 30);
    const f = fixture(tool, (x, y) => x === 15 && y > 45 && y < 75);
    // Weak false edges could enclose the corridor at the more inclusive threshold.
    for (let x = 45; x <= right; x++) f.edges[20 * width + x] = f.edges[105 * width + x] = .58;
    const result = selectAutomaticEdges(f.edges, width, height, f.seeds, f.background);
    expect(result.result.mask[60 * width + 46]).toBe(0);
    expect(result.result.mask[60 * width + right + 10]).toBe(1);
    expect(result.selection.edgeThresholdTrials).toBeLessThanOrEqual(5);
  });

  it("rejects a weak enclosure that would fill an observed paper recess", () => {
    const f = fixture(body, weakSide); addSurfaceDetail(f.edges);
    for (let x = 51; x <= 69; x++) f.edges[15 * width + x] = .58;
    const result = selectAutomaticEdges(f.edges, width, height, f.seeds, f.background);
    expect(result.result.mask[25 * width + 60]).toBe(0);
    expect(result.selection.edgeThreshold).toBe(.6);
  });

  it("keeps the original when closure is unstable or unsupported", () => {
    const f = fixture(body, weakSide); addSurfaceDetail(f.edges);
    // A large paper enclosure appears one threshold after the object closes.
    for (let y = 3; y <= 122; y++) for (let x = 3; x <= 122; x++) if (x === 3 || x === 122 || y === 3 || y === 122) f.edges[y * width + x] = .55;
    const result = selectAutomaticEdges(f.edges, width, height, f.seeds, f.background);
    expect(result.selection.edgeThreshold).toBe(.6);
    const blank = fixture(() => false);
    expect(selectAutomaticEdges(blank.edges, width, height, blank.seeds, blank.background).selection.edgeThresholdTrials).toBe(1);
    expect(() => selectAutomaticEdges(f.edges, width, height, f.seeds, new Uint8Array(2))).toThrow("background");
  });
});
