import { describe, expect, it } from "vitest";
import { cleanupEdgeMask, type EdgeCleanupEvidence } from "./edge-cleanup";
import { scoreFromEdgeMask } from "./edge-mask";

const width = 220, height = 240;
function fixture(kind: "slit" | "shadow" | "jaw" | "shaft" = "slit") {
  const mask = new Uint8Array(width * height);
  const colour = new Uint8Array(mask.length), seeds = new Uint8Array(mask.length), unknown = new Uint8Array(mask.length);
  for (let y = 20; y < 220; y++) for (let x = 50; x < 200; x++) mask[y * width + x] = 1;
  if (kind === "slit" || kind === "shadow") {
    for (let y = 75; y < 110; y++) for (let x = 43; x < 45; x++) mask[y * width + x] = 1;
    for (let y = 107; y < 110; y++) for (let x = 43; x < 51; x++) mask[y * width + x] = 1;
  }
  if (kind === "jaw") for (let y = 20; y < 80; y++) for (let x = 100; x < 105; x++) mask[y * width + x] = 0;
  if (kind === "shaft") for (let y = 3; y < 30; y++) for (let x = 100; x < 103; x++) mask[y * width + x] = 1;
  for (let i = 0; i < mask.length; i++) { colour[i] = mask[i] ? 80 : 0; seeds[i] = mask[i]; }
  // The colour baseline misses a pale rail and its slit, as in the photograph.
  if (kind === "slit" || kind === "shadow") for (let y = 74; y < 111; y++) for (let x = 42; x < 50; x++) {
    colour[y * width + x] = kind === "slit" ? 50 : 20; seeds[y * width + x] = 0;
  }
  if (kind === "shaft") for (let y = 3; y < 20; y++) for (let x = 100; x < 103; x++) {
    colour[y * width + x] = 10; seeds[y * width + x] = 0;
  }
  return { mask, evidence: { colour, seeds, unknown, iso: 50 } satisfies EdgeCleanupEvidence };
}

