import { expect, it } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { validateLayout } from "@shared/gridfinity/validate";
import { fingerHoleSchema } from "@shared/gridfinity/cutout";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { withKernel } from "@/lib/manifold/runtime";
import { createBasicPocket } from "./basic-shape";
import { linkedPocketCopyPosition } from "./autoplace";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";
import { expectAllSurfaceTextBuilt } from "./surface-text.test-support";

it.each([0, 90, 180])("places four long linked copies inside the available axis at %s degrees", rotationDeg => {
  const tool = createBasicPocket("rectangle", { x: -5, y: -134 }, { x: 5, y: 134 }, "driver")!;
  const spec = parseBinSpec({ gridX: rotationDeg === 90 ? 7 : 3, gridY: rotationDeg === 90 ? 3 : 7, heightUnits: 6 });
  const shapes = new Map([[tool.shape.id, tool.shape]]);
  const cutouts = [{ ...tool.cutout, rotationDeg, clearanceMm: 1, topFilletMm: 1 }];
  for (let index = 1; index <= 4; index++) {
    const source = cutouts.at(-1)!;
    const position = linkedPocketCopyPosition(spec, source, cutouts, shapes);
    expect(position).not.toBeNull();
    cutouts.push({ ...source, id: `copy-${index}`, position: position! });
    expect(validateLayout(spec, cutouts, shapes)).toEqual([]);
  }
  expect(cutouts[0]).toMatchObject({ position: tool.cutout.position, rotationDeg });
});

it("avoids custom-footprint gaps and separate finger access without enlarging the bin", () => {
  const tool = createBasicPocket("rectangle", { x: -6, y: -6 }, { x: 6, y: 6 }, "tool")!;
  const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
  const shapes = new Map([[tool.shape.id, tool.shape]]);
  const source = { ...tool.cutout, position: { x: -21, y: -21 } };
  const finger = fingerHoleSchema.parse({ id: "finger", center: { x: -21, y: 0 }, diameterMm: 18 });
  const position = linkedPocketCopyPosition(spec, source, [source], shapes, [finger]);
  expect(position).not.toBeNull();
  expect(validateLayout(spec, [{ ...source, position: position! }], shapes)).toEqual([]);
  expect(Math.hypot(position!.x - finger.center.x, position!.y - finger.center.y)).toBeGreaterThan(18);
  expect(spec.gridX).toBe(2);
});

it("returns no guessed location for a full bin or unavailable outline", () => {
  const tool = createBasicPocket("rectangle", { x: -14, y: -14 }, { x: 14, y: 14 }, "tool")!;
  const spec = parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 6 });
  expect(linkedPocketCopyPosition(spec, tool.cutout, [tool.cutout], new Map([[tool.shape.id, tool.shape]]))).toBeNull();
  expect(linkedPocketCopyPosition(spec, tool.cutout, [tool.cutout], new Map())).toBeNull();
});

it.each([
  { name: "text", text: "M", rotationDeg: 0 },
  { name: "rotated text", text: "M4", rotationDeg: 45 },
  { name: "symbol", text: "", symbol: "hex-nut", rotationDeg: 90 },
])("keeps existing $name printable when placing a linked copy", async labelFields => {
  const tool = createBasicPocket("rectangle", { x: -5, y: -5 }, { x: 5, y: 5 }, "tool")!;
  const source = { ...tool.cutout, depth: { mode: "mm" as const, value: 10 } };
  const shapes = new Map([[tool.shape.id, tool.shape]]);
  // This valid label occupies the first position chosen without label obstacles.
  const { name: _name, ...content } = labelFields;
  const label = surfaceTextSchema.parse({ ...content, id: "label", font: "helvetiker", sizeMm: 4, position: { x: 0, y: 11.21 } });
  const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, surfaceTexts: [label] });
  const position = linkedPocketCopyPosition(spec, source, [source], shapes);
  expect(position).not.toBeNull();
  const cutouts = [source, { ...source, id: "copy", position: position! }];
  expect(validateLayout(spec, cutouts, shapes)).toEqual([]);
  await withKernel(kernel => {
    for (const placed of [[source], cutouts]) {
      const built = buildBinWithCutouts(kernel, spec, { cutouts: placed, shapesById: shapes, fingerHoles: [] }, EXPORT_QUALITY);
      expectAllSurfaceTextBuilt(built, 1);
      expect(built.validationIssues.filter(issue => issue.severity === "error")).toEqual([]);
    }
  });
  expect(spec.surfaceTexts).toEqual([label]);
  expect(source.position).toEqual({ x: 0, y: 0 });
});

it("uses the in-place fallback when an existing label cannot be resolved", () => {
  const tool = createBasicPocket("rectangle", { x: -5, y: -5 }, { x: 5, y: 5 }, "tool")!;
  const label = surfaceTextSchema.parse({ id: "unsupported", text: "🦆", font: "helvetiker", position: { x: 0, y: 15 } });
  const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, surfaceTexts: [label] });
  expect(linkedPocketCopyPosition(spec, tool.cutout, [tool.cutout], new Map([[tool.shape.id, tool.shape]]))).toBeNull();
});
