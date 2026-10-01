import { hasRigidPocket } from "@shared/gridfinity/rigid-pocket";
import { hasPocketTilt } from "@shared/gridfinity/pocket-orientation";
import type { ProjectDoc } from "@shared/gridfinity/project";

/** Include undo/redo designs so their tools are available when restored too. */
export function projectUsesExperimentalFeatures(project: ProjectDoc): boolean {
  const modelIds = new Set(project.shapes.filter(shape => shape.model).map(shape => shape.id));
  return [project, ...(project.history?.stack.map(entry => entry.doc) ?? [])].some(doc =>
    doc.spec.surfaceTexts.length > 0 ||
    doc.cutouts.some(cutout => modelIds.has(cutout.shapeId) || cutout.designLink || (!hasRigidPocket(cutout) && (hasPocketTilt(cutout) || (cutout.zOffsetMm ?? 0) !== 0))) ||
    doc.fingerHoles.some(hole => hole.designLink),
  );
}
