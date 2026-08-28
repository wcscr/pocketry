import { describe, expect, it } from "vitest";

import { calibrationTemplatePdf } from "./template-pdf";

function pdfText(paper: "a4" | "letter"): string {
  return new TextDecoder().decode(calibrationTemplatePdf(paper));
}

function markerRectangles(pdf: string): { x: number; y: number }[] {
  return [...pdf.matchAll(/0 g\n([\d.]+) ([\d.]+) 85\.0394 85\.0394 re f/g)].map(
    (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
  );
}

describe("printable calibration PDF", () => {
  it("uses exact A4 and US Letter page boxes with print scaling disabled", () => {
    const a4 = pdfText("a4");
    expect(a4).toContain("Pocketry v2 A4 calibration sheet");
    expect(a4).toContain("/MediaBox [0 0 595.2756 841.8898]");
    expect(a4).toContain("/CropBox [0 0 595.2756 841.8898]");
    expect(a4).toContain("/PrintScaling /None");

    const letter = pdfText("letter");
    expect(letter).toContain("/MediaBox [0 0 612 792]");
    expect(letter).toContain("/CropBox [0 0 612 792]");
    expect(letter).toContain("/PrintScaling /None");
  });

  it("draws four 30 mm markers at 150 x 200 mm centre spacing", () => {
    for (const paper of ["a4", "letter"] as const) {
      const rectangles = markerRectangles(pdfText(paper));
      expect(rectangles).toHaveLength(4);
      const xs = [...new Set(rectangles.map(({ x }) => x))].sort((a, b) => a - b);
      const ys = [...new Set(rectangles.map(({ y }) => y))].sort((a, b) => a - b);
      expect((xs[1] - xs[0]) / (72 / 25.4)).toBeCloseTo(150, 4);
      expect((ys[1] - ys[0]) / (72 / 25.4)).toBeCloseTo(200, 4);
      expect(85.0394 / (72 / 25.4)).toBeCloseTo(30, 4);
    }
  });

  it("uses the intended paper-specific marker IDs and a 100 mm check bar", () => {
    const a4 = pdfText("a4");
    for (const id of [0, 1, 2, 3]) expect(a4).toContain(`(id ${id})`);
    expect(a4).not.toContain("(id 4)");

    const letter = pdfText("letter");
    for (const id of [4, 5, 6, 7]) expect(letter).toContain(`(id ${id})`);
    expect(letter).not.toContain("(id 0)");

    const lines = [...a4.matchAll(/([\d.]+) ([\d.]+) m ([\d.]+) \2 l S/g)];
    expect(
      lines.some(
        (match) =>
          Math.abs((Number(match[3]) - Number(match[1])) / (72 / 25.4) - 100) <
          0.0001,
      ),
    ).toBe(true);
  });

  it("keeps every drawn element inside an 8 mm print-safe margin", () => {
    for (const paper of ["a4", "letter"] as const) {
      const pdf = pdfText(paper);
      const mediaBox = pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
      const width = Number(mediaBox[1]);
      const height = Number(mediaBox[2]);
      const safe = 8 * (72 / 25.4);
      const checkLabel = pdf.match(
        /BT \/F1 [\d.]+ Tf [\d.]+ ([\d.]+) Td \(check: this bar/,
      )!;
      expect(Number(checkLabel[1]) / (72 / 25.4)).toBeCloseTo(14, 4);
      const pageRect = `${width} ${height} re f`;
      const coordinates = [
        ...pdf.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g),
      ]
        .filter((match) => !match[0].includes(pageRect))
        .map((match) => ({
          x: Number(match[1]),
          y: Number(match[2]),
          width: Number(match[3]),
          height: Number(match[4]),
        }));
      expect(coordinates.length).toBeGreaterThan(4);
      for (const rectangle of coordinates) {
        expect(rectangle.x).toBeGreaterThanOrEqual(safe - 0.001);
        expect(rectangle.y).toBeGreaterThanOrEqual(safe - 0.001);
        expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(
          width - safe + 0.001,
        );
        expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(
          height - safe + 0.001,
        );
      }
    }
  });

  it("uses A4's extra height to separate the header from the markers", () => {
    const a4 = pdfText("a4");
    const letter = pdfText("letter");
    const instructionBaseline = (pdf: string) =>
      Number(
        pdf.match(
          /BT \/F1 [\d.]+ Tf [\d.]+ ([\d.]+) Td \(Place the tool/,
        )![1],
      ) /
      (72 / 25.4);

    expect(instructionBaseline(a4)).toBeCloseTo(297 - 22, 4);
    expect(instructionBaseline(letter)).toBeCloseTo(279.4 - 22.7, 4);

    const a4InstructionFromTop = 297 - instructionBaseline(a4);
    expect(33.5 - a4InstructionFromTop).toBeCloseTo(11.5, 4);
  });

  it("emits a complete single-page PDF with a cross-reference table", () => {
    for (const paper of ["a4", "letter"] as const) {
      const pdf = pdfText(paper);
      expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
      expect(pdf).toContain("/Type /Page");
      expect(pdf).toContain("xref\n0 6");
      expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    }
  });
});
