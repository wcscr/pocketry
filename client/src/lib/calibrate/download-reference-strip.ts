import { downloadBlob } from "@/lib/download";
import { referenceStripPdf } from "./reference-strip-pdf";
import type { TemplatePaper } from "./template";
import type { MeasurementAidLength } from "./reference-strip";

export function downloadReferenceStripPdf(paper: TemplatePaper): void {
  downloadBlob(new Blob([referenceStripPdf(paper)], { type: "application/pdf" }), `pocketry-reference-strip-v1-${paper}.pdf`);
}

/** Load the geometry runtime only when the user asks for a 3D print. */
export async function downloadReferenceStripThreeMf(): Promise<void> {
  const [{ withKernel }, { referenceStripThreeMf }] = await Promise.all([
    import("@/lib/manifold/runtime"), import("./reference-strip-mesh"),
  ]);
  const bytes = await withKernel(referenceStripThreeMf);
  downloadBlob(new Blob([bytes], { type: "model/3mf" }), "pocketry-reference-strip-v1.3mf");
}

export async function downloadMeasurementAid(length: MeasurementAidLength, format: "3mf" | "stl"): Promise<void> {
  const [{ withKernel }, { measurementAidThreeMf, measurementAidStl }] = await Promise.all([
    import("@/lib/manifold/runtime"), import("./measurement-aid-mesh"),
  ]);
  const bytes = await withKernel((kernel) => format === "3mf"
    ? measurementAidThreeMf(kernel, length)
    : measurementAidStl(kernel, length));
  downloadBlob(new Blob([bytes], { type: format === "3mf" ? "model/3mf" : "model/stl" }),
    `pocketry-measurement-aid-${length}mm-v2.${format}`);
}
