import { describe, expect, it } from "vitest";

import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "./project";
import { parseBinSpec } from "./types";
import airdusterV9 from "./fixtures/airduster-v9.pocketry.json";

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
  fingerHoles: [],
};

describe("parseProjectDoc", () => {
  it("defaults v24 grip recesses off and preserves an enabled recess through saved history", () => {
    const { lidGripRecess: _recess, ...oldSpec } = VALID.spec;
    const previous = { ...VALID, schemaVersion: 24, spec: oldSpec,
      history: { index: 0, stack: [{ label: "Loaded", doc: { spec: oldSpec, cutouts: VALID.cutouts, fingerHoles: [] } }] } };
    const original = JSON.stringify(previous);
    const migrated = parseProjectDoc(previous)!;
    expect(migrated.spec.lidGripRecess).toBe(false);
    expect(migrated.history!.stack[0].doc.spec.lidGripRecess).toBe(false);
    expect(JSON.stringify(previous)).toBe(original);
    const spec = { ...migrated.spec, lidGripRecess: true };
    const enabled = { ...migrated, spec, history: { index: 1, stack: [...migrated.history!.stack,
      { label: "Grip recess", doc: { spec, cutouts: migrated.cutouts, fingerHoles: [] } }] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(enabled)))).toEqual(enabled);
    expect(parseProjectDoc({ ...enabled, history: undefined, spec: { ...spec, lidGripRecess: "true" } })).toBeNull();
  });

  it("migrates v23 rib spacing and retains tuning throughout saved undo history", () => {
    const { lidRibSpacingMm: _spacing, ...oldSpec } = VALID.spec;
    const previous = { ...VALID, schemaVersion: 23, spec: oldSpec,
      history: { index: 0, stack: [{ label: "Loaded", doc: { spec: oldSpec, cutouts: VALID.cutouts, fingerHoles: [] } }] } };
    const original = JSON.stringify(previous);
    const migrated = parseProjectDoc(previous)!;
    expect(migrated.spec.lidRibSpacingMm).toBe(24);
    expect(migrated.history!.stack[0].doc.spec.lidRibSpacingMm).toBe(24);
    expect(JSON.stringify(previous)).toBe(original);
    const tuned = { ...migrated, spec: { ...migrated.spec, lidRibSpacingMm: 12 },
      history: { index: 1, stack: [...migrated.history!.stack, { label: "Rib spacing", doc: {
        ...migrated.history!.stack[0].doc, spec: { ...migrated.spec, lidRibSpacingMm: 12 } } }] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(tuned)))).toEqual(tuned);
  });

  it("migrates v22 designs and history to contact ribs without mutating the source", () => {
    const { lidInterface: _interface, ...oldSpec } = VALID.spec;
    const previous = { ...VALID, schemaVersion: 22, spec: oldSpec,
      history: { index: 0, stack: [{ label: "Loaded", doc: { spec: oldSpec, cutouts: VALID.cutouts, fingerHoles: [] } }] } };
    const original = JSON.stringify(previous);
    const migrated = parseProjectDoc(previous)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.spec.lidInterface).toBe("ribs");
    expect(migrated.history!.stack[0].doc.spec.lidInterface).toBe("ribs");
    expect(JSON.stringify(previous)).toBe(original);
    for (const lidInterface of ["ribs", "side-springs", "angled-fins", "spring-latch"] as const) {
      const doc = { ...migrated, spec: { ...migrated.spec, lidInterface },
        history: { index: 0, stack: [{ label: "Change interface", doc: { ...migrated.history!.stack[0].doc,
          spec: { ...migrated.spec, lidInterface } } }] } };
      expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    }
    expect(parseProjectDoc({ ...migrated, spec: { ...migrated.spec, lidInterface: "unknown" } })).toBeNull();
  });

  it("preserves old overlapping wall thickness in the design and every history step", () => {
    const { lidWallThicknessMm: _wall, wallThicknessMm: _shared, ...oldSpec } = VALID.spec;
    const inset = { ...oldSpec, magneticLid: true, magneticLidStyle: "inset" };
    const overlap = { ...inset, magneticLidStyle: "overlap" };
    const previous = { ...VALID, schemaVersion: 19, spec: overlap,
      history: { index: 1, stack: [inset, overlap].map(spec => ({ label: "Change lid", doc: { spec, cutouts: VALID.cutouts, fingerHoles: [] } })) } };
    const original = JSON.stringify(previous);
    const migrated = parseProjectDoc(previous)!;
    expect(migrated.spec.lidWallThicknessMm).toBe(0.8);
    expect(migrated.history!.stack.map(entry => entry.doc.spec.lidWallThicknessMm)).toEqual([undefined, 0.8]);
    expect(migrated.spec.wallThicknessMm).toBe(0.95);
    expect(migrated.history!.stack.every(entry => entry.doc.spec.wallThicknessMm === 0.95)).toBe(true);
    expect(JSON.stringify(previous)).toBe(original);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it("preserves a saved lid-only thickness before the shared control was introduced", () => {
    const { wallThicknessMm: _wall, ...oldSpec } = VALID.spec;
    const previous = { ...VALID, schemaVersion: 20, spec: { ...oldSpec, magneticLid: true,
      magneticLidStyle: "overlap", lidWallThicknessMm: 1.6 } };
    const migrated = parseProjectDoc(previous)!;
    expect(migrated.spec).toMatchObject({ wallThicknessMm: 0.95, lidWallThicknessMm: 1.6 });
    expect(parseProjectDoc(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it("rejects malformed legacy wall values and fractional schema versions", () => {
    expect(parseProjectDoc({ ...VALID, schemaVersion: 19, spec: { ...VALID.spec, wallThicknessMm: null } })).toBeNull();
    expect(parseProjectDoc({ ...VALID, schemaVersion: 19.5 })).toBeNull();
  });

  it("defaults new shared walls to 1.2 mm and round-trips custom thickness", () => {
    expect(VALID.spec.wallThicknessMm).toBe(1.2);
    const thick = { ...VALID, spec: { ...VALID.spec, magneticLid: true, magneticLidStyle: "overlap", wallThicknessMm: 4 } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(thick)))?.spec.wallThicknessMm).toBe(4);
    for (const wallThicknessMm of [0.6, 4.2, Infinity, NaN]) {
      expect(parseProjectDoc({ ...thick, spec: { ...thick.spec, wallThicknessMm } })).toBeNull();
    }
  });

  it("migrates v17 lid defaults in the visible design and undo history without changing the source", () => {
    const { magneticLid: _removed, magneticLidStyle: _style, ...oldSpec } = VALID.spec;
    const previous = { ...VALID, schemaVersion: 17, spec: oldSpec,
      history: { index: 0, stack: [{ label: "Loaded", doc: { spec: oldSpec, cutouts: VALID.cutouts, fingerHoles: [] } }] } };
    const original = JSON.stringify(previous);
    const migrated = parseProjectDoc(previous);
    expect(migrated?.spec.magneticLid).toBe(false);
    expect(migrated?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated?.history?.stack[0].doc.spec.magneticLid).toBe(false);
    expect(JSON.stringify(previous)).toBe(original);
    const enabled = parseProjectDoc({ ...migrated, history: undefined, spec: { ...migrated!.spec, magneticLid: true } });
    expect(enabled?.spec.magneticLid).toBe(true);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(enabled)))).toEqual(enabled);
  });
  it("preserves finger access names through save and reload alongside unnamed legacy holes", () => {
    const doc = parseProjectDoc({
      ...VALID,
      fingerHoles: [
        { id: "named", name: "Thumb access", center: { x: 0, y: 0 } },
        { id: "legacy", center: { x: 15, y: 0 } },
      ],
    });
    expect(doc?.fingerHoles[0].name).toBe("Thumb access");
    expect(doc?.fingerHoles[1].name).toBeUndefined();
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });


  it("round-trips a 3 by 5 standard-cell bin at quarter pitch", () => {
    const doc = parseProjectDoc({ ...VALID, spec: { ...VALID.spec, gridX: 12, gridY: 20, gridPitch: "quarter" } });
    expect(doc?.spec).toMatchObject({ gridX: 12, gridY: 20, gridPitch: "quarter" });
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("migrates the complete New Airduster Layout without changing any saved geometry or settings", () => {
    const original = JSON.stringify(airdusterV9);
    const doc = parseProjectDoc(airdusterV9);
    const { liteBase: _removed, ...spec } = airdusterV9.spec;
    expect(doc).toEqual({ ...airdusterV9, spec: { ...spec, flatBottom: false, magneticLid: false, magneticLidStyle: "inset", magneticLidTop: "flat", lidGripRecess: false, lidMagnetHoles: true, lidMagnetCrushRibs: false, lidFit: "lift-off", lidInterface: "ribs", lidRibSpacingMm: 24, lidFitAdjustmentMm: 0, wallThicknessMm: 0.95, magnetDiameterMm: 6, magnetThicknessMm: 2 }, schemaVersion: PROJECT_SCHEMA_VERSION });
    expect(doc!.shapes).toHaveLength(7);
    expect(doc!.cutouts).toHaveLength(4);
    expect(doc!.fingerHoles).toHaveLength(2);
    const named = { ...doc!, name: "New Airduster Layout", keepBinSize: true };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(named)))).toEqual(named);
    expect(JSON.stringify(airdusterV9)).toBe(original);
    expect(doc!.shapes.every((shape) => shape.traceMarginMm === undefined)).toBe(true);
  });

  it("preserves new metadata through repeated round trips", () => {
    const doc = parseProjectDoc({ ...VALID, name: "Workshop tools", keepBinSize: true,
      shapes: VALID.shapes.map((shape) => ({ ...shape, traceMarginMm: 0.5 })) });
    expect(doc).not.toBeNull();
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(doc!.shapes[0].traceMarginMm).toBe(0.5);
  });
  it("round-trips negative pocket clearance without changing the saved trace", () => {
    const doc = parseProjectDoc({ ...VALID, cutouts: [{ ...VALID.cutouts[0], clearanceMm: -0.7 }] });
    expect(doc?.cutouts[0].clearanceMm).toBe(-0.7);
    expect(doc?.shapes[0].outlineMm).toEqual(VALID.shapes[0].outlineMm);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("round-trips a valid document", () => {
    const doc = parseProjectDoc(VALID);
    expect(doc).not.toBeNull();
    expect(doc!.shapes).toHaveLength(1);
    expect(doc!.cutouts[0].shapeId).toBe("s1");
    expect(doc!.cutouts[0]).toMatchObject({
      scaleX: 1,
      scaleY: 1,
      aspectRatioLocked: true,
    });
  });

  it("migrates schema v7 placements with identity scale", () => {
    const previous = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    previous.schemaVersion = 7;
    const doc = parseProjectDoc(previous);
    expect(doc?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc?.cutouts[0]).toMatchObject({
      scaleX: 1,
      scaleY: 1,
      aspectRatioLocked: true,
    });
  });

  it("migrates schema v8 finger holes with sharp edge defaults", () => {
    const previous = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    previous.schemaVersion = 8;
    previous.fingerHoles = [
      {
        id: "f1",
        kind: "straight",
        center: { x: 4, y: 1 },
        diameterMm: 20,
        depthMm: 12,
      },
    ];

    const doc = parseProjectDoc(previous);
    expect(doc?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc?.fingerHoles[0]).toMatchObject({
      topFilletMm: 0,
      bottomFilletMm: 0,
    });
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
  it("preserves round and oblong deep-scoop finger holes through JSON", () => {
    const withFeatures = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    withFeatures.fingerHoles = [
        {
          id: "f1",
          kind: "straight",
          center: { x: 4, y: 1 },
          diameterMm: 20,
          depthMm: 12,
          topFilletMm: 1.2,
          bottomFilletMm: 2.4,
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
        {
          id: "f4",
          kind: "oblong-deep-scoop",
          center: { x: 0, y: 12 },
          diameterMm: 12,
          depthMm: 32,
          lengthMm: 48,
          rotationDeg: 35,
        },
      ];
    // The exact path the Save file / Open file buttons take.
    const doc = parseProjectDoc(JSON.parse(JSON.stringify(withFeatures)));
    expect(doc).not.toBeNull();
    expect(doc!.cutouts[0].fingerHoles).toEqual([]);
    expect(doc!.fingerHoles).toHaveLength(4);
    expect(doc!.fingerHoles[0]).toMatchObject({
      topFilletMm: 1.2,
      bottomFilletMm: 2.4,
    });
    expect(doc!.fingerHoles[1]).toMatchObject({
      id: "f2",
      kind: "scoop",
      depthMm: 10,
    });
    expect(doc!.fingerHoles[2]).toMatchObject({
      id: "f3",
      kind: "deep-scoop",
      depthMm: 38,
    });
    expect(doc!.fingerHoles[3]).toMatchObject({
      id: "f4",
      kind: "oblong-deep-scoop",
      lengthMm: 48,
      rotationDeg: 35,
    });
  });

  it("migrates a schema-v1 scoop into a typed finger hole", () => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = 1;
    delete legacy.fingerHoles;
    (legacy.cutouts as Record<string, unknown>[])[0] = {
      ...(legacy.cutouts as Record<string, unknown>[])[0],
      fingerHoles: [{ id: "f1", center: { x: 4, y: 1 }, diameterMm: 20 }],
      scoop: { center: { x: -4, y: 0 }, diameterMm: 28, depthMm: 10 },
    };
    const doc = parseProjectDoc(legacy);
    expect(doc?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc?.cutouts[0].fingerHoles).toEqual([]);
    expect(doc?.fingerHoles.map((hole) => hole.kind)).toEqual([
      "straight",
      "scoop",
    ]);
    expect(doc?.fingerHoles[1].id).toBe("legacy-scoop");
  });

  it("migrates schema v2 with the safe sharp top-edge default", () => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = 2;
    delete legacy.fingerHoles;
    delete (legacy.cutouts as Record<string, unknown>[])[0].topFilletMm;

    const doc = parseProjectDoc(legacy);
    expect(doc?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc?.cutouts[0].topFilletMm).toBe(0);
  });

  it("still accepts a featureless schema-v1 document", () => {
    const { fingerHoles: _currentHoles, ...legacy } = VALID;
    const doc = parseProjectDoc({ ...legacy, schemaVersion: 1 });
    expect(doc!.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc!.cutouts[0].fingerHoles).toEqual([]);
    expect(doc!.fingerHoles).toEqual([]);
  });

  it("migrates schema v3 projects to a rectangular footprint", () => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = 3;
    delete legacy.fingerHoles;
    delete ((legacy.spec as Record<string, unknown>).footprint);
    const doc = parseProjectDoc(legacy);
    expect(doc?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc?.spec.footprint).toEqual({ kind: "rectangle" });
  });

  it("migrates schema v4 finger holes without changing their geometry", () => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = 4;
    delete legacy.fingerHoles;
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
    expect(doc?.cutouts[0].fingerHoles).toEqual([]);
    expect(doc?.fingerHoles[0]).toMatchObject({
      kind: "scoop",
      diameterMm: 18,
      depthMm: 8,
    });
  });

  it("normalizes the prototype oblong scoop into a vertical deep scoop", () => {
    const prototype = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    prototype.schemaVersion = 4;
    delete prototype.fingerHoles;
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
    expect(doc?.fingerHoles[0]).toEqual({
      id: "prototype",
      kind: "deep-scoop",
      center: { x: 4, y: 0 },
      diameterMm: 18,
      depthMm: 24,
      topFilletMm: 0,
      bottomFilletMm: 0,
      rotationDeg: undefined,
    });
  });

  it("migrates schema v5 projects before saving oblong deep scoops", () => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = 5;
    delete legacy.fingerHoles;
    const doc = parseProjectDoc(legacy);
    expect(doc?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(doc?.cutouts).toHaveLength(1);
  });

  it("migrates v6 pocket-local holes into fixed bin-local positions", () => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = 6;
    delete legacy.fingerHoles;
    (legacy.cutouts as Record<string, unknown>[])[0] = {
      ...(legacy.cutouts as Record<string, unknown>[])[0],
      position: { x: 10, y: 20 },
      rotationDeg: 90,
      fingerHoles: [
        {
          id: "migrated",
          kind: "oblong-deep-scoop",
          center: { x: 4, y: 1 },
          diameterMm: 10,
          depthMm: 25,
          lengthMm: 30,
          rotationDeg: 0,
        },
      ],
    };
    const doc = parseProjectDoc(legacy);
    expect(doc?.cutouts[0].fingerHoles).toEqual([]);
    expect(doc?.fingerHoles[0].center.x).toBeCloseTo(9, 9);
    expect(doc?.fingerHoles[0].center.y).toBeCloseTo(24, 9);
    expect(doc?.fingerHoles[0].rotationDeg).toBeCloseTo(90, 9);
  });
});


