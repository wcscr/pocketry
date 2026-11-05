import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createTeedDetector, loadTeedModel, TEED_MODEL_URL } from "./teed";
import { detectOutline } from "./pipeline";
import type { OpenCV } from "./segment-opencv";

async function shippedCV(): Promise<OpenCV> {
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL("../../../public/opencv/opencv.js", import.meta.url), "utf8"), {
    module, exports: module.exports, require: createRequire(import.meta.url),
    __dirname: ".", process, Buffer, console, setTimeout, clearTimeout,
    performance, TextDecoder, TextEncoder, WebAssembly,
  });
  return await module.exports;
}

const model = () => new Uint8Array(readFileSync(resolve("client/public/models/teed/teed-512-f1a4f305.onnx")));
describe("self-hosted learned-outline model", () => {
  it("runs the real bundled graph, caches only identical pixels, and retains color outlines on model failure", async () => {
    const cv = await shippedCV();
    const load = vi.fn(async () => model());
    const teed = createTeedDetector(load);
    const image = { width: 384, height: 600, data: new Uint8ClampedArray(gunzipSync(readFileSync(
      new URL("./fixtures/gerber.rgba.gz", import.meta.url)))) };
    try {
      const first = await detectOutline(image, { boundary: "teed" }, { loadCV: async () => cv, teed });
      expect(first.refinement?.cached).toBe(false);
      expect(first.outline.length).toBeGreaterThan(0);
      const cached = await detectOutline(image, { boundary: "teed", sensitivity: 135 }, { loadCV: async () => cv, teed });
      expect(cached.refinement?.cached).toBe(true);
      const changed = { ...image, data: image.data.slice().fill(128) };
      for (let i = 3; i < changed.data.length; i += 4) changed.data[i] = 255;
      const other = await detectOutline(changed, { boundary: "teed" }, { loadCV: async () => cv, teed });
      expect(other.refinement?.cached).toBe(false);
      expect(load).toHaveBeenCalledTimes(1);
      teed.dispose();
      const broken = createTeedDetector(async () => { throw new Error("offline"); });
      const fallback = await detectOutline(image, { boundary: "teed" }, { loadCV: async () => cv, teed: broken });
      const plain = await detectOutline(image, {}, { loadCV: async () => cv });
      expect(fallback.refinement).toMatchObject({ status: "fallback", reason: "teed-unavailable" });
      expect(fallback.outline).toEqual(plain.outline);
      broken.dispose();
    } finally { teed.dispose(); }
  }, 30_000);

  it("rejects a learned mask that fragments a formerly connected silhouette", async () => {
    const cv = await shippedCV(), width = 100, height = 100;
    const data = new Uint8ClampedArray(width * height * 4).fill(255), score = new Uint8Array(width * height);
    for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) {
      const i = y * width + x; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 30;
      if (x < 45 || x > 55) score[i] = 255;
    }
    const teed = { dispose: vi.fn(), segment: vi.fn(async () => ({ field: {
      score, width, height, scale: 1, offsetX: 0, offsetY: 0, iso: 128, otsu: 128,
    } })) };
    const result = await detectOutline({ width, height, data }, { boundary: "teed" }, { loadCV: async () => cv, teed });
    expect(result.refinement).toMatchObject({ status: "fallback", reason: "fragmented-outline" });
    expect(result.outline).toHaveLength(1);
  });
  it("verifies the exact bundled graph before returning bytes", async () => {
    const bytes = model();
    const request = vi.fn(async () => new Response(bytes));
    expect(await loadTeedModel(undefined, request)).toEqual(bytes);
    expect(request).toHaveBeenCalledWith(TEED_MODEL_URL, { cache: "force-cache", signal: undefined });
  });
  it("rejects corrupt, truncated and oversized assets", async () => {
    const corrupt = model(); corrupt[corrupt.length - 5] ^= 1;
    await expect(loadTeedModel(undefined, async () => new Response(corrupt))).rejects.toThrow("verification");
    await expect(loadTeedModel(undefined, async () => new Response(corrupt.slice(0, 20)))).rejects.toThrow("Incomplete");
    await expect(loadTeedModel(undefined, async () => new Response(new Uint8Array(300_000)))).rejects.toThrow("size");
  });
  it("does not download a model for ordinary detection and reports a JS fallback", async () => {
    const loadCV = vi.fn();
    const segment = vi.fn();
    const image = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(255) };
    const ordinary = await detectOutline(image, { engine: "js" }, { loadCV, teed: { segment, dispose: vi.fn() } });
    expect(ordinary.refinement).toBeUndefined();
    const fallback = await detectOutline(image, { engine: "js", boundary: "teed" }, { loadCV, teed: { segment, dispose: vi.fn() } });
    expect(fallback.refinement).toMatchObject({ status: "fallback", reason: "teed-unavailable" });
    expect(segment).not.toHaveBeenCalled(); expect(loadCV).not.toHaveBeenCalled();
  });
  it("never converts cancellation into a usable fallback", async () => {
    const controller = new AbortController(); controller.abort();
    const loadCV = vi.fn();
    await expect(detectOutline({ width: 3, height: 3, data: new Uint8ClampedArray(36) },
      { boundary: "teed", signal: controller.signal }, { loadCV })).rejects.toMatchObject({ name: "AbortError" });
    expect(loadCV).not.toHaveBeenCalled();
  });
});
