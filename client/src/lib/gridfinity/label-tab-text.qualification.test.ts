import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { parseBinSpec } from "@shared/gridfinity/types";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { labelTabTopZ } from "@shared/gridfinity/label-tab-surfaces";
import { DEFAULT_LABEL_TAB_RECESS_MM } from "@shared/gridfinity/label-tab";
import { withKernel, loadManifold } from "@/lib/manifold/runtime";
import { extractPrintableMeshData, type MeshData } from "@/lib/mesh/mesh-data";
import { writeBinarySTL } from "@/lib/export/stl-writer";
import { writeThreeMf } from "@/lib/mesh/threemf";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { createBinWorkerHandlers } from "./bin-worker-handlers";
import { BUILD_BIN_METHOD, type BuildBinRequest, type BuildBinResult } from "./worker-api";
import type { HandlerContext, TransferableResult } from "@/lib/worker/host";
import { placeSurfaceTextOnTab } from "./surface-text";
import { createBasicPocket } from "./basic-shape";

const reported = parseBinSpec({ gridX: 4, gridY: 4, gridPitch: "half", heightUnits: 5.5, lip: "none", fill: "none",
  wallSlant: { axis: "y", angleDeg: 30 }, bottomFilletRadiusMm: 8,
  compartments: { enabled: true, rows: 2, columns: 3, dividerThicknessMm: 1.2 },
  labelTab: { wall: "south", autoWall: true, scope: "compartments", width: "full" } });
const label = surfaceTextSchema.parse({ id: "metric", text: "M3", font: "helvetiker", sizeMm: 4,
  symbol: "hex-nut", symbolSizeMm: 4, position: { x: 0, y: 0 } });

function expectClosedStl(mesh: MeshData) {
  const bytes = new DataView(writeBinarySTL(mesh));
  const edges = new Map<string, { count: number; direction: number }>();
  for (let i = 0; i < bytes.getUint32(80, true); i++) {
    const vertices = [0, 1, 2].map(j => [0, 1, 2].map(k => bytes.getFloat32(84 + i * 50 + 12 + j * 12 + k * 4, true)).join(","));
    for (let j = 0; j < 3; j++) {
      const a = vertices[j], b = vertices[(j + 1) % 3], key = [a, b].sort().join("/");
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++; edge.direction += a < b ? 1 : -1; edges.set(key, edge);
    }
  }
  expect([...edges.values()].filter(edge => edge.count !== 2 || edge.direction !== 0)).toEqual([]);
}

