import { arena, kernel } from "./pocket-insertion.test-support";
import { expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import { strFromU8, unzipSync } from "fflate";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBinSpec } from "@shared/gridfinity/types";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { createBasicPocket } from "./basic-shape";
import { createPlacementGroup, transformObjects } from "./object-arrangement";
import { buildBinWithCutouts, EXPORT_QUALITY } from "./bin";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeThreeMf } from "@/lib/mesh/threemf";

it("exports grouped and ungrouped poses identically and produces a closed 3MF after compound rotation", () => {
  const spec = parseBinSpec({ gridX: 4, gridY: 3, heightUnits: 6, fill: "solid", lip: "none" });
  const basic = createBasicPocket("rectangle", { x: -6, y: -9 }, { x: 6, y: 9 }, "group-tool")!;
  const cutouts = [-25, 0, 40].map((x, i) => ({ ...basic.cutout, id: `member-${i}`, name: i === 2 ? "Linked copy outside group" : `Grouped pocket ${i + 1}`,
    position: { x, y: 0 }, elevationMm: 27, rotationDeg: i === 1 ? 20 : 0, depth: { mode: "mm" as const, value: 12 },
    insertionMode: "vertical" as const, ...(i !== 1 ? { designLink: { id: "geometry", tilt: false } } : {}) }));
  const objects = cutouts.slice(0, 2).map(cutout => ({ kind: "pocket" as const, cutout, shape: basic.shape }));
  const frame = createPlacementGroup(objects, spec, "placement");
  const grouped = objects.map(o => ({ ...o, cutout: { ...o.cutout, placementGroup: frame } }));
  const moved = transformObjects(grouped, spec, new Vector3(0, 0, 2), new Quaternion().setFromEuler(new Euler(.15, -.12, .6)))!;
  expect(moved).not.toBeNull();
  const placed = [...moved.cutouts, cutouts[2]], shapes = [basic.shape];
  const project = parseProjectDoc({ schemaVersion: PROJECT_SCHEMA_VERSION, name: "Group rotation prototype", spec, shapes, cutouts: placed, fingerHoles: [] })!;
  expect(project).not.toBeNull();
  const build = (cutouts: typeof placed) => buildBinWithCutouts(kernel, spec, { shapesById: new Map([[basic.shape.id, basic.shape]]), cutouts, fingerHoles: [] }, EXPORT_QUALITY);
  const groupedBin = build(placed), ungroupedBin = build(placed.map(c => ({ ...c, placementGroup: undefined })));
  expect(groupedBin.validationIssues.filter(i => i.severity === "error")).toEqual([]);
  expect(groupedBin.solid.status()).toBe("NoError");
  expect(arena.track(groupedBin.solid.subtract(ungroupedBin.solid)).volume()).toBeLessThan(1e-6);
  expect(arena.track(ungroupedBin.solid.subtract(groupedBin.solid)).volume()).toBeLessThan(1e-6);
  const bytes = writeThreeMf([{ name: "Grouped pockets", mesh: extractPrintableMeshData(kernel, groupedBin.solid) }]);
  expect(bytes).toEqual(writeThreeMf([{ name: "Grouped pockets", mesh: extractPrintableMeshData(kernel, ungroupedBin.solid) }]));
  const xml = strFromU8(unzipSync(bytes)["3D/3dmodel.model"]);
  const vertices = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map(m => new Vector3(...m.slice(1).map(Number)));
  const edges = new Map<string, { count: number; winding: number }>();
  let volume = 0;
  for (const triangle of xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)) {
    const [a, b, c] = triangle.slice(1).map(Number);
    expect(vertices[a].clone().sub(vertices[b]).cross(vertices[c].clone().sub(vertices[b])).lengthSq()).toBeGreaterThan(0);
    volume += vertices[a].dot(vertices[b].clone().cross(vertices[c])) / 6;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const key = `${Math.min(x, y)}:${Math.max(x, y)}`, old = edges.get(key) ?? { count: 0, winding: 0 };
      edges.set(key, { count: old.count + 1, winding: old.winding + (x < y ? 1 : -1) });
    }
  }
  expect(vertices.length).toBeGreaterThan(0);
  expect([...edges.values()].every(e => e.count === 2 && e.winding === 0)).toBe(true);
  expect(volume / groupedBin.solid.volume()).toBeCloseTo(1, 5);
  // Optional local review artifacts use the exact project and serialized mesh tested above.
  const output = process.env.POCKETRY_GROUP_ARTIFACT_DIR;
  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "group-rotation.pocketry.json"), JSON.stringify(project, null, 2));
    writeFileSync(join(output, "group-rotation.3mf"), bytes);
  }
}, 30_000);
