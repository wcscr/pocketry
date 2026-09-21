import type { Kernel } from "@/lib/manifold/runtime";
import { roundedRectPolygon } from "@/lib/gridfinity/profiles";
import { extractMeshData } from "@/lib/mesh/mesh-data";
import { writeThreeMf, type ThreeMfObject } from "@/lib/mesh/threemf";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { MEASUREMENT_AIDS, type MeasurementAidLength } from "./reference-strip";
import { MEASUREMENT_AID_EDGE, measurementAidMarks } from "./measurement-aid";

/** Flat marker face, 45-degree bottom chamfer, and a 0.25 mm top edge round. */
export function measurementAidBlank(kernel: Kernel, length: MeasurementAidLength) {
  const { widthMm, thicknessMm } = MEASUREMENT_AIDS[length];
  const { bottomChamferMm, topRadiusMm, cornerRadiusMm } = MEASUREMENT_AID_EDGE;
  const levels: { z: number; inset: number }[] = [{ z: 0, inset: bottomChamferMm }, { z: bottomChamferMm, inset: 0 }];
  for (let step = 0; step <= 6; step++) {
    const angle = step * Math.PI / 12;
    levels.push({ z: thicknessMm - topRadiusMm + topRadiusMm * Math.sin(angle), inset: topRadiusMm * (1 - Math.cos(angle)) });
  }
  const points: [number, number, number][] = levels.flatMap(({ z, inset }) =>
    roundedRectPolygon(length - 2 * inset, widthMm - 2 * inset, cornerRadiusMm - inset, 32)
      .map(([x, y]): [number, number, number] => [x + length / 2, y + widthMm / 2, z]),
  );
  return kernel.arena.track(kernel.Manifold.hull(points));
}

/** Flush, complementary material volumes: white carrier plus black details. */
export function measurementAidMeshes(kernel: Kernel, length: MeasurementAidLength): ThreeMfObject[] {
  const { arena, CrossSection } = kernel;
  const { widthMm, thicknessMm, inkDepthMm } = MEASUREMENT_AIDS[length];
  const polygons = measurementAidMarks(length).map(({ x, y, width, height }): [number, number][] => {
    const bottom = widthMm - y - height;
    return [[x, bottom], [x + width, bottom], [x + width, bottom + height], [x, bottom + height]];
  });
  const inkProfile = arena.track(new CrossSection(polygons, "Positive"));
  const raisedInk = arena.track(inkProfile.extrude(inkDepthMm));
  const ink = arena.track(raisedInk.translate([0, 0, thicknessMm - inkDepthMm]));
  const blank = measurementAidBlank(kernel, length);
  const black = arena.track(blank.intersect(ink));
  const white = arena.track(blank.subtract(black));
  return [
    { name: `${length} mm white carrier`, mesh: extractMeshData(kernel, white), material: { name: "Opaque white", displayColor: "#FFFFFF" } },
    { name: "Black markers, label and graduations", mesh: extractMeshData(kernel, black), material: { name: "Opaque black", displayColor: "#000000" } },
  ];
}

export function measurementAidThreeMf(kernel: Kernel, length: MeasurementAidLength): Uint8Array {
  return writeThreeMf(measurementAidMeshes(kernel, length), { assemble: true, title: `Pocketry ${length} x 15 x 2 mm measurement aid` });
}

/** Single-colour STL has recessed details; fill those recesses black for detection. */
export function measurementAidStl(kernel: Kernel, length: MeasurementAidLength): ArrayBuffer {
  const { mesh } = measurementAidMeshes(kernel, length)[0];
  return writeBinarySTL(
    { positions: new Float32Array(mesh.positions), indices: new Uint32Array(mesh.indices) },
    `Pocketry ${length} x 15 x 2 mm - paint recessed markings black`,
  );
}
