import { ARUCO_4X4_MODULES, markerBits } from "./aruco-4x4";

/** Physical paper sizes supported by printed calibration sheets. */
export type TemplatePaper = "a4" | "letter";

/**
 * Stable sheets remain the default. Experimental sheets move smaller markers
 * toward the paper corners to enlarge the useful photography area and improve
 * the perspective baseline.
 */
export type TemplateVariant =
  | TemplatePaper
  | "a4-experimental"
  | "letter-experimental";

export const TEMPLATE_VARIANTS: readonly TemplateVariant[] = [
  "a4",
  "letter",
  "a4-experimental",
  "letter-experimental",
];

/** Printed and machine-readable template generation. */
export const TEMPLATE_SIGNATURE_VERSION = 2;

/** Existing sheets use a 150-200-250 centre rectangle. */
export const TEMPLATE_SPACING_MM = { width: 150, height: 200 } as const;

/** Printed side length of one marker on the existing sheets. */
export const TEMPLATE_MARKER_SIZE_MM = 30;

/** Printed side length of one marker on the experimental sheets. */
export const EXPERIMENTAL_TEMPLATE_MARKER_SIZE_MM = 24;

/** Outer marker edges on experimental sheets are this far from the paper. */
export const EXPERIMENTAL_TEMPLATE_OUTER_MARGIN_MM = 12;

/** Minimum clearance used by the existing printable calibration content. */
export const TEMPLATE_PRINT_SAFE_MARGIN_MM = 8;

/** Corner assignment, clockwise from top-left, unique to every sheet. */
export const TEMPLATE_MARKER_IDS: Record<
  TemplateVariant,
  readonly [number, number, number, number]
> = {
  a4: [0, 1, 2, 3],
  letter: [4, 5, 6, 7],
  "a4-experimental": [8, 9, 10, 11],
  "letter-experimental": [12, 13, 14, 15],
};

export const ALL_TEMPLATE_MARKER_IDS = Object.values(TEMPLATE_MARKER_IDS).flat();

export const TEMPLATE_PAPER_MM: Record<
  TemplatePaper,
  { width: number; height: number }
> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

export function isExperimentalTemplate(template: TemplateVariant): boolean {
  return template.endsWith("-experimental");
}

export function templatePaper(template: TemplateVariant): TemplatePaper {
  return template.startsWith("a4") ? "a4" : "letter";
}

export function templateDisplayName(template: TemplateVariant): string {
  const paper = templatePaper(template) === "a4" ? "A4" : "US Letter";
  return isExperimentalTemplate(template) ? `${paper} experimental` : paper;
}

export function templateMarkerSizeMm(template: TemplateVariant): number {
  return isExperimentalTemplate(template)
    ? EXPERIMENTAL_TEMPLATE_MARKER_SIZE_MM
    : TEMPLATE_MARKER_SIZE_MM;
}

/** Header baselines in millimetres from the top of the page. */
export function templateHeaderBaselinesMm(
  template: TemplateVariant,
): { title: number; instructions: number } {
  if (isExperimentalTemplate(template)) {
    return { title: 16, instructions: 23 };
  }
  if (template === "a4") {
    return {
      title: TEMPLATE_PRINT_SAFE_MARGIN_MM + 7,
      instructions: TEMPLATE_PRINT_SAFE_MARGIN_MM + 14,
    };
  }
  const markerTop =
    templateMarkerCentersMm(template)[0].y - TEMPLATE_MARKER_SIZE_MM / 2;
  return { title: markerTop - 8, instructions: markerTop - 2 };
}

/** Marker centre positions in page millimetres, in marker-id order. */
export function templateMarkerCentersMm(
  template: TemplateVariant,
): { id: number; x: number; y: number }[] {
  const page = TEMPLATE_PAPER_MM[templatePaper(template)];
  const ids = TEMPLATE_MARKER_IDS[template];
  if (isExperimentalTemplate(template)) {
    const inset =
      EXPERIMENTAL_TEMPLATE_OUTER_MARGIN_MM +
      EXPERIMENTAL_TEMPLATE_MARKER_SIZE_MM / 2;
    return [
      { id: ids[0], x: inset, y: inset },
      { id: ids[1], x: page.width - inset, y: inset },
      { id: ids[2], x: page.width - inset, y: page.height - inset },
      { id: ids[3], x: inset, y: page.height - inset },
    ];
  }

  const cx = page.width / 2;
  const cy = page.height / 2;
  const dx = TEMPLATE_SPACING_MM.width / 2;
  const dy = TEMPLATE_SPACING_MM.height / 2;
  return [
    { id: ids[0], x: cx - dx, y: cy - dy },
    { id: ids[1], x: cx + dx, y: cy - dy },
    { id: ids[2], x: cx + dx, y: cy + dy },
    { id: ids[3], x: cx - dx, y: cy + dy },
  ];
}

export function templateMarkerSpacingMm(
  template: TemplateVariant,
): { width: number; height: number } {
  const [topLeft, topRight, , bottomLeft] = templateMarkerCentersMm(template);
  return {
    width: topRight.x - topLeft.x,
    height: bottomLeft.y - topLeft.y,
  };
}

/** Compact human-readable millimetres without binary floating-point noise. */
export function formatTemplateMm(value: number): string {
  return Number(value.toFixed(4)).toString();
}

