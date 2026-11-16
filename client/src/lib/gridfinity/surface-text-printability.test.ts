import { describe, expect, it } from "vitest";
import { surfaceTextSchema, type SurfaceText } from "@shared/gridfinity/surface-text";
import { withKernel } from "@/lib/manifold/runtime";
import { surfaceTextOutline } from "./surface-text";
import { surfaceTextPrintabilityIssue } from "./surface-text-printability";

const label = surfaceTextSchema.parse({ id: "metric", text: "M4 nut", font: "helvetiker", sizeMm: 2, position: { x: 0, y: 0 } });
const check = (value: SurfaceText) => withKernel(kernel => {
  const rings = surfaceTextOutline(value).flatMap(shape => [shape.outer, ...shape.holes]);
  const section = kernel.arena.track(new kernel.CrossSection(rings.map(ring => ring.map(p => [p.x, p.y] as [number, number])), "NonZero"));
  return surfaceTextPrintabilityIssue(value, section);
});

describe("surface label printability", () => {
  it("warns about the 2 mm lettering that disappears in a 0.4 mm Bambu Classic slice", async () => {
    const issue = await check({ ...label, name: "M4 nuts", symbol: "hex-nut", symbolSizeMm: 10 });
    expect(issue).toMatchObject({ code: "surface-text-thin-strokes", severity: "warning", surfaceTextIds: ["metric"] });
    expect(issue!.message).toContain("M4 nuts");
    expect(issue!.message).toContain("0.42 mm line width");
    expect(issue!.message).toContain("0.4 mm nozzle");
  });

  it.each(["M4 nut", "M5 flat", "M5 lock", "M2.5x12", "M2x2.7+2", "Spare"])("accepts the enlarged bold label %s", async text => {
    expect(await check({ ...label, text, font: "helvetiker-bold", sizeMm: 3.6 })).toBeUndefined();
  });

  it.each([0, 45, 180])("is independent of label placement and rotation (%s degrees)", async rotationDeg => {
    expect(await check({ ...label, rotationDeg, position: { x: 130, y: -58 } })).toBeDefined();
    expect(await check({ ...label, font: "helvetiker-bold", sizeMm: 3.6, rotationDeg, position: { x: 130, y: -58 } })).toBeUndefined();
  });

  it("checks symbol-only labels and respects independent symbol size", async () => {
    const symbol = { ...label, text: "", symbol: "pan-screw" as const, sizeMm: 20 };
    expect(await check({ ...symbol, symbolSizeMm: 2 })).toBeDefined();
    expect(await check({ ...symbol, symbolSizeMm: 6 })).toBeUndefined();
  });

  it("checks portable custom font outlines, including tiny punctuation beside large glyphs", async () => {
    const custom: SurfaceText = { ...label, sizeMm: 10, text: "A.", font: {
      kind: "local", name: "Fixture", resolution: 1000,
      glyphs: { A: { ha: 1200, o: "m 0 0 l 1000 0 l 1000 1000 l 0 1000 l 0 0" },
        ".": { ha: 100, o: "m 0 0 l 20 0 l 20 20 l 0 20 l 0 0" } },
    } };
    expect(await check({ ...custom, text: "A" })).toBeUndefined();
    expect(await check(custom)).toBeDefined();
  });
});
