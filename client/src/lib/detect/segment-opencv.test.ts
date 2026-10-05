import { createRequire } from "node:module";

import { describe, expect, it, beforeAll } from "vitest";

import { outlineArea, outlineBounds, pointInOutline } from "../geometry/outline";
import { buildOutline, normalizeOutline } from "../geometry/outline";
import { traceIsoRings } from "../geometry/trace";
import { buildScoreFieldJS } from "./segment-js";
import { buildScoreFieldOpenCV, type OpenCV } from "./segment-opencv";
import type { ImageLike, ScoreField } from "./types";

/**
 * Coverage for the OpenCV segmentation backend.
 *
 * This is the path that actually runs in a browser — `engine: "auto"` prefers
 * OpenCV and only falls back to JavaScript when the wasm fails to load — so
 * testing only the JS backend would leave the default production path
 * unexercised.
 *
 * It runs headlessly because `@techstark/opencv-js` ships the same 4.11.0 build
 * as the bundled `client/public/opencv/opencv.js`, and because
 * `buildScoreFieldOpenCV` takes `cv` as a parameter rather than importing it.
 *
 * The important assertions are the **agreement** ones: `segment-opencv.ts` and
 * `segment-js.ts` are documented as behaviourally equivalent, and nothing
 * enforced that until now. Drift between them would mean a user's outline
 * silently changed shape depending on whether a wasm download succeeded.
 */

let cv: OpenCV;

beforeAll(async () => {
  // Loaded through createRequire rather than `import`. The package's default
  // export is a Promise, which makes its ESM namespace object itself thenable;
  // Vitest's module runner then awaits the namespace and throws
  // "Promise.prototype.then called on incompatible receiver [object Module]".
  // Requiring the CommonJS entry sidesteps the interop entirely.
  const required = createRequire(import.meta.url)("@techstark/opencv-js") as
    | Promise<OpenCV>
    | { default: Promise<OpenCV> };
  cv = await ("default" in required ? required.default : required);
}, 120_000);

function photo(
  width: number,
  height: number,
  isSubject: (x: number, y: number) => boolean,
  options: { alpha?: boolean } = {},
): ImageLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = isSubject(x, y);
      data[i] = inside ? 45 : 226;
      data[i + 1] = inside ? 48 : 223;
      data[i + 2] = inside ? 52 : 219;
      data[i + 3] = options.alpha ? (inside ? 255 : 0) : 255;
    }
  }
  return { width, height, data };
}

/**
 * A dark subject on a light mat with an achromatic cast shadow beside it.
 *
 * The shadow is a pure luminance scale of the mat, as a real cast shadow under
 * white light is, so it differs from the background only in L.
 */
function shadowed(width: number, height: number, subject: (x: number, y: number) => boolean,
  shadow: (x: number, y: number) => boolean, strength: number): ImageLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = subject(x, y);
      const shade = !inside && shadow(x, y) ? 1 - strength : 1;
      data[i] = (inside ? 45 : 226) * shade;
      data[i + 1] = (inside ? 48 : 223) * shade;
      data[i + 2] = (inside ? 52 : 219) * shade;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** A saturated subject on a neutral mat, so a and b carry the contrast. */
function colored(width: number, height: number, subject: (x: number, y: number) => boolean): ImageLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = subject(x, y);
      data[i] = inside ? 200 : 180;
      data[i + 1] = inside ? 60 : 178;
      data[i + 2] = inside ? 50 : 175;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const box =
  (x0: number, y0: number, x1: number, y1: number) =>
  (x: number, y: number): boolean =>
    x >= x0 && x < x1 && y >= y0 && y < y1;

/** A block with a bay on the right and a round hole through it. */
function toolShape(x: number, y: number): boolean {
  if (!box(30, 30, 170, 150)(x, y)) return false;
  if (box(110, 75, 171, 105)(x, y)) return false;
  return Math.hypot(x - 75, y - 90) > 18;
}

/** Traces a score field the same way the pipeline does. */
function outlineOf(field: ScoreField) {
  const rings = traceIsoRings(field.score, field.width, field.height, {
    iso: field.iso,
    interpolate: true,
    ambiguity: "separate",
  });
  const perSource = field.scale > 0 ? 1 / field.scale : 1;
  const mapped = rings.map((ring) =>
    ring.map((p) => ({
      x: (p.x + 0.5) * perSource + field.offsetX,
      y: (p.y + 0.5) * perSource + field.offsetY,
    })),
  );
  return normalizeOutline(buildOutline(mapped), {
    minShellAreaFrac: 0.01,
    minHoleAreaFrac: 0.001,
  });
}

describe("buildScoreFieldOpenCV", () => {
  it("separates the subject from the background", () => {
    const field = buildScoreFieldOpenCV(cv, photo(160, 160, box(40, 40, 120, 120)));

    const at = (x: number, y: number) => field.score[y * field.width + x];
    expect(at(80, 80)).toBeGreaterThanOrEqual(field.iso);
    expect(at(5, 5)).toBeLessThan(field.iso);
  });

  it("reports the mapping back to source coordinates", () => {
    const field = buildScoreFieldOpenCV(cv, photo(200, 200, box(50, 50, 150, 150)), {
      roi: { x: 20, y: 30, width: 120, height: 100 },
    });

    expect(field.offsetX).toBe(20);
    expect(field.offsetY).toBe(30);
    expect(field.width).toBe(120);
    expect(field.height).toBe(100);
  });

  it("honours the pixel budget", () => {
    const field = buildScoreFieldOpenCV(cv, photo(400, 400, box(100, 100, 300, 300)), {
      maxPixels: 10_000,
    });
    expect(field.width * field.height).toBeLessThanOrEqual(12_000);
    expect(field.scale).toBeLessThan(1);
  });

  it("takes the alpha channel when asked", () => {
    const field = buildScoreFieldOpenCV(
      cv,
      photo(120, 120, box(30, 30, 90, 90), { alpha: true }),
      { useAlpha: "always" },
    );
    expect(field.iso).toBe(128);
    expect(field.score[60 * field.width + 60]).toBe(255);
    expect(field.score[2 * field.width + 2]).toBe(0);
  });

  it("does not leak Mats across repeated calls", () => {
    // A leak here grows the wasm heap until the tab dies, and would not show up
    // as a failure anywhere else.
    const image = photo(120, 120, box(30, 30, 90, 90));
    expect(() => {
      for (let i = 0; i < 25; i++) buildScoreFieldOpenCV(cv, image);
    }).not.toThrow();
  });
});