/** Known physical corners for every printed marker, in detector order. */
export function templateMarkerCornersMm(
  template: TemplateVariant,
): { id: number; corners: readonly { x: number; y: number }[] }[] {
  const half = templateMarkerSizeMm(template) / 2;
  return templateMarkerCentersMm(template).map(({ id, x, y }) => ({
    id,
    corners: [
      { x: x - half, y: y - half },
      { x: x + half, y: y - half },
      { x: x + half, y: y + half },
      { x: x - half, y: y + half },
    ],
  }));
}

/** Identifies one Pocketry v2 sheet only from its complete marker signature. */
export function templateFromTemplateMarkerIds(
  ids: readonly number[],
): TemplateVariant | null {
  const known = [
    ...new Set(ids.filter((id) => ALL_TEMPLATE_MARKER_IDS.includes(id))),
  ];
  if (known.length !== 4) return null;
  const matches = TEMPLATE_VARIANTS.filter((template) =>
    TEMPLATE_MARKER_IDS[template].every((id) => known.includes(id)),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Backwards-compatible physical-paper lookup for a complete signature. */
export function paperFromTemplateMarkerIds(
  ids: readonly number[],
): TemplatePaper | null {
  const template = templateFromTemplateMarkerIds(ids);
  return template ? templatePaper(template) : null;
}

export interface TemplateVerificationBar {
  startX: number;
  endX: number;
  y: number;
  labelY: number;
}

/** Exact 100 mm verification line geometry for SVG and PDF output. */
export function templateVerificationBarMm(
  template: TemplateVariant,
): TemplateVerificationBar {
  const page = TEMPLATE_PAPER_MM[templatePaper(template)];
  const centerX = page.width / 2;
  const y = isExperimentalTemplate(template)
    ? page.height - EXPERIMENTAL_TEMPLATE_OUTER_MARGIN_MM - 4
    : page.height - TEMPLATE_PRINT_SAFE_MARGIN_MM;
  return { startX: centerX - 50, endX: centerX + 50, y, labelY: y - 6 };
}

/** One marker as SVG: black square with the pattern's white cells punched in. */
function markerSvg(
  id: number,
  centerX: number,
  centerY: number,
  size: number,
  labelY: number,
): string {
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
      const x = originX + (col + 1) * module;
      const y = originY + (row + 1) * module;
      parts.push(
        `<rect x="${x}" y="${y}" width="${module}" height="${module}" fill="#fff"/>`,
      );
    }
  }
  parts.push(
    `<text x="${centerX}" y="${labelY}" text-anchor="middle" font-size="3.5" fill="#333" font-family="sans-serif">id ${id}</text>`,
    `</g>`,
  );
  return parts.join("");
}

/** The complete printable sheet. */
export function calibrationTemplateSvg(template: TemplateVariant): string {
  const paper = templatePaper(template);
  const page = TEMPLATE_PAPER_MM[paper];
  const centers = templateMarkerCentersMm(template);
  const header = templateHeaderBaselinesMm(template);
  const markerSize = templateMarkerSizeMm(template);
  const experimental = isExperimentalTemplate(template);
  const cx = page.width / 2;

  const markers = centers
    .map(({ id, x, y }, index) => {
      const originY = y - markerSize / 2;
      const labelY =
        experimental && index >= 2
          ? originY - 3
          : originY + markerSize + 5;
      return markerSvg(id, x, y, markerSize, labelY);
    })
    .join("\n  ");

  const ruler = templateVerificationBarMm(template);
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const x = ruler.startX + i * 10;
    return `<line x1="${x}" y1="${ruler.y}" x2="${x}" y2="${ruler.y - (i % 5 === 0 ? 4 : 2.5)}" stroke="#000" stroke-width="0.3"/>`;
  }).join("");
  const title = experimental
    ? `Pocketry v${TEMPLATE_SIGNATURE_VERSION} experimental — ${paper === "a4" ? "A4" : "US Letter"} — print at 100% scale`
    : `Pocketry v${TEMPLATE_SIGNATURE_VERSION} calibration sheet — print at 100% scale (no “fit to page”)`;
  const instructions = experimental
    ? "Keep all four markers visible · camera 1× · shoot straight down"
    : "Place the tool between the markers, keep all four visible, shoot from directly above.";
  const spacing = templateMarkerSpacingMm(template);
  const check = experimental
    ? `check: this bar is exactly 100 mm — marker centres ${formatTemplateMm(spacing.width)} × ${formatTemplateMm(spacing.height)} mm`
    : "check: this bar is exactly 100 mm — marker centres 150 × 200 mm, diagonals 250 mm";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}mm" height="${page.height}mm" viewBox="0 0 ${page.width} ${page.height}">
  <rect width="${page.width}" height="${page.height}" fill="#fff"/>
  <text x="${cx}" y="${header.title}" text-anchor="middle" font-size="${experimental ? 4 : 5}" font-family="sans-serif" fill="#000">${title}</text>
  <text x="${cx}" y="${header.instructions}" text-anchor="middle" font-size="${experimental ? 3 : 3.5}" font-family="sans-serif" fill="#333">${instructions}</text>
  ${markers}
  <g>
    <line x1="${ruler.startX}" y1="${ruler.y}" x2="${ruler.endX}" y2="${ruler.y}" stroke="#000" stroke-width="0.5"/>
    ${ticks}
    <text x="${cx}" y="${ruler.labelY}" text-anchor="middle" font-size="3.5" font-family="sans-serif" fill="#333">${check}</text>
  </g>
</svg>
`;
}
