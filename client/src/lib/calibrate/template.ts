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

/** Machine-readable marker generation; v3 sheets retain the v2 signature. */
export const TEMPLATE_SIGNATURE_VERSION = 2;

/** Printed sheet revision, independent of the unchanged marker signature. */
export const TEMPLATE_SHEET_VERSION = 3;

/** Shared photography hints for both printable formats. */
export const TEMPLATE_PHOTO_INSTRUCTIONS = [
  "Print at 100% scale (no fit to page).",
  "Keep markers visible. Avoid overlapping text. Shoot straight down.",
  "Wide objects: add plain white paper.",
  "Tall objects: shoot farther away; zoom as needed.",
] as const;

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

/** Identifies a Pocketry sheet only from its complete v2 marker signature. */
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

/** Height of the major ticks on the verification bar, and of the label text beside markers and bar. */
const BAR_TICK_MM = 4;
const LABEL_FONT_MM = 3.5;

/** Baseline of the "id N" label printed beside the marker at `index` (marker-id order). */
function markerLabelBaselineMm(template: TemplateVariant, index: number, centerY: number): number {
  const top = centerY - templateMarkerSizeMm(template) / 2;
  return isExperimentalTemplate(template) && index >= 2
    ? top - 3
    : top + templateMarkerSizeMm(template) + 5;
}

/** Distance between the baselines of the sheet's instruction lines. */
const INSTRUCTION_LINE_PITCH_MM = 5;
const INSTRUCTION_FONT_MM = 3;

/**
 * One centred line of sheet text: content, font size and baseline, in page
 * millimetres. `alternate` is the same line as another output wrote it.
 */
interface TextLine { text: string; size: number; baseline: number; alternate?: string }

/** The current sheet's centred text lines, shared by the SVG and the printed-area list. */
function templateTextLines(template: TemplateVariant): { title: TextLine; instructions: TextLine[]; check: TextLine } {
  const header = templateHeaderBaselinesMm(template);
  return {
    title: {
      text: `Pocketry v${TEMPLATE_SHEET_VERSION} Cal Sheet — ${templatePaper(template) === "a4" ? "A4" : "US Letter"}`,
      size: isExperimentalTemplate(template) ? 4 : 5, baseline: header.title,
    },
    instructions: TEMPLATE_PHOTO_INSTRUCTIONS.map((text, index) => ({
      text, size: INSTRUCTION_FONT_MM, baseline: header.instructions + index * INSTRUCTION_LINE_PITCH_MM,
    })),
    check: { text: "Scale check: 100 mm", size: LABEL_FONT_MM, baseline: templateVerificationBarMm(template).labelY },
  };
}

/**
 * The text of the v2 sheets, at the same baselines as today's.
 *
 * v2 sheets are no longer generated, but printed copies stay in use and carry
 * the same markers as a v3 sheet. Their longer title, single instruction line
 * and longer caption therefore remain part of the printed-area list. The PDF,
 * which is what most people printed, worded the lines slightly differently
 * from the SVG; both wordings are kept, and an area covers the wider one.
 * Never change these strings.
 */
function legacyV2TextLines(template: TemplateVariant): TextLine[] {
  const experimental = isExperimentalTemplate(template);
  const paper = templatePaper(template) === "a4" ? "A4" : "US Letter";
  const header = templateHeaderBaselinesMm(template);
  const spacing = templateMarkerSpacingMm(template);
  const width = formatTemplateMm(spacing.width), height = formatTemplateMm(spacing.height);
  return [
    {
      text: experimental
        ? `Pocketry v2 experimental — ${paper} — print at 100% scale`
        : "Pocketry v2 calibration sheet — print at 100% scale (no “fit to page”)",
      alternate: experimental
        ? `Pocketry v2 experimental - ${paper} - print at 100% scale`
        : `Pocketry v2 ${paper} calibration sheet - print at 100% scale (no fit to page)`,
      size: experimental ? 4 : 5, baseline: header.title,
    },
    {
      text: experimental
        ? "Keep all four markers visible · camera 1× · shoot straight down"
        : "Place the tool between the markers, keep all four visible, shoot from directly above.",
      alternate: experimental
        ? "Keep all four markers visible - camera 1x - shoot straight down."
        : "Place the tool between the markers, keep all four visible, shoot from directly above.",
      size: experimental ? 3 : 3.5, baseline: header.instructions,
    },
    {
      text: experimental
        ? `check: this bar is exactly 100 mm — marker centres ${width} × ${height} mm`
        : "check: this bar is exactly 100 mm — marker centres 150 × 200 mm, diagonals 250 mm",
      alternate: experimental
        ? `check: this bar is exactly 100 mm - marker centres ${width} x ${height} mm`
        : "check: this bar is exactly 100 mm - marker centres 150 x 200 mm, diagonals 250 mm",
      size: LABEL_FONT_MM, baseline: templateVerificationBarMm(template).labelY,
    },
  ];
}

