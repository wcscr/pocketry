import type { ProjectDoc } from "@shared/gridfinity/project";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import { hasColorablePocketSurfaces } from "@shared/gridfinity/pocket-color";
import { surfaceTextName } from "@shared/gridfinity/surface-text";
import { withoutFontSources } from "@shared/gridfinity/project-font-sources";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { writeThreeMf, type ThreeMfObject } from "@/lib/mesh/threemf";
import { EXPORT_QUALITY } from "@/lib/gridfinity/bin";
import type { BuildBinRequest, BuildBinResult } from "@/lib/gridfinity/worker-api";
import { binSizeLabel } from "./export";

export const MODEL_FORMATS = ["stl", "3mf", "3mf-multicolor", "3mf-bambu", "3mf-prusa"] as const;
export type ModelFormat = typeof MODEL_FORMATS[number];

/** Material partition settings and serialization shared by browser and Node. */
export function prepareModelExport(exportProjectDoc: ProjectDoc, format: ModelFormat) {
  const label = binSizeLabel(exportProjectDoc.spec);
  const prusaColorPreview = format === "3mf-prusa";
  const slicerCompatible = format === "3mf-bambu" || prusaColorPreview;
  const multicolor = format === "3mf-multicolor" || slicerCompatible;
  const materials = exportProjectDoc.materials ?? DEFAULT_BIN_MATERIALS;
  const { binColor, pocketFloorColor, stackingRimColor, labelBackgroundColor } = materials;
  const edgeBandColor = materials.colorStackingRim ? stackingRimColor : binColor;
  const includePocketFloors =
    multicolor &&
    materials.colorPocketFloors &&
    (exportProjectDoc.spec.fill === "none" ||
      exportProjectDoc.cutouts.some(hasColorablePocketSurfaces));
  const includeLabelBackground = multicolor && labelBackgroundColor !== null && !!exportProjectDoc.spec.labelTab;
  const includeStackingRim =
    multicolor && materials.colorStackingRim;
  const options = {
    labelBackgroundMaterialThicknessMm: includeLabelBackground ? materials.labelBackgroundThicknessMm : undefined,
    pocketFloorMaterialThicknessMm: includePocketFloors
      ? materials.pocketFloorThicknessMm
      : undefined,
    stackingRimMaterialThicknessMm: includeStackingRim
      ? materials.stackingRimThicknessMm
      : undefined,
    ...(includeStackingRim && materials.colorDividerTops ? { colorDividerTops: true } : {}),
    borderWidthMm: includeStackingRim && exportProjectDoc.spec.lip === "none"
      ? materials.borderWidthMm : undefined,
  };

  const buildRequest: BuildBinRequest = {
    spec: withoutFontSources(exportProjectDoc.spec), quality: EXPORT_QUALITY, exportTopology: true,
    layout: exportProjectDoc.cutouts.length || exportProjectDoc.fingerHoles.length ? {
      shapes: exportProjectDoc.shapes, cutouts: exportProjectDoc.cutouts, fingerHoles: exportProjectDoc.fingerHoles,
    } : undefined,
    ...options,
  };
  const extension: "stl" | "3mf" = format === "stl" ? "stl" : "3mf";
  const variant = prusaColorPreview ? "prusa-color-preview" : slicerCompatible ? "compatible-multicolor" : multicolor ? "multicolor" : "";
  const displayFormat = prusaColorPreview ? "a Prusa color preview 3MF" : slicerCompatible ? "a Bambu multi-color 3MF" : multicolor ? "a multi-color 3MF" : format.toUpperCase();
  const serialize = (result: BuildBinResult): Uint8Array => {
    if (format === "stl") {
      return new Uint8Array(writeBinarySTL(
        { positions: result.mesh.positions, indices: result.mesh.indices },
        `Pocketry Gridfinity bin ${label}`,
      ));
    }
    const textObjects: ThreeMfObject[] = (result.textMeshes ?? []).map(part => ({
      name: part.label.name ?? `Text: ${surfaceTextName(part.label)}`,
      mesh: part.mesh,
      material: { name: "Text", displayColor: (multicolor ? exportProjectDoc.spec.textColor ?? edgeBandColor : binColor) as `#${string}` },
    }));
    if (multicolor) {
      if (!result.materialMeshes && (includePocketFloors || includeStackingRim || includeLabelBackground)) {
        throw new Error(
          "This bin has no printable label background, floor, rim, or border color volume.",
        );
      }
      const objects: ThreeMfObject[] = [
        {
          name: `Gridfinity bin ${label} body`,
          mesh: result.materialMeshes?.body ?? result.bodyMesh ?? result.mesh,
          material: {
            name: "Bin body",
            displayColor: binColor as `#${string}`,
          },
        },
      ];
      if (includePocketFloors && result.materialMeshes?.pocketFloors) {
        const floorName = exportProjectDoc.spec.fill === "none" ? "Bin floor" : exportProjectDoc.cutouts.some(c => c.role !== "hole" && c.colorCoverage === "interior") ? "Pocket interiors" : "Pocket floors";
        objects.push({
          name: `Gridfinity bin ${label} ${floorName.toLowerCase()}`,
          mesh: result.materialMeshes.pocketFloors,
          material: {
            name: floorName,
            displayColor: pocketFloorColor as `#${string}`,
          },
        });
      }
      if (includeStackingRim && result.materialMeshes?.stackingRim) {
        const rimName = exportProjectDoc.spec.lip === "standard" ? "Stacking rim top" : "Top border";
        objects.push({
          name: `Gridfinity bin ${label} ${rimName.toLowerCase()}`,
          mesh: result.materialMeshes.stackingRim,
          material: {
            name: rimName,
            displayColor: stackingRimColor as `#${string}`,
          },
        });
      }
      if (includeLabelBackground && result.materialMeshes?.labelBackground) {
        objects.push({
          name: `Gridfinity bin ${label} label backgrounds`,
          mesh: result.materialMeshes.labelBackground,
          material: { name: "Label background", displayColor: labelBackgroundColor as `#${string}` },
        });
      }
      // A wide, deep border can color all of a small bin. Keep its chosen
      // color and omit the now-empty body rather than exporting an empty mesh.
      const printableObjects = objects.concat(textObjects).filter(object => object.mesh.indices.length > 0);
      if (printableObjects.length === 0 || (printableObjects.length === 1 && printableObjects[0] === objects[0])) {
        throw new Error(
          "The selected color regions did not produce printable material volumes.",
        );
      }
      const bytes = writeThreeMf(
        printableObjects,
        {
          title: `Pocketry multi-color Gridfinity bin ${label}`,
          assemble: true,
          combineObjects: slicerCompatible,
          prusaPaint: slicerCompatible,
          prusaColorPreview,
        },
      );
      return bytes;
    } else {
      const bytes = writeThreeMf(
        [
          {
            name: `Gridfinity bin ${label}`,
            mesh: result.bodyMesh ?? result.mesh,
            material: {
              name: "Bin body",
              displayColor: binColor as `#${string}`,
            },
          },
          ...textObjects,
        ],
        { title: `Pocketry Gridfinity bin ${label}`, assemble: textObjects.length > 0 },
      );
      return bytes;
    }
  };
  return { label, variant, displayFormat, extension, buildRequest, options, serialize };
}
