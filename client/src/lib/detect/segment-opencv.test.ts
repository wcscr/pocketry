import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { describe, expect, it, beforeAll } from "vitest";

import { outlineArea, outlineBounds, pointInOutline } from "../geometry/outline";
import { buildOutline, normalizeOutline } from "../geometry/outline";
import { traceIsoRings } from "../geometry/trace";
import { labDistanceScore, rgbToLab } from "./background";
import { refineOutline } from "./pipeline";
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

  it.each([[0, 255], [64, 192], [120, 200], [180, 210]])("scores achromatic contrast in L* units (%s against %s)", (subject, background) => {
    const image = photo(160, 160, box(40, 40, 120, 120));
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const value = box(40, 40, 120, 120)(x, y) ? subject : background;
      const i = (y * image.width + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    }
    const expected = labDistanceScore(rgbToLab(subject, subject, subject), rgbToLab(background, background, background));
    expect(Math.abs(buildScoreFieldOpenCV(cv, image).score[80 * 160 + 80] - expected)).toBeLessThanOrEqual(1);
  });

  it.each([
    [40, 40, 120, 120], [0, 40, 80, 120], [80, 40, 160, 120],
    [40, 0, 120, 80], [40, 80, 120, 160],
  ])("uses the reference cleanup for alpha corners and image edges (%s,%s,%s,%s)", (x0, y0, x1, y1) => {
    // Alpha bypasses colour conversion, isolating kernel shape and edge policy.
    const image = photo(160, 160, box(x0, y0, x1, y1), { alpha: true });
    const options = { useAlpha: "always" as const };
    expect(buildScoreFieldOpenCV(cv, image, options).score).toEqual(buildScoreFieldJS(image, options).score);
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
  for (const engine of ["opencv", "js"] as const) {
    const segment = (image: ImageLike) => engine === "opencv"
      ? buildScoreFieldOpenCV(cv, image)
      : buildScoreFieldJS(image);

    it.each([false, true])(`${engine} retains a thin shaft and removes speckles (alpha=%s)`, (alpha) => {
      const image = photo(180, 200, (x, y) =>
        box(60, 25, 100, 95)(x, y) || box(79, 95, 81, 175)(x, y) ||
        (x === 130 && y === 145), { alpha });
      const field = segment(image);
      expect(field.score[150 * field.width + 80]).toBeGreaterThanOrEqual(field.iso);
      expect(field.score[145 * field.width + 130]).toBe(0);
      const outline = outlineOf(field);
      expect(outline).toHaveLength(1);
      expect(pointInOutline(outline, { x: 80, y: 150 })).toBe(true);
      expect(pointInOutline(outline, { x: 86, y: 150 })).toBe(false);
    });

    it(`${engine} preserves an angled shaft and the space beside it`, () => {
      const image = photo(200, 200, (x, y) => box(40, 30, 90, 90)(x, y) ||
        (y >= 85 && y < 155 && x >= y - 10 && x < y - 8));
      const outline = outlineOf(segment(image));
      expect(pointInOutline(outline, { x: 120, y: 130 })).toBe(true);
      expect(pointInOutline(outline, { x: 124, y: 130 })).toBe(false);
    });

    it(`${engine} leaves separate tools apart when a thin stray line joins them`, () => {
      // A smaller solid object must not become part of the larger one.
      const image = photo(180, 140, (x, y) => box(20, 25, 75, 115)(x, y) ||
        box(115, 55, 130, 75)(x, y) || box(75, 64, 115, 66)(x, y));
      const outline = outlineOf(segment(image));
      expect(outline).toHaveLength(2);
      expect(pointInOutline(outline, { x: 95, y: 65 })).toBe(false);
      expect(pointInOutline(outline, { x: 122, y: 65 })).toBe(true);
    });

    it(`${engine} restores a narrow neck with small surviving shaft fragments`, () => {
      const image = photo(160, 200, (x, y) => box(50, 25, 95, 85)(x, y) ||
        box(71, 85, 73, 175)(x, y) || box(70, 130, 74, 145)(x, y));
      const outline = outlineOf(segment(image));
      expect(outline).toHaveLength(1);
      expect(pointInOutline(outline, { x: 72, y: 160 })).toBe(true);
    });

    it.each([
      { photo: "50", sensitivity: 128, shaft: { x: 88.5, y: 340.5 }, tipY: 370 },
      { photo: "40", sensitivity: 100, shaft: { x: 82.5, y: 310.5 }, tipY: 325 },
    ])(`${engine} retains the reflective shaft in the $photo mm photo`, ({ photo, sensitivity, shaft, tipY }) => {
      const data = new Uint8ClampedArray(gunzipSync(readFileSync(
        new URL(`./fixtures/wiha-${photo}mm.rgba.gz`, import.meta.url),
      )));
      const image = { width: 161, height: 443, data };
      const options = { sensitivity, useAlpha: "never" as const };
      const field = engine === "opencv"
        ? buildScoreFieldOpenCV(cv, image, options)
        : buildScoreFieldJS(image, options);
      const outline = refineOutline(outlineOf(field), {}, field);
      expect(outlineBounds(outline)!.maxY).toBeGreaterThan(tipY);
      expect(pointInOutline(outline, shaft)).toBe(true);
      expect(pointInOutline(outline, { x: shaft.x + 8, y: shaft.y })).toBe(false);
    });
  }

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

  it.each(cases)("scores pixels in the same units for %s", (_name, image) => {
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
