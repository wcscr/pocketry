import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { calibrationTemplatePdf } from "../client/src/lib/calibrate/template-pdf";
import { PAPER_TEMPLATE_VARIANTS } from "../client/src/lib/calibrate/template";

const outputDirectory = resolve("output/pdf");
await mkdir(outputDirectory, { recursive: true });

for (const paper of PAPER_TEMPLATE_VARIANTS) {
  await writeFile(
    resolve(outputDirectory, `pocketry-calibration-${paper}.pdf`),
    calibrationTemplatePdf(paper),
  );
}
