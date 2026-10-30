import { wasm, arena, spec, checkSupportFree } from "./peg-bottom.test-support";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PEG_BOTTOM,
  pegBottomExtensionMm,
  pegBottomRootHeightMm,
  ULTIM8_COLLAR_HEIGHT_MM,
  ULTIM8_ROOT_HEIGHT_MM,
} from "@shared/gridfinity/peg-bottom";
import { createKernel } from "@/lib/manifold/runtime";
import { binDimensionsMm, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { buildPegBottom } from "./peg-bottom";

describe("support-free peg bottoms", () => {
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("builds a connected, watertight base with no unsupported underside at %j quality", quality => {
    const kernel = createKernel(wasm, arena);
    const s = spec();
    const solid = buildPegBottom(kernel, s, quality.circularSegments);
    expect(solid.status()).toBe("NoError");
    const pieces = solid.decompose();
    pieces.forEach(p => arena.track(p));
    expect(pieces).toHaveLength(1);
    const bottom = -pegBottomExtensionMm(s);
    expect(solid.boundingBox().min[2]).toBeCloseTo(bottom, 6);
    expect(solid.boundingBox().max[2]).toBeCloseTo(7, 6);
    const shafts = arena.track(solid.slice(-ULTIM8_ROOT_HEIGHT_MM - 1));
    expect(shafts.area()).toBeGreaterThan(0);
    checkSupportFree(solid.getMesh(), bottom);
  });
  it.each(["full", "half", "quarter"] as const)("supports small rectangles and custom footprints on %s pitch", gridPitch => {
    const kernel = createKernel(wasm, arena);
    for (const s of [spec({ gridPitch }), spec({ gridPitch, gridX: 2, gridY: 2,
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } })]) {
      const solid = buildPegBottom(kernel, s, 24);
      expect(solid.status()).toBe("NoError");
      checkSupportFree(solid.getMesh(), -pegBottomExtensionMm(s));
    }
  });
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("builds a shorter connected bridged web with a 45 degree perimeter at %j quality", quality => {
    const kernel = createKernel(wasm, arena);
    const s = spec({ gridPitch: "quarter", gridX: 2, gridY: 2, pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged", density: 1 } });
    const solid = buildPegBottom(kernel, s, quality.circularSegments);
    expect(solid.status()).toBe("NoError");
    const pieces = solid.decompose();
    pieces.forEach(p => arena.track(p));
    expect(pieces).toHaveLength(1);
    expect(pegBottomExtensionMm(s)).toBeCloseTo(7.8);
    const bridgeZ = -pegBottomRootHeightMm(s) + ULTIM8_COLLAR_HEIGHT_MM;
    checkSupportFree(solid.getMesh(), -pegBottomExtensionMm(s), bridgeZ);
    expect(arena.track(solid.slice(bridgeZ + 0.1)).area()).toBeGreaterThan(arena.track(solid.slice(bridgeZ - 0.1)).area());
  });
  it.each(["full", "half", "quarter"] as const)("handles single, collinear and wider rectangular peg layouts on %s pitch", gridPitch => {
    const kernel = createKernel(wasm, arena);
    for (const [gridX, gridY] of [[1, 1], [1, 3], [2, 2], [3, 3]]) {
      const s = spec({ gridPitch, gridX, gridY, pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged", density: 1 } });
      const solid = buildPegBottom(kernel, s, 24);
      expect(solid.status()).toBe("NoError");
      checkSupportFree(solid.getMesh(), -pegBottomExtensionMm(s), -pegBottomRootHeightMm(s) + ULTIM8_COLLAR_HEIGHT_MM);
    }
  });
  it("rejects custom bridged footprints with an actionable alternative", () => {
    const kernel = createKernel(wasm, arena);
    expect(() => buildPegBottom(kernel, spec({ gridX: 2, gridY: 2,
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      pegBottom: { ...DEFAULT_PEG_BOTTOM, underside: "bridged", density: 1 } }), 24)).toThrow(/sloped underside/);
  });
  it("includes extension in overall dimensions without moving the rim", () => {
    const normal = binDimensionsMm(spec({ pegBottom: null }));
    const pegs = binDimensionsMm(spec());
    expect(pegs.heightToRimMm).toBe(normal.heightToRimMm);
    expect(pegs.totalHeightMm).toBe(normal.totalHeightMm + pegBottomExtensionMm(spec()));
  });
  const overlapCases = [PREVIEW_QUALITY, EXPORT_QUALITY].flatMap(quality =>
    (["sloped", "bridged"] as const).map(underside => ({ quality, underside })),
  );});
