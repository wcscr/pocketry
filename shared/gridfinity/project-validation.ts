import { DEFAULT_BIN_MATERIALS } from "./materials";
import type { ProjectDoc } from "./project";
import { validateBinSpec, validateLayout, validatePocketFloorMaterials } from "./validate";

/** Cheap editor validation. Exact solid construction remains an export step. */
export function projectLayoutIssues(project: Pick<ProjectDoc, "spec" | "shapes" | "cutouts" | "fingerHoles" | "materials">) {
  const { spec, shapes, cutouts, fingerHoles, materials = DEFAULT_BIN_MATERIALS } = project;
  const shapesById = new Map(shapes.map(shape => [shape.id, shape]));
  return [
    ...validateBinSpec(spec).issues,
    ...validateLayout(spec, cutouts, shapesById, fingerHoles),
    ...validatePocketFloorMaterials(spec, cutouts, shapesById, materials.colorPocketFloors ? materials.pocketFloorThicknessMm : 0),
  ];
}
