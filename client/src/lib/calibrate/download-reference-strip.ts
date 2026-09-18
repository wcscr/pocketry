import { downloadBlob } from "@/lib/download";
import { referenceStripPdf } from "./reference-strip-pdf";
import type { TemplatePaper } from "./template";

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