describe("removed Lite Base migration", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("migrates v%s with the removed flag", (schemaVersion) => {
    const legacy = JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;
    legacy.schemaVersion = schemaVersion;
    if (schemaVersion < 7) delete legacy.fingerHoles;
    (legacy.spec as Record<string, unknown>).liteBase = true;
    const migrated = parseProjectDoc(legacy);
    expect(migrated?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated?.spec).not.toHaveProperty("liteBase");
  });

  it.each([true, false])("migrates v10 liteBase=%s while preserving the project", (liteBase) => {
    const current = parseProjectDoc(VALID)!;
    const legacy = { ...current, schemaVersion: 10, name: "My tools", keepBinSize: true,
      spec: { ...current.spec, liteBase } };
    expect(parseProjectDoc(legacy)).toEqual({ ...current, name: "My tools", keepBinSize: true });
    expect(legacy.spec.liteBase).toBe(liteBase);
  });

  it("rejects malformed legacy flags and removed fields in current documents", () => {
    const current = parseProjectDoc(VALID)!;
    expect(parseProjectDoc({ ...current, schemaVersion: 10, spec: { ...current.spec, liteBase: "yes" } })).toBeNull();
    expect(parseProjectDoc({ ...current, spec: { ...current.spec, liteBase: true } })).toBeNull();
  });
});


