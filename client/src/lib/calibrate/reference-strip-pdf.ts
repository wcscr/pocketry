import { REFERENCE_STRIP, referenceStripBlackCells } from "./reference-strip";
import { TEMPLATE_PAPER_MM, type TemplatePaper } from "./template";
import { PDF_POINTS_PER_MM, singlePageVectorPdf } from "./template-pdf";

/** Printable instructions and one exact-size cut-out; no printer-dependent SVG scaling. */
export function referenceStripPdf(paper: TemplatePaper): Uint8Array {
  const page = TEMPLATE_PAPER_MM[paper];
  const { lengthMm, widthMm, centerSpacingMm } = REFERENCE_STRIP;
  const left = (page.width - lengthMm) / 2;
  const top = 62;
  const pt = (mm: number) => (mm * PDF_POINTS_PER_MM).toFixed(4);
  const y = (mm: number) => pt(page.height - mm);
  const commands: string[] = ["1 g", `0 0 ${pt(page.width)} ${pt(page.height)} re f`, "0 g"];
  const text = (value: string, x: number, baseline: number, fontMm = 3.6) => {
    const safe = value.replace(/([\\()])/g, "\\$1");
    commands.push(`0 g BT /F1 ${pt(fontMm)} Tf ${pt(x)} ${y(baseline)} Td (${safe}) Tj ET`);
  };
  text("Pocketry / Object reference strip", 20, 25, 6);
  text("Calibrate at the height of the object", 20, 34, 4.2);
  text("Print at 100% / Actual size. Turn off Fit to page.", 20, 46);
  text("Check the 100 mm bar below before cutting out the strip.", 20, 53);

  // Cut outline stays outside the one-module (2.5 mm) white marker quiet zones.
  commands.push(`0.65 G ${pt(0.1)} w [${pt(1)} ${pt(1)}] 0 d ${pt(left)} ${y(top + widthMm)} ${pt(lengthMm)} ${pt(widthMm)} re S [] 0 d`);
  for (const { x, y: cellY, size } of referenceStripBlackCells()) {
    commands.push(`0 g ${pt(left + x)} ${y(top + cellY + size)} ${pt(size)} ${pt(size)} re f`);
  }
  text("100 x 20 mm - cut along the outside dashed line", left, 91, 3.3);
  text(`Two 15 mm markers / centres ${centerSpacingMm} mm apart`, left, 98, 3.3);

  commands.push(`0 G ${pt(0.3)} w ${pt(left)} ${y(115)} m ${pt(left + lengthMm)} ${y(115)} l S`);
  for (let mm = 0; mm <= lengthMm; mm += 10) {
    commands.push(`${pt(left + mm)} ${y(115)} m ${pt(left + mm)} ${y(115 - (mm % 50 === 0 ? 4 : 2))} l S`);
  }
  text("This bar must measure exactly 100 mm", left + 16, 123, 3.3);

  text("Use the strip", 20, 145, 4.5);
  const lines = [
    "1. Keep it flat. Mount paper on a thin, rigid backing if needed.",
    "2. Rest it on the part furthest from the paper, near the dimension",
    "    you need to fit. Keep both markers and the tool's outer edge visible.",
    "3. Keep the strip parallel to the paper. Photograph straight down.",
    "4. Import the photo into Trace. Review and accept Reference strip scale.",
    "    If a paper sheet is also detected, choose a reference in Scale.",
  ];
  lines.forEach((line, index) => text(line, 20, 155 + index * 7));
  text("For accurate fit", 20, 210, 4.5);
  [
    "The scale applies near the marker surface's height. A thick backing,",
    "a tilted strip, or edges at different heights can still cause errors.",
    "Verify one tool dimension before printing a pocket. For an uneven tool,",
    "measure that dimension directly and set the scale manually if needed.",
    "3D version: use opaque white and black filament, with markers facing up.",
  ].forEach((line, index) => text(line, 20, 220 + index * 7));
  text("pocketry.xyz / Reference strip v1 / IDs 20 + 21", 20, page.height - 14, 3);
  return singlePageVectorPdf(page.width, page.height, commands);
}
