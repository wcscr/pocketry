import { describe, expect, it } from "vitest";
import { HARDWARE_SYMBOLS, hardwareSymbol, type HardwareSymbolId } from "@shared/gridfinity/hardware-symbols";
import { surfaceTextName, surfaceTextSchema, SURFACE_TEXT_FONTS } from "@shared/gridfinity/surface-text";
import type { LocalFont } from "@shared/gridfinity/local-font";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { doubleSignedArea, pointInRing } from "@shared/geometry/rings";
import { outlineBounds } from "@/lib/geometry/outline";
import { surfaceTextOutline } from "./surface-text";

const label = surfaceTextSchema.parse({ id: "hardware", text: "M3", position: { x: 0, y: 0 } });

describe("bundled hardware symbols", () => {
  it.each(HARDWARE_SYMBOLS)("preserves closed rings, holes, and source area for $name", symbol => {
    let area = 0;
    for (const shape of symbol.outline) {
      expect(doubleSignedArea(shape.outer)).toBeGreaterThan(0);
      for (const hole of shape.holes) {
        expect(doubleSignedArea(hole)).toBeLessThan(0);
        expect(pointInRing(shape.outer, hole[0])).toBe(true);
      }
      for (const ring of [shape.outer, ...shape.holes]) {
        expect(ring.length).toBeGreaterThanOrEqual(3);
        expect(ring[0]).not.toEqual(ring.at(-1));
        expect(ring.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
        area += doubleSignedArea(ring) / 2;
      }
    }
    expect(area).toBeGreaterThan(0);
    expect(Math.abs(area - symbol.sourceArea)).toBeLessThan(0.001);
    const bounds = outlineBounds(symbol.outline)!;
    expect(bounds.maxY - bounds.minY).toBeCloseTo(1, 3);
    expect(surfaceTextName({ ...label, text: "", symbol: symbol.id })).toBe(symbol.name);
  });

  it("keeps symbol geometry independent of fonts and separates it from mixed wording", () => {
    const base = { ...label, text: "", symbol: "hex-nut" as const };
    const icon = surfaceTextOutline(base);
    for (const font of SURFACE_TEXT_FONTS) expect(surfaceTextOutline({ ...base, font: font.id })).toEqual(icon);
    const mixed = surfaceTextOutline({ ...label, symbol: base.symbol });
    const symbolBounds = outlineBounds(mixed.slice(0, icon.length))!;
    const textBounds = outlineBounds(mixed.slice(icon.length))!;
    expect(textBounds.minX - symbolBounds.maxX).toBeCloseTo(label.sizeMm * 0.25);
    expect((textBounds.minY + textBounds.maxY) / 2).toBeCloseTo((symbolBounds.minY + symbolBounds.maxY) / 2);
    const moved = surfaceTextOutline({ ...base, rotationDeg: 90, position: { x: 8, y: -5 } });
    expect(moved[0].outer[0].x).toBeCloseTo(-icon[0].outer[0].y + 8);
    expect(moved[0].outer[0].y).toBeCloseTo(icon[0].outer[0].x - 5);
  });

  it.each(["socket-bolt", "pan-screw", "countersunk-screw", "tapping-screw"] as const)("starts %s upright with its head at the top", symbol => {
    const outline = surfaceTextOutline({ ...label, symbol, text: "" });
    const bounds = outlineBounds(outline)!;
    expect(bounds.maxY - bounds.minY).toBeCloseTo(label.sizeMm);
    expect(bounds.maxX - bounds.minX).toBeLessThan(label.sizeMm);
    const points = outline.flatMap(shape => shape.outer);
    const width = (top: boolean) => {
      const xs = points.filter(p => top ? p.y > 0 : p.y < 0).map(p => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(true)).toBeGreaterThan(width(false));
  });

  it.each([-180, -45, 0, 45, 90, 180])("rotates only the symbol by %s degrees, with clear and centered wording", symbolRotationDeg => {
    for (const symbol of ["socket-bolt", "tapping-screw", "lock-washer", "threaded-insert"] satisfies HardwareSymbolId[]) {
      const base = { ...label, symbol };
      const mixed = surfaceTextOutline({ ...base, symbolRotationDeg });
      const symbolCount = hardwareSymbol(symbol).outline.length;
      const icon = mixed.slice(0, symbolCount), text = mixed.slice(symbolCount);
      const symbolBounds = outlineBounds(icon)!, textBounds = outlineBounds(text)!;
      expect(textBounds.minX - symbolBounds.maxX).toBeCloseTo(label.sizeMm * 0.25);
      expect(textBounds.minY + textBounds.maxY).toBeCloseTo(symbolBounds.minY + symbolBounds.maxY);
      // Wording can translate for the new bounds, but every edge keeps its direction.
      const originalText = surfaceTextOutline(label);
      const dx = text[0].outer[0].x - originalText[0].outer[0].x;
      const dy = text[0].outer[0].y - originalText[0].outer[0].y;
      text.forEach((shape, i) => shape.outer.forEach((point, j) => {
        expect(point.x).toBeCloseTo(originalText[i].outer[j].x + dx);
        expect(point.y).toBeCloseTo(originalText[i].outer[j].y + dy);
      }));
      // The label's own angle still turns both symbol and wording together.
      const turned = surfaceTextOutline({ ...base, symbolRotationDeg, rotationDeg: 90 });
      mixed.forEach((shape, i) => [shape.outer, ...shape.holes].forEach((ring, j) => ring.forEach((point, k) => {
        const actual = [turned[i].outer, ...turned[i].holes][j][k];
        expect(actual.x).toBeCloseTo(-point.y);
        expect(actual.y).toBeCloseTo(point.x);
      })));
      const edge = hardwareSymbol(symbol).outline[0].outer;
      const radians = symbolRotationDeg * Math.PI / 180;
      const x = (edge[1].x - edge[0].x) * label.sizeMm, y = (edge[1].y - edge[0].y) * label.sizeMm;
      expect(icon[0].outer[1].x - icon[0].outer[0].x).toBeCloseTo(x * Math.cos(radians) - y * Math.sin(radians));
      expect(icon[0].outer[1].y - icon[0].outer[0].y).toBeCloseTo(x * Math.sin(radians) + y * Math.cos(radians));
    }
    expect(surfaceTextOutline({ ...label, symbolRotationDeg })).toEqual(surfaceTextOutline(label));
  });

  it("round-trips symbol-only, mixed and legacy labels and history without inventing symbols", () => {
    const oldSpec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, surfaceTexts: [label] });
    const oldDoc = { spec: oldSpec, cutouts: [], fingerHoles: [] };
    const old = parseProjectDoc({ schemaVersion: 53, ...oldDoc, shapes: [] })!;
    expect(old.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(old.spec.surfaceTexts[0]).toEqual(label);
    const spec = { ...oldSpec, surfaceTexts: [
      { ...label, text: "", symbol: "washer", symbolRotationDeg: -45, symbolSizeMm: 12, symbolGapMm: 0 },
      { ...label, id: "mixed", text: "  M3", symbol: "socket-bolt", symbolRotationDeg: 90, symbolSizeMm: 4, symbolGapMm: 4.5 },
    ] };
    const current = { ...old, spec, history: { index: 1, stack: [
      { doc: oldDoc, label: "Old label" }, { doc: { ...oldDoc, spec }, label: "Choose symbols" },
    ] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(current)))).toEqual(current);
    expect(surfaceTextSchema.safeParse({ ...label, text: "" }).success).toBe(false);
    expect(surfaceTextSchema.safeParse({ ...label, text: " ", symbol: "washer" }).success).toBe(true);
    expect(surfaceTextSchema.safeParse({ ...label, symbol: "__proto__" }).success).toBe(false);
    expect(surfaceTextSchema.safeParse({ ...label, text: "\n", symbol: "washer" }).success).toBe(false);
    for (const symbolRotationDeg of [Infinity, NaN, -181, 181, "90"]) {
      expect(surfaceTextSchema.safeParse({ ...label, symbol: "washer", symbolRotationDeg }).success).toBe(false);
    }
    for (const symbolSizeMm of [Infinity, NaN, 0, 1.9, 40.1, "6"]) {
      expect(surfaceTextSchema.safeParse({ ...label, symbol: "washer", symbolSizeMm }).success).toBe(false);
    }
    for (const symbolGapMm of [Infinity, NaN, -0.1, 40.1, "2"]) {
      expect(surfaceTextSchema.safeParse({ ...label, symbol: "washer", symbolGapMm }).success).toBe(false);
    }
  });

  it.each(SURFACE_TEXT_FONTS)("honors leading spaces and explicit gaps in $name", ({ id: font }) => {
    const symbol = "socket-bolt" as const, count = hardwareSymbol(symbol).outline.length;
    const base = { ...label, font, symbol, symbolSizeMm: 12, symbolRotationDeg: 45 };
    const gap = (outline: ReturnType<typeof surfaceTextOutline>) =>
      outlineBounds(outline.slice(count))!.minX - outlineBounds(outline.slice(0, count))!.maxX;
    const original = surfaceTextOutline(base);
    expect(surfaceTextOutline({ ...base, symbolGapMm: label.sizeMm * 0.25 })).toEqual(original);
    const oneSpace = gap(surfaceTextOutline({ ...base, text: " M3" })) - gap(original);
    expect(oneSpace).toBeGreaterThan(0);
    for (const symbolGapMm of [0, 2.5, 40]) {
      const spaced = surfaceTextOutline({ ...base, text: "   M3 ", symbolGapMm });
      expect(gap(spaced)).toBeCloseTo(symbolGapMm + 3 * oneSpace);
      expect(gap(surfaceTextOutline({ ...base, symbolGapMm, sizeMm: 12 }))).toBeCloseTo(symbolGapMm);
      const turned = surfaceTextOutline({ ...base, text: "   M3 ", symbolGapMm, rotationDeg: 90 });
      spaced.forEach((shape, i) => [shape.outer, ...shape.holes].forEach((ring, j) => ring.forEach((point, k) => {
        const actual = [turned[i].outer, ...turned[i].holes][j][k];
        expect(actual.x).toBeCloseTo(-point.y);
        expect(actual.y).toBeCloseTo(point.x);
      })));
      // Spacing translates pieces without resizing any glyph, symbol, or hole.
      spaced.forEach((shape, i) => {
        const dx = shape.outer[0].x - original[i].outer[0].x;
        const dy = shape.outer[0].y - original[i].outer[0].y;
        [shape.outer, ...shape.holes].forEach((ring, j) => ring.forEach((point, k) => {
          const old = [original[i].outer, ...original[i].holes][j][k];
          expect(point.x).toBeCloseTo(old.x + dx); expect(point.y).toBeCloseTo(old.y + dy);
        }));
      });
    }
    expect(surfaceTextOutline({ ...base, text: "", symbolGapMm: 40 })).toEqual(surfaceTextOutline({ ...base, text: "   " }));
    expect(surfaceTextOutline({ ...label, font, symbolGapMm: 40 })).toEqual(surfaceTextOutline({ ...label, font }));
  });

  it("uses saved-font space advances without counting the first glyph's side bearing", () => {
    const font: LocalFont = { kind: "local", name: "Spacing fixture", resolution: 1000, glyphs: {
      " ": { ha: 250, o: "" }, A: { ha: 600, o: "m 100 0 l 100 500 l 500 500 l 500 0 l 100 0" },
    } };
    const base = { ...label, font, text: "  A", symbol: "hex-nut" as const, symbolGapMm: 2.5 };
    const saved = JSON.stringify(base), count = hardwareSymbol(base.symbol).outline.length;
    const outline = surfaceTextOutline(base);
    expect(outlineBounds(outline.slice(count))!.minX - outlineBounds(outline.slice(0, count))!.maxX).toBeCloseTo(5.5);
    expect(JSON.stringify(base)).toBe(saved);
    expect(surfaceTextOutline(JSON.parse(saved))).toEqual(outline);
  });

  it.each([0, 45, 90])("sizes symbols independently at %s degrees without changing text dimensions", symbolRotationDeg => {
    const symbol = "lock-washer" as const, count = hardwareSymbol(symbol).outline.length;
    const base = { ...label, symbol, symbolRotationDeg };
    const legacy = surfaceTextOutline(base);
    expect(surfaceTextOutline({ ...base, symbolSizeMm: label.sizeMm })).toEqual(legacy);
    const dimensions = (outline: ReturnType<typeof surfaceTextOutline>) => {
      const bounds = outlineBounds(outline)!;
      return { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
    };
    const oldIcon = dimensions(legacy.slice(0, count)), oldText = dimensions(legacy.slice(count));
    for (const symbolSizeMm of [2, 12, 40]) {
      const result = surfaceTextOutline({ ...base, symbolSizeMm });
      const icon = dimensions(result.slice(0, count)), text = dimensions(result.slice(count));
      expect(icon.width).toBeCloseTo(oldIcon.width * symbolSizeMm / label.sizeMm);
      expect(icon.height).toBeCloseTo(oldIcon.height * symbolSizeMm / label.sizeMm);
      expect(text.width).toBeCloseTo(oldText.width); expect(text.height).toBeCloseTo(oldText.height);
      const iconBounds = outlineBounds(result.slice(0, count))!, textBounds = outlineBounds(result.slice(count))!;
      expect(textBounds.minX - iconBounds.maxX).toBeCloseTo(label.sizeMm * 0.25);
      expect(textBounds.minY + textBounds.maxY).toBeCloseTo(iconBounds.minY + iconBounds.maxY);
      const resizedText = surfaceTextOutline({ ...base, sizeMm: 10, symbolSizeMm });
      expect(dimensions(resizedText.slice(0, count)).height).toBeCloseTo(icon.height);
      expect(dimensions(resizedText.slice(count)).height).toBeCloseTo(oldText.height * 10 / label.sizeMm);
    }
  });
});