describe("flat bottom projects", () => {
  it("defaults existing v11 documents to Gridfinity and preserves flat projects on reload", () => {
    const legacy = JSON.parse(JSON.stringify(VALID));
    legacy.schemaVersion = 11;
    delete legacy.spec.flatBottom;
    expect(parseProjectDoc(legacy)?.spec.flatBottom).toBe(false);
    const flat = parseProjectDoc({ ...VALID, spec: { ...VALID.spec, flatBottom: true } });
    expect(flat?.spec.flatBottom).toBe(true);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(flat)))).toEqual(flat);
  });
});


it("round-trips flat-ended scoops and migrates v12 without changing existing geometry", () => {
  const old = parseProjectDoc({ ...VALID, schemaVersion: 12, spec: { ...VALID.spec, flatBottom: true } });
  expect(old).not.toBeNull();
  expect(old!.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  expect(old!.spec.flatBottom).toBe(true);
  const doc = parseProjectDoc({ ...old!, fingerHoles: [{
    id: "flat", kind: "flat-ended-scoop", center: { x: 10, y: -5 },
    diameterMm: 16, lengthMm: 55, depthMm: 2, rotationDeg: 35,
    topFilletMm: 1, bottomFilletMm: 0,
  }] });
  expect(doc!.fingerHoles[0]).toMatchObject({ kind: "flat-ended-scoop", lengthMm: 55, rotationDeg: 35 });
  expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  expect(doc!.cutouts).toEqual(old!.cutouts);
  expect(parseProjectDoc({ ...doc!, schemaVersion: PROJECT_SCHEMA_VERSION + 1 })).toBeNull();
});

it("migrates v13 without rewriting finger-access geometry and persists new slot choices", () => {
  const previous = parseProjectDoc({ ...VALID, fingerHoles: [
    { id: "legacy", kind: "scoop", center: { x: 0, y: 0 }, diameterMm: 18, depthMm: 30 },
    { id: "flat", kind: "flat-ended-scoop", center: { x: 10, y: 5 }, diameterMm: 24, lengthMm: 6, depthMm: 1, rotationDeg: 37 },
  ] })!;
  expect(parseProjectDoc({ ...previous, schemaVersion: 13 })).toEqual(previous);
  const current = parseProjectDoc({ ...previous, fingerHoles: [
    { ...previous.fingerHoles[1], kind: "flat-ended-straight", bottomFilletMm: 2 },
    { ...previous.fingerHoles[1], id: "rounded", kind: "oblong-straight", lengthMm: 40 },
    { ...previous.fingerHoles[1], id: "round", kind: "straight", slotEnds: "flat" },
  ] });
  expect(current).not.toBeNull();
  expect(parseProjectDoc(JSON.parse(JSON.stringify(current)))).toEqual(current);
  expect(current?.fingerHoles[2]).toMatchObject({ slotEnds: "flat", lengthMm: 6, rotationDeg: 37 });
  expect(parseProjectDoc({ ...current, fingerHoles: [{ ...current!.fingerHoles[0], slotEnds: "invalid" }] })).toBeNull();
});

it("migrates v14 with sharp slot corners and round-trips explicit and retained corner radii", () => {
  const previous = { ...VALID, schemaVersion: 14, fingerHoles: [
    { id: "slot", kind: "flat-ended-scoop", center: { x: 0, y: 0 }, diameterMm: 24, lengthMm: 6, depthMm: 1 },
  ] };
  const source = JSON.stringify(previous);
  const migrated = parseProjectDoc(previous)!;
  expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  expect(migrated.fingerHoles[0].cornerRoundMm).toBeUndefined();
  expect(JSON.stringify(previous)).toBe(source);
  for (const kind of ["flat-ended-scoop", "flat-ended-straight", "straight", "oblong-straight"]) {
    const doc = parseProjectDoc({ ...migrated, fingerHoles: [{ ...migrated.fingerHoles[0], kind, cornerRoundMm: 8 }] });
    expect(doc?.fingerHoles[0]).toMatchObject({ kind, cornerRoundMm: 8, lengthMm: 6, depthMm: 1 });
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  }
});


it("preserves v18 inset lids and both styles in current project history", () => {
  const { magneticLidStyle: _style, ...v18Spec } = VALID.spec;
  const old = parseProjectDoc({ ...VALID, schemaVersion: 18, spec: { ...v18Spec, magneticLid: true } })!;
  expect(old.spec.magneticLidStyle).toBe("inset");
  const overlap = { ...old.spec, magneticLidStyle: "overlap" as const };
  const doc = { ...old, spec: overlap, history: { stack: [
    { label: "Inset", doc: { spec: old.spec, cutouts: old.cutouts, fingerHoles: old.fingerHoles } },
    { label: "Overlap", doc: { spec: overlap, cutouts: old.cutouts, fingerHoles: old.fingerHoles } },
  ], index: 1 } };
  const parsed = parseProjectDoc(doc);
  expect(parsed?.spec.magneticLidStyle).toBe("overlap");
  expect(parsed?.history?.stack.map(entry => entry.doc.spec.magneticLidStyle)).toEqual(["inset", "overlap"]);
});


it("round-trips a stacking lid without magnets and independent crush rib preferences", () => {
  const doc = parseProjectDoc({ ...VALID, spec: { ...VALID.spec, magneticLid: true, magneticLidStyle: "overlap", magneticLidTop: "stacking", lidMagnetHoles: false, lidMagnetCrushRibs: true, magnetHoles: true, magnetCrushRibs: false } })!;
  expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))?.spec).toEqual(doc.spec);
  expect(doc.spec).toMatchObject({ lidMagnetHoles: false, lidMagnetCrushRibs: true, magnetCrushRibs: false });
});