/**
 * Width of a line of sheet text, in the units of `fontSize`. An over-estimate
 * of Helvetica, which the PDF prints; the SVG's generic sans-serif is close.
 */
export function estimatedTemplateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const character of text) {
    if ("ilI1.,:;!'".includes(character)) units += 0.28;
    else if ("mwMW@".includes(character)) units += 0.86;
    else if (character === " ") units += 0.28;
    else units += 0.54;
  }
  return units * fontSize;
}

/** The two printed layouts a sheet with these markers can have. */
export type SheetLayout = "v2" | "v3";

/** One printed element of the sheet, as a box in page millimetres. */
export interface TemplateInkRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text ("strokes"), the ruled bar and its ticks ("rule"), or a filled block: a marker ("solid"). */
  kind: "strokes" | "rule" | "solid";
  /** Set when only one layout prints this; markers, their labels and the bar are on both. */
  layout?: SheetLayout;
}

/** Slack around each printed element, for print and rectification error. */
const INK_MARGIN_MM = 1;

/**
 * Everything a sheet with these markers may print, as boxes in page millimetres.
 *
 * Detection uses these to tell the sheet's own printing from the tool lying on
 * it. They are derived from the same numbers as the SVG and the PDF, and a
 * test checks every drawn element falls inside one, so the three cannot drift.
 * The list covers the current sheet and the v2 sheet together, because both
 * carry the same markers. Each text area says which layout prints it, so a
 * caller that can see the whole sheet can drop the other layout's areas (see
 * `detectSheetLayout`): inside an area a thin dark object lying wholly within
 * it is taken for printing, so an area the sheet left blank is not free.
 */
export function templateInkRegionsMm(template: TemplateVariant): TemplateInkRegion[] {
  const page = TEMPLATE_PAPER_MM[templatePaper(template)];
  const cx = page.width / 2;
  const text = (line: TextLine, centerX = cx, layout?: SheetLayout): TemplateInkRegion => {
    // 15% over the Helvetica estimate covers a wider substituted sans-serif.
    const widest = Math.max(estimatedTemplateTextWidth(line.text, line.size),
      line.alternate ? estimatedTemplateTextWidth(line.alternate, line.size) : 0);
    const width = widest * 1.15 + 2 * INK_MARGIN_MM;
    return {
      x: centerX - width / 2, width,
      y: line.baseline - line.size * 0.85 - INK_MARGIN_MM, height: line.size * 1.15 + 2 * INK_MARGIN_MM,
      kind: "strokes", ...(layout ? { layout } : {}),
    };
  };
  const lines = templateTextLines(template);
  const bar = templateVerificationBarMm(template);
  const size = templateMarkerSizeMm(template);
  const regions: TemplateInkRegion[] = [
    text(lines.title, cx, "v3"), ...lines.instructions.map((line) => text(line, cx, "v3")), text(lines.check, cx, "v3"),
    ...legacyV2TextLines(template).map((line) => text(line, cx, "v2")),
    {
      x: bar.startX - INK_MARGIN_MM, width: bar.endX - bar.startX + 2 * INK_MARGIN_MM,
      y: bar.y - BAR_TICK_MM - INK_MARGIN_MM, height: BAR_TICK_MM + 2 * INK_MARGIN_MM,
      kind: "rule",
    },
  ];
  templateMarkerCentersMm(template).forEach(({ id, x, y }, index) => {
    regions.push({
      x: x - size / 2 - INK_MARGIN_MM, y: y - size / 2 - INK_MARGIN_MM,
      width: size + 2 * INK_MARGIN_MM, height: size + 2 * INK_MARGIN_MM, kind: "solid",
    });
    regions.push(text({ text: `id ${id}`, size: LABEL_FONT_MM, baseline: markerLabelBaselineMm(template, index, y) }, x));
  });
  return regions;
}

