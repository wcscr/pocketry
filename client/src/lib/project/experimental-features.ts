import { hasPocketTilt } from "@shared/gridfinity/pocket-orientation";
import type { ProjectDoc } from "@shared/gridfinity/project";

/** Include undo/redo designs so their tools are available when restored too. */
export function projectUsesExperimentalFeatures(project: ProjectDoc): boolean {
  return [project, ...(project.history?.stack.map(entry => entry.doc) ?? [])].some(doc =>
    doc.cutouts.some(cutout => cutout.designLink || hasPocketTilt(cutout) || (cutout.zOffsetMm ?? 0) !== 0) ||
    doc.fingerHoles.some(hole => hole.designLink),
  );
}
