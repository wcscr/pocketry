import { describe, expect, it } from "vitest";
import { signedArea } from "../geometry/rings";
import type { Outline } from "../geometry/types";
import { parseCutoutPlacement, type TracedShape } from "./cutout";
import { nearestPocketEdge, resolvePocketSplit } from "./pocket-split";
import { parseBinSpec } from "./types";
import { validateLayout } from "./validate";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "./project";

const outline: Outline = [{ outer: [{ x: -30, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 10 }, { x: -30, y: 10 }], holes: [] }];
const boundary = [{ x: 0, y: -10 }, { x: 0, y: 10 }];
const shape: TracedShape = { id: "tool", name: "Tool", outlineMm: outline,
  bboxMm: { minX: -30, minY: -10, maxX: 30, maxY: 10 }, pointCount: 4, sourceMmPerPx: 1 };
const spec = parseBinSpec({ gridX: 3, gridY: 2, heightUnits: 5, flatBottom: true });
const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 },
  split: { boundary, depths: [{ mode: "mm", value: 6 }, { mode: "remaining", floorThicknessMm: 2 }] } });

describe("pocket split", () => {
  it("partitions a single perimeter with positive winding and no lost area", () => {
    const split = resolvePocketSplit(outline, boundary);
    expect(split.error).toBeUndefined();
    expect(split.regions!.map(region => signedArea(region[0].outer))).toEqual([600, 600]);
    const diagonal = resolvePocketSplit(outline, [outline[0].outer[0], outline[0].outer[2]]);
    expect(diagonal.regions!.map(region => signedArea(region[0].outer))).toEqual([600, 600]);
  });

  it("snaps to edges and preserves holes on their side", () => {
    expect(nearestPocketEdge(outline, { x: 4, y: 10.2 })).toEqual({ x: 4, y: 10 });
    const hole = [{ x: -20, y: -2 }, { x: -20, y: 2 }, { x: -15, y: 2 }, { x: -15, y: -2 }];
    const holed = [{ ...outline[0], holes: [hole] }];
    const result = resolvePocketSplit(holed, boundary);
    expect(result.regions![0][0].holes).toEqual([hole]);
    expect(result.regions![1][0].holes).toEqual([]);
    expect(resolvePocketSplit(holed, [{ x: -18, y: -10 }, { x: -18, y: 10 }]).error).toContain("interior hole");
  });

  it("rejects degenerate, stale, multipart, sliver, and unsupported boundaries", () => {
    expect(resolvePocketSplit(outline, [boundary[0], boundary[0]]).error).toBeTruthy();
    expect(resolvePocketSplit(outline, [{ x: 0, y: -9 }, boundary[1]]).error).toContain("endpoints");
    expect(resolvePocketSplit(outline, [outline[0].outer[0], outline[0].outer[1]]).error).toContain("along its edge");
    expect(resolvePocketSplit(outline, [{ x: 29.999, y: -10 }, { x: 29.999, y: 10 }]).error).toContain("usable");
    expect(resolvePocketSplit([...outline, ...outline], boundary).error).toContain("connected");
    expect(resolvePocketSplit(outline, [...boundary, { x: 0, y: 0 }]).error).toContain("straight");
    const concave: Outline = [{ outer: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 20, y: 30 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 }], holes: [] }];
    expect(resolvePocketSplit(concave, [{ x: 0, y: 20 }, { x: 30, y: 20 }]).error).toContain("connected sections");
  });

  it("validates each active depth without treating the internal step as overlap", () => {
    const validate = (c = cutout) => validateLayout(spec, [c], new Map([[shape.id, shape]]));
    expect(validate()).toEqual([]);
    const bad = { ...cutout, split: { ...cutout.split!, depths: [{ mode: "mm" as const, value: 100 }, cutout.split!.depths[1]] as const } };
    const issues = validate({ ...bad, split: { ...bad.split, depths: [...bad.split.depths] } });
    expect(issues).toContainEqual(expect.objectContaining({ code: "too-deep", severity: "error", message: expect.stringContaining("Section A") }));
    expect(validate({ ...cutout, depth: { mode: "mm", value: 100 } })).toEqual([]);
    expect(validate({ ...cutout, split: { ...cutout.split!, boundary: [{ x: 0, y: -9 }, boundary[1]] } })).toContainEqual(expect.objectContaining({ code: "invalid-pocket-split" }));
  });

  it("round-trips the split and migrates old pockets without adding one", () => {
    const doc = { schemaVersion: PROJECT_SCHEMA_VERSION, spec, shapes: [shape], cutouts: [cutout], fingerHoles: [] };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))?.cutouts[0]).toEqual(cutout);
    const old = { ...doc, schemaVersion: 15, cutouts: [{ ...cutout, split: undefined }] };
    const migrated = parseProjectDoc(old)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.cutouts[0].split).toBeUndefined();
    expect(migrated.cutouts[0].depth).toEqual(cutout.depth);
    const malformed = { ...doc, cutouts: [{ ...cutout, split: { ...cutout.split, depths: [{ mode: "mm", value: 6 }] } }] };
    expect(parseProjectDoc(malformed)).toBeNull();
  });
});
