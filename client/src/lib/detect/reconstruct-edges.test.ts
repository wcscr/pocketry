import { describe, expect, it } from "vitest";
import { reconstructEdges } from "./reconstruct-edges";
import { selectAutomaticEdges } from "./adaptive-edges";

const width = 96, height = 80;
function fixture() {
  return { edges: new Float32Array(width * height).fill(.1), seeds: new Uint8Array(width * height),
    background: new Uint8Array(width * height).fill(1), unknown: new Uint8Array(width * height) };
}
function rectangle(f: ReturnType<typeof fixture>, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * width + x;
    f.background[i] = 0;
    if (x === x0 || x === x1 || y === y0 || y === y1) f.edges[i] = .9;
    else f.seeds[i] = 1;
  }
}
const run = (f: ReturnType<typeof fixture>) => reconstructEdges(f.edges, width, height, f.seeds, f.background, f.unknown);

describe("automatic edge reconstruction", () => {
  it("keeps a complete silhouette unchanged without mutating its evidence", () => {
    const f = fixture(); rectangle(f, 20, 15, 70, 60);
    const copy = structuredClone(f), original = selectAutomaticEdges(f.edges, width, height, f.seeds, f.background);
    const result = run(f);
    expect(result.result).toEqual(original.result);
    expect(result.selection.edgeReconstruction).toBeUndefined();
    expect(result.selection.edgeThresholdTrials).toBeLessThanOrEqual(14);
    expect(f).toEqual(copy);
  });

  it("confirms a narrow stable threshold interval when the coarse search includes paper", () => {
    const f = fixture(); rectangle(f, 20, 20, 65, 60); rectangle(f, 30, 30, 40, 40);
    for (let y = 30; y <= 50; y++) f.edges[y * width + 65] = .595;
    for (let y = 5; y <= 75; y++) for (let x = 5; x <= 90; x++) {
      if (x === 5 || x === 90 || y === 5 || y === 75) f.edges[y * width + x] = .575;
    }
    const coarse = selectAutomaticEdges(f.edges, width, height, f.seeds, f.background), result = run(f);
    expect(coarse.result.mask[50 * width + 50]).toBe(0);
    expect(result.result.mask[50 * width + 50]).toBe(1);
    expect(result.result.mask[10 * width + 10]).toBe(0);
    expect(result.selection).toMatchObject({ edgeReconstruction: "fine-threshold-confirmation", edgeThreshold: .59 });
    expect(result.selection.edgeThresholdTrials).toBeLessThanOrEqual(14);
  });

  it.each([true, false])("preserves separate tools with confirmed paper = %s", confirmedPaper => {
    const f = fixture(); rectangle(f, 10, 15, 35, 60); rectangle(f, 48, 15, 73, 60);
    if (!confirmedPaper) f.background.fill(0);
    for (let x = 35; x <= 48; x++) f.edges[15 * width + x] = f.edges[60 * width + x] = .585;
    const result = run(f);
    expect(result.result.mask[35 * width + 20]).toBe(1);
    expect(result.result.mask[35 * width + 60]).toBe(1);
    for (let y = 20; y < 55; y++) for (let x = 38; x < 45; x++) expect(result.result.mask[y * width + x]).toBe(0);
    expect(result.selection.edgeThresholdTrials).toBeLessThanOrEqual(14);
  });

  it("does not simplify away an observed white notch", () => {
    const f = fixture(); rectangle(f, 10, 10, 75, 65);
    for (let y = 10; y < 50; y++) for (let x = 39; x <= 46; x++) {
      const i = y * width + x;
      f.seeds[i] = 0; f.background[i] = 1;
      f.edges[i] = x === 39 || x === 46 || y === 49 ? .9 : .1;
    }
    for (let x = 39; x <= 46; x++) f.edges[10 * width + x] = .585;
    expect(run(f).result.mask[30 * width + 42]).toBe(0);
  });

  it("ignores foreground and paper labels inside a recognized strip", () => {
    const f = fixture(); rectangle(f, 15, 15, 70, 60);
    for (let x = 30; x < 45; x++) f.edges[15 * width + x] = .585;
    for (let y = 15; y < 25; y++) for (let x = 30; x < 45; x++) f.unknown[y * width + x] = 1;
    const before = run(f);
    for (let i = 0; i < f.unknown.length; i++) if (f.unknown[i]) {
      f.seeds[i] = f.seeds[i] ? 0 : 1; f.background[i] = f.background[i] ? 0 : 1;
    }
    expect(run(f)).toEqual(before);
  });

  it("retains an enclosed edge-only shaft without local color support", () => {
    const f = fixture(); rectangle(f, 10, 20, 45, 60); rectangle(f, 45, 37, 80, 41);
    for (let y = 37; y <= 41; y++) for (let x = 47; x < 80; x++) f.seeds[y * width + x] = 0;
    expect(run(f).result.mask[39 * width + 75]).toBe(1);
  });

  it("uses clipped-region recovery automatically and reports its review limitation", () => {
    const f = fixture(); rectangle(f, 20, 15, 70, 60);
    for (let x = 0; x < width; x++) f.edges[35 * width + x] = .95;
    const result = run(f);
    expect(result.result.reason).toBeUndefined();
    expect(result.result.mask[45 * width + 45]).toBe(1);
    expect(result.result.mask[35 * width]).toBe(0);
    expect(result.selection).toMatchObject({ edgeReconstruction: "clipped-boundary-recovery",
      boundaryRecovery: { status: "recovered", requiresReview: true } });
  });

  it("leaves a clipped mask unchanged if recovery would alter a recognized strip", () => {
    const f = fixture(); rectangle(f, 20, 15, 70, 60);
    for (let x = 0; x < width; x++) f.edges[35 * width + x] = .95;
    f.unknown[35 * width] = 1;
    const result = run(f);
    expect(result.result.reason).toBe("selection-too-tight");
    expect(result.selection.edgeReconstruction).toBeUndefined();
    expect(result.selection.boundaryRecovery).toMatchObject({ status: "rejected", reason: "unknown-strip-change" });
  });

  it("rejects malformed evidence and stops on sparse evidence", () => {
    const f = fixture();
    expect(run(f).selection.edgeThresholdTrials).toBe(1);
    expect(() => run({ ...f, unknown: new Uint8Array(1) })).toThrow("evidence");
    expect(() => run({ ...f, seeds: new Uint8Array(1) })).toThrow();
    f.edges[0] = NaN;
    expect(() => run(f)).toThrow("probability");
  });
});
