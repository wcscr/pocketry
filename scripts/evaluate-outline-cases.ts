/**
 * Replays detection inputs captured from the running app and measures the result.
 *
 * A case is what Pocketry itself handed its detection worker after a user-style
 * flow (automatic calibration, perspective and scale correction, a region drawn
 * closely around one tool): `<name>.rgba` holds those exact pixels and
 * `<name>.json` holds the options, the app's own result, the region and the
 * calibration. An optional `<name>.truth.json` holds a reference outline in the
 * same crop pixel frame: `{ "outline": Outline, "status": "draft" | "reviewed" }`.
 *
 * What is scored is the outline a user gets: detection followed by the automatic
 * line and curve cleanup the Trace page applies. The dense trace is scored too,
 * to show what the cleanup changes.
 *
 * Usage:
 *   node --import tsx scripts/evaluate-outline-cases.ts <cases-dir> <output-dir>
 *     [--boundary teed|color] [--outer-smoothing on|off]
 *
 * Without the flags a case is replayed exactly as captured and checked against
 * the app's own result. `--outer-smoothing on` applies the outward smoothing as
 * the Trace page does (one millimetre when the case has a scale), for cases
 * captured before it existed; `off` removes it.
 *
 * Local CPU/WASM evaluation only. No network; photos and cases stay on this machine.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { templateInkRegionsInPixels, type TemplateVariant } from "../client/src/lib/calibrate/template";
import { detectOutline } from "../client/src/lib/detect/pipeline";
import { SHEET_STROKE_MM, type SheetInk } from "../client/src/lib/detect/sheet-ink";
import { OUTER_SMOOTHING_MM } from "../client/src/lib/geometry/outer-smoothing";
import { outsideSilhouettes } from "../client/src/lib/geometry/outline";
import { createTeedDetector } from "../client/src/lib/detect/teed";
import type { DetectOptions, DetectResult } from "../client/src/lib/detect/types";
import { recommendedReconstructionTolerance } from "../shared/geometry/contour-reconstruction";
import { compareContours, isLoopback, outlineRoughness, scaleOutline, type ContourComparison } from "../shared/geometry/contour-metrics";
import { CURVE_TOLERANCE_MM, curvesFromOutline, sampleCurves } from "../shared/geometry/curves";
import { reconstructDetectedForEditing } from "../shared/geometry/detected-cleanup";
import type { Calibration } from "../shared/geometry/scale";
import type { Outline, Rect } from "../shared/geometry/types";

interface CapturedCase {
  name: string;
  title?: string;
  subject?: number;
  photo?: string;
  detect: { width: number; height: number; options: Omit<DetectOptions, "signal">; ms: number; result: DetectResult | null };
  app: {
    calibration: Calibration | null; region: Rect | null; outline?: Outline; rawOutline?: Outline;
    includeInteriorHoles?: boolean; editableCurves?: boolean; margin?: number | null;
    perspectiveCorrection?: { source: string; template?: TemplateVariant; paperBounds?: Rect } | null;
    imageRotation?: number; imageAlignment?: unknown;
  };
}
interface Truth { outline: Outline; status: "draft" | "reviewed"; source?: string }

const TOLERANCES_MM = [0.25, 0.5] as const;
const SPACING_MM = 0.05;
/** A replay "matches" the app when its boundary is within this many crop pixels almost everywhere. */
const REPLAY_TOLERANCE_PX = 0.05;
/** A stretch farther than this from the reference edge is an excursion; a loopback is one at least this deep. */
const EXCURSION_MM = 0.5;
const LOOPBACK_MM = 1;
/** Stair-steps: swings of 0.1 mm or more, peak to peak, about a copy of the outline smoothed over 0.5 mm. */
const ROUGHNESS_MM = { spacing: SPACING_MM, scale: 0.5, minAmplitude: 0.05 } as const;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const boundaryOverride = flag("--boundary") as DetectOptions["boundary"] | undefined;
const smoothingOverride = flag("--outer-smoothing") as "on" | "off" | undefined;
const inkOverride = flag("--sheet-ink") as "on" | "off" | undefined;
const [casesArg, outputArg] = args;
const switches = [smoothingOverride, inkOverride];
if (!casesArg || !outputArg || switches.some((value) => value && value !== "on" && value !== "off")) {
  console.error("Usage: node --import tsx scripts/evaluate-outline-cases.ts <cases-dir> <output-dir> [--boundary teed|color] [--outer-smoothing on|off] [--sheet-ink on|off]");
  process.exit(2);
}
/** A replay is comparable with the app's own result only when nothing was overridden. */
const asCaptured = !boundaryOverride && !smoothingOverride && !inkOverride;

