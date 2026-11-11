import { describe, expect, it } from "vitest";

import { eraseSheetInk, type SheetInkRegion } from "./sheet-ink";
import type { ImageLike } from "./types";

const PAPER = 200, INK = 60, TOOL = 30;
type Paint = (x: number, y: number) => number | undefined;

/** A grey photo: `PAPER` everywhere except where a painter returns a level. Later painters win. */
function photo(width: number, height: number, ...painters: Paint[]): ImageLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let level = PAPER;
    for (const paint of painters) level = paint(x, y) ?? level;
    data.set([level, level, level, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
const block = (x0: number, y0: number, x1: number, y1: number, level: number): Paint =>
  (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1 ? level : undefined;
const at = (image: ImageLike, x: number, y: number) => image.data[(y * image.width + x) * 4];

/** A line of text 12 px tall: three-pixel stems every five pixels, like a blurred word. */
const word = (x0: number, x1: number, y0: number): Paint =>
  (x, y) => x >= x0 && x < x1 && y >= y0 && y < y0 + 12 && (x - x0) % 5 < 3 ? INK : undefined;

/** A text line's printed area: 26 px tall, across most of a 220 px wide photo. */
const TEXT: SheetInkRegion = { x: 10, y: 20, width: 180, height: 26, kind: "strokes" };
const ink = (...regions: SheetInkRegion[]) => ({ regions, strokePx: 5 });

describe("eraseSheetInk", () => {
  it("paints out a whole word inside a printed area and nothing outside it", () => {
    const image = photo(220, 100, word(30, 120, 27), word(30, 120, 70));
    const result = eraseSheetInk(image, ink(TEXT));
    expect(result).not.toBe(image);
    for (let x = 30; x < 120; x++) for (let y = 27; y < 39; y++) expect(at(result, x, y)).toBe(PAPER);
    // The same word lower down, where the sheet prints nothing, is left alone.
    expect(at(result, 31, 75)).toBe(INK);
    // The input is not modified.
    expect(at(image, 31, 30)).toBe(INK);
  });

  it("keeps a shaft that runs through the text, and removes the letters right up to it", () => {
    const shaft = block(100, 0, 106, 100, TOOL);
    const image = photo(220, 100, word(30, 180, 27), shaft);
    const result = eraseSheetInk(image, ink(TEXT));
    for (let y = 0; y < 100; y++) for (let x = 100; x < 106; x++) expect(at(result, x, y)).toBe(TOOL);
    expect(at(result, 96, 30)).toBe(PAPER);
    expect(at(result, 111, 30)).toBe(PAPER);
  });

  it("keeps a tip that ends inside the text", () => {
    // The shaft comes up from below and stops half-way through the printed area.
    const image = photo(220, 100, word(30, 180, 27), block(100, 33, 106, 100, TOOL));
    const result = eraseSheetInk(image, ink(TEXT));
    for (let y = 33; y < 100; y++) expect(at(result, 103, y)).toBe(TOOL);
    expect(at(result, 51, 30)).toBe(PAPER);
  });

  it("keeps a low part that leaves the printed area sideways, with whatever touches it", () => {
    // A 4 px tall wire lying along the text line and running out past its right-hand end.
    const wire = block(120, 30, 215, 34, TOOL);
    const image = photo(220, 100, word(30, 100, 27), word(130, 150, 22), wire);
    const result = eraseSheetInk(image, ink(TEXT));
    for (let x = 120; x < 215; x++) expect(at(result, x, 32)).toBe(TOOL);
    // The letters touching the wire stay attached, as they were before; the free-standing word goes.
    expect(at(result, 131, 24)).toBe(INK);
    expect(at(result, 31, 30)).toBe(PAPER);
  });

  it("removes the ruled bar on both sides of a handle lying across it", () => {
    const bar: SheetInkRegion = { x: 10, y: 60, width: 200, height: 24, kind: "rule" };
    const line = block(15, 78, 205, 80, INK), tick = block(60, 64, 61, 78, INK);
    const handle = block(90, 0, 130, 100, TOOL);
    // A contact shadow down the handle's left edge, running out of the printed area.
    const rim = block(88, 0, 90, 100, 120);
    const result = eraseSheetInk(photo(220, 100, line, tick, handle, rim), ink(bar));
    for (const x of [20, 60, 80, 140, 200]) expect(at(result, x, 78)).toBe(PAPER);
    expect(at(result, 60, 70)).toBe(PAPER);
    // The handle and its rim are untouched.
    for (let y = 0; y < 100; y++) { expect(at(result, 110, y)).toBe(TOOL); expect(at(result, 88, y)).toBe(120); }
  });

  it("fills a marker with the paper around it", () => {
    const marker: SheetInkRegion = { x: 150, y: 10, width: 40, height: 40, kind: "solid" };
    const result = eraseSheetInk(photo(220, 100, block(152, 12, 188, 48, 0), block(160, 20, 170, 30, 255)), ink(marker));
    for (const [x, y] of [[152, 12], [165, 25], [187, 47]]) expect(at(result, x, y)).toBe(PAPER);
  });

  it("takes the faint halo of a blurred stroke with it", () => {
    // A stem with a one-pixel halo only 5 levels darker than the paper.
    const image = photo(220, 100, block(49, 27, 54, 39, PAPER - 5), block(50, 27, 53, 39, INK));
    const result = eraseSheetInk(image, ink(TEXT));
    expect(at(result, 49, 30)).toBe(PAPER);
    expect(at(result, 53, 30)).toBe(PAPER);
  });

  it("leaves the image alone when no printed area is in view", () => {
    const image = photo(220, 100, word(30, 120, 27));
    expect(eraseSheetInk(image, ink())).toBe(image);
    expect(eraseSheetInk(image, ink({ ...TEXT, x: 400 }))).toBe(image);
    expect(eraseSheetInk(image, { regions: [TEXT], strokePx: 0 })).toBe(image);
  });

  it("works at the edge of the photo", () => {
    // The printed area is cut by the top and left edges; nothing throws and the word still goes.
    const cut: SheetInkRegion = { x: -40, y: -6, width: 140, height: 26, kind: "strokes" };
    const result = eraseSheetInk(photo(220, 100, word(0, 80, 2)), ink(cut));
    expect(at(result, 41, 10)).toBe(PAPER);
  });
});
