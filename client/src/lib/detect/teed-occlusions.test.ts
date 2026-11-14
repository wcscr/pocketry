import { createRequire } from "node:module";
import { beforeAll, expect, it, vi } from "vitest";
import { createTeedDetector } from "./teed";
import { detectOutline } from "./pipeline";
import { outsideSilhouettes, pointInOutline } from "../geometry/outline";
import type { OpenCV } from "./segment-opencv";
import type { Ring } from "@shared/geometry/types";

let cv: OpenCV;
beforeAll(async () => { cv = await createRequire(import.meta.url)("../../../public/opencv/opencv.js"); }, 60000);
it.each(["inside", "outside", "edge"])("retains learned edges with a recognized aid %s the tool", async placement => {
  const width = 512, height = 512, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const aidX = placement === "inside" ? 190 : placement === "outside" ? 405 : 335;
  // Validated carrier footprint includes a small cut / localization border.
  const aid: Ring = [{ x: aidX - 3, y: 217 }, { x: aidX + 53, y: 217 }, { x: aidX + 53, y: 273 }, { x: aidX - 3, y: 273 }];
  const tool = (x: number, y: number) => x >= 100 && x <= 350 && y >= 100 && y <= 400;
  const carrier = (x: number, y: number) => x >= aidX && x <= aidX + 50 && y >= 220 && y <= 270;
  const inside = (x: number, y: number) => tool(x, y) || carrier(x, y);
  const probabilities = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    // Simulate lettering on white carrier; it must not support a separate aid.
    if (tool(x, y) && !carrier(x, y) || carrier(x, y) && (x + y) % 6 < 3) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 25;
    if (inside(x, y) && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1))) probabilities[i] = 1;
  }
  const forward = vi.fn(() => { const mat = new cv.Mat(height, width, cv.CV_32FC1); mat.data32F.set(probabilities); return mat; });
  // Deterministic DNN output isolates aid handling; Mats, segmentation, local
  // score restoration, tracing and topology use the real shipped WASM build.
  const injected = Object.create(cv);
  injected.readNetFromONNX = () => ({ setInput() {}, forward, delete() {} });
  const detector = createTeedDetector(async () => new Uint8Array([1]));
  try {
    const result = await detectOutline({ width, height, data }, { boundary: "teed", occlusions: [aid] }, { loadCV: async () => injected, teed: detector });
    expect(result.refinement?.status).toBe("accepted"); expect(forward).toHaveBeenCalledTimes(1);
    const outline = outsideSilhouettes(result.outline);
    expect(outline).toHaveLength(1); expect(outline[0].holes).toHaveLength(0);
    expect(pointInOutline(outline, { x: 120, y: 120 })).toBe(true);
    expect(pointInOutline(outline, { x: 370, y: 245 })).toBe(false);
    expect(result.inferredOccludedEdge).toBe(placement === "edge");
    expect(pointInOutline(outline, { x: aidX + 5, y: 245 })).toBe(placement !== "outside");
  } finally { detector.dispose(); }
});

it("automatically closes weak outer edges using one inference and retains manual sensitivity", async () => {
  const width = 512, height = 512, data = new Uint8ClampedArray(width * height * 4).fill(255), probabilities = new Float32Array(width * height);
  for (let y = 80; y <= 430; y++) for (let x = 100; x <= 400; x++) {
    const i = y * width + x;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 25;
    if (x === 100 || x === 400 || y === 80 || y === 430) probabilities[i] = x === 400 && y > 180 && y < 260 ? .58 : .9;
    if (x >= 180 && x <= 240 && y >= 180 && y <= 240 && (x === 180 || x === 240 || y === 180 || y === 240)) probabilities[i] = .9;
  }
  const forward = vi.fn(() => { const mat = new cv.Mat(height, width, cv.CV_32FC1); mat.data32F.set(probabilities); return mat; });
  const injected = Object.create(cv); injected.readNetFromONNX = () => ({ setInput() {}, forward, delete() {} });
  const detector = createTeedDetector(async () => new Uint8Array([1]));
  try {
    const image = { width, height, data }, runtime = { loadCV: async () => injected, teed: detector };
    const automatic = await detectOutline(image, { boundary: "teed" }, runtime);
    expect(automatic.refinement).toMatchObject({ status: "accepted", automaticSensitivity: true, edgeThreshold: .57, edgeThresholdTrials: 3, seedCoverage: 1 });
    expect(outsideSilhouettes(automatic.outline)).toHaveLength(1);
    expect(pointInOutline(automatic.outline, { x: 350, y: 300 })).toBe(true);
    const manual = await detectOutline(image, { boundary: "teed", sensitivity: 100 }, runtime);
    expect(manual.refinement).toMatchObject({ status: "accepted", cached: true, automaticSensitivity: false, edgeThresholdTrials: 1 });
    expect(manual.refinement?.edgeThreshold).toBeCloseTo(.544);
    const withoutGrabCut = await detectOutline(image, { boundary: "teed", refine: "none" }, runtime);
    expect(withoutGrabCut.refinement).toMatchObject({ status: "accepted", automaticSensitivity: true, edgeThreshold: .57, cached: true });
    expect(forward).toHaveBeenCalledTimes(1);
  } finally { detector.dispose(); }
});
