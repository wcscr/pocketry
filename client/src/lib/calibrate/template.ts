import { ARUCO_4X4_MODULES, markerBits } from "./aruco-4x4";

/**
 * The printable auto-calibration sheet: four ArUco markers at precisely known
 * centre-to-centre distances. Photograph a tool lying on the printed sheet and
 * the detector (opencv.js `ArucoDetector`) can recover millimetres-per-pixel
 * without the manual ruler flow.
 *
 * Geometry: marker centres sit on a 150 × 200 mm rectangle around the page
 * centre — a 3-4-5 triangle, so the diagonals are exactly 250 mm and the
 * numbers double as a self-check. IDs are fixed per corner, which lets the
 * solver identify orientation however the sheet is rotated in the photo:
 *
 *     A4:     id 0 ── top left        id 1 ── top right
 *             id 3 ── bottom left     id 2 ── bottom right
 *
 *     Letter: id 4 ── top left        id 5 ── top right
 *             id 7 ── bottom left     id 6 ── bottom right
 *
 * Distinct marker families let the detector infer the paper size rather than
 * asking the user which sheet was printed.
 *
 * The SVG's user unit is the millimetre (`width="210mm"` + matching viewBox),
 * so any browser or slicer printing at 100% produces true-size markers; the
 * 100 mm verification bar makes a wrong printer scale obvious before it can
 * poison every measurement taken from the sheet.
 */

export type TemplatePaper = "a4" | "letter";

/** Centre-to-centre marker spacing. 150-200-250: a 3-4-5 triangle. */
export const TEMPLATE_SPACING_MM = { width: 150, height: 200 } as const;

/** Printed side length of one marker, border modules included. */
export const TEMPLATE_MARKER_SIZE_MM = 30;

/** Minimum clearance between printed calibration content and the paper edge. */
export const TEMPLATE_PRINT_SAFE_MARGIN_MM = 8;

/** Corner assignment, clockwise from top-left, unique to each paper size. */
export const TEMPLATE_MARKER_IDS: Record<
  TemplatePaper,
  readonly [number, number, number, number]
> = {
  a4: [0, 1, 2, 3],
  letter: [4, 5, 6, 7],
};

export const ALL_TEMPLATE_MARKER_IDS = Object.values(TEMPLATE_MARKER_IDS).flat();

export const TEMPLATE_PAPER_MM: Record<TemplatePaper, { width: number; height: number }> =
  {
    a4: { width: 210, height: 297 },
    letter: { width: 215.9, height: 279.4 },
  };

/** Marker centre positions in page millimetres, in `TEMPLATE_MARKER_IDS` order. */
export function templateMarkerCentersMm(
  paper: TemplatePaper,
): { id: number; x: number; y: number }[] {
  const page = TEMPLATE_PAPER_MM[paper];
  const cx = page.width / 2;
  const cy = page.height / 2;
  const dx = TEMPLATE_SPACING_MM.width / 2;
  const dy = TEMPLATE_SPACING_MM.height / 2;
  const ids = TEMPLATE_MARKER_IDS[paper];
  return [
    { id: ids[0], x: cx - dx, y: cy - dy },
    { id: ids[1], x: cx + dx, y: cy - dy },
    { id: ids[2], x: cx + dx, y: cy + dy },
    { id: ids[3], x: cx - dx, y: cy + dy },
  ];
}

/** Known physical corners for every printed marker, in detector order. */
export function templateMarkerCornersMm(
  paper: TemplatePaper,
): { id: number; corners: readonly { x: number; y: number }[] }[] {
  const half = TEMPLATE_MARKER_SIZE_MM / 2;
  return templateMarkerCentersMm(paper).map(({ id, x, y }) => ({
    id,
    corners: [
      { x: x - half, y: y - half },
      { x: x + half, y: y - half },
      { x: x + half, y: y + half },
      { x: x - half, y: y + half },
    ],
  }));
}

/** Identifies one Pocketry template from any two or more of its marker ids. */
export function paperFromTemplateMarkerIds(
  ids: readonly number[],
): TemplatePaper | null {
  const known = [...new Set(ids.filter((id) => ALL_TEMPLATE_MARKER_IDS.includes(id)))];
  if (known.length < 2) return null;
  const matches = (Object.keys(TEMPLATE_MARKER_IDS) as TemplatePaper[]).filter(
    (paper) => known.every((id) => TEMPLATE_MARKER_IDS[paper].includes(id)),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** One marker as SVG: black square with the pattern's white cells punched in. */
function markerSvg(id: number, centerX: number, centerY: number): string {
  const size = TEMPLATE_MARKER_SIZE_MM;
  const module = size / ARUCO_4X4_MODULES;
  const originX = centerX - size / 2;
  const originY = centerY - size / 2;

  const parts: string[] = [
    `<g shape-rendering="crispEdges">`,
    `<rect x="${originX}" y="${originY}" width="${size}" height="${size}" fill="#000"/>`,
  ];
  const bits = markerBits(id);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      if (!bits[row][col]) continue;
      // +1: the outer ring of modules is the black border.
      const x = originX + (col + 1) * module;
      const y = originY + (row + 1) * module;
      parts.push(`<rect x="${x}" y="${y}" width="${module}" height="${module}" fill="#fff"/>`);
    }
  }
  parts.push(
    `<text x="${centerX}" y="${originY + size + 5}" text-anchor="middle" font-size="3.5" fill="#333" font-family="sans-serif">id ${id}</text>`,
    `</g>`,
  );
  return parts.join("");
}

/** The complete printable sheet. */
export function calibrationTemplateSvg(paper: TemplatePaper): string {
  const page = TEMPLATE_PAPER_MM[paper];
  const centers = templateMarkerCentersMm(paper);
  const cx = page.width / 2;

  const markers = centers.map(({ id, x, y }) => markerSvg(id, x, y)).join("\n  ");

  // 100 mm verification bar, centred and kept inside common printer margins.
  const rulerY = page.height - TEMPLATE_PRINT_SAFE_MARGIN_MM;
  const rulerX = cx - 50;
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const x = rulerX + i * 10;
    return `<line x1="${x}" y1="${rulerY}" x2="${x}" y2="${rulerY - (i % 5 === 0 ? 4 : 2.5)}" stroke="#000" stroke-width="0.3"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}mm" height="${page.height}mm" viewBox="0 0 ${page.width} ${page.height}">
  <rect width="${page.width}" height="${page.height}" fill="#fff"/>
  <text x="${cx}" y="${centers[0].y - TEMPLATE_MARKER_SIZE_MM / 2 - 8}" text-anchor="middle" font-size="5" font-family="sans-serif" fill="#000">Pocketry calibration sheet — print at 100% scale (no “fit to page”)</text>
  <text x="${cx}" y="${centers[0].y - TEMPLATE_MARKER_SIZE_MM / 2 - 2}" text-anchor="middle" font-size="3.5" font-family="sans-serif" fill="#333">Place the tool between the markers, keep all four visible, shoot from directly above.</text>
  ${markers}
  <g>
    <line x1="${rulerX}" y1="${rulerY}" x2="${rulerX + 100}" y2="${rulerY}" stroke="#000" stroke-width="0.5"/>
    ${ticks}
    <text x="${cx}" y="${rulerY - 6}" text-anchor="middle" font-size="3.5" font-family="sans-serif" fill="#333">check: this bar is exactly 100 mm — marker centres 150 × 200 mm, diagonals 250 mm</text>
  </g>
</svg>
`;
}
