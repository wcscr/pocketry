/** Local CPU/WASM benchmark; no server, network requests or model downloads.
 * node --import tsx scripts/evaluate-photo-refinement.ts /tmp/photo-results [extra-images.json]
 * Extra images: [{ name, path, width, height, gzip?, options? }] of local RGBA.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectOutline } from "../client/src/lib/detect/pipeline";
import type { DetectOptions } from "../client/src/lib/detect/types";

interface Fixture { name: string; path: string; width: number; height: number; gzip?: boolean; options?: DetectOptions }
const output = resolve(process.argv[2] ?? "/tmp/pocketry-photo-results");
mkdirSync(output, { recursive: true });
const fixtures: Fixture[] = [
  { name: "gerber", width: 384, height: 600 },
  { name: "wiha-40mm", width: 161, height: 443 },
  { name: "wiha-50mm", width: 161, height: 443 },
].map(f => ({ ...f, gzip: true, path: fileURLToPath(new URL(`../client/src/lib/detect/fixtures/${f.name}.rgba.gz`, import.meta.url)) }));
if (process.argv[3]) fixtures.push(...JSON.parse(readFileSync(process.argv[3], "utf8")) as Fixture[]);
const initialize = performance.now();
const cv = await createRequire(import.meta.url)("../client/public/opencv/opencv.js");
const summary = { node: process.version, platform: `${process.platform}/${process.arch}`,
  initializeMs: performance.now() - initialize, wasmHeapBytes: cv.HEAPU8.buffer.byteLength,
  photos: [] as unknown[] };
for (const fixture of fixtures) {
  const bytes = readFileSync(fixture.path);
  const data = new Uint8ClampedArray(fixture.gzip ? gunzipSync(bytes) : bytes);
  if (data.length !== fixture.width * fixture.height * 4) throw new Error(`Invalid RGBA size: ${fixture.name}`);
  const image = { width: fixture.width, height: fixture.height, data };
  const results = [];
  for (const refine of ["none", "grabcut"] as const) {
    const start = performance.now();
    const { debug, ...result } = await detectOutline(image, { ...fixture.options, refine, debug: true }, { loadCV: async () => cv });
    const totalMs = performance.now() - start;
    writeFileSync(resolve(output, `${fixture.name}-${refine}.mask`), debug!.mask.data.filter((_, i) => i % 4 === 0));
    results.push({ ...result, totalMs });
  }
  const warmMs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await detectOutline(image, fixture.options, { loadCV: async () => cv });
    warmMs.push(performance.now() - start);
  }
  writeFileSync(resolve(output, `${fixture.name}.rgba`), data);
  writeFileSync(resolve(output, `${fixture.name}.json`), JSON.stringify({ width: image.width, height: image.height, results }));
  summary.photos.push({ name: fixture.name, width: image.width, height: image.height,
    rgbaSha256: createHash("sha256").update(data).digest("hex"), warmMs,
    stages: results.map(r => ({ totalMs: r.totalMs, timings: r.timings, refinement: r.refinement })),
    wasmHeapBytes: cv.HEAPU8.buffer.byteLength, processMemory: process.memoryUsage() });
}
writeFileSync(resolve(output, "benchmark.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
