/** Settings that directly fix a model issue, before falling back to an object editor. */
export function issueSettingsTarget(code: string): { id: string; label: string; focusId?: string } | null {
  switch (code) {
    case "cutouts-require-solid-fill":
      return { id: "bin-settings-construction", label: "Turn on solid fill", focusId: "bin-solid-fill" };
    case "label-tab-edge-missing":
    case "label-tab-clipped":
    case "label-tab-shadow":
      return { id: "bin-settings-construction", label: "Edit label tab", focusId: "bin-label-tab" };
    case "fractional-grid-holes":
      return { id: "bin-settings-size", label: "Change grid pitch", focusId: "bin-grid-pitch" };
    case "floor-color-on-underside":
      return { id: "bin-settings-materials", label: "Edit floor color thickness", focusId: "input-pocket-floor-thickness" };
    case "lip-support-clipped":
    case "no-infill-space":
    case "large-footprint":
      return { id: "bin-settings-size", label: "Edit bin size" };
    default:
      return null;
  }
}
