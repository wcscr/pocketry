import { describe, expect, it } from "vitest";
import { recoverClippedBoundary } from "./boundary-recovery";
import { maskFromEdges } from "./edge-mask";

const width = 64, height = 64;
const fixture = () => ({ edges: new Float32Array(width * height), seeds: new Uint8Array(width * height) });
function rectangle(f: ReturnType<typeof fixture>, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x === x0 || x === x1 || y === y0 || y === y1) f.edges[y * width + x] = .95;
    else f.seeds[y * width + x] = 1;
  }
}
function printAcross(f: ReturnType<typeof fixture>, y: number) {
  for (let x = 0; x < width; x++) f.edges[y * width + x] = .95;
}
const run = (f: ReturnType<typeof fixture>) => recoverClippedBoundary(f.edges, width, height, f.seeds);
function shaft(supported: boolean) {
  const f = fixture(); rectangle(f, 18, 34, 46, 56);
  for (let y = 8; y <= 34; y++) {
    for (let x = 30; x <= 32; x++) f.edges[y * width + x] = .95;
    if (supported) f.seeds[y * width + 31] = 1;
  }
  printAcross(f, 40);
  return f;
}

describe("clipped learned-boundary recovery", () => {
  it("keeps a valid closed region identical", () => {
    const f = fixture(); rectangle(f, 18, 18, 46, 50);
    const result = run(f);
    expect(result.recovery).toEqual({ status: "unchanged", requiresReview: false });
    expect(result.mask).toEqual(maskFromEdges(f.edges, width, height, f.seeds).mask);
  });

  it("rejects a broad genuinely cropped foreground run", () => {
    const f = fixture(); rectangle(f, 0, 15, 63, 50);
    for (let y = 16; y < 50; y++) for (let x = 0; x < width; x++) f.seeds[y * width + x] = 1;
    const result = run(f);
    expect(result.reason).toBe("selection-too-tight");
    expect(result.recovery).toMatchObject({ status: "rejected", reason: "substantial-foreground-at-crop-border" });
  });

  it.each([0, 1, 2, 3])("removes crop-spanning printing and keeps the body at rotation %s", turns => {
    const f = fixture(); rectangle(f, 18, 18, 46, 50); printAcross(f, 30);
    const rotated = fixture();
    const target = (x: number, y: number) => turns === 0 ? y * width + x : turns === 1 ? x * width + width - 1 - y
      : turns === 2 ? (height - 1 - y) * width + width - 1 - x : (height - 1 - x) * width + y;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      rotated.edges[target(x, y)] = f.edges[y * width + x]; rotated.seeds[target(x, y)] = f.seeds[y * width + x];
    }
    const copy = structuredClone(rotated), result = run(rotated);
    expect(result.recovery.status).toBe("recovered");
    expect(result.mask[target(32, 35)]).toBe(1);
    expect(result.mask[target(0, 30)]).toBe(0);
    expect(rotated).toEqual(copy);
  });

  it("retains a narrow shaft supported by foreground evidence", () => {
    const result = run(shaft(true));
    expect(result.recovery.status).toBe("recovered");
    expect(result.mask[8 * width + 31]).toBe(1);
    expect(result.mask[20 * width + 31]).toBe(1);
  });

  // Accepted limitation of this default: a solid edge band with no enclosed
  // interior or color support is indistinguishable from attached sheet printing.
  // Keep the desired invariant as an expected failure, not an assertion that
  // dropping real material is correct. Resolve this before claiming protection
  // for all thin features; an unexpected pass requires updating this record.
  it.fails("known limitation: retains an unseeded barrier-only shaft during clipping recovery", () => {
    const result = run(shaft(false));
    expect(result.mask[8 * width + 31]).toBe(1);
  });

  it("marks recovered geometry for review even when seed coverage is complete", () => {
    expect(run(shaft(false)).recovery.requiresReview).toBe(true);
  });

  it("retains independent tools without adding pixels or filling their gap", () => {
    const f = fixture(); rectangle(f, 8, 12, 23, 50); rectangle(f, 40, 18, 56, 50); printAcross(f, 12);
    const original = maskFromEdges(f.edges, width, height, f.seeds), result = run(f);
    expect(result.recovery.status).toBe("recovered");
    for (let i = 0; i < result.mask.length; i++) expect(!result.mask[i] || !!original.mask[i]).toBe(true);
    expect(result.mask[30 * width + 15]).toBe(1);
    expect(result.mask[30 * width + 48]).toBe(1);
    expect(result.mask[30 * width + 31]).toBe(0);
  });
});
