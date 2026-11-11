import type { Rect } from "@shared/geometry/types";

import type { ImageLike } from "./types";

/**
 * Removing the calibration sheet's own printing before detection.
 *
 * The sheet prints a title, instructions, marker labels and a 100 mm bar, and
 * detection used to treat them like anything else on the paper: letters and
 * the bar stuck out of tool handles as spurs. The layout is known exactly, and
 * nothing the sheet prints is taller than its own printed area. So inside an
 * area, a dark structure no taller than the area is printing, and is painted
 * out with the brightness above and below it. Whole words go, not only single
 * strokes: a blurred word is one dense blob.
 *
 * What is never touched:
 *
 * - **Anything taller than the printed area**: a shaft or handle running down
 *   through a line of text, or a tip that ends in it. The test is a greyscale
 *   closing with an upright line, which leaves such a structure exactly as it
 *   was, so letters beside it are removed right up to its edge.
 * - **Anything that continues beyond the printed areas** sideways. Sheet
 *   printing stays inside its own box. A low dark structure that runs out of
 *   the box (a thin tool lying along the title) is part of a tool, and the
 *   whole connected structure is kept, letters touching it included. That
 *   leaves those letters attached, as they were before; it never removes
 *   tool.
 * - **Thin lines hugging a solid dark part**, such as a contact shadow along a
 *   handle. They stay. Over the ruled bar they do not pass that protection on
 *   to the printed line they touch, or the bar under a handle would survive.
 *
 * What it can still remove is a dark tool part that lies wholly inside a
 * printed area, top to bottom and side to side, such as a short wire end
 * resting on the title line. The photo must be the rectified sheet with the
 * page upright; callers skip the step otherwise.
 */

/** One printed area of the sheet, in the pixels of the image being detected. */
export interface SheetInkRegion extends Rect {
  /**
   * Text ("strokes"), ruled lines such as the 100 mm bar and its ticks
   * ("rule"), or a filled block such as a marker ("solid").
   */
  kind: "strokes" | "rule" | "solid";
}

/** The sheet's known printing for one detection frame. */
export interface SheetInk {
  regions: readonly SheetInkRegion[];
  /** Side of the closing element in pixels: strokes narrower than this are printing. */
  strokePx: number;
}

/** Strokes up to this wide are printing. The sheet's heaviest line is 0.5 mm before blur. */
export const SHEET_STROKE_MM = 1.25;

/** A stroke must be this much darker than its surroundings, as a fraction of their brightness. */
const STROKE_CONTRAST = 0.08;
const MIN_STROKE_CONTRAST = 8;
/** Pixels this close to an erased stroke are erased with it, however faint. */
const HALO_PX = 2;
/** Anything wider than a stroke and darker than this fraction of the paper is a solid tool part. */
const BODY_DARKNESS = 0.75;

interface Box { x0: number; y0: number; x1: number; y1: number }

function clip(region: Rect, width: number, height: number, grow = 0): Box {
  return {
    x0: Math.max(0, Math.floor(region.x) - grow), y0: Math.max(0, Math.floor(region.y) - grow),
    x1: Math.min(width, Math.ceil(region.x + region.width) + grow), y1: Math.min(height, Math.ceil(region.y + region.height) + grow),
  };
}

/** Max filter (`dilate`) or min filter over a (2rx+1) by (2ry+1) window, edges replicated. */
function rank(values: Uint8Array, width: number, height: number, rx: number, ry: number, dilate: boolean): Uint8Array {
  let rows = values;
  if (rx > 0) {
    rows = new Uint8Array(values.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const from = Math.max(0, x - rx), to = Math.min(width - 1, x + rx);
      let value = values[y * width + from];
      for (let k = from + 1; k <= to; k++) { const v = values[y * width + k]; if (dilate ? v > value : v < value) value = v; }
      rows[y * width + x] = value;
    }
  }
  if (ry <= 0) return rows === values ? Uint8Array.from(values) : rows;
  const result = new Uint8Array(values.length);
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
    const from = Math.max(0, y - ry), to = Math.min(height - 1, y + ry);
    let value = rows[from * width + x];
    for (let k = from + 1; k <= to; k++) { const v = rows[k * width + x]; if (dilate ? v > value : v < value) value = v; }
    result[y * width + x] = value;
  }
  return result;
}
/**
 * Greyscale closing with an upright line: a dark structure shorter, top to
 * bottom, than the line takes on the brightness above and below it.
 */
const closeUpright = (values: Uint8Array, width: number, height: number, ry: number) =>
  rank(rank(values, width, height, 0, ry, true), width, height, 0, ry, false);

/**
 * Returns a copy of the image with the sheet's printing painted out, or the
 * image itself when there is nothing to do.
 */
export function eraseSheetInk(image: ImageLike, ink: SheetInk): ImageLike {
  const { width, height } = image;
  const radius = Math.max(1, Math.round(ink.strokePx) >> 1);
  const regions = ink.regions.map((region) => ({ region, box: clip(region, width, height) }))
    .filter(({ box }) => box.x1 > box.x0 && box.y1 > box.y0);
  if (!regions.length || !(ink.strokePx > 0)) return image;

  const data = new Uint8ClampedArray(image.data);
  // Where the sheet prints anything: a stroke that leaves this is not printing.
  const printed = new Uint8Array(width * height);
  for (const { box } of regions) for (let y = box.y0; y < box.y1; y++) printed.fill(1, y * width + box.x0, y * width + box.x1);

  for (const { region, box } of regions) {
    if (region.kind === "solid") fillWithPaper(image, data, box, 2 * radius + 2);
    else eraseStrokes(image, data, printed, region, radius, region.kind === "rule");
  }
  return { width, height, data };
}

