import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { outlineBounds, pointInOutline } from "../geometry/outline";
import { detectOutline } from "./pipeline";
import { buildGrabCutSeeds, GRABCUT_MAX_PIXELS, refineWithGrabCut, rejectMaskChange } from "./grabcut";
import { buildScoreFieldOpenCV, MatScope, type OpenCV } from "./segment-opencv";
import type { DetectOptions, ImageLike } from "./types";

let cv: OpenCV;
beforeAll(async () => {
  // Exercise the ACTUAL shipped artifact, not a potentially different npm build.
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL("../../../public/opencv/opencv.js", import.meta.url), "utf8"), {
    module, exports: module.exports, require: createRequire(import.meta.url),
    __dirname: ".", process, Buffer, console, setTimeout, clearTimeout,
    performance, TextDecoder, TextEncoder, WebAssembly,
  });
  cv = await module.exports;
}, 30_000);

function photo(subject: (x: number, y: number) => boolean, alpha = false): ImageLike {
  const width = 160, height = 160;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = subject(x, y), i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = inside ? 60 : 225;
    data[i + 3] = alpha && !inside ? 0 : 255;
  }
  return { width, height, data };
}
const body = (x: number, y: number) => x >= 30 && x < 110 && y >= 20 && y < 90;
const run = (image: ImageLike, options: DetectOptions = {}) => detectOutline(image, options, { loadCV: async () => cv });
function fixture(name: string, width: number, height: number): ImageLike {
  return { width, height, data: new Uint8ClampedArray(gunzipSync(readFileSync(
    new URL(`./fixtures/${name}.rgba.gz`, import.meta.url),
  ))) };
}

describe("guarded GrabCut in the shipped CPU/WASM bundle", () => {
  it("really invokes mask-initialized GrabCut and retains a notch, thin shaft, holes and separate objects", async () => {
    const image = photo((x, y) => (body(x, y) && !(x >= 66 && x < 72 && y < 49) &&
      Math.hypot(x - 52, y - 55) > 8) || (x >= 80 && x < 82 && y >= 85 && y < 145) ||
      (x >= 130 && x < 145 && y >= 55 && y < 80));
    const invoke = vi.fn((...args: unknown[]) => cv.grabCut(...args));
    const result = await detectOutline(image, {}, { loadCV: async () => ({ ...cv, grabCut: invoke }) });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][6]).toBe(cv.GC_INIT_WITH_MASK);
    expect(invoke.mock.calls[1][6]).toBe(cv.GC_EVAL);
    expect(result.outline).toHaveLength(2);
    expect(result.outline.reduce((n, s) => n + s.holes.length, 0)).toBe(1);
    expect(pointInOutline(result.outline, { x: 69, y: 35 })).toBe(false);
    expect(pointInOutline(result.outline, { x: 81, y: 130 })).toBe(true);
    expect(pointInOutline(result.outline, { x: 52, y: 55 })).toBe(false);
  });

  // Historical crop diagnostics: do not count as photo workflow verification.
  it.skip("cleans the Gerber sides without filling either end recess or following dark inserts", async () => {
    const image = fixture("gerber", 384, 600);
    const before = await run(image, { refine: "none" });
    const after = await run(image);
    expect(after.refinement?.status).toBe("accepted");
    for (const p of [{ x: 62, y: 245 }, { x: 73, y: 365 }, { x: 238, y: 350 }]) {
      expect(pointInOutline(before.outline, p)).toBe(true);
      expect(pointInOutline(after.outline, p)).toBe(false);
    }
    for (const p of [{ x: 161, y: 520 }, { x: 162, y: 525 }, { x: 156, y: 62 }]) {
      expect(pointInOutline(before.outline, p)).toBe(false);
      expect(pointInOutline(after.outline, p)).toBe(false);
    }
    expect(pointInOutline(after.outline, { x: 90, y: 200 })).toBe(true);
    expect(after.outline).toHaveLength(1);
    expect(after.outline[0].holes).toHaveLength(0);
  });

  it.skip.each([
    ["wiha-50mm", 128, 88.5, 340.5, 370],
    ["wiha-40mm", 100, 82.5, 310.5, 325],
  ] as const)("preserves the reflective %s shaft at its regression sensitivity", async (name, sensitivity, x, y, tip) => {
    const result = await run(fixture(name, 161, 443), { sensitivity });
    expect(outlineBounds(result.outline)!.maxY).toBeGreaterThan(tip);
    expect(pointInOutline(result.outline, { x, y })).toBe(true);
    expect(pointInOutline(result.outline, { x: x + 8, y })).toBe(false);
  });

  it("keeps cropped image coordinates and foreground touching region boundaries", async () => {
    const image = photo(body);
    const opts = { roi: { x: 45, y: 10, width: 90, height: 100 } };
    const before = await run(image, { ...opts, refine: "none" });
    const after = await run(image, opts);
    for (const key of ["minX", "minY", "maxX", "maxY"] as const) {
      expect(Math.abs(outlineBounds(after.outline)![key] - outlineBounds(before.outline)![key])).toBeLessThan(0.1);
    }
    expect(pointInOutline(after.outline, { x: 46, y: 50 })).toBe(true);
    expect(pointInOutline(after.outline, { x: 40, y: 50 })).toBe(false);
  });

  it("leaves alpha silhouettes, occluded boundaries and over-budget images on the exact original field", async () => {
    const image = photo(body, true);
    const field = buildScoreFieldOpenCV(cv, image);
    expect((await refineWithGrabCut(cv, image, field)).field).toBe(field);
    expect((await run(image)).refinement?.reason).toBe("alpha-mask");
    const opaque = photo(body);
    const color = buildScoreFieldOpenCV(cv, opaque);
    expect((await refineWithGrabCut(cv, opaque, color, { occlusions: [[{ x: 1, y: 1 }]] })).field).toBe(color);
    expect((await refineWithGrabCut(cv, opaque, { ...color, width: GRABCUT_MAX_PIXELS + 1 })).report.reason).toBe("pixel-budget");
  });

  it("keeps a low-contrast object and rejects an achromatic cast shadow", async () => {
    const image = photo(body);
    for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
      const v = body(x, y) ? 180 : x >= 110 && x < 135 && y > 30 && y < 100 ? 212 : 225;
      const i = (y * 160 + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    }
    const result = await run(image);
    expect(pointInOutline(result.outline, { x: 70, y: 50 })).toBe(true);
    expect(pointInOutline(result.outline, { x: 122, y: 50 })).toBe(false);
  });

  it("returns the exact baseline on solver failure and deletes every tracked handle", async () => {
    const image = photo(body);
    const field = buildScoreFieldOpenCV(cv, image);
    const track = vi.spyOn(MatScope.prototype, "track");
    const result = await refineWithGrabCut({ ...cv, grabCut() { throw new Error("OOM"); } }, image, field);
    expect(result.field).toBe(field);
    expect(result.report.reason).toBe("grabcut-failed");
    expect(track.mock.results).toHaveLength(7);
    for (const r of track.mock.results) expect(r.value.isDeleted()).toBe(true);
    track.mockRestore();
  });

  it("cancels between iterations, frees models and never falls back after abort", async () => {
    const image = photo(body);
    const controller = new AbortController();
    const track = vi.spyOn(MatScope.prototype, "track");
    const invoke = vi.fn((...args: unknown[]) => {
      cv.grabCut(...args);
      setTimeout(() => controller.abort(), 0);
    });
    await expect(detectOutline(image, { signal: controller.signal }, {
      loadCV: async () => ({ ...cv, grabCut: invoke }),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).toHaveBeenCalledTimes(1);
    for (const r of track.mock.results) expect(r.value.isDeleted()).toBe(true);
    track.mockRestore();
  });

  it("does not load WASM for pre-cancelled calls; missing WASM keeps the JS baseline", async () => {
    const loadCV = vi.fn(async () => { throw new Error("offline"); });
    const image = photo(body);
    await expect(detectOutline(image, { signal: AbortSignal.abort() }, { loadCV })).rejects.toMatchObject({ name: "AbortError" });
    expect(loadCV).not.toHaveBeenCalled();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fallback = await detectOutline(image, {}, { loadCV });
    expect(fallback.outline).toEqual((await detectOutline(image, { engine: "js" })).outline);
    expect(fallback.engine).toBe("js");
    warn.mockRestore();
  });
});