/**
 * The sheet's printed areas in the crop's pixels, as the Trace page and
 * `processImage` derive them: only for a template-rectified, unrotated photo.
 */
function sheetInkFor(captured: CapturedCase, mmPerPx: number | null): SheetInk | undefined {
  const { perspectiveCorrection: correction, region, imageRotation, imageAlignment } = captured.app;
  if (correction?.source !== "template" || !correction.template || !correction.paperBounds || !region || !mmPerPx) return undefined;
  if (imageRotation || imageAlignment) return undefined;
  const sx = region.width / captured.detect.width, sy = region.height / captured.detect.height;
  return {
    regions: templateInkRegionsInPixels(correction.template, correction.paperBounds).map((area) => ({
      x: (area.x - region.x) / sx, y: (area.y - region.y) / sy, width: area.width / sx, height: area.height / sy, kind: area.kind,
    })),
    strokePx: SHEET_STROKE_MM / mmPerPx,
  };
}
const casesDir = resolve(casesArg);
const outputDir = resolve(outputArg);
mkdirSync(outputDir, { recursive: true });

const loadStarted = performance.now();
const cv = await createRequire(import.meta.url)("../client/public/opencv/opencv.js");
const initializeMs = performance.now() - loadStarted;
const model = new Uint8Array(readFileSync(resolve("client/public/models/teed/teed-512-f1a4f305.onnx")));
const detector = createTeedDetector(async () => model);
const runtime = { loadCV: async () => cv, teed: detector };

/** Millimetres per pixel of the crop the detector saw (the app may shrink a long region). */
function mmPerCropPixel(c: CapturedCase): number | null {
  const { calibration, region } = c.app;
  if (!calibration || !region) return null;
  const pixels = Math.hypot(calibration.endX - calibration.startX, calibration.endY - calibration.startY);
  return pixels > 0 ? calibration.lengthMm / pixels * (region.width / c.detect.width) : null;
}

function round(value: number | null | undefined, digits = 3): number | null {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}
function compact(m: ContourComparison) {
  const loopbacks = m.excursions.filter((excursion) => isLoopback(excursion, LOOPBACK_MM));
  return {
    f025: round(m.scores[0]?.f), f050: round(m.scores[1]?.f),
    offsetMean: round(m.signedOffsetMean), offsetMedian: round(m.signedOffsetMedian),
    p95: round(m.distanceP95), missingMax: round(m.missingMax), excessMax: round(m.excessMax), cutInMax: round(m.cutInMax),
    // Tool left outside the outline, whether a part is lost or the outline cuts in.
    leftOutMax: m.missingMax === null || m.cutInMax === null ? null : round(Math.max(m.missingMax, m.cutInMax)),
    loopbacksIn: loopbacks.filter((excursion) => excursion.side === "inside").length,
    loopbacksOut: loopbacks.filter((excursion) => excursion.side === "outside").length,
    shellDelta: m.shellDelta,
  };
}
function roughness(outline: Outline, mmPerPx: number) {
  const r = outlineRoughness(scaleOutline(outline, mmPerPx), ROUGHNESS_MM);
  return {
    jaggedShare: round(r.jaggedShare), reversals: r.reversals, reversalsPer100Mm: round(r.perimeter ? r.reversals / r.perimeter * 100 : 0, 2),
    ripple: round(r.ripple), perimeterMm: round(r.perimeter, 1),
  };
}

/**
 * The cleanup the Trace page applies after detection (`processImage` with
 * automatic cleanup): outside silhouettes only, then lines and curves fitted
 * to the dense trace within its recommended allowance. Run here in crop pixels;
 * the app runs it in working-photo pixels, which differ by the region scale.
 */
