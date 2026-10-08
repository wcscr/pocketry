import { hasRigidPocket } from "@shared/gridfinity/rigid-pocket";
import { hasPocketTilt } from "@shared/gridfinity/pocket-orientation";
import type { ProjectDoc } from "@shared/gridfinity/project";
import { D_WALL } from "@shared/gridfinity/standard";

/** Include undo/redo designs so their tools are available when restored too. */
export function projectUsesExperimentalFeatures(project: ProjectDoc): boolean {
  return [project, ...(project.history?.stack.map(entry => entry.doc) ?? [])].some(doc =>
    doc.spec.magneticLid ||
    doc.spec.wallThicknessMm !== D_WALL ||
    doc.spec.surfaceTexts.length > 0 ||
    doc.cutouts.some(cutout => cutout.designLink || (!hasRigidPocket(cutout) && (hasPocketTilt(cutout) || (cutout.zOffsetMm ?? 0) !== 0))) ||
    doc.fingerHoles.some(hole => hole.designLink),
  );
}
