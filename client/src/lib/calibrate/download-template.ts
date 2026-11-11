import { downloadBlob } from "@/lib/download";

import { calibrationTemplatePdf } from "./template-pdf";
import { TEMPLATE_SHEET_VERSION, type TemplateVariant } from "./template";

/** Downloads one true-size, printable Pocketry calibration sheet. */
export function downloadCalibrationTemplate(template: TemplateVariant): void {
  const pdf = calibrationTemplatePdf(template);
  downloadBlob(
    new Blob([pdf], { type: "application/pdf" }),
    `pocketry-calibration-v${TEMPLATE_SHEET_VERSION}-${template}.pdf`,
  );
}