it("uses all four seed classes without forcing a background frame", () => {
  const width = 20, height = 20;
  const mask = new Uint8Array(width * height);
  const score = new Uint8Array(mask.length);
  for (let y = 3; y < 17; y++) for (let x = 0; x < 12; x++) {
    mask[y * width + x] = 1; score[y * width + x] = x < 10 ? 60 : 25;
  }
  for (let y = 3; y < 17; y++) score[y * width + 12] = 15;
  const seeds = buildGrabCutSeeds(mask, score, width, height, 20);
  expect(new Set(seeds)).toEqual(new Set([0, 1, 2, 3]));
  expect(seeds[10 * width]).toBe(1);
});

it.each([2, 4, 5, 6, 7])("seeds the interior of a %i-pixel shaft without a width gap", width => {
  const size = 32;
  const mask = new Uint8Array(size * size);
  const evidence = new Uint8Array(mask.length);
  for (let y = 5; y < 27; y++) for (let x = 12; x < 12 + width; x++) {
    mask[y * size + x] = 1; evidence[y * size + x] = 100;
  }
  const seeds = buildGrabCutSeeds(mask, evidence, size, size, 30);
  expect(seeds[16 * size + 12 + Math.floor(width / 2)]).toBe(1);
});

it("rejects a lost small object, a split body, invented hole, and filled recess", () => {
  const width = 40, height = 30;
  const mask = new Uint8Array(width * height);
  for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) mask[y * width + x] = 1;
  for (let y = 10; y < 16; y++) for (let x = 32; x < 37; x++) mask[y * width + x] = 1;
  const lost = mask.slice();
  for (let y = 10; y < 16; y++) for (let x = 32; x < 37; x++) lost[y * width + x] = 0;
  expect(rejectMaskChange(mask, lost, width, height)).toBe("object-area-loss");
  const split = mask.slice();
  for (let y = 5; y < 25; y++) split[y * width + 15] = 0;
  expect(rejectMaskChange(mask, split, width, height)).toBe("object-topology");
  const hole = mask.slice();
  for (let y = 10; y < 15; y++) for (let x = 10; x < 15; x++) hole[y * width + x] = 0;
  expect(rejectMaskChange(mask, hole, width, height)).toBe("hole-topology");
  expect(rejectMaskChange(hole, mask, width, height)).toBe("unsupported-growth");
});
