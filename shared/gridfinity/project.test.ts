import { describe, expect, it } from "vitest";

import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "./project";
import { parseBinSpec } from "./types";

const VALID = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  shapes: [
    {
      id: "s1",
      name: "tool",
      outlineMm: [
        {
          outer: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 10 },
          ],
          holes: [],
        },
      ],
      bboxMm: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      pointCount: 3,
      sourceMmPerPx: 0.5,
    },
  ],
  spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }),
  cutouts: [
    {
      id: "c1",
      shapeId: "s1",
      position: { x: 0, y: 0 },
      rotationDeg: 0,
      mirrored: false,
      depth: { mode: "remaining", floorThicknessMm: 7 },
      clearanceMm: 0,
      cornerRoundMm: 1,
      topFilletMm: 0,
      bottomFilletMm: 2.8,
    },
  ],
};

describe("parseProjectDoc", () => {
  it("round-trips a valid document", () => {
    const doc = parseProjectDoc(VALID);
    expect(doc).not.toBeNull();
    expect(doc!.shapes).toHaveLength(1);
    expect(doc!.cutouts[0].shapeId).toBe("s1");
  });

  it("returns null rather than throwing on garbage", () => {
    expect(parseProjectDoc(undefined)).toBeNull();
    expect(parseProjectDoc({ schemaVersion: 3, shapes: [], spec: {}, cutouts: [] })).toBeNull();
    expect(parseProjectDoc({ ...VALID, extra: true })).toBeNull();
    expect(
      parseProjectDoc({ ...VALID, cutouts: [{ id: "broken" }] }),
    ).toBeNull();
  });
});

describe("project file round trip", () => {
  it("preserves straight, round-scoop and deep-scoop finger holes through JSON", () => {
    const withFeatures = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    (withFeatures.cutouts as Record<string, unknown>[])[0] = {
      ...(withFeatures.cutouts as Record<string, unknown>[])[0],
      fingerHoles: [
        {
          id: "f1",
          kind: "straight",
          center: { x: 4, y: 1 },
          diameterMm: 20,
          depthMm: 12,
        },
        {
          id: "f2",
          kind: "scoop",
          center: { x: -4, y: 0 },
          diameterMm: 28,
          depthMm: 10,
        },
        {
          id: "f3",
          kind: "deep-scoop",
          center: { x: 12, y: 0 },
          diameterMm: 16,
          depthMm: 38,
        },
      ],
    };
    // The exact path the Save file / Open file buttons take.
    const doc = parseProjectDoc(JSON.parse(JSON.stringify(withFeatures)));
    expect(doc).not.toBeNull();
    expect(doc!.cutouts[0].fingerHoles).toHaveLength(3);
    expect(doc!.cutouts[0].fingerHoles[1]).toMatchObject({
      id: "f2",
      kind: "scoop",
      depthMm: 10,
    });
    expect(doc!.cutouts[0].fingerHoles[2]).toMatchObject({
      id: "f3",
      kind: "deep-scoop",
      depthMm: 38,
    });
  });

  it("migrates a schema-v1 scoop into a typed finger hole", () => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = 1;
    (legacy.cutouts as Record<string, unknown>[])[0] = {
      ...(legacy.cutouts as Record<string, unknown>[])[0],
      fingerHoles: [{ id: "f1", center: { x: 4, y: 1 }, diameterMm: 20 }],
      scoop: { center: { x: -4, y: 0 }, diameterMm: 28, depthMm: 10 },
    };
    const doc = parseProjectDoc(legacy);
    expect(doc?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc?.cutouts[0].fingerHoles.map((hole) => hole.kind)).toEqual([
      "straight",
      "scoop",
    ]);
    expect(doc?.cutouts[0].fingerHoles[1].id).toBe("legacy-scoop");
  });

  it("migrates schema v2 with the safe sharp top-edge default", () => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = 2;
    delete (legacy.cutouts as Record<string, unknown>[])[0].topFilletMm;

    const doc = parseProjectDoc(legacy);
    expect(doc?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc?.cutouts[0].topFilletMm).toBe(0);
  });

  it("still accepts a featureless schema-v1 document", () => {
    const doc = parseProjectDoc({ ...VALID, schemaVersion: 1 });
    expect(doc!.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc!.cutouts[0].fingerHoles).toEqual([]);
  });

  it("migrates schema v3 projects to a rectangular footprint", () => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = 3;
    delete ((legacy.spec as Record<string, unknown>).footprint);
    const doc = parseProjectDoc(legacy);
    expect(doc?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc?.spec.footprint).toEqual({ kind: "rectangle" });
  });

  it("migrates schema v4 finger holes without changing their geometry", () => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = 4;
    (legacy.cutouts as Record<string, unknown>[])[0] = {
      ...(legacy.cutouts as Record<string, unknown>[])[0],
      fingerHoles: [
        {
          id: "f1",
          kind: "scoop",
          center: { x: 4, y: 0 },
          diameterMm: 18,
          depthMm: 8,
        },
      ],
    };
    const doc = parseProjectDoc(legacy);
    expect(doc?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc?.cutouts[0].fingerHoles[0]).toMatchObject({
      kind: "scoop",
      diameterMm: 18,
      depthMm: 8,
    });
  });

  it("normalizes the prototype oblong scoop into a vertical deep scoop", () => {
    const prototype = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    (prototype.cutouts as Record<string, unknown>[])[0] = {
      ...(prototype.cutouts as Record<string, unknown>[])[0],
      fingerHoles: [
        {
          id: "prototype",
          kind: "oblong-scoop",
          center: { x: 4, y: 0 },
          diameterMm: 18,
          depthMm: 24,
          reachMm: 30,
          directionDeg: 180,
        },
      ],
    };
    const doc = parseProjectDoc(prototype);
    expect(doc?.cutouts[0].fingerHoles[0]).toEqual({
      id: "prototype",
      kind: "deep-scoop",
      center: { x: 4, y: 0 },
      diameterMm: 18,
      depthMm: 24,
    });
  });
});
