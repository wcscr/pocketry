import type { Manifold } from "manifold-3d";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import sans from "three/examples/fonts/droid/droid_sans_regular.typeface.json";
import sansBold from "three/examples/fonts/droid/droid_sans_bold.typeface.json";
import mono from "three/examples/fonts/droid/droid_sans_mono_regular.typeface.json";
import helvetiker from "three/examples/fonts/helvetiker_regular.typeface.json";
import helvetikerBold from "three/examples/fonts/helvetiker_bold.typeface.json";
import type { SurfaceText } from "@shared/gridfinity/surface-text";
import type { BinSpec } from "@shared/gridfinity/types";
import { infillTopZ } from "@shared/gridfinity/fill";
import { BASE_HEIGHT } from "@shared/gridfinity/standard";
import { normalizeOutline, outlineBounds } from "@/lib/geometry/outline";
import type { Kernel } from "@/lib/manifold/runtime";

const loader = new FontLoader();
const fonts = {
  sans: loader.parse(sans), "sans-bold": loader.parse(sansBold), mono: loader.parse(mono),
  helvetiker: loader.parse(helvetiker), "helvetiker-bold": loader.parse(helvetikerBold),
};

export function surfaceTextZ(spec: BinSpec): number {
  return spec.fill === "none" ? BASE_HEIGHT : infillTopZ(spec);
}

/** Same outlines serve the layout and Manifold extrusion; never silently replace glyphs. */
export function surfaceTextOutline(label: SurfaceText) {
  const selectedFont = label.font;
  const font = typeof selectedFont === "string" ? fonts[selectedFont] : loader.parse({
    // FontLoader memoizes paths on glyph objects. Keep that cache out of saved data.
    glyphs: Object.fromEntries([...new Set(label.text)].filter(key => Object.prototype.hasOwnProperty.call(selectedFont.glyphs, key))
      .map(key => {
        const glyph = selectedFont.glyphs[key];
        return [key, { ...glyph, x_min: 0, x_max: glyph.ha }];
      })),
    familyName: selectedFont.name, resolution: selectedFont.resolution,
    ascender: selectedFont.resolution, descender: 0, underlinePosition: 0, underlineThickness: 0,
    boundingBox: { xMin: 0, yMin: 0, xMax: selectedFont.resolution, yMax: selectedFont.resolution }, original_font_information: {},
  });
  for (const char of label.text) {
    if (!Object.prototype.hasOwnProperty.call(font.data.glyphs, char)) {
      throw new Error(`The label “${label.text}” contains an unsupported character: ${char}`);
    }
  }
  const shapes = font.generateShapes(label.text, label.sizeMm);
  const outline = normalizeOutline(shapes.map(shape => {
    const points = shape.extractPoints(12);
    const ring = (items: { x: number; y: number }[]) => {
      const result = items.map(({ x, y }) => ({ x, y }));
      if (result.length > 1 && result[0].x === result.at(-1)!.x && result[0].y === result.at(-1)!.y) result.pop();
      return result;
    };
    return { outer: ring(points.shape), holes: points.holes.map(ring) };
  }));
  // Complex system fonts can produce hundreds of thousands of points. Avoid
  // spreading them into function arguments, which exceeds browser stack limits.
  const bounds = outlineBounds(outline);
  if (!bounds) throw new Error("Enter some visible text.");
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const angle = label.rotationDeg * Math.PI / 180;
  const transform = (ring: { x: number; y: number }[]) => ring.map(p => ({
    x: (p.x - cx) * Math.cos(angle) - (p.y - cy) * Math.sin(angle) + label.position.x,
    y: (p.x - cx) * Math.sin(angle) + (p.y - cy) * Math.cos(angle) + label.position.y,
  }));
  return outline.map(shape => ({ outer: transform(shape.outer), holes: shape.holes.map(transform) }));
}

/** Text sits exactly on the surface. Keep each label separate for 3MF part editing. */
export function buildSurfaceTexts(kernel: Kernel, spec: BinSpec, body: Manifold): { label: SurfaceText; solid: Manifold; z: number }[] {
  const { arena, CrossSection } = kernel;
  const z = surfaceTextZ(spec);
  const support = arena.track(body.slice(z - 0.01));
  const occupied: Manifold[] = [];
  return spec.surfaceTexts.map(label => {
    const rings = surfaceTextOutline(label).flatMap(shape => [shape.outer, ...shape.holes]);
    const section = arena.track(new CrossSection(rings.map(ring => ring.map(p => [p.x, p.y] as [number, number])), "NonZero"));
    const unsupported = arena.track(section.subtract(support));
    if (unsupported.area() > 0.001) {
      throw new Error(`Text “${label.text}” must fit on the flat surface, clear of pockets and openings. Move it or reduce its size.`);
    }
    const solid = arena.track(arena.track(section.extrude(label.heightMm)).translate([0, 0, z]));
    if (arena.track(solid.intersect(body)).volume() > 0.001 ||
        occupied.some(other => arena.track(solid.intersect(other)).volume() > 0.001)) {
      throw new Error(`Text “${label.text}” overlaps another label or the bin walls. Move it or reduce its size.`);
    }
    if (solid.status() !== "NoError" || solid.isEmpty()) throw new Error(`Could not build text “${label.text}”.`);
    occupied.push(solid);
    return { label, solid, z };
  });
}