/**
 * The printed areas in the pixels of a photo rectified to this template, where
 * the page stands upright in `paperBounds`. A photo rotated or straightened
 * after rectification no longer fits this mapping; callers skip it then.
 */
export function templateInkRegionsInPixels(
  template: TemplateVariant,
  paperBounds: { x: number; y: number; width: number; height: number },
): TemplateInkRegion[] {
  const page = TEMPLATE_PAPER_MM[templatePaper(template)];
  const sx = paperBounds.width / page.width, sy = paperBounds.height / page.height;
  return templateInkRegionsMm(template).map((region) => ({
    x: paperBounds.x + region.x * sx, y: paperBounds.y + region.y * sy,
    width: region.width * sx, height: region.height * sy, kind: region.kind,
    ...(region.layout ? { layout: region.layout } : {}),
  }));
}

/** Pixels this much darker than the paper beside them count as ink. */
const LAYOUT_INK_DARKNESS = 0.85;
/** A line of text crosses from paper to ink and back this often per line height; a tool lying across it does not. */
const LAYOUT_TEXT_CROSSINGS = 2;
/** Stretches of a text area this narrow, in line heights, are too short to judge. */
const LAYOUT_MIN_STRETCH = 2;

/**
 * Which layout a rectified photo of the sheet shows, or `null` when the photo
 * does not say.
 *
 * v2 and v3 sheets carry the same markers and differ only in their text. Each
 * layout has stretches where it prints and the other is blank: the ends of the
 * v2 title, instruction line and caption, and the second to fourth instruction
 * lines of v3. A printed stretch alternates between paper and ink many times
 * along its length, which blank paper and a tool lying across it do not. A
 * layout is named when at least two of its stretches read as text and none of
 * the other's do. `regions` are the printed areas in the pixels of `image`.
 */
export function detectSheetLayout(
  image: { width: number; height: number; data: ArrayLike<number> },
  regions: readonly TemplateInkRegion[],
): SheetLayout | null {
  const text = regions.filter((region) => region.layout && region.kind === "strokes");
  const votes: Record<SheetLayout, number> = { v2: 0, v3: 0 };
  const luminance = (x: number, y: number) => {
    const at = (y * image.width + x) * 4;
    return (image.data[at] * 77 + image.data[at + 1] * 150 + image.data[at + 2] * 29) >> 8;
  };
  for (const region of text) {
    const others = text.filter((other) => other.layout !== region.layout);
    let reads = false;
    // Rows through the body of the letters.
    for (const fraction of [0.4, 0.5, 0.6, 0.7]) {
      const y = Math.round(region.y + region.height * fraction);
      if (y < 0 || y >= image.height) continue;
      // The parts of this row no other layout prints on.
      let stretches: [number, number][] = [[Math.max(0, Math.ceil(region.x)), Math.min(image.width, Math.floor(region.x + region.width))]];
      for (const other of others) {
        if (y < other.y || y >= other.y + other.height) continue;
        const from = Math.floor(other.x), to = Math.ceil(other.x + other.width);
        stretches = stretches.flatMap(([a, b]): [number, number][] => [[a, Math.min(b, from)], [Math.max(a, to), b]]);
      }
      stretches = stretches.filter(([a, b]) => b - a >= region.height * LAYOUT_MIN_STRETCH);
      const width = stretches.reduce((sum, [a, b]) => sum + b - a, 0);
      if (width <= 0) continue;
      const values: number[] = [];
      for (const [a, b] of stretches) for (let x = a; x < b; x++) values.push(luminance(x, y));
      const paper = [...values].sort((p, q) => p - q)[Math.floor(values.length * 0.9)];
      let crossings = 0;
      for (const [a, b] of stretches) {
        let ink = false;
        for (let x = a; x < b; x++) {
          const dark = luminance(x, y) < paper * LAYOUT_INK_DARKNESS;
          if (dark !== ink) { crossings++; ink = dark; }
        }
      }
      if (crossings >= LAYOUT_TEXT_CROSSINGS * width / region.height) { reads = true; break; }
    }
    if (reads) votes[region.layout!]++;
  }
  if (votes.v2 >= 2 && votes.v3 === 0) return "v2";
  if (votes.v3 >= 2 && votes.v2 === 0) return "v3";
  return null;
}

