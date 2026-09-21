import { measurementAidMarks } from "./measurement-aid";
import { MEASUREMENT_AIDS, MEASUREMENT_AID_LENGTHS } from "./reference-strip";
import { TEMPLATE_PAPER_MM, type TemplatePaper } from "./template";
import { PDF_POINTS_PER_MM, singlePageVectorPdf } from "./template-pdf";

const CUT_MARGIN_MM = 2;

/** True-size paper artwork shares the 3MF's markers, label and ruler graduations. */
export function measurementAidsPdf(paper: TemplatePaper): Uint8Array {
  // Landscape gives even the 200 mm aid generous printer margins on both papers.
  const page = { width: TEMPLATE_PAPER_MM[paper].height, height: TEMPLATE_PAPER_MM[paper].width };
  const pt = (mm: number) => (mm * PDF_POINTS_PER_MM).toFixed(4);
  const y = (mm: number) => pt(page.height - mm);
  const commands = ["1 g", `0 0 ${pt(page.width)} ${pt(page.height)} re f`];
  const text = (value: string, x: number, baseline: number, fontMm = 3.6) => {
    const safe = value.replace(/([\\()])/g, "\\$1");
    commands.push(`0 g BT /F1 ${pt(fontMm)} Tf ${pt(x)} ${y(baseline)} Td (${safe}) Tj ET`);
  };

  text("Pocketry / Paper measurement aids", 20, 22, 6);
  text(`50 / 100 / 200 mm / ${paper === "a4" ? "A4" : "US Letter"} / landscape`, 20, 31, 4.2);
  text("Print at 100% / Actual size. Turn off Fit to page.", 20, 42);
  text("Check the marker-centre spacing. Dashed cut lines add a 2 mm white margin.", 20, 49);

  // Offset only the cut line; all calibrated artwork stays at its original size.
  for (const [index, length] of MEASUREMENT_AID_LENGTHS.entries()) {
    const spec = MEASUREMENT_AIDS[length];
    const left = (page.width - length) / 2;
    const top = 58 + index * 28;
    commands.push(`0.65 G ${pt(0.1)} w [${pt(1)} ${pt(1)}] 0 d ${pt(left - CUT_MARGIN_MM)} ${y(top + spec.widthMm + CUT_MARGIN_MM)} ${pt(length + 2 * CUT_MARGIN_MM)} ${pt(spec.widthMm + 2 * CUT_MARGIN_MM)} re S [] 0 d`);
    for (const mark of measurementAidMarks(length)) {
      commands.push(`0 g ${pt(left + mark.x)} ${y(top + mark.y + mark.height)} ${pt(mark.width)} ${pt(mark.height)} re f`);
    }
    text(`${length} mm aid / marker centres ${spec.centerSpacingMm} mm apart / IDs ${spec.markerIds.join(" + ")}`, left, top + 20, 3);
  }

  text("Cut out one aid to use in each photo", 20, 149, 4.5);
  [
    "Keep the white marker margins. Keep the aid flat; use thin, rigid backing if needed.",
    "Place on top of the tool near the edge you need to measure. Keep both markers",
    "and the tool outline visible. Photograph straight down; accept the aid scale in Trace.",
    "Verify a tool dimension before printing a pocket. Backing thickness, tilt and",
    "edges at different heights can affect accuracy. Set the scale manually if needed.",
  ].forEach((line, index) => text(line, 20, 159 + index * 7));
  text("pocketry.xyz / Measurement aids v2 / Artwork shares the 3MF markers and dimensions", 20, page.height - 12, 3);
  return singlePageVectorPdf(page.width, page.height, commands);
}