describe("raised labels on slanted shelves", () => {
  it.each([{ recessMm: 0 }, { recessMm: 0.4 }, { recessMm: DEFAULT_LABEL_TAB_RECESS_MM },
    { recessMm: DEFAULT_LABEL_TAB_RECESS_MM, frontRim: true }])("exports six metric labels with %j and separate colored 3MF parts", async settings => {
    const { recessMm } = settings;
    const spec = { ...reported, labelTab: { ...reported.labelTab!, ...settings }, surfaceTexts: [...reported.surfaceTexts] };
    for (let i = 0; i < 6; i++) spec.surfaceTexts.push(placeSurfaceTextOnTab(spec, { ...label, id: String(i), text: `M${i + 2}` }));
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY,
        { floorInsertThicknessMm: 0.6, rimInsertThicknessMm: 1.25, colorDividerTops: true });
      expect(result.textParts).toHaveLength(6);
      expect(result.solid.status()).toBe("NoError");
      expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
      for (const part of result.textParts) {
        expect(part.z).toBeCloseTo(38.5 - recessMm);
        expect(part.solid.boundingBox().min[2]).toBeCloseTo(38.5 - recessMm, 6);
        if (recessMm === DEFAULT_LABEL_TAB_RECESS_MM) expect(part.solid.boundingBox().max[2]).toBeCloseTo(38.5, 6);
        expect(kernel.arena.track(part.solid.intersect(result.bodySolid)).volume()).toBeCloseTo(0, 6);
      }
      expectClosedStl(extractPrintableMeshData(kernel, result.solid));
      const model = strFromU8(unzipSync(writeThreeMf([
        { name: "Bin", mesh: extractPrintableMeshData(kernel, result.bodySolid) },
        ...result.textParts.map(part => ({ name: `Text: ${part.label.text}`, mesh: extractPrintableMeshData(kernel, part.solid),
          material: { name: "Text", displayColor: "#002244" as const } })),
      ], { assemble: true }))["3D/3dmodel.model"]);
      expect(model.match(/<component /g)).toHaveLength(7);
      expect(model).toContain('name="Text: M3"');
      expect([...model.matchAll(/z="([^"]+)"/g)].some(match => Math.abs(Number(match[1]) - (38.5 - recessMm)) < 1e-4)).toBe(true);
      expect(model).toContain("#002244");
    });
  });

  it.each(["x", "y"] as const)("supports %s slants in both directions and single walls, with outer/compartment tabs and scoops", async axis => {
    for (const side of ["both", "positive", "negative"] as const) for (const angleDeg of [-30, 30]) {
      for (const scope of ["outer", "compartments"] as const) {
        const spec = parseBinSpec({ ...reported, wallSlant: { axis, angleDeg, side },
          // Outer tabs span the full bin; their centred label must not cross a divider.
          compartments: { ...reported.compartments, rows: scope === "outer" ? 1 : 2, columns: scope === "outer" ? 1 : 3, scoop: true },
          labelTab: { wall: axis === "x" ? angleDeg > 0 ? "west" : "east" : angleDeg > 0 ? "south" : "north", width: "full", scope,
            recessMm: 0.5, frontRim: true } });
        const placed = placeSurfaceTextOnTab(spec, label);
        expect(placed.surface, `${axis}/${side}/${angleDeg}/${scope}`).toBe("label-tab");
        await withKernel(kernel => {
          const result = buildBinWithCutouts(kernel, { ...spec, surfaceTexts: [placed] }, null, PREVIEW_QUALITY);
          expect(result.solid.status()).toBe("NoError");
          expect(result.textParts[0].z).toBe(labelTabTopZ(spec));
          expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
        });
      }
    }
  });

  it.each(["outer", "compartments"] as const)("honors the actual %s tab height with a stacking lip on upright bins", async scope => {
    const spec = parseBinSpec({ ...reported, wallSlant: null, lip: "standard", labelTab: { wall: "south", width: "full", scope } });
    const placed = placeSurfaceTextOnTab(spec, label);
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, { ...spec, surfaceTexts: [placed] }, null, EXPORT_QUALITY);
      expect(result.textParts[0].z).toBe(labelTabTopZ(spec));
      expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
    });
  });

  it("rejects floating, oversized, overlapping and missing-tab text", async () => {
    const placed = placeSurfaceTextOnTab(reported, label);
    await withKernel(kernel => {
      const build = (surfaceTexts: typeof reported.surfaceTexts) => buildBinWithCutouts(kernel, { ...reported, surfaceTexts }, null, PREVIEW_QUALITY);
      expect(() => build([{ ...placed, position: { x: 100, y: 100 } }])).toThrow("must fit on a label tab");
      expect(() => build([{ ...placed, sizeMm: 40 }])).toThrow("must fit on a label tab");
      expect(() => build([placed, { ...placed, id: "duplicate" }])).toThrow("overlaps");
      expect(() => buildBinWithCutouts(kernel, { ...reported, labelTab: null, surfaceTexts: [placed] }, null, PREVIEW_QUALITY)).toThrow("needs a label tab");
      const closed = parseBinSpec({ ...reported, wallSlant: { axis: "x", angleDeg: -80, side: "positive" }, surfaceTexts: [placed] });
      expect(() => buildBinWithCutouts(kernel, closed, null, PREVIEW_QUALITY)).toThrow("needs a label tab");
    });
  });

  it("keeps the shelf height through the preview worker boundary", async () => {
    const spec = { ...reported, surfaceTexts: [placeSurfaceTextOnTab(reported, label)] };
    const handler = createBinWorkerHandlers(loadManifold)[BUILD_BIN_METHOD] as (
      request: BuildBinRequest, context: HandlerContext
    ) => Promise<TransferableResult<BuildBinResult>>;
    const { value } = await handler({ spec, quality: PREVIEW_QUALITY, exportTopology: true },
      { signal: new AbortController().signal, progress: () => {} });
    const part = value.textMeshes![0];
    expect(part.label.surface).toBe("label-tab");
    const zs = [...part.mesh.positions].filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(38.5, 5);
    expect(Math.max(...zs)).toBeCloseTo(38.5 + label.heightMm, 5);
  });

  it.each(["outer", "compartments"] as const)("clips %s tab text to a custom footprint", async scope => {
    const spec = parseBinSpec({ ...reported, gridX: 2, gridY: 2, gridPitch: "full", bottomFilletRadiusMm: 0,
      compartments: { rows: scope === "outer" ? 1 : 2, columns: scope === "outer" ? 1 : 2 },
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      labelTab: { wall: "south", scope, width: "center", recessMm: 0.5, frontRim: true } });
    const placed = placeSurfaceTextOnTab(spec, label);
    expect(placed.surface).toBe("label-tab");
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, { ...spec, surfaceTexts: [placed] }, null, EXPORT_QUALITY);
      expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
      expectClosedStl(extractPrintableMeshData(kernel, result.solid));
    });
  });

  it("rejects text over an actual cut through its shelf", async () => {
    const placed = placeSurfaceTextOnTab(reported, label), p = placed.position;
    const pocket = createBasicPocket("rectangle", { x: p.x - 10, y: p.y - 4 }, { x: p.x + 10, y: p.y + 4 }, "opening")!;
    await withKernel(kernel => {
      expect(() => buildBinWithCutouts(kernel, { ...reported, surfaceTexts: [placed] }, {
        cutouts: [{ ...pocket.cutout, depth: { mode: "through" } }], shapesById: new Map([[pocket.shape.id, pocket.shape]]), fingerHoles: [],
      }, PREVIEW_QUALITY)).toThrow("must fit on a label tab");
    });
  });

  it("allows supported text on the solid fill of a slanted bin", async () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 5, fill: "solid", lip: "none", wallSlant: { axis: "y", angleDeg: 30 }, surfaceTexts: [label] });
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY);
      expect(result.textParts[0].z).toBe(35);
      expectClosedStl(extractPrintableMeshData(kernel, result.solid));
    });
  });

  it.each([undefined, "bin"] as const)("builds the reported M1 label at tab height with legacy surface %s", async surface => {
    const original = surfaceTextSchema.parse({ id: "reported", text: "M1 4x6.5", font: "helvetiker", sizeMm: 2,
      symbol: "pan-screw", symbolSizeMm: 3.5, symbolRotationDeg: 45, rotationDeg: -180,
      position: { x: 27.055917407145827, y: 27.305240547813284 }, surface });
    const spec = parseBinSpec({ ...reported, surfaceTexts: [original] });
    expect(spec.surfaceTexts).toEqual([{ ...original, surface: "label-tab" }]);
    await withKernel(kernel => {
      const result = buildBinWithCutouts(kernel, spec, null, EXPORT_QUALITY);
      expect(result.textParts[0].z).toBe(38.5);
      expect(result.solid.decompose().map(part => kernel.arena.track(part)).filter(part => part.volume() > 1e-6)).toHaveLength(1);
      expectClosedStl(extractPrintableMeshData(kernel, result.solid));
    });
  });

  it("requires label tabs for hollow-bin text even if it would fit on the floor", async () => {
    const spec = parseBinSpec({ ...reported, labelTab: null, surfaceTexts: [label] });
    await withKernel(kernel => {
      expect(() => buildBinWithCutouts(kernel, spec, null, PREVIEW_QUALITY)).toThrow("Enable label tabs in Construction");
    });
  });
});