it("defaults older lid fits and preserves tuning through project and history round-trips", () => {
  const { lidFit: _fit, lidFitAdjustmentMm: _adjustment, ...oldSpec } = VALID.spec;
  const old = parseProjectDoc({ ...VALID, spec: { ...oldSpec, magneticLid: true, lidMagnetHoles: false } })!;
  expect(old.spec).toMatchObject({ lidFit: "lift-off", lidFitAdjustmentMm: 0 });
  const tuned = { ...old.spec, lidFit: "friction" as const, lidFitAdjustmentMm: 0.05 };
  const doc = { ...old, spec: tuned, history: { stack: [
    { label: "Easy lift-off", doc: { spec: old.spec, cutouts: old.cutouts, fingerHoles: old.fingerHoles } },
    { label: "Tune friction fit", doc: { spec: tuned, cutouts: old.cutouts, fingerHoles: old.fingerHoles } },
  ], index: 1 } };
  expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  for (const lidFitAdjustmentMm of [-0.15, 0.15, 0.025, Infinity]) {
    expect(parseProjectDoc({ ...old, spec: { ...old.spec, lidFitAdjustmentMm } })).toBeNull();
  }
  expect(parseProjectDoc({ ...old, spec: { ...old.spec, lidFit: "unknown" } })).toBeNull();
});