/**
 * The printed areas for a working photo, or `undefined` when they cannot be
 * placed: no template-based rectification (a manual four-point correction
 * knows no layout), or the photo was rotated or straightened afterwards.
 *
 * Given the whole photo (`sheet`, with the scale from its pixels to working
 * pixels), the text areas of the layout it does not show are left out. When
 * the photo does not say which layout it is, both stay.
 */
export function rectifiedSheetInkRegions(
  correction: { source: string; template?: TemplateVariant; paperBounds?: { x: number; y: number; width: number; height: number } } | null | undefined,
  upright: boolean,
  sheet?: { image: { width: number; height: number; data: ArrayLike<number> }; toWorking: { x: number; y: number } } | null,
): TemplateInkRegion[] | undefined {
  if (!upright || correction?.source !== "template" || !correction.template || !correction.paperBounds) return undefined;
  const regions = templateInkRegionsInPixels(correction.template, correction.paperBounds);
  if (!sheet || !(sheet.toWorking.x > 0) || !(sheet.toWorking.y > 0)) return regions;
  const layout = detectSheetLayout(sheet.image, regions.map((region) => ({ ...region,
    x: region.x / sheet.toWorking.x, y: region.y / sheet.toWorking.y,
    width: region.width / sheet.toWorking.x, height: region.height / sheet.toWorking.y })));
  return layout ? regions.filter((region) => !region.layout || region.layout === layout) : regions;
}

/** The complete printable sheet. */
export function calibrationTemplateSvg(template: TemplateVariant): string {
  const paper = templatePaper(template);
  const page = TEMPLATE_PAPER_MM[paper];
  const centers = templateMarkerCentersMm(template);
  const markerSize = templateMarkerSizeMm(template);
  const cx = page.width / 2;

  const markers = centers
    .map(({ id, x, y }, index) =>
      markerSvg(id, x, y, markerSize, markerLabelBaselineMm(template, index, y)))
    .join("\n  ");

  const ruler = templateVerificationBarMm(template);
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const x = ruler.startX + i * 10;
    return `<line x1="${x}" y1="${ruler.y}" x2="${x}" y2="${ruler.y - (i % 5 === 0 ? BAR_TICK_MM : 2.5)}" stroke="#000" stroke-width="0.3"/>`;
  }).join("");
  const { title, instructions, check } = templateTextLines(template);
  const instructionLines = instructions.map((line) =>
    `<text x="${cx}" y="${line.baseline}" text-anchor="middle" font-size="${line.size}" font-family="sans-serif" fill="#333">${line.text}</text>`,
  ).join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}mm" height="${page.height}mm" viewBox="0 0 ${page.width} ${page.height}">
  <rect width="${page.width}" height="${page.height}" fill="#fff"/>
  <text x="${cx}" y="${title.baseline}" text-anchor="middle" font-size="${title.size}" font-family="sans-serif" fill="#000">${title.text}</text>
  ${instructionLines}
  ${markers}
  <g>
    <line x1="${ruler.startX}" y1="${ruler.y}" x2="${ruler.endX}" y2="${ruler.y}" stroke="#000" stroke-width="0.5"/>
    ${ticks}
    <text x="${cx}" y="${check.baseline}" text-anchor="middle" font-size="${check.size}" font-family="sans-serif" fill="#333">${check.text}</text>
  </g>
</svg>
`;
}
