import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { HARDWARE_SYMBOLS } from "@shared/gridfinity/hardware-symbols";
import { surfaceTextName, surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { parseBinSpec } from "@shared/gridfinity/types";
import { withKernel } from "@/lib/manifold/runtime";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";
import { createBasicPocket } from "./basic-shape";
import { surfaceTextOutline, surfaceTextZ } from "./surface-text";

describe("hardware symbol export", () => {
  it.each([2, 6, 40].flatMap(sizeMm => [-180, -45, 0, 90].map(symbolRotationDeg => ({ sizeMm, symbolRotationDeg }))))("preserves area, holes and pieces at $sizeMm mm / $symbolRotationDeg degrees", async ({ sizeMm, symbolRotationDeg }) => {
    await withKernel(({ arena, CrossSection }) => {
      for (const symbol of HARDWARE_SYMBOLS) {
        const label = surfaceTextSchema.parse({ id: symbol.id, text: "", symbol: symbol.id, sizeMm, symbolRotationDeg, position: { x: 0, y: 0 } });
        const outline = surfaceTextOutline(label);
        const section = arena.track(new CrossSection(outline.flatMap(s => [s.outer, ...s.holes]).map(ring => ring.map(p => [p.x, p.y] as [number, number])), "NonZero"));
        expect(section.area() / sizeMm ** 2, symbol.name).toBeCloseTo(symbol.sourceArea, 3);
        expect(section.toPolygons().length, symbol.name).toBe(symbol.outline.reduce((n, shape) => n + 1 + shape.holes.length, 0));
        const solid = arena.track(section.extrude(label.heightMm));
        expect(solid.status(), symbol.name).toBe("NoError");
        expect(solid.volume()).toBeCloseTo(section.area() * label.heightMm, 4);
        expect(solid.decompose().map(part => arena.track(part)), symbol.name).toHaveLength(symbol.outline.length);
      }
    });
  });

  it("fuses all 18 symbols into a closed STL and keeps colored label parts in 3MF", async () => {
    const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 2, lip: "none", textColor: "#00aabb",
      surfaceTexts: HARDWARE_SYMBOLS.map((symbol, i) => ({ id: symbol.id, symbol: symbol.id,
        text: i % 2 ? "M3" : "", sizeMm: 5, rotationDeg: i % 2 ? 12 : 0, symbolRotationDeg: i % 3 ? 45 : 90,
        position: { x: (i % 3 - 1) * 36, y: (Math.floor(i / 3) - 2.5) * 18 } })),
    });
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY);
      expect(result.solid.status()).toBe("NoError");
      expect(result.solid.decompose().map(part => kernel.arena.track(part))).toHaveLength(1);
      expect(result.textParts).toHaveLength(18);
      for (const { solid, label } of result.textParts) {
        expect(solid.boundingBox().min[2]).toBeCloseTo(surfaceTextZ(spec));
        expect(solid.boundingBox().max[2]).toBeCloseTo(surfaceTextZ(spec) + label.heightMm);
        expect(kernel.arena.track(solid.intersect(result.bodySolid)).volume()).toBeCloseTo(0, 6);
      }
      // Count coordinate edges in the actual STL bytes, including attachment seams.
      const stl = new DataView(writeBinarySTL(extractPrintableMeshData(kernel, result.solid)));
      const edges = new Map<string, { count: number; direction: number }>();
      for (let i = 0; i < stl.getUint32(80, true); i++) {
        const vertices = [0, 1, 2].map(j => [0, 1, 2].map(k => stl.getFloat32(84 + i * 50 + 12 + j * 12 + k * 4, true)).join(","));
        for (let j = 0; j < 3; j++) {
          const a = vertices[j], b = vertices[(j + 1) % 3];
          const key = a < b ? `${a}/${b}` : `${b}/${a}`;
          const edge = edges.get(key) ?? { count: 0, direction: 0 };
          edge.count++; edge.direction += a < b ? 1 : -1; edges.set(key, edge);
        }
      }
      expect([...edges.values()].every(edge => edge.count === 2 && edge.direction === 0)).toBe(true);
      const model = strFromU8(unzipSync(writeThreeMf([
        { name: "Bin", mesh: extractPrintableMeshData(kernel, result.bodySolid) },
        ...result.textParts.map(part => ({ name: `Text: ${surfaceTextName(part.label)}`,
          mesh: extractPrintableMeshData(kernel, part.solid), material: { name: "Text", displayColor: "#00aabb" as const } })),
      ], { assemble: true }))["3D/3dmodel.model"]);
      expect(model.match(/<component /g)).toHaveLength(19);
      expect(model.match(/<item /g)).toHaveLength(1);
      expect(model).toContain('name="Text: Hex nut"');
      expect(model).toContain('name="Text: M3"');
      expect(model).toContain("#00AABB");
    });
  });

  it("rejects symbols outside the support, above openings, or overlapping another label", async () => {
    const label = surfaceTextSchema.parse({ id: "nut", text: "", symbol: "hex-nut", position: { x: 0, y: 0 } });
    const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 3, surfaceTexts: [label] });
    await withKernel(kernel => {
      const build = (surfaceTexts: typeof spec.surfaceTexts) => buildBinWithCutouts(kernel, { ...spec, surfaceTexts }, null, EXPORT_QUALITY);
      expect(() => build([{ ...label, position: { x: 21, y: 0 } }])).toThrow("must fit on the flat surface");
      expect(() => build([label, { ...label, id: "other" }])).toThrow("overlaps");
      const pocket = createBasicPocket("rectangle", { x: -8, y: -8 }, { x: 8, y: 8 }, "pocket")!;
      expect(() => buildBinWithCutouts(kernel, spec, { cutouts: [pocket.cutout], shapesById: new Map([[pocket.shape.id, pocket.shape]]), fingerHoles: [] }, EXPORT_QUALITY)).toThrow("must fit on the flat surface");
    });
  });
});
