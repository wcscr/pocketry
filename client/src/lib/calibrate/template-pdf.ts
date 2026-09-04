import { ARUCO_4X4_MODULES, markerBits } from "./aruco-4x4";
import {
  TEMPLATE_PAPER_MM,
  TEMPLATE_SIGNATURE_VERSION,
  formatTemplateMm,
  isExperimentalTemplate,
  templateHeaderBaselinesMm,
  templateMarkerCentersMm,
  templateMarkerSizeMm,
  templateMarkerSpacingMm,
  templatePaper,
  templateVerificationBarMm,
  type TemplateVariant,
} from "./template";

export const PDF_POINTS_PER_MM = 72 / 25.4;

function number(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function escapePdfText(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

/** Conservative Helvetica width estimate, sufficient for centred sheet labels. */
function estimatedTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const character of text) {
    if ("ilI1.,:;!'".includes(character)) units += 0.28;
    else if ("mwMW@".includes(character)) units += 0.86;
    else if (character === " ") units += 0.28;
    else units += 0.54;
  }
  return units * fontSize;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/**
 * Builds a one-page vector PDF whose drawing coordinates are derived directly
 * from the same millimetre template geometry used by the detector.
 */
export function calibrationTemplatePdf(template: TemplateVariant): Uint8Array {
  const paper = templatePaper(template);
  const page = TEMPLATE_PAPER_MM[paper];
  const pageWidth = page.width * PDF_POINTS_PER_MM;
  const pageHeight = page.height * PDF_POINTS_PER_MM;
  const centers = templateMarkerCentersMm(template);
  const header = templateHeaderBaselinesMm(template);
  const markerSizeMm = templateMarkerSizeMm(template);
  const markerSize = markerSizeMm * PDF_POINTS_PER_MM;
  const moduleSize = markerSize / ARUCO_4X4_MODULES;
  const commands: string[] = ["1 g", `0 0 ${number(pageWidth)} ${number(pageHeight)} re f`];

  const pdfX = (millimetres: number) => millimetres * PDF_POINTS_PER_MM;
  const pdfY = (millimetresFromTop: number) =>
    pageHeight - millimetresFromTop * PDF_POINTS_PER_MM;
  const drawTopOriginRect = (
    xMm: number,
    yMm: number,
    widthMm: number,
    heightMm: number,
    gray: number,
  ) => {
    commands.push(
      `${number(gray)} g`,
      `${number(pdfX(xMm))} ${number(pdfY(yMm + heightMm))} ${number(
        pdfX(widthMm),
      )} ${number(pdfX(heightMm))} re f`,
    );
  };
  const drawCenteredText = (
    text: string,
    centerXMm: number,
    baselineYMm: number,
    fontSizeMm: number,
    gray: number,
  ) => {
    const fontSize = pdfX(fontSizeMm);
    const x = pdfX(centerXMm) - estimatedTextWidth(text, fontSize) / 2;
    commands.push(
      `${number(gray)} g`,
      `BT /F1 ${number(fontSize)} Tf ${number(x)} ${number(
        pdfY(baselineYMm),
      )} Td (${escapePdfText(text)}) Tj ET`,
    );
  };

  for (const [index, { id, x, y }] of centers.entries()) {
    const originX = x - markerSizeMm / 2;
    const originY = y - markerSizeMm / 2;
    drawTopOriginRect(
      originX,
      originY,
      markerSizeMm,
      markerSizeMm,
      0,
    );
    const bits = markerBits(id);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        if (!bits[row][col]) continue;
        commands.push(
          "1 g",
          `${number(pdfX(originX) + (col + 1) * moduleSize)} ${number(
            pdfY(originY) - (row + 2) * moduleSize,
          )} ${number(moduleSize)} ${number(moduleSize)} re f`,
        );
      }
    }
    const labelY =
      isExperimentalTemplate(template) && index >= 2
        ? originY - 3
        : originY + markerSizeMm + 5;
    drawCenteredText(`id ${id}`, x, labelY, 3.5, 0.2);
  }

  const centerX = page.width / 2;
  const experimental = isExperimentalTemplate(template);
  drawCenteredText(
    experimental
      ? `Pocketry v${TEMPLATE_SIGNATURE_VERSION} experimental - ${paper === "a4" ? "A4" : "US Letter"} - print at 100% scale`
      : `Pocketry v${TEMPLATE_SIGNATURE_VERSION} ${paper === "a4" ? "A4" : "US Letter"} calibration sheet - print at 100% scale (no fit to page)`,
    centerX,
    header.title,
    experimental ? 4 : 5,
    0,
  );
  drawCenteredText(
    experimental
      ? "Keep all four markers visible - camera 1x - shoot straight down."
      : "Place the tool between the markers, keep all four visible, shoot from directly above.",
    centerX,
    header.instructions,
    experimental ? 3 : 3.5,
    0.2,
  );

  const ruler = templateVerificationBarMm(template);
  commands.push(
    "0 G",
    `${number(pdfX(0.5))} w`,
    `${number(pdfX(ruler.startX))} ${number(pdfY(ruler.y))} m ${number(
      pdfX(ruler.endX),
    )} ${number(pdfY(ruler.y))} l S`,
  );
  for (let index = 0; index <= 10; index++) {
    const x = ruler.startX + index * 10;
    const tick = index % 5 === 0 ? 4 : 2.5;
    commands.push(
      `${number(pdfX(0.3))} w`,
      `${number(pdfX(x))} ${number(pdfY(ruler.y))} m ${number(
        pdfX(x),
      )} ${number(pdfY(ruler.y - tick))} l S`,
    );
  }
  const spacing = templateMarkerSpacingMm(template);
  drawCenteredText(
    experimental
      ? `check: this bar is exactly 100 mm - marker centres ${formatTemplateMm(spacing.width)} x ${formatTemplateMm(spacing.height)} mm`
      : "check: this bar is exactly 100 mm - marker centres 150 x 200 mm, diagonals 250 mm",
    centerX,
    ruler.labelY,
    3.5,
    0.2,
  );

  const encoder = new TextEncoder();
  const content = encoder.encode(`${commands.join("\n")}\n`);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(
      pageWidth,
    )} ${number(pageHeight)}] /CropBox [0 0 ${number(pageWidth)} ${number(
      pageHeight,
    )}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${new TextDecoder().decode(content)}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];

  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  let byteOffset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(byteOffset);
    const chunk = encoder.encode(`${index + 1} 0 obj\n${object}\nendobj\n`);
    chunks.push(chunk);
    byteOffset += chunk.length;
  });
  const xrefOffset = byteOffset;
  const xref = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  for (const offset of offsets.slice(1)) {
    xref.push(`${String(offset).padStart(10, "0")} 00000 n `);
  }
  xref.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF",
  );
  chunks.push(encoder.encode(`${xref.join("\n")}\n`));
  return concatBytes(chunks);
}
