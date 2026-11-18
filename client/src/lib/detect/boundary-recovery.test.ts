import { describe, expect, it } from "vitest";
import { recoverClippedBoundary } from "./boundary-recovery";
import { labelMaskComponents, maskFromEdges } from "./edge-mask";

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

  /** An edge-only box: a part the color detector cannot see, such as bright metal on white paper. */
  function unseeded(f: ReturnType<typeof fixture>, x0: number, y0: number, x1: number, y1: number) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x === x0 || x === x1 || y === y0 || y === y1) f.edges[y * width + x] = .95;
    }
  }
  function spur(f: ReturnType<typeof fixture>, x: number, y0: number, y1: number) {
    for (let y = y0; y <= y1; y++) f.edges[y * width + x] = .95;
  }
  /** A colored handle with a bright metal head above it, sharing one edge. */
  function headAndHandle() {
    const f = fixture(); rectangle(f, 20, 34, 44, 56); unseeded(f, 18, 12, 46, 34);
    return f;
  }

  it("keeps a part without color support when only thin lines reach opposite sides", () => {
    const f = headAndHandle(); spur(f, 24, 0, 12); spur(f, 40, 56, 63);
    expect(maskFromEdges(f.edges, width, height, f.seeds).reason).toBe("selection-too-tight");
    const copy = structuredClone(f), result = run(f);
    expect(result.reason).toBeUndefined();
    expect(result.recovery).toMatchObject({ status: "recovered", reason: "thin-contact", lostSupportedPixels: 0, requiresReview: true });
    // The head and the handle are both whole, and the two lines are gone from the selection sides.
    expect(result.mask[20 * width + 32]).toBe(1);
    expect(result.mask[45 * width + 32]).toBe(1);
    expect(result.mask[2 * width + 24]).toBe(0);
    expect(result.mask[61 * width + 40]).toBe(0);
    // Only the lines were taken.
    const original = maskFromEdges(f.edges, width, height, f.seeds).mask;
    for (let y = 12; y <= 56; y++) for (let x = 18; x <= 46; x++) expect(result.mask[y * width + x]).toBe(original[y * width + x]);
    expect(f).toEqual(copy);
  });

  it("leaves one printed line crossing the selection to the general recovery", () => {
    // The same two lines in one column are a single line passing behind the tool.
    const f = headAndHandle(); spur(f, 30, 0, 12); spur(f, 30, 56, 63);
    expect(run(f).recovery.reason).not.toBe("thin-contact");
  });

  /** A faint line two pixels thick from the left side to the right side, rising 6 px, so its ends are not level. */
  function slopedAcross(f: ReturnType<typeof fixture>, leftY: number) {
    for (let x = 0; x < width; x++) {
      const y = Math.round(leftY - 6 * x / (width - 1));
      f.edges[y * width + x] = f.edges[(y + 1) * width + x] = .95;
    }
  }

  it.each([0, 6])("takes out the stretch of a sloped line that joins two tools, %s seed pixels on it", onLine => {
    // The line's ends are released as thin contacts, but its middle stretch reaches no side and would stay
    // between the tools, tracing them as one outline. A few seed pixels on that stretch change nothing.
    const f = fixture(); rectangle(f, 8, 14, 26, 50); rectangle(f, 38, 14, 56, 50); slopedAcross(f, 36);
    for (let x = 30; x < 30 + onLine; x++) f.seeds[Math.round(36 - 6 * x / (width - 1)) * width + x] = 1;
    expect(maskFromEdges(f.edges, width, height, f.seeds).reason).toBe("selection-too-tight");
    const result = run(f);
    expect(result.recovery).toMatchObject({ status: "recovered", reason: "thin-contact" });
    expect(result.mask[20 * width + 17]).toBe(1);
    expect(result.mask[20 * width + 47]).toBe(1);
    // The two tools are separate pieces, with nothing left of the line between them or at the sides.
    const pieces = labelMaskComponents(result.mask, width, height);
    expect(pieces.labels[20 * width + 17]).not.toBe(pieces.labels[20 * width + 47]);
    for (let y = 26; y <= 42; y++) expect(result.mask[y * width + 32]).toBe(0);
    expect(result.mask[36 * width + 2]).toBe(0);
    expect(result.mask[31 * width + 61]).toBe(0);
  });

  it("keeps one tool whole when a thin bright neck joins its two colored parts", () => {
    // A colored handle, a bright shaft 3 px thick and a colored socket; the stray lines are not in line with the shaft.
    const f = fixture(); rectangle(f, 6, 24, 24, 40); rectangle(f, 44, 26, 58, 38);
    for (let x = 24; x <= 44; x++) for (let y = 31; y <= 33; y++) f.edges[y * width + x] = .95;
    spur(f, 12, 0, 24); spur(f, 50, 38, 63);
    expect(maskFromEdges(f.edges, width, height, f.seeds).reason).toBe("selection-too-tight");
    const result = run(f);
    expect(result.recovery).toMatchObject({ status: "recovered", reason: "thin-contact", lostSupportedPixels: 0 });
    for (let x = 24; x <= 44; x++) expect(result.mask[32 * width + x]).toBe(1);
    expect(result.mask[2 * width + 12]).toBe(0);
    expect(result.mask[61 * width + 50]).toBe(0);
  });

  it("gives up only the neck, not a bright part, when stray lines happen to lie in line with it", () => {
    // Level strokes left and right, ten rows apart, put the tool's own bright neck on their straight course.
    // That cannot be told from one sloped line crossing two tools, so the neck goes; the bright head must not.
    const w = 128, h = 128, edges = new Float32Array(w * h), seeds = new Uint8Array(w * h);
    const box = (x0: number, y0: number, x1: number, y1: number, color: boolean) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (x === x0 || x === x1 || y === y0 || y === y1) edges[y * w + x] = .95;
        else if (color) seeds[y * w + x] = 1;
      }
    };
    box(10, 36, 45, 92, true); box(57, 44, 82, 84, true); box(82, 30, 104, 98, false);
    for (let x = 45; x <= 57; x++) for (let y = 63; y <= 65; y++) edges[y * w + x] = .95;
    for (let x = 0; x <= 10; x++) edges[60 * w + x] = .95;
    for (let x = 104; x < w; x++) edges[70 * w + x] = .95;
    expect(maskFromEdges(edges, w, h, seeds).reason).toBe("selection-too-tight");
    const result = recoverClippedBoundary(edges, w, h, seeds);
    expect(result.recovery).toMatchObject({ status: "recovered", reason: "thin-contact", lostSupportedPixels: 0 });
    expect(result.mask[64 * w + 30]).toBe(1);
    expect(result.mask[64 * w + 70]).toBe(1);
    expect(result.mask[64 * w + 93]).toBe(1);
  });

  it("still releases thin contacts when a line joins a tool to a part without color support", () => {
    // Only tools the general recovery would keep count: here it would drop the bright part.
    const f = fixture(); rectangle(f, 8, 30, 26, 50); unseeded(f, 38, 30, 56, 50);
    for (let x = 26; x <= 38; x++) f.edges[40 * width + x] = .95;
    spur(f, 14, 0, 30); spur(f, 50, 50, 63);
    const result = run(f);
    expect(result.recovery).toMatchObject({ status: "recovered", reason: "thin-contact" });
    expect(result.mask[40 * width + 17]).toBe(1);
    expect(result.mask[40 * width + 47]).toBe(1);
  });

  it("stops at the colored stretch of a shaft whose color support is thin overall", () => {
    // A 3 px shaft from a handle to the top side, colored for 16 px next to the handle: under 7 % of the
    // shaft, so the shaft counts as a line without color support. Its colorless end is released; the
    // colored stretch stays, as it does in the general recovery.
    const w = 128, h = 128, edges = new Float32Array(w * h), seeds = new Uint8Array(w * h);
    for (let y = 90; y <= 116; y++) for (let x = 40; x <= 88; x++) {
      if (x === 40 || x === 88 || y === 90 || y === 116) edges[y * w + x] = .95;
      else seeds[y * w + x] = 1;
    }
    for (let y = 0; y <= 90; y++) for (let x = 63; x <= 65; x++) edges[y * w + x] = .95;
    for (let y = 72; y <= 87; y++) seeds[y * w + 64] = 1;
    // A printed stroke from the handle to the bottom side makes the selection look clipped.
    for (let y = 116; y < h; y++) edges[y * w + 80] = .95;
    expect(maskFromEdges(edges, w, h, seeds).reason).toBe("selection-too-tight");
    const result = recoverClippedBoundary(edges, w, h, seeds);
    expect(result.recovery).toMatchObject({ status: "recovered", reason: "thin-contact", lostSupportedPixels: 0 });
    for (let y = 72; y <= 87; y++) expect(result.mask[y * w + 64]).toBe(1);
    expect(result.mask[100 * w + 64]).toBe(1);
    expect(result.mask[4 * w + 64]).toBe(0);
    expect(result.mask[124 * w + 80]).toBe(0);
  });

  it("keeps a bright part when a stray stroke carries a short run of color", () => {
    // A bright head cut by the top side, a handle, and a printed stroke to the bottom side with a dark speck
    // on it. Treating the stroke as a colored part would leave the selection clipped and cost the head.
    const w = 100, h = 128, edges = new Float32Array(w * h), seeds = new Uint8Array(w * h);
    const box = (x0: number, y0: number, x1: number, y1: number, color: boolean) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (x === x0 || x === x1 || y === y0 || y === y1) edges[y * w + x] = .95;
        else if (color) seeds[y * w + x] = 1;
      }
    };
    box(28, 0, 72, 34, false); box(30, 34, 70, 56, true);
    for (let y = 56; y < h; y++) for (let x = 60; x <= 61; x++) edges[y * w + x] = .95;
    for (let y = 90; y <= 97; y++) seeds[y * w + 60] = 1;
    expect(maskFromEdges(edges, w, h, seeds).reason).toBe("selection-too-tight");
    const result = recoverClippedBoundary(edges, w, h, seeds);
    expect(result.recovery).toMatchObject({ status: "recovered", reason: "thin-contact", lostSupportedPixels: 0 });
    expect(result.mask[15 * w + 50]).toBe(1);
    expect(result.mask[45 * w + 50]).toBe(1);
    for (let y = 90; y <= 97; y++) expect(result.mask[y * w + 60]).toBe(1);
    expect(result.mask[120 * w + 60]).toBe(0);
  });

  // Accepted limitation: a faint sloped line across a gap in one tool keeps the paper it closes in. Its ends
  // are not level, so they are not taken for one line, and the paper cannot be told from a bright metal part.
  // The general recovery opens the gap. Keep the wanted result as an expected failure; an unexpected pass
  // requires updating this record.
  it.fails("known limitation: opens a gap that a sloped line across the selection closes in", () => {
    const f = fixture(); rectangle(f, 10, 8, 54, 22); rectangle(f, 10, 22, 24, 56); rectangle(f, 40, 22, 54, 56);
    slopedAcross(f, 46);
    const result = run(f);
    expect(result.recovery.status).toBe("recovered");
    expect(result.mask[30 * width + 32]).toBe(0);
  });

  it("keeps a thin part with color support that reaches a selection side", () => {
    const f = headAndHandle(); spur(f, 40, 56, 63);
    // A dark shaft from the head to the top of the selection.
    for (let y = 0; y <= 12; y++) {
      for (let x = 29; x <= 31; x++) f.edges[y * width + x] = .95;
      f.seeds[y * width + 30] = 1;
    }
    const result = run(f);
    expect(result.recovery).toMatchObject({ status: "recovered", reason: "thin-contact" });
    expect(result.mask[1 * width + 30]).toBe(1);
    expect(result.mask[20 * width + 32]).toBe(1);
    expect(result.mask[61 * width + 40]).toBe(0);
  });

  it("does not accept a mask that lines with color support still clip", () => {
    const f = fixture(); rectangle(f, 20, 20, 44, 50);
    for (const [x, y0, y1] of [[24, 0, 20], [40, 50, 63]]) for (let y = y0; y <= y1; y++) {
      for (let dx = -1; dx <= 1; dx++) f.edges[y * width + x + dx] = .95;
      f.seeds[y * width + x] = 1;
    }
    const result = run(f);
    expect(result.reason).toBe("selection-too-tight");
    expect(result.recovery).toMatchObject({ status: "rejected", reason: "recovered-mask-still-clipped" });
  });

  it("accepts a tool the selection cuts on one side once the line on the other side is gone", () => {
    // The head meets the top of the selection along its whole width; a printed stroke reaches the bottom.
    const f = fixture(); rectangle(f, 20, 34, 44, 56); unseeded(f, 18, 0, 46, 34); spur(f, 40, 56, 63);
    const result = run(f);
    expect(result.recovery).toMatchObject({ status: "recovered", reason: "thin-contact" });
    expect(result.mask[32]).toBe(1);
    expect(result.mask[20 * width + 32]).toBe(1);
    expect(result.mask[61 * width + 40]).toBe(0);
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