/** Paints a marker's block with the paper colour found in a ring just outside it. */
function fillWithPaper(image: ImageLike, data: Uint8ClampedArray, box: Box, ring: number): void {
  const { width, height } = image, samples: number[][] = [[], [], []];
  const outer = { x0: Math.max(0, box.x0 - ring), y0: Math.max(0, box.y0 - ring), x1: Math.min(width, box.x1 + ring), y1: Math.min(height, box.y1 + ring) };
  for (let y = outer.y0; y < outer.y1; y++) for (let x = outer.x0; x < outer.x1; x++) {
    if (x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) continue;
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) samples[c].push(image.data[i + c]);
  }
  // Too little paper in view to say what colour it is: leave the block alone.
  if (samples[0].length < 16) return;
  // The brighter side of the ring is paper; a tool or a shadow beside the marker is the darker side.
  const paper = samples.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length * 0.75)]);
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) data.set(paper, (y * width + x) * 4);
}

/**
 * Paints out thin dark strokes inside one printed area, unless they continue
 * beyond the printing. `ruled` marks an area of long printed lines, which a
 * tool lying across them touches along its whole edge.
 */
function eraseStrokes(image: ImageLike, data: Uint8ClampedArray, printed: Uint8Array, region: Rect, radius: number, ruled: boolean): void {
  const { width, height } = image;
  // Nothing the sheet prints here is taller than the area itself, so a dark structure that is
  // taller, running through the area or out of its top or bottom, is not printing.
  const reach = Math.max(1, Math.ceil(region.height / 2));
  // Room to see what runs on past the area.
  const pad = 2 * reach + radius + 2;
  const win = clip(region, width, height, pad), inner = clip(region, width, height);
  const w = win.x1 - win.x0, h = win.y1 - win.y0;
  if (w <= 0 || h <= 0) return;

  const grey = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = ((y + win.y0) * width + x + win.x0) * 4;
    grey[y * w + x] = (image.data[at] * 77 + image.data[at + 1] * 150 + image.data[at + 2] * 29) >> 8;
  }
  const closedGrey = closeUpright(grey, w, h, reach);

  // Printing candidates: clearly darker than what the closing found above and below them.
  const stroke = new Uint8Array(w * h);
  for (let i = 0; i < stroke.length; i++) {
    const contrast = closedGrey[i] - grey[i];
    stroke[i] = contrast >= Math.max(MIN_STROKE_CONTRAST, closedGrey[i] * STROKE_CONTRAST) ? 1 : 0;
  }
  // Connected strokes that reach beyond the printing belong to a tool. 0 unvisited, 1 printing, 2 kept.
  const verdict = new Uint8Array(w * h), stack: number[] = [], members: number[] = [];
  if (ruled) {
    // A solid part of a tool: wider than a stroke, and clearly not paper. Thin lines hugging it (a
    // contact shadow, a rim) run along its edge and out of the printed area, and would carry the
    // "continues beyond the printing" protection to the ruled line they touch: the bar under a
    // handle. They are left exactly as they are and connect nothing. Only ruled areas need this;
    // in text it would cut a thin tip off the thicker shaft it continues from.
    const paper = [...closedGrey].sort((a, b) => a - b)[Math.floor(closedGrey.length * 0.8)];
    const body = new Uint8Array(w * h);
    for (let i = 0; i < body.length; i++) body[i] = closedGrey[i] < paper * BODY_DARKNESS ? 255 : 0;
    const nearBody = rank(body, w, h, radius + 1, radius + 1, true);
    for (let i = 0; i < stroke.length; i++) if (stroke[i] && nearBody[i]) { verdict[i] = 2; stroke[i] = 0; }
  }
  for (let start = 0; start < stroke.length; start++) {
    if (!stroke[start] || verdict[start]) continue;
    let leaves = false;
    members.length = 0; stack.push(start); verdict[start] = 1;
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i / w) | 0;
      members.push(i);
      if (!printed[(y + win.y0) * width + x + win.x0]) leaves = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (stroke[j] && !verdict[j]) { verdict[j] = 1; stack.push(j); }
      }
    }
    if (leaves) for (const i of members) verdict[i] = 2;
  }

  // A blurred stroke has a faint halo below the contrast floor. Take it with the stroke, or the
  // ghost of every letter is left behind.
  const erased = new Uint8Array(w * h);
  for (let i = 0; i < erased.length; i++) erased[i] = verdict[i] === 1 ? 255 : 0;
  const halo = rank(erased, w, h, HALO_PX, HALO_PX, true);

  for (let y = inner.y0; y < inner.y1; y++) for (let x = inner.x0; x < inner.x1; x++) {
    const i = (y - win.y0) * w + x - win.x0;
    if (verdict[i] === 2 || !halo[i] || closedGrey[i] <= grey[i]) continue;
    // Brighten to what lies above and below, keeping the pixel's own tint.
    const at = (y * width + x) * 4, lift = closedGrey[i] - grey[i];
    for (let c = 0; c < 3; c++) data[at + c] = Math.min(255, image.data[at + c] + lift);
  }
}
