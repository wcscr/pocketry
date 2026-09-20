import { MEASUREMENT_AIDS, referenceStripBlackCells, type MeasurementAidLength } from "./reference-strip";

export const MEASUREMENT_AID_EDGE = { bottomChamferMm: 0.3, topRadiusMm: 0.25, cornerRadiusMm: 0.8 } as const;
export interface AidMark { x: number; y: number; width: number; height: number }

// Original five-column bitmap lettering, shared by the physical inlay and preview.
const GLYPHS: Record<string, readonly string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "m": ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
};

function lettering(text: string, centerX: number, top: number, cell: number): AidMark[] {
  const left = centerX - (text.length * 6 - 1) * cell / 2;
  return [...text].flatMap((character, index) => {
    if (character === " ") return [];
    const rows = GLYPHS[character];
    if (!rows) throw new Error(`Unsupported measurement-aid character: ${character}`);
    return rows.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === "1"
      ? [{ x: left + (index * 6 + x) * cell, y: top + y * cell, width: cell, height: cell }]
      : []));
  });
}

/** mm graduations from the left end face. End-marker quiet zones stay empty. */
export function measurementAidRulerMarks(length: MeasurementAidLength): AidMark[] {
  const marks: AidMark[] = [];
  for (let mm = 1; mm < length; mm++) {
    const height = mm % 10 === 0 ? 1.15 : mm % 5 === 0 ? 0.95 : 0.7;
    marks.push({ x: mm - 0.2, y: 0.35, width: 0.4, height });
    marks.push({ x: mm - 0.2, y: 15 - 0.35 - height, width: 0.4, height });
  }
  for (let mm = 20; mm <= length - 20; mm += 10) {
    marks.push(...lettering(String(mm), mm, 10, 0.4));
  }
  return marks;
}

/** Paper/image coordinates: y down. A single Y flip is made by the mesh builder. */
export function measurementAidMarks(length: MeasurementAidLength): AidMark[] {
  return [
    ...referenceStripBlackCells(MEASUREMENT_AIDS[length]).map(({ x, y, size }) => ({ x, y, width: size, height: size })),
    ...measurementAidRulerMarks(length),
    ...lettering(`${length} mm`, length / 2, 5.3, 0.45),
  ];
}

export function measurementAidSvg(length: MeasurementAidLength): string {
  const rectangles = measurementAidMarks(length).map(({ x, y, width, height }) =>
    `<rect x="${x.toFixed(4)}" y="${y.toFixed(4)}" width="${width.toFixed(4)}" height="${height.toFixed(4)}"/>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${length}mm" height="15mm" viewBox="0 0 ${length} 15"><rect width="${length}" height="15" rx="0.8" fill="white"/><g fill="black">${rectangles}</g></svg>`;
}
