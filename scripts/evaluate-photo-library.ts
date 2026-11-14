/** Paired baseline/GrabCut benchmark on an explicit, hashed local photo manifest.
 * Prepare inputs with scripts/photo-evaluation/prepare-library.py, then:
 * node --import tsx scripts/evaluate-photo-library.ts <input/cases.json> <output>
 * No network, uploads, model downloads or changes to example projects.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { detectOutline } from '../client/src/lib/detect/pipeline';
import type { DetectResult } from '../client/src/lib/detect/types';
interface PhotoCase { name: string; path: string; width: number; height: number; group: string; sourceFile: string }
const cases: PhotoCase[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
const loadStarted = performance.now();
const cv = await createRequire(import.meta.url)('../client/public/opencv/opencv.js');
const initializeMs = performance.now() - loadStarted;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const summaries: unknown[] = [];
for (const c of cases) {
  const data = new Uint8ClampedArray(readFileSync(c.path));
  if (data.length !== c.width * c.height * 4) throw new Error(`Invalid RGBA length: ${c.name}`);
  const image = { width: c.width, height: c.height, data };
  const modes = ['none', 'grabcut'] as const;
  const captures: Partial<Record<typeof modes[number], DetectResult>> = {};
  const cold: Record<string, number> = {};
  // Capture once with debug, then time without allocating debug images. Both
  // methods receive an untimed warm-up; alternate order to limit order/JIT bias.
  for (const refine of modes) {
    const started = performance.now();
    const result = await detectOutline(image, { refine, debug: true }, { loadCV: async () => cv });
    cold[refine] = performance.now() - started;
    const { debug, ...compact } = result;
    writeFileSync(resolve(output, `${c.name}-${refine}.mask`), debug!.mask.data.filter((_, i) => i % 4 === 0));
    captures[refine] = compact;
    await detectOutline(image, { refine }, { loadCV: async () => cv });
  }
  const times: Record<string, number[]> = { none: [], grabcut: [] };
  for (let round = 0; round < 7; round++) {
    for (const refine of round % 2 ? [...modes].reverse() : modes) {
      const started = performance.now();
      await detectOutline(image, { refine }, { loadCV: async () => cv });
      times[refine].push(performance.now() - started);
    }
  }
  const before = captures.none!, after = captures.grabcut!;
  const summary = { ...c, path: undefined, rgbaSha256: createHash('sha256').update(data).digest('hex'),
    firstCaptureMs: cold, warmMs: times, baselineMedianMs: median(times.none), grabcutMedianMs: median(times.grabcut),
    addedMedianMs: median(times.grabcut) - median(times.none), ratio: median(times.grabcut) / median(times.none),
    refinement: after.refinement, stages: after.timings,
    topology: { baseline: before.outline.map(s => s.holes.length), refined: after.outline.map(s => s.holes.length) },
    identicalOutline: JSON.stringify(before.outline) === JSON.stringify(after.outline),
    wasmHeapBytes: cv.HEAPU8.buffer.byteLength, memory: process.memoryUsage() };
  writeFileSync(resolve(output, `${c.name}.json`), JSON.stringify({ ...summary, baseline: before.outline, refined: after.outline }));
  summaries.push(summary);
  console.log(c.name, after.refinement?.status, after.refinement?.reason, Math.round(summary.addedMedianMs)+'ms added');
}
writeFileSync(resolve(output, 'benchmark.json'), JSON.stringify({ node: process.version, platform: process.platform+'/'+process.arch,
  initializeMs, repetitions: 7, order: 'alternating; both warmed; debug disabled during timing', cases: summaries }, null, 2)+'\n');
