import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { calibrationTemplatePdf } from "../client/src/lib/calibrate/template-pdf";

const outputDirectory = resolve("output/pdf");
await mkdir(outputDirectory, { recursive: true });

for (const paper of ["a4", "letter"] as const) {
  await writeFile(
    resolve(outputDirectory, `pocketry-calibration-${paper}.pdf`),
    calibrationTemplatePdf(paper),
  );
}
