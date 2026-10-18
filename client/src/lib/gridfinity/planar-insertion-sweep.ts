import type { CrossSection, Manifold, Vec2 } from "manifold-3d";
import type { Kernel } from "@/lib/manifold/runtime";
import type { ExtrusionBand } from "./fillet-stack";

/** Exact Minkowski sum with a planar segment. Each boundary edge traces a
 * quadrilateral; their union with the start and end preserves concavities and
 * only closes holes where the moving source actually passes through them. */
export function sweepCrossSection(kernel: Kernel, section: CrossSection, delta: Vec2): CrossSection {
  const { arena, CrossSection } = kernel;
  if (delta[0] === 0 && delta[1] === 0) return section;
  const strips: Vec2[][] = [];
  for (const ring of section.toPolygons()) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const area = (b[0] - a[0]) * delta[1] - (b[1] - a[1]) * delta[0];
    if (Math.abs(area) < 1e-12) continue;
    const strip: Vec2[] = [a, b, [b[0] + delta[0], b[1] + delta[1]], [a[0] + delta[0], a[1] + delta[1]]];
    strips.push(area > 0 ? strip : strip.reverse());
  }
  const sweptEdges = arena.track(CrossSection.ofPolygons(strips));
  return arena.track(CrossSection.union([section, arena.track(section.translate(delta)), sweptEdges]));
}

/** Clip source bands before a sideways sweep. Clipping afterwards would cut
 * off travel across a split boundary, particularly with different floor limits. */
export function clipExtrusionBands(kernel: Kernel, bands: readonly ExtrusionBand[],
  normal: Vec2, offset: number,
): ExtrusionBand[] {
  const { arena, CrossSection } = kernel;
  return bands.flatMap(band => {
    if (band.section.isEmpty()) return [];
    const { min, max } = band.section.bounds();
    const rectangle: Vec2[] = [[min[0] - 1, min[1] - 1], [max[0] + 1, min[1] - 1],
      [max[0] + 1, max[1] + 1], [min[0] - 1, max[1] + 1]];
    const polygon: Vec2[] = [];
    for (let i = 0; i < rectangle.length; i++) {
      const a = rectangle[i], b = rectangle[(i + 1) % rectangle.length];
      const da = a[0] * normal[0] + a[1] * normal[1] - offset;
      const db = b[0] * normal[0] + b[1] * normal[1] - offset;
      if (da >= 0) polygon.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        polygon.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    if (polygon.length < 3) return [];
    const section = arena.track(band.section.intersect(arena.track(CrossSection.ofPolygons([polygon]))));
    return section.isEmpty() ? [] : [{ ...band, section }];
  });
}

/** Local X/Y travel leaves every band's height unchanged. Sweep the native
 * sections before extrusion instead of unioning a prism per mesh triangle. */
export function planarInsertionCutter(kernel: Kernel, bands: readonly ExtrusionBand[], delta: Vec2): Manifold {
  const { arena, Manifold } = kernel;
  const pieces = bands.map(({ section, bottom, height }) => arena.track(
    arena.track(sweepCrossSection(kernel, section, delta).extrude(height)).translate([0, 0, bottom]),
  ));
  return arena.track(Manifold.union(pieces));
}
