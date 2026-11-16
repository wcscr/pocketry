import type { CrossSection } from "manifold-3d";
import { surfaceTextName, type SurfaceText } from "@shared/gridfinity/surface-text";
import type { ValidationIssue } from "@shared/gridfinity/validate";
import { withArena } from "@/lib/manifold/arena";

// A reference extrusion width, not a printer profile or a slicing guarantee.
export const TEXT_REFERENCE_LINE_WIDTH_MM = 0.42;

/**
 * Estimate which details cannot contain a round extrusion at the reference width.
 * Erode then dilate each connected outline independently: a large icon must not
 * hide disappearing letters, punctuation, or dots. Allow 20% area loss to avoid
 * flagging ordinary rounded corners and pointed terminals as unprintable text.
 * This is advisory; variable-width walls and thin-wall handling differ by slicer.
 * Run beside extrusion in the geometry worker, using its already-built section.
 */
export function surfaceTextPrintabilityIssue(label: SurfaceText, section: CrossSection): ValidationIssue | undefined {
  const thin = withArena(arena => {
    const components = arena.trackAll(section.decompose());
    return components.some(component => {
      const area = component.area();
      if (area <= 1e-8) return false;
      const inset = arena.track(component.offset(-TEXT_REFERENCE_LINE_WIDTH_MM / 2, "Round", 2, 24));
      if (inset.isEmpty()) return true;
      const printable = arena.track(inset.offset(TEXT_REFERENCE_LINE_WIDTH_MM / 2, "Round", 2, 24));
      return arena.track(component.subtract(printable)).area() / area > 0.2;
    });
  });
  if (!thin) return undefined;
  return {
    code: "surface-text-thin-strokes",
    severity: "warning",
    surfaceTextIds: [label.id],
    message: `Fine detail in “${surfaceTextName(label)}” may disappear at ${TEXT_REFERENCE_LINE_WIDTH_MM} mm line width (typical 0.4 mm nozzle). Use larger or bolder text, enlarge symbols, or use a smaller nozzle. Check your slicer's layer preview; results depend on its settings.`,
  };
}
