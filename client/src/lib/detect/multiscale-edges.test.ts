import { describe, expect, it } from "vitest";
import { maskFromEdges } from "./edge-mask";
import { recoverAcrossScales } from "./multiscale-edges";

const width = 88, height = 42, count = width * height;
type Field = Float32Array | Uint8Array;
function box(field: Field, left: number, top: number, right: number, bottom: number, fill = false) {
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (fill || x === left || x === right || y === top || y === bottom) field[y * width + x] = 1;
  }
}

function printedTool() {
  const fine = new Float32Array(count), coarse = new Float32Array(count);
  const seeds = new Uint8Array(count), paper = new Uint8Array(count), unknown = new Uint8Array(count);
  // The fine model follows a label across the body and separately encloses the tip.
  box(fine, 8, 8, 26, 32); box(fine, 50, 15, 73, 24);
  box(coarse, 8, 8, 56, 32);
  box(seeds, 10, 10, 54, 30, true); box(seeds, 52, 17, 71, 22, true);
  const run = () => recoverAcrossScales(maskFromEdges(fine, width, height, seeds).mask,
    fine, coarse, width, height, seeds, paper, unknown, .6);
  return { fine, coarse, seeds, paper, unknown, run };
}

describe("high-detail cross-scale edge recovery", () => {
  it("fills the labeled body and keeps the tip only visible in the fine map", () => {
    const { run } = printedTool();
    const recovered = run();
    expect(recovered?.seedCoverage).toBe(1);
    expect(recovered?.result.mask[20 * width + 40]).toBe(1);
    expect(recovered?.result.mask[20 * width + 70]).toBe(1);
    expect(recovered?.result.mask[28 * width + 70]).toBe(0);
  });

  it("keeps the fine boundary when a long coarse edge is only two pixels wider", () => {
    const { fine, coarse, seeds, run } = printedTool();
    fine.fill(0); coarse.fill(0); seeds.fill(0);
    box(fine, 8, 8, 70, 30); box(coarse, 8, 8, 70, 32);
    box(seeds, 10, 10, 68, 31, true);
    expect(run()).toBeUndefined();
  });

  it("ignores a coarse enclosure that adds no material evidence", () => {
    const { fine, coarse, run } = printedTool();
    coarse.set(fine);
    expect(run()).toBeUndefined();
  });

  it("preserves a passage of observed paper even inside the coarse enclosure", () => {
    const { seeds, paper, run } = printedTool();
    for (let y = 0; y <= 21; y++) for (let x = 31; x <= 45; x++) {
      seeds[y * width + x] = 0; paper[y * width + x] = 1;
    }
    expect(run()).toBeUndefined();
  });

  it("leaves the primary result intact if recovery would paint over an occlusion", () => {
    const { unknown, run } = printedTool(); unknown[20 * width + 40] = 1;
    expect(run()).toBeUndefined();
  });

  it("preserves distinct fine-scale tools even when the coarse model encloses both", () => {
    const { fine, coarse, seeds, run } = printedTool();
    fine.fill(0); coarse.fill(0); seeds.fill(0);
    box(seeds, 10, 12, 43, 28, true); box(seeds, 58, 12, 72, 28, true);
    box(fine, 8, 10, 26, 30); box(fine, 56, 10, 75, 30);
    box(coarse, 8, 10, 75, 30);
    expect(run()).toBeUndefined();
  });

  it("rejects a bridge between tools that the coarse map keeps separate", () => {
    const { fine, coarse, seeds, run } = printedTool();
    fine.fill(0); coarse.fill(0); seeds.fill(0);
    box(seeds, 10, 12, 43, 28, true); box(seeds, 58, 12, 72, 28, true);
    box(fine, 8, 10, 26, 30); box(fine, 44, 17, 73, 23);
    box(coarse, 8, 10, 46, 30); box(coarse, 56, 10, 75, 30);
    expect(run()).toBeUndefined();
  });
});
