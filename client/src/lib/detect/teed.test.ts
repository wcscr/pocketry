import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { createTeedDetector, loadTeedModel, TEED_MODEL_URL } from "./teed";
import { detectOutline } from "./pipeline";
import type { OpenCV } from "./segment-opencv";
import * as reconstruction from "./reconstruct-edges";

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
    // Runtime/cache contract uses synthetic pixels; photo qualification belongs
    // to the original-photo UI workflow, never a prepared crop.
    const image = { width: 384, height: 600, data: new Uint8ClampedArray(384 * 600 * 4).fill(255) };
    for (let y = 80; y < 520; y++) for (let x = 120; x < 260; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 40;
    }
    try {
      const first = await detectOutline(image, { boundary: "teed" }, { loadCV: async () => cv, teed });
      expect(first.refinement?.cached).toBe(false);
      expect(first.refinement?.automaticSensitivity).toBe(true);
      expect(first.refinement?.edgeThresholdTrials).toBeLessThanOrEqual(28);
      expect(first.outline.length).toBeGreaterThan(0);
      const cached = await detectOutline(image, { boundary: "teed", sensitivity: 135 }, { loadCV: async () => cv, teed });
      expect(cached.refinement?.cached).toBe(true);
      expect(cached.refinement?.automaticSensitivity).toBe(false);
      expect(cached.refinement?.edgeThresholdTrials).toBe(1);
      expect(cached.refinement?.edgeReconstruction).toBeUndefined();
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

  it.each(["recover", "complete", "manual", "incomplete", "lost-seed", "unknown", "merge", "failed-retry"] as const)(
    "bounds area-sampling recovery and preserves the primary result: %s", async scenario => {
      const cv = await shippedCV(), width = 2048, height = 1024, count = 512 * 256;
      const image = { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
      // Fine stripes expose a real difference between bilinear and area input.
      for (let y = 80; y < 420; y++) for (let x = 80; x < 940; x++) {
        const i = (y * width + x) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = x % 4 === 0 ? 20 : 180;
      }
      const seeds = new Uint8Array(count), partial = new Uint8Array(count), complete = new Uint8Array(count);
      for (let y = 50; y < 200; y++) for (let x = 50; x < 460; x++) {
        const i = y * 512 + x; seeds[i] = 255; complete[i] = 1;
        if (x < 300) partial[i] = 1;
      }
      if (scenario === "merge") {
        for (let y = 50; y < 200; y++) for (let x = 230; x < 330; x++) {
          seeds[y * 512 + x] = 0; partial[y * 512 + x] = 0;
        }
      }
      if (scenario === "lost-seed") complete[100 * 512 + 100] = 0;
      const make = (mask: Uint8Array, coverage: number) => ({ result: { mask, score: mask.map(v => v * 255) },
        selection: { edgeThreshold: .6, edgeThresholdTrials: 3, automaticSensitivity: true, seedCoverage: coverage } });
      const reconstruct = vi.spyOn(reconstruction, "reconstructEdges")
        .mockReturnValueOnce(make(scenario === "complete" ? complete : partial, scenario === "complete" ? 1 : .6))
        .mockReturnValue(make(complete, scenario === "incomplete" ? .8 : 1));
      const inputs: Float32Array[] = [];
      const forward = vi.fn(() => {
        if (scenario === "failed-retry" && inputs.length === 2) throw new Error("retry unavailable");
        return { data32F: new Float32Array(512 * 512), delete: vi.fn() };
      });
      const net = { setInput: (mat: { data32F: Float32Array }) => inputs.push(mat.data32F.slice()), forward, delete: vi.fn() };
      const readNet = vi.spyOn(cv, "readNetFromONNX").mockReturnValue(net);
      const detector = createTeedDetector(async () => new Uint8Array());
      try {
        const options = { sensitivity: scenario === "manual" ? 97 : 128, ...(scenario === "unknown" ? { occlusions: [[{x:1250,y:210},{x:1500,y:210},{x:1500,y:600},{x:1250,y:600}]] } : {}) };
        const baseline = {
          score: seeds, evidence: seeds, width: 512, height: 256, iso: 128, otsu: 128, scale: .25, offsetX: 0, offsetY: 0,
        };
        const result = await detector.segment(cv, image, options, baseline);
        const retry = !["complete", "manual"].includes(scenario);
        expect(forward).toHaveBeenCalledTimes(retry ? 2 : 1);
        if (retry) expect(inputs[0].some((value, i) => value !== inputs[1][i])).toBe(true);
        expect(result.selection?.inputSampling).toBe(scenario === "recover" ? "area-recovery" : undefined);
        if (retry) expect(result.selection?.samplingRetry).toBe(true);
        if (scenario === "recover") expect(result.selection?.seedCoverage).toBe(1);
        if (["incomplete", "lost-seed", "unknown", "merge", "failed-retry"].includes(scenario)) expect(result.selection?.seedCoverage).toBe(.6);
        if (scenario === "recover") {
          reconstruct.mockReturnValueOnce(make(partial, .6)).mockReturnValue(make(complete, 1));
          const repeated = await detector.segment(cv, image, options, baseline);
          expect(repeated.cached).toBe(true);
          expect(repeated.selection?.inputSampling).toBe("area-recovery");
          expect(forward).toHaveBeenCalledTimes(2);
        }
        if (scenario === "manual") expect(reconstruct).not.toHaveBeenCalled();
        if (scenario === "failed-retry") expect(result.field).toBeDefined();
      } finally { detector.dispose(); readNet.mockRestore(); reconstruct.mockRestore(); }
    });

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