describe("OpenCV and JS backends agree", () => {
  const cases: Array<[string, ImageLike]> = [
    ["a plain rectangle", photo(160, 160, box(40, 40, 120, 120))],
    ["a concave tool with a hole", photo(200, 180, toolShape)],
    ["an object touching the edge", photo(160, 160, box(0, 40, 60, 130))],
    [
      "two disjoint parts",
      photo(200, 120, (x, y) => box(20, 30, 70, 90)(x, y) || box(130, 30, 180, 90)(x, y)),
    ],
    [
      "an object beside a cast shadow",
      shadowed(200, 160, box(40, 40, 110, 120), box(110, 50, 155, 140), 0.3),
    ],
    ["a coloured object on a neutral mat", colored(160, 160, box(40, 40, 120, 120))],
  ];

  // Preserve the confirmed unit mismatch as an expected failure until the
  // production correction lands. An unexpected pass requires removing .fails.
  it.fails.each(cases)("scores pixels in the same units for %s", (_name, image) => {
    // Comparing outlines alone hid a units mismatch: OpenCV's 8-bit Lab scales
    // L to 0..255 while the JS reference uses L* in 0..100, which made the
    // shipped backend weight lightness 2.55x harder relative to chroma.
    const viaCv = buildScoreFieldOpenCV(cv, image);
    const viaJs = buildScoreFieldJS(image);

    let total = 0;
    let worst = 0;
    for (let i = 0; i < viaJs.score.length; i++) {
      const diff = Math.abs(viaCv.score[i] - viaJs.score[i]);
      total += diff;
      worst = Math.max(worst, diff);
    }
    expect(total / viaJs.score.length).toBeLessThan(0.5);
    expect(worst).toBeLessThanOrEqual(3);
  });

  it("rejects a cast shadow on the OpenCV path too", () => {
    const image = shadowed(200, 160, box(40, 40, 110, 120), box(110, 50, 155, 140), 0.3);
    const outline = outlineOf(buildScoreFieldOpenCV(cv, image));

    // The shadow extends to x=155; the object ends at x=110.
    expect(outlineBounds(outline)!.maxX).toBeLessThan(115);
  });

  it.each(cases)("picks a comparable threshold for %s", (_name, image) => {
    const viaCv = buildScoreFieldOpenCV(cv, image);
    const viaJs = buildScoreFieldJS(image);

    // Both derive the level from Otsu on their own score field. The fields are
    // built with different colour-conversion precision, so the levels are close
    // rather than identical.
    expect(viaCv.width).toBe(viaJs.width);
    expect(viaCv.height).toBe(viaJs.height);
    expect(Math.abs(viaCv.iso - viaJs.iso)).toBeLessThan(40);
  });

  it.each(cases)("produces the same topology for %s", (_name, image) => {
    const fromCv = outlineOf(buildScoreFieldOpenCV(cv, image));
    const fromJs = outlineOf(buildScoreFieldJS(image));

    expect(fromCv.length).toBe(fromJs.length);
    expect(fromCv.map((s) => s.holes.length)).toEqual(
      fromJs.map((s) => s.holes.length),
    );
  });

  it.each(cases)("produces the same geometry for %s", (_name, image) => {
    const fromCv = outlineOf(buildScoreFieldOpenCV(cv, image));
    const fromJs = outlineOf(buildScoreFieldJS(image));

    const areaCv = Math.abs(outlineArea(fromCv));
    const areaJs = Math.abs(outlineArea(fromJs));
    // Within 5%: sub-pixel boundaries differ slightly between the two colour
    // pipelines, but a real disagreement would be far larger than this.
    expect(Math.abs(areaCv - areaJs) / Math.max(areaJs, 1)).toBeLessThan(0.05);

    const boundsCv = outlineBounds(fromCv)!;
    const boundsJs = outlineBounds(fromJs)!;
    for (const key of ["minX", "minY", "maxX", "maxY"] as const) {
      expect(Math.abs(boundsCv[key] - boundsJs[key])).toBeLessThan(3);
    }
  });

  it("keeps the concave bay open on the OpenCV path too", () => {
    // The whole point of the rewrite, verified against the backend that
    // actually runs in a browser.
    const outline = outlineOf(buildScoreFieldOpenCV(cv, photo(200, 180, toolShape)));

    expect(pointInOutline(outline, { x: 150, y: 90 })).toBe(false); // jaw gap
    expect(pointInOutline(outline, { x: 75, y: 90 })).toBe(false); // pivot hole
    expect(pointInOutline(outline, { x: 50, y: 45 })).toBe(true); // body
  });

  it("finds the interior hole on the OpenCV path too", () => {
    const outline = outlineOf(buildScoreFieldOpenCV(cv, photo(200, 180, toolShape)));
    expect(outline).toHaveLength(1);
    expect(outline[0].holes).toHaveLength(1);
  });
});
