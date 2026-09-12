import { describe, expect, it } from "vitest";
import { signedArea } from "../geometry/rings";
import type { Outline } from "../geometry/types";
import { parseCutoutPlacement, type TracedShape } from "./cutout";
import { nearestPocketEdge, orientRedrawnPocketSplit, resolvePocketSplit } from "./pocket-split";
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
  it("reattaches endpoints after contour edits while preserving the authored split line", () => {
    const edited = [{ ...outline[0], outer: outline[0].outer.map((p, i) => i === 2 ? { ...p, y: 14 } : p) }];
    const saved = structuredClone(boundary);
    const resolved = resolvePocketSplit(edited, boundary);
    expect(resolved.error).toBeUndefined();
    expect(resolved.boundary).toEqual([{ x: 0, y: -10 }, { x: 0, y: 12 }]);
    expect(resolvePocketSplit(edited, [...boundary].reverse()).boundary).toEqual([...resolved.boundary!].reverse());
    expect(boundary).toEqual(saved);
    // The finite authored segment can be completely outside the revised ring;
    // it still defines the same dividing line through the two new edge points.
    const shifted = [{ ...edited[0], outer: edited[0].outer.map(p => ({ ...p, y: p.y + 100 })) }];
    expect(resolvePocketSplit(shifted, boundary).boundary).toEqual([{ x: 0, y: 90 }, { x: 0, y: 112 }]);
  });

  it("keeps section regions identical for either redraw direction, including moved and angled lines", () => {
    for (const redrawn of [boundary, [{ x: 5, y: -10 }, { x: 5, y: 10 }],
      [{ x: -3, y: -10 }, { x: 8, y: 10 }], [{ x: -30, y: 0 }, { x: 30, y: 0 }]]) {
      const reversed = [...redrawn].reverse();
      const before = structuredClone(reversed);
      const forward = orientRedrawnPocketSplit(redrawn, boundary);
      const backward = orientRedrawnPocketSplit(reversed, boundary);
      expect(backward).toEqual(forward);
      expect(resolvePocketSplit(outline, backward).regions).toEqual(resolvePocketSplit(outline, forward).regions);
      expect(reversed).toEqual(before);
    }
    // A previous direction authored in reverse must be respected as well.
    expect(orientRedrawnPocketSplit(boundary, [...boundary].reverse())).toEqual([...boundary].reverse());
  });

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

  it("rejects degenerate, missing, multipart, sliver, and unsupported boundaries", () => {
    expect(resolvePocketSplit(outline, [boundary[0], boundary[0]]).error).toBeTruthy();
    expect(resolvePocketSplit(outline, [{ x: 40, y: -10 }, { x: 40, y: 10 }]).error).toContain("connected sections");
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
    expect(validate({ ...cutout, split: { ...cutout.split!, boundary: [{ x: 0, y: -9 }, boundary[1]] } })).toEqual([]);
    expect(validate({ ...cutout, split: { ...cutout.split!, boundary: [{ x: 40, y: -10 }, { x: 40, y: 10 }] } })).toContainEqual(expect.objectContaining({ code: "invalid-pocket-split" }));
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
