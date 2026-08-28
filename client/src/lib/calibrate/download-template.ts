import { downloadBlob } from "@/lib/download";

import { calibrationTemplatePdf } from "./template-pdf";
import type { TemplatePaper } from "./template";

/** Downloads one true-size, printable Pocketry calibration sheet. */
export function downloadCalibrationTemplate(paper: TemplatePaper): void {
  const pdf = calibrationTemplatePdf(paper);
  downloadBlob(
    new Blob([pdf], { type: "application/pdf" }),
    `pocketry-calibration-v2-${paper}.pdf`,
  );
}