function rotate(values: Uint8Array, turns: number) {
  const w = turns % 2 ? height : width, h = turns % 2 ? width : height;
  const pixels = new Uint8Array(values.length);
  const index = (x: number, y: number) => {
    const p = turns === 0 ? { x, y } : turns === 1 ? { x: height - 1 - y, y: x }
      : turns === 2 ? { x: width - 1 - x, y: height - 1 - y } : { x: y, y: width - 1 - x };
    return p.y * w + p.x;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[index(x, y)] = values[y * width + x];
  return { pixels, w, h, index };
}

describe("targeted learned-boundary cleanup", () => {
  it.each([0, 1, 2, 3])("fills a material-supported slit at quarter-turn %i", turns => {
    const f = fixture(), m = rotate(f.mask, turns);
    const evidence = { iso: 50, colour: rotate(f.evidence.colour, turns).pixels, seeds: rotate(f.evidence.seeds, turns).pixels,
      unknown: rotate(f.evidence.unknown, turns).pixels };
    const result = cleanupEdgeMask(m.pixels, m.w, m.h, evidence);
    expect(result.mask[m.index(47, 90)]).toBe(1);
    expect(result.mask[m.index(40, 90)]).toBe(0);
    expect(result.report.filledSlits).toBe(1);
    expect(result.report.softenedPixels).toBeGreaterThan(0);
    expect(result.mask[m.index(43, 75)]).toBe(0); // round the unseeded shoulder
    expect(result.mask[m.index(50, 75)]).toBe(1); // retain the seeded body
    const score = scoreFromEdgeMask(result.mask, m.w, m.h);
    expect(score.every((value, i) => (value >= 128) === !!result.mask[i])).toBe(true);
  });

  it.each([0, 1, 2, 3])("removes an unsupported parallel shadow branch at quarter-turn %i", turns => {
    const f = fixture("shadow"), m = rotate(f.mask, turns);
    const result = cleanupEdgeMask(m.pixels, m.w, m.h, { iso: 50, colour: rotate(f.evidence.colour, turns).pixels,
      seeds: rotate(f.evidence.seeds, turns).pixels, unknown: rotate(f.evidence.unknown, turns).pixels });
    expect(result.mask[m.index(44, 90)]).toBe(0);
    expect(result.mask[m.index(51, 90)]).toBe(1);
    expect(result.report.trimmedBranches).toBe(1);
    expect(result.report.filledPixels).toBe(0);
  });

  it.each(["jaw", "shaft"] as const)("preserves a genuine %s, including an unseeded thin shaft", kind => {
    const f = fixture(kind);
    expect(cleanupEdgeMask(f.mask, width, height, f.evidence).mask).toEqual(f.mask);
  });

  it("preserves a supported narrow hook with paper between it and the body", () => {
    const f = fixture();
    for (let y = 75; y < 107; y++) for (let x = 45; x < 50; x++) f.evidence.colour[y * width + x] = 0;
    for (let y = 75; y < 110; y++) for (let x = 43; x < 45; x++) f.evidence.seeds[y * width + x] = 1;
    expect(cleanupEdgeMask(f.mask, width, height, f.evidence).mask).toEqual(f.mask);
  });

  it("does not edit a reference-aid footprint", () => {
    const f = fixture(); f.evidence.unknown[90 * width + 47] = 1;
    expect(cleanupEdgeMask(f.mask, width, height, f.evidence).mask).toEqual(f.mask);
  });

  it("does not join an independent narrow object across a coloured gap", () => {
    const f = fixture();
    for (let y = 107; y < 110; y++) for (let x = 45; x < 50; x++) f.mask[y * width + x] = 0;
    expect(cleanupEdgeMask(f.mask, width, height, f.evidence).mask).toEqual(f.mask);
  });

  it("retains confident paper and rejects an edit that would enclose it as a new hole", () => {
    const f = fixture(); f.evidence.colour[90 * width + 47] = 0;
    const result = cleanupEdgeMask(f.mask, width, height, f.evidence);
    expect(result.mask[90 * width + 47]).toBe(0);
    expect(result.mask).toEqual(f.mask);
    expect(result.report.topologyRejected).toBe(true);
  });

  it("repairs a short fold that was below the original length cutoff", () => {
    const f = fixture();
    for (let y = 89; y < 110; y++) for (let x = 43; x < 50; x++) f.mask[y * width + x] = 0;
    for (let y = 84; y < 89; y++) for (let x = 43; x < 50; x++) f.mask[y * width + x] = 1;
    const result = cleanupEdgeMask(f.mask, width, height, f.evidence);
    expect(result.report.filledSlits).toBe(1);
    expect(result.mask[79 * width + 47]).toBe(1);
  });

  it("removes a long shadow rail on a slender solid body without filling its channel", () => {
    const f = fixture("shadow"); f.mask.fill(0); f.evidence.colour.fill(0); f.evidence.seeds.fill(0);
    for (let y = 20; y < 220; y++) for (let x = 50; x < 125; x++) {
      const i = y * width + x; f.mask[i] = 1; f.evidence.colour[i] = 80; f.evidence.seeds[i] = 1;
    }
    for (let y = 75; y < 145; y++) for (let x = 43; x < 50; x++) {
      const i = y * width + x; f.evidence.colour[i] = 20;
      if (x < 45 || y >= 142) f.mask[i] = 1;
    }
    const result = cleanupEdgeMask(f.mask, width, height, f.evidence);
    expect(result.report.trimmedBranches).toBe(1);
    expect(result.mask[110 * width + 44]).toBe(0);
    expect(result.mask[110 * width + 47]).toBe(0);
    expect(result.mask[110 * width + 51]).toBe(1);
  });

  it("trims two opposing shadow rails sharing the same channel", () => {
    const f = fixture("shadow");
    for (let y = 90; y < 96; y++) for (let x = 43; x < 45; x++) f.mask[y * width + x] = 0;
    for (let y = 75; y < 78; y++) for (let x = 43; x < 50; x++) f.mask[y * width + x] = 1;
    const result = cleanupEdgeMask(f.mask, width, height, f.evidence);
    expect(result.report.trimmedBranches).toBe(2);
    expect(result.mask[84 * width + 44]).toBe(0);
    expect(result.mask[101 * width + 44]).toBe(0);
  });

  it.each([5, 25])("preserves rails beyond the supported channel width (evidence %i)", colour => {
    const f = fixture("shadow");
    for (let y = 74; y < 111; y++) for (let x = 33; x < 50; x++) {
      f.mask[y * width + x] = y >= 75 && y < 110 && (x === 34 || x === 35 || y >= 107) ? 1 : 0;
      f.evidence.colour[y * width + x] = colour; f.evidence.seeds[y * width + x] = 0;
    }
    expect(cleanupEdgeMask(f.mask, width, height, f.evidence).mask).toEqual(f.mask);
  });

  it("leaves thin frames alone even when they have a short pale fold", () => {
    const f = fixture();
    for (let y = 23; y < 217; y++) for (let x = 53; x < 197; x++) {
      if (x < 80 && y >= 70 && y < 120) continue;
      const i = y * width + x; f.mask[i] = 0; f.evidence.colour[i] = 0; f.evidence.seeds[i] = 0;
    }
    for (let y = 85; y < 110; y++) for (let x = 43; x < 50; x++) f.mask[y * width + x] = 0;
    for (let y = 82; y < 85; y++) for (let x = 43; x < 50; x++) f.mask[y * width + x] = 1;
    expect(cleanupEdgeMask(f.mask, width, height, f.evidence).mask).toEqual(f.mask);
  });

  it("limits fairing to the repair neighbourhood and protects colour anchors", () => {
    const f = fixture(), result = cleanupEdgeMask(f.mask, width, height, f.evidence);
    expect(result.report.softenedPixels).toBeGreaterThan(0);
    for (let i = 0; i < f.mask.length; i++) {
      if (f.evidence.seeds[i]) expect(result.mask[i]).toBe(1);
      if (!f.mask[i] && f.evidence.colour[i] < 20) expect(result.mask[i]).toBe(0);
      if (Math.floor(i / width) < 65 || Math.floor(i / width) > 120) expect(result.mask[i]).toBe(f.mask[i]);
    }
  });

  it("keeps an aid-adjacent shoulder fixed while filling the permitted channel", () => {
    const f = fixture(); f.evidence.unknown[74 * width + 40] = 1;
    const result = cleanupEdgeMask(f.mask, width, height, f.evidence);
    expect(result.report.filledSlits).toBe(1);
    expect(result.mask[75 * width + 43]).toBe(1);
    expect(result.mask[74 * width + 40]).toBe(0);
  });

  it.each([1, 2, 3])("produces exactly rotated repairs and fairing at quarter-turn %i", turns => {
    const f = fixture(), expected = rotate(cleanupEdgeMask(f.mask, width, height, f.evidence).mask, turns);
    const m = rotate(f.mask, turns);
    const actual = cleanupEdgeMask(m.pixels, m.w, m.h, { iso: 50, colour: rotate(f.evidence.colour, turns).pixels,
      seeds: rotate(f.evidence.seeds, turns).pixels, unknown: rotate(f.evidence.unknown, turns).pixels });
    expect(actual.mask).toEqual(expected.pixels);
  });

  it("does not mutate inputs and is deterministic", () => {
    const f = fixture(), before = f.mask.slice(), colour = f.evidence.colour.slice();
    const a = cleanupEdgeMask(f.mask, width, height, f.evidence), b = cleanupEdgeMask(f.mask, width, height, f.evidence);
    expect(a).toEqual(b); expect(f.mask).toEqual(before); expect(f.evidence.colour).toEqual(colour);
  });

  it("rejects unbounded or inconsistent inputs", () => {
    const f = fixture();
    expect(() => cleanupEdgeMask(f.mask, width, height, { ...f.evidence, iso: NaN })).toThrow("Invalid");
    expect(() => cleanupEdgeMask(f.mask, 513, 513, f.evidence)).toThrow("Invalid");
    expect(() => cleanupEdgeMask(f.mask, width, height, { ...f.evidence, unknown: new Uint8Array(3) })).toThrow("Invalid");
  });
});