function appCleanup(result: DetectResult, captured: CapturedCase, mmPerPx: number | null): { outline: Outline; applied: boolean; reason?: string } {
  const silhouette = (outline: Outline) => captured.app.includeInteriorHoles ? outline : outsideSilhouettes(outline);
  const detected = silhouette(result.outline), dense = silhouette(result.rawOutline);
  if (!detected.length || !dense.length) return { outline: detected, applied: false, reason: "empty" };
  try {
    const unitsPerPixel = mmPerPx ?? 1;
    const recommended = Math.max(...dense.flatMap((shape) => [shape.outer, ...shape.holes])
      .map((ring) => recommendedReconstructionTolerance(ring, unitsPerPixel, mmPerPx ? "mm" : "px")));
    const tolerance = Math.ceil(recommended * unitsPerPixel * 1000) / 1000 / unitsPerPixel;
    const native = !!captured.app.editableCurves && (captured.app.margin ?? 0) === 0;
    const fitted = reconstructDetectedForEditing(curvesFromOutline(detected), dense, tolerance, native);
    const outline = sampleCurves(fitted.curves, CURVE_TOLERANCE_MM / (mmPerPx ?? 0.1));
    return { outline: captured.app.includeInteriorHoles ? outline : outline.map((shape) => ({ ...shape, holes: [] })), applied: true };
  } catch (error) {
    // The app keeps the detected outline when cleanup cannot preserve it.
    return { outline: detected, applied: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
/**
 * The app's final outline, mapped from working-photo pixels back into the crop the detector saw.
 *
 * The app keeps its dense outline in the same working frame, so the mapping is
 * read off the two dense outlines' bounds; the saved region is not exact to the
 * pixel the crop started on.
 */
function appFinalInCrop(captured: CapturedCase, dense: Outline): Outline | null {
  const { outline, rawOutline } = captured.app;
  if (!outline?.length || !rawOutline?.length || !dense.length) return null;
  const span = (shapes: Outline, axis: "x" | "y") => {
    const values = shapes.flatMap((shape) => shape.outer.map((point) => point[axis]));
    return { min: Math.min(...values), size: Math.max(...values) - Math.min(...values) };
  };
  const axis = (name: "x" | "y") => {
    const working = span(rawOutline, name), crop = span(dense, name);
    const scale = crop.size > 0 ? working.size / crop.size : 1;
    return (value: number) => (value - working.min) / scale + crop.min;
  };
  const x = axis("x"), y = axis("y");
  const map = (ring: { x: number; y: number }[]) => ring.map((point) => ({ x: x(point.x), y: y(point.y) }));
  return outline.map((shape) => ({ outer: map(shape.outer), holes: shape.holes.map(map) }));
}

// Warm the runtime and the model on a small neutral frame so the first case is not charged for it.
{
  const side = 64, data = new Uint8ClampedArray(side * side * 4).fill(235);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) data.set([20, 20, 20, 255], (y * side + x) * 4);
  await detectOutline({ width: side, height: side, data }, { boundary: boundaryOverride ?? "teed" }, runtime);
}

const names = readdirSync(casesDir)
  .filter((file) => file.endsWith(".json") && !file.endsWith(".truth.json"))
  .map((file) => file.slice(0, -5))
  .filter((name) => existsSync(join(casesDir, name + ".rgba")))
  .sort();
const rows: Record<string, unknown>[] = [];
for (const name of names) {
  const captured: CapturedCase = JSON.parse(readFileSync(join(casesDir, name + ".json"), "utf8"));
  const { width, height } = captured.detect;
  const data = new Uint8ClampedArray(readFileSync(join(casesDir, name + ".rgba")));
  if (data.length !== width * height * 4) throw new Error(`Pixel data does not match ${width}x${height}: ${name}`);
  const mmPerPx = mmPerCropPixel(captured);
  const options: DetectOptions = {
    ...captured.detect.options,
    ...(boundaryOverride ? { boundary: boundaryOverride } : {}),
    // The same length `processImage` passes: a millimetre in the crop's pixels, or "auto" without a scale.
    ...(smoothingOverride === "on" ? { outerSmoothingPx: mmPerPx ? OUTER_SMOOTHING_MM / mmPerPx : "auto" as const } : {}),
    ...(smoothingOverride === "off" ? { outerSmoothingPx: undefined } : {}),
    ...(inkOverride === "on" ? { sheetInk: sheetInkFor(captured, mmPerPx) } : {}),
    ...(inkOverride === "off" ? { sheetInk: undefined } : {}),
  };

  const started = performance.now();
  const result = await detectOutline({ width, height, data }, options, runtime);
  const ms = performance.now() - started;

  const appResult = captured.detect.result;
  let replay: { matches: boolean; p95Px: number | null; statusMatches: boolean } | null = null;
  if (appResult && asCaptured) {
    const statusMatches = appResult.refinement?.status === result.refinement?.status && appResult.refinement?.reason === result.refinement?.reason;
    const p95Px = appResult.outline.length && result.outline.length
      ? compareContours(result.outline, appResult.outline, { spacing: 0.25 }).distanceP95
      : appResult.outline.length === result.outline.length ? 0 : null;
    replay = { matches: statusMatches && p95Px !== null && p95Px <= REPLAY_TOLERANCE_PX, p95Px: round(p95Px, 4), statusMatches };
  }

  const cleaned = appCleanup(result, captured, mmPerPx);
  const final = cleaned.outline;
  const appFinal = !asCaptured ? null
    : appFinalInCrop(captured, captured.app.includeInteriorHoles ? result.rawOutline : outsideSilhouettes(result.rawOutline));
  const cleanupReplay = appFinal?.length && final.length
    ? round(compareContours(final, appFinal, { spacing: 0.25 }).distanceP95, 4) : null;
  const truthFile = join(casesDir, name + ".truth.json");
  const truth: Truth | null = existsSync(truthFile) ? JSON.parse(readFileSync(truthFile, "utf8")) : null;
  let measured: Record<string, unknown> | null = null;
  if (truth && mmPerPx) {
    const reference = scaleOutline(truth.outline, mmPerPx);
    const measure = (outline: Outline) => compact(compareContours(scaleOutline(outline, mmPerPx), reference,
      { spacing: SPACING_MM, tolerances: TOLERANCES_MM, excursionThreshold: EXCURSION_MM }));
    measured = { truthStatus: truth.status, final: measure(final), dense: measure(result.rawOutline), simplified: measure(result.outline) };
  }
  const rough = mmPerPx ? {
    final: roughness(final, mmPerPx), dense: roughness(result.rawOutline, mmPerPx),
    reference: truth ? roughness(truth.outline, mmPerPx) : null,
  } : null;

  const row = {
    name, title: captured.title ?? name, subject: captured.subject ?? null, crop: `${width}x${height}`, mmPerPx: round(mmPerPx, 4),
    boundary: options.boundary ?? "color", status: result.refinement ? `${result.refinement.status}:${result.refinement.reason}` : "none",
    edgeThreshold: result.refinement?.edgeThreshold ?? null, edgeReconstruction: result.refinement?.edgeReconstruction ?? null,
    shells: final.length, cleanup: cleaned.applied ? "applied" : `kept detected outline: ${cleaned.reason}`, cleanupReplayP95Px: cleanupReplay,
    ms: Math.round(ms), timings: Object.fromEntries(Object.entries(result.timings).map(([k, v]) => [k, Math.round(v)])),
    outerSmoothingMs: result.timings.outerSmoothing === undefined ? null : round(result.timings.outerSmoothing, 2),
    densePoints: result.rawOutline.reduce((n, shape) => n + shape.outer.length + shape.holes.reduce((m, hole) => m + hole.length, 0), 0),
    wasmHeapMb: round(cv.HEAPU8.buffer.byteLength / 2 ** 20, 1), rssMb: round(process.memoryUsage().rss / 2 ** 20, 1),
    replay, measured, roughness: rough,
  };
  rows.push(row);
  writeFileSync(join(outputDir, name + ".json"), JSON.stringify({ ...row, final, outline: result.outline, rawOutline: result.rawOutline }));
  console.log(name.padEnd(34), row.status.padEnd(40), `${row.shells} shell(s)`, `${row.ms} ms`, cleaned.applied ? "" : `cleanup not applied (${cleaned.reason})`,
    replay ? (replay.matches ? "replay = app" : `replay differs (p95 ${replay.p95Px} px, status ${replay.statusMatches ? "same" : "differs"})`) : "");
}
detector.dispose();

const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
const median = (values: number[]) => {
  const s = sorted(values), n = s.length;
  return !n ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const times = rows.map((row) => row.ms as number);
const replayed = rows.filter((row) => row.replay);
type Measured = { final: ReturnType<typeof compact>; truthStatus: string };
type Rough = { final: ReturnType<typeof roughness> };
const measuredRows = rows.filter((row) => row.measured).map((row) => (row.measured as Measured).final);
const roughRows = rows.filter((row) => row.roughness).map((row) => (row.roughness as Rough).final);
const cleanupReplayed = rows.filter((row) => row.cleanupReplayP95Px != null);
const summary = {
  node: process.version, platform: `${process.platform}/${process.arch}`, initializeMs: Math.round(initializeMs),
  boundary: boundaryOverride ?? "as captured", outerSmoothing: smoothingOverride ?? "as captured", sheetInk: inkOverride ?? "as captured", cases: rows.length,
  medianOuterSmoothingMs: round(median(rows.map((row) => (row.outerSmoothingMs as number | null) ?? 0)), 2),
  maxOuterSmoothingMs: round(Math.max(...rows.map((row) => (row.outerSmoothingMs as number | null) ?? 0)), 2),
  accepted: rows.filter((row) => String(row.status).startsWith("accepted")).length,
  fallback: rows.filter((row) => String(row.status).startsWith("fallback")).length,
  multiShell: rows.filter((row) => (row.shells as number) > 1).length,
  cleanupApplied: rows.filter((row) => row.cleanup === "applied").length,
  medianMs: median(times), maxMs: times.length ? Math.max(...times) : null,
  peakWasmHeapMb: Math.max(...rows.map((row) => row.wasmHeapMb as number)), peakRssMb: Math.max(...rows.map((row) => row.rssMb as number)),
  replayMatchesApp: replayed.length ? `${replayed.filter((row) => (row.replay as { matches: boolean }).matches).length}/${replayed.length}` : "n/a",
  cleanupMatchesApp: cleanupReplayed.length
    ? `${cleanupReplayed.filter((row) => (row.cleanupReplayP95Px as number) <= REPLAY_TOLERANCE_PX).length}/${cleanupReplayed.length}` : "n/a",
  withTruth: measuredRows.length,
  // The final outline against the reference, in the order that matters for a pocket.
  leftOut1Mm: measuredRows.filter((m) => (m.leftOutMax ?? 0) >= 1).length,
  extra1Mm: measuredRows.filter((m) => (m.excessMax ?? 0) >= 1).length,
  withLoopbacks: measuredRows.filter((m) => m.loopbacksIn + m.loopbacksOut > 0).length,
  jagged10Percent: roughRows.filter((r) => (r.jaggedShare ?? 0) >= 0.1).length,
  medianJaggedShare: round(median(roughRows.map((r) => r.jaggedShare ?? 0))),
  medianOffsetMm: round(median(measuredRows.map((m) => m.offsetMean ?? 0))),
};
writeFileSync(join(outputDir, "summary.json"), JSON.stringify({ summary, rows }, null, 1) + "\n");

const cell = (value: unknown) => value == null ? "–" : String(value);
const percent = (value: number | null | undefined) => value == null ? "–" : `${Math.round(value * 100)}%`;
const lines = [
  `# Outline evaluation`, ``,
  `Node ${summary.node}, ${summary.platform}. Boundary: ${summary.boundary}. ${summary.cases} cases: ${summary.accepted} accepted, ${summary.fallback} fell back, ${summary.multiShell} with more than one shell.`,
  `Detection time median ${summary.medianMs} ms, worst ${summary.maxMs} ms. Peak WASM heap ${summary.peakWasmHeapMb} MB, peak RSS ${summary.peakRssMb} MB. Detection replay matches the app on ${summary.replayMatchesApp}; cleanup replay on ${summary.cleanupMatchesApp}. Cases with a reference outline: ${summary.withTruth}.`,
  ``,
  `Scored on the outline after the app's automatic cleanup. Distances are millimetres in the sheet plane. "Left out" is tool outside the outline (a lost part or a cut-in); "extra" is outline beyond the reference; a loopback is a spur or slit at least ${LOOPBACK_MM} mm deep and deeper than its mouth is wide; "jagged" is the share of the edge in stair-steps.`, ``,
  `Left out by 1 mm or more: ${summary.leftOut1Mm}. Extra by 1 mm or more: ${summary.extra1Mm}. With a loopback: ${summary.withLoopbacks}. Jagged on a tenth of the edge or more: ${summary.jagged10Percent} (median share ${percent(summary.medianJaggedShare)}). Median offset ${cell(summary.medianOffsetMm)} mm.`, ``,
  `| Case | Crop px | mm/px | Status | Shells | ms | Replay = app | Left out | Cut-in | Extra | Loopbacks in/out | Jagged | Steps per 100 mm | Offset | F@0.5 | Truth |`,
  `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
  ...rows.map((row) => {
    const m = (row.measured as Measured | null)?.final;
    const rough = (row.roughness as Rough | null)?.final;
    const r = row.replay as { matches: boolean; p95Px: number | null } | null;
    return `| ${row.name} | ${row.crop} | ${cell(row.mmPerPx)} | ${row.status} | ${row.shells} | ${row.ms} | ${r ? (r.matches ? "yes" : `no (${cell(r.p95Px)} px)`) : "–"} | ${cell(m?.leftOutMax)} | ${cell(m?.cutInMax)} | ${cell(m?.excessMax)} | ${m ? `${m.loopbacksIn}/${m.loopbacksOut}` : "–"} | ${percent(rough?.jaggedShare)} | ${cell(rough?.reversalsPer100Mm)} | ${cell(m?.offsetMean)} | ${cell(m?.f050)} | ${cell((row.measured as Measured | null)?.truthStatus)} |`;
  }),
  ``,
];
writeFileSync(join(outputDir, "summary.md"), lines.join("\n"));
console.log(JSON.stringify(summary, null, 1));
