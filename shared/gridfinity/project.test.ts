import { describe, expect, it } from "vitest";

import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "./project";
import { parseBinSpec } from "./types";
import { rigidPocket } from "./rigid-pocket";
import { DEFAULT_PEG_BOTTOM } from "./peg-bottom";
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
  it("migrates v31 wall thickness through the design, history, and transform references", () => {
    const { wallThicknessMm: _removed, ...spec } = VALID.spec;
    const cutouts = [parseProjectDoc(VALID)!.cutouts[0]];
    const doc = { spec: { ...spec, fill: "none" }, cutouts, fingerHoles: [] };
    const legacy = { ...VALID, ...doc, schemaVersion: 31,
      history: { stack: [{ doc, label: "Opened" }], index: 0 },
      transformOrigins: { pockets: [{ cutout: cutouts[0], spec }], fingerHoles: [] } };
    const original = JSON.stringify(legacy);
    const migrated = parseProjectDoc(legacy)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.spec.wallThicknessMm).toBe(0.95);
    expect(migrated.history!.stack[0].doc.spec.wallThicknessMm).toBe(0.95);
    expect(migrated.transformOrigins!.pockets[0].spec.wallThicknessMm).toBe(0.95);
    expect(JSON.stringify(legacy)).toBe(original);
    const thick = { ...migrated.spec, wallThicknessMm: 2.4 };
    const saved = { ...migrated, spec: thick, history: { index: 1, stack: [
      migrated.history!.stack[0],
      { doc: { ...migrated.history!.stack[0].doc, spec: thick }, label: "Change wall thickness" },
    ] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
  it("migrates released v25 fill-depth references and settings without changing history", () => {
    const original = parseProjectDoc(VALID)!;
    const spec = { ...original.spec, fillHeightPercent: 75, adjustFixedPocketDepths: false };
    const cutouts = [{ ...original.cutouts[0], depth: { mode: "mm" as const, value: 20 },
      fillHeightReference: { topZ: 40.8, position: { x: 0, y: 0 }, depth: { mode: "mm" as const, value: 20 } } }];
    const doc = { spec, cutouts, fingerHoles: [] };
    const legacy = { ...original, ...doc, schemaVersion: 25,
      history: { stack: [{ doc, label: "Restore original pocket depths" }], index: 0 },
      transformOrigins: { pockets: [{ cutout: cutouts[0], spec }], fingerHoles: [] } };
    const migrated = parseProjectDoc(JSON.parse(JSON.stringify(legacy)))!;
    expect(migrated).toEqual({ ...legacy, schemaVersion: PROJECT_SCHEMA_VERSION });
    expect(parseProjectDoc(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it("migrates v24 without changing ordinary pockets or as-drawn references", () => {
    const source = parseProjectDoc(VALID)!;
    const legacy = { ...source, schemaVersion: 24, transformOrigins: { pockets: [{ cutout: source.cutouts[0], spec: source.spec }], fingerHoles: [] } };
    const migrated = parseProjectDoc(legacy)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.cutouts).toEqual(source.cutouts);
    expect(migrated.transformOrigins).toEqual(legacy.transformOrigins);
    expect(migrated.cutouts[0].profileBottom).toBeUndefined();
  });
  it("converts prototype profiles in every history snapshot and rejects malformed prototypes", () => {
    const source = parseProjectDoc(VALID)!;
    const before = { spec: source.spec, cutouts: source.cutouts, fingerHoles: [] };
    const after = { ...before, cutouts: [{ ...source.cutouts[0], tilt: { xDeg: 30, yDeg: 0 },
      profileBottom: { edge: "right" as const, widthMm: 8, elevationMm: 45 } }] };
    const project = { ...source, ...after, history: { stack: [{ doc: before, label: "Before" }, { doc: after, label: "Profile bottom" }], index: 1 } };
    const migrated = parseProjectDoc(JSON.parse(JSON.stringify(project)))!;
    expect(migrated.cutouts[0]).toMatchObject({depth:{mode:"mm",value:8},elevationMm:45,tilt:{xDeg:0,yDeg:90}});
    expect(migrated.history?.stack[0].doc).toEqual(before);
    expect(migrated.history?.stack[1].doc.cutouts).toEqual(migrated.cutouts);
    expect(JSON.stringify(parseProjectDoc(JSON.parse(JSON.stringify(migrated))))).toBe(JSON.stringify(migrated));
    const bad = structuredClone(project);
    bad.history.stack[1].doc.cutouts[0].profileBottom!.widthMm = -1;
    expect(parseProjectDoc(bad)).toBeNull();
  });
  it("migrates version 24 projects and history without changing existing pocket geometry", () => {
    const { adjustFixedPocketDepths: _removed, ...spec } = VALID.spec;
    const cutouts = [parseProjectDoc(VALID)!.cutouts[0]];
    const doc = { spec, cutouts, fingerHoles: [] };
    const legacy = { ...VALID, ...doc, schemaVersion: 24,
      transformOrigins: { pockets: [{ cutout: cutouts[0], spec }], fingerHoles: [] },
      history: { stack: [{ doc, label: "Start" }], index: 0 } };
    const migrated = parseProjectDoc(legacy)!;
    expect(migrated).not.toBeNull();
    expect(migrated.spec.adjustFixedPocketDepths).toBe(true);
    expect(migrated.history!.stack[0].doc.spec.adjustFixedPocketDepths).toBe(true);
    expect(migrated.cutouts).toEqual(cutouts);
    expect(migrated.transformOrigins!.pockets[0].cutout).toEqual(cutouts[0]);
    expect(migrated.cutouts[0].fillHeightReference).toBeUndefined();
  });

  it("migrates legacy fill heights in the current design and every undo/redo snapshot", () => {
    const { fillHeightPercent: _removed, ...spec } = VALID.spec;
    const doc = { spec, cutouts: [], fingerHoles: [] };
    const legacy = { ...VALID, ...doc, schemaVersion: 19, history: {
      stack: [
        { doc, label: "Start" },
        { doc: { ...doc, spec: { ...spec, gridX: 3 } }, label: "Change width" },
      ], index: 0,
    } };
    const original = JSON.stringify(legacy);
    const migrated = parseProjectDoc(legacy)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.spec.fillHeightPercent).toBe(100);
    expect(migrated.history!.stack.map(entry => entry.doc.spec.fillHeightPercent)).toEqual([100, 100]);
    expect(migrated.history!.index).toBe(0);
    expect(JSON.stringify(legacy)).toBe(original);
    expect(JSON.stringify(parseProjectDoc(JSON.parse(JSON.stringify(migrated))))).toBe(JSON.stringify(migrated));
  });

  it("round-trips a long access groove and its undo history without changing existing geometry", () => {
    const fingerHole = { id: "long", kind: "oblong-deep-scoop", center: { x: 0, y: 0 },
      diameterMm: 23, depthMm: 10, lengthMm: 193, topFilletMm: 0.6 };
    const doc = { spec: { ...VALID.spec, gridX: 5, gridY: 5 }, cutouts: VALID.cutouts, fingerHoles: [fingerHole] };
    const project = parseProjectDoc({ ...VALID, ...doc, history: {
      stack: [
        { doc: { ...doc, fingerHoles: [{ ...fingerHole, lengthMm: 160 }] }, label: "Start" },
        { doc, label: "Change length" },
      ], index: 1,
    } });
    expect(project).not.toBeNull();
    expect(project?.fingerHoles[0]).toMatchObject(fingerHole);
    expect(project?.history?.stack[0].doc.fingerHoles[0].lengthMm).toBe(160);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });

  it("round-trips custom fill height and saved history", () => {
    const doc = { spec: { ...VALID.spec, fillHeightPercent: 37.5 }, cutouts: [], fingerHoles: [] };
    const project = parseProjectDoc({ ...VALID, ...doc, history: {
      stack: [{ doc: { ...doc, spec: VALID.spec }, label: "Start" }, { doc, label: "Change fill height" }], index: 1,
    } });
    expect(project?.spec.fillHeightPercent).toBe(37.5);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });

  it("preserves independent pocket names alongside unnamed legacy placements", () => {
    const doc = parseProjectDoc({ ...VALID, cutouts: [
      { ...VALID.cutouts[0], name: "  First pocket  " },
      { ...VALID.cutouts[0], id: "copy" },
      { ...VALID.cutouts[0], id: "second-copy", name: "Second pocket" },
    ] });
    expect(doc?.cutouts.map(cutout => cutout.name)).toEqual(["First pocket", undefined, "Second pocket"]);
    expect(doc?.shapes).toEqual(VALID.shapes);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    for (const name of ["", "   ", null, 42]) {
      expect(parseProjectDoc({ ...VALID, cutouts: [{ ...VALID.cutouts[0], name }] })).toBeNull();
    }
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
    expect(doc).toEqual({ ...airdusterV9, spec: { ...spec, flatBottom: false, arbitrarySizeMm: null, pegBottom: null, fillHeightPercent: 100, adjustFixedPocketDepths: true, surfaceTexts: [], textColor: null, wallThicknessMm: 0.95 }, schemaVersion: PROJECT_SCHEMA_VERSION });
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

  it("migrates schema v8 finger access features with sharp edge defaults", () => {
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
  it("preserves round and oblong deep-scoop finger access features through JSON", () => {
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

  it("migrates a schema-v1 scoop into a typed finger access", () => {
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

  it("migrates schema v4 finger access features without changing their geometry", () => {
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

it.each([
  { version: 20, fill: 55, tilt: undefined, offset: undefined },
  { version: 20, fill: undefined, tilt: { xDeg: 12, yDeg: 30 }, offset: undefined },
  { version: 21, fill: undefined, tilt: { xDeg: 12, yDeg: 30 }, offset: 2 },
])("migrates both version-20 branches and v21 without losing history: %j", ({ version, fill, tilt, offset }) => {
  const { fillHeightPercent: _fill, ...oldSpec } = VALID.spec;
  const spec = fill === undefined ? oldSpec : { ...oldSpec, fillHeightPercent: fill };
  const cutouts = [{ ...VALID.cutouts[0], ...(tilt ? { tilt } : {}), ...(offset === undefined ? {} : { zOffsetMm: offset }) }];
  const doc = { spec, cutouts, fingerHoles: [] };
  const input = { ...VALID, ...doc, schemaVersion: version, history: {
    stack: [{ doc, label: "Start" }, { doc: { ...doc, cutouts: [{ ...cutouts[0], position: { x: 10, y: 5 } }] }, label: "Move" }], index: 0,
  } };
  const serialized = JSON.stringify(input), migrated = parseProjectDoc(input)!;
  expect(migrated).not.toBeNull();
  expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  expect(migrated.spec.fillHeightPercent).toBe(fill ?? 100);
  for (const entry of migrated.history!.stack) {
    expect(entry.doc.spec.fillHeightPercent).toBe(fill ?? 100);
    expect(entry.doc.cutouts[0].tilt).toEqual(tilt);
    expect(entry.doc.cutouts[0].zOffsetMm).toBe(offset);
  }
  expect(JSON.stringify(input)).toBe(serialized);
  expect(JSON.stringify(parseProjectDoc(JSON.parse(JSON.stringify(migrated))))).toBe(JSON.stringify(migrated));
});


it("round-trips as-drawn references and migrates version 23 without changing geometry", () => {
  const doc = parseProjectDoc(VALID)!;
  const transformOrigins = { pockets: [{ cutout: doc.cutouts[0], spec: doc.spec }], fingerHoles: [] };
  const saved = { ...doc, transformOrigins, cutouts: [{ ...doc.cutouts[0], position: { x: 10, y: 4 } }] };
  expect(parseProjectDoc(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  expect(parseProjectDoc({ ...doc, schemaVersion: 23 })).toEqual(doc);
  expect(parseProjectDoc({ ...saved, transformOrigins: { ...transformOrigins, pockets: [{ cutout: { ...doc.cutouts[0], rotationDeg: Infinity }, spec: doc.spec }] } })).toBeNull();
});

it("retains unclipped rigid source depths with floor limits through save, history, and creation references", () => {
  const previous = parseProjectDoc({...VALID,schemaVersion:33})!;
  expect(previous).not.toBeNull();
  const cutout = {...previous.cutouts[0],elevationMm:3,insertionMode:"vertical",tilt:{xDeg:20,yDeg:25},
    depth:{mode:"remaining",floorThicknessMm:9,sourceDepthMm:16}};
  const doc = {...previous,cutouts:[cutout],history:{index:0,stack:[{label:"Lower pocket",doc:{spec:previous.spec,cutouts:[cutout],fingerHoles:[]}}]},
    transformOrigins:{pockets:[{cutout,spec:previous.spec}],fingerHoles:[]}};
  const parsed = parseProjectDoc(JSON.parse(JSON.stringify(doc)))!;
  expect(parsed).not.toBeNull();
  expect(parsed.cutouts[0].depth).toEqual(cutout.depth);
  expect(parsed.history!.stack[0].doc.cutouts[0].depth).toEqual(cutout.depth);
  expect(parsed.transformOrigins!.pockets[0].cutout.depth).toEqual(cutout.depth);
  expect(parseProjectDoc({...doc,cutouts:[{...cutout,depth:{...cutout.depth,sourceDepthMm:-1}}]})).toBeNull();
});

it("recovers a through object's original depth from ordered history and preserves moves and Undo", () => {
  const base = parseProjectDoc(VALID)!;
  const finite = {...base.cutouts[0],elevationMm:12,depth:{mode:"mm" as const,value:16},tilt:{xDeg:20,yDeg:25}};
  const through = {...finite,depth:{mode:"through" as const},elevationMm:50};
  const later = {...finite,depth:{mode:"mm" as const,value:24}};
  const snapshot = (cutout: typeof through | typeof finite) => ({spec:base.spec,cutouts:[cutout],fingerHoles:[]});
  const input = {...base,...snapshot(through),schemaVersion:34,
    history:{index:1,stack:[{label:"Original",doc:snapshot(finite)},{label:"Through and raise",doc:snapshot(through)},
      {label:"Later resize",doc:snapshot(later)}]},
    transformOrigins:{pockets:[{cutout:finite,spec:base.spec}],fingerHoles:[]}};
  const saved = JSON.stringify(input);
  const migrated = parseProjectDoc(JSON.parse(saved))!;
  expect(migrated.cutouts[0]).toMatchObject({elevationMm:50,depth:{mode:"through",sourceDepthMm:16}});
  expect(migrated.history!.stack[1].doc.cutouts).toEqual(migrated.cutouts);
  expect(migrated.history!.stack[0].doc.cutouts[0].depth).toEqual(finite.depth);
  expect(migrated.history!.stack[2].doc.cutouts[0].depth).toEqual(later.depth);
  expect(parseProjectDoc(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  expect(JSON.stringify(input)).toBe(saved);
  expect(parseProjectDoc({...migrated,history:undefined,cutouts:[{...migrated.cutouts[0],elevationMm:-0.01}]})).toBeNull();
});

it("recovers retained creation depths without history and freezes a legacy through default once", () => {
  const base = parseProjectDoc(VALID)!;
  const original = {...base.cutouts[0],elevationMm:7,depth:{mode:"mm" as const,value:16}};
  const through = {...original,depth:{mode:"through" as const}};
  const recovered = parseProjectDoc({...base,schemaVersion:34,cutouts:[through],
    transformOrigins:{pockets:[{cutout:original,spec:base.spec}],fingerHoles:[]}})!;
  expect(recovered.cutouts[0].depth).toEqual({mode:"through",sourceDepthMm:16});
  const migrated = parseProjectDoc({...base,schemaVersion:34,cutouts:[through]})!;
  const sourceDepth = migrated.cutouts[0].depth;
  expect(sourceDepth).toHaveProperty("sourceDepthMm");
  expect(parseProjectDoc({...migrated,spec:{...base.spec,heightUnits:8}})!.cutouts[0].depth).toEqual(sourceDepth);
});

it("keeps migrated linked through designs consistent even when creation depths differed", () => {
  const base = parseProjectDoc(VALID)!;
  const first = {...base.cutouts[0],elevationMm:7,depth:{mode:"through" as const},designLink:{id:"linked",tilt:false}};
  const second = {...first,id:"copy",elevationMm:12,position:{x:20,y:0}};
  const migrated = parseProjectDoc({...base,schemaVersion:34,cutouts:[first,second],
    transformOrigins:{pockets:[{cutout:{...first,designLink:undefined,depth:{mode:"mm",value:16}},spec:base.spec},
      {cutout:{...second,designLink:undefined,depth:{mode:"mm",value:24}},spec:base.spec}],fingerHoles:[]}})!;
  expect(migrated).not.toBeNull();
  expect(migrated.cutouts[0].depth).toEqual({mode:"through",sourceDepthMm:16});
  expect(migrated.cutouts[1].depth).toEqual(migrated.cutouts[0].depth);
});


it.each(["corners", 1, 2, 3, 4, 5])("restores every-hole pegs from v37 density %s throughout saved projects", density => {
  const base = parseProjectDoc(VALID)!;
  const spec = { ...base.spec, pegBottom: { ...DEFAULT_PEG_BOTTOM, density } };
  const snapshot = { spec, cutouts: base.cutouts, fingerHoles: base.fingerHoles };
  const legacy = { ...base, ...snapshot, schemaVersion: 37,
    history: { index: 0, stack: [{ label: "Start", doc: snapshot }] },
    transformOrigins: { pockets: [{ cutout: base.cutouts[0], spec }], fingerHoles: [] } };
  const original = JSON.stringify(legacy);
  const migrated = parseProjectDoc(legacy)!;
  expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  expect(migrated.spec.pegBottom).toEqual(DEFAULT_PEG_BOTTOM);
  expect(migrated.history!.stack[0].doc.spec.pegBottom).toEqual(DEFAULT_PEG_BOTTOM);
  expect(migrated.transformOrigins!.pockets[0].spec.pegBottom).toEqual(DEFAULT_PEG_BOTTOM);
  expect(migrated.cutouts).toEqual(base.cutouts);
  expect(JSON.stringify(legacy)).toBe(original);
  expect(parseProjectDoc(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
});

it.each([0, 6, 1.5, "everywhere", null])("rejects malformed v37 density %s", density => {
  expect(parseProjectDoc({ ...VALID, schemaVersion: 37, spec: { ...VALID.spec, pegBottom: { ...DEFAULT_PEG_BOTTOM, density } } })).toBeNull();
});

it.each([35, 36, 37])("repairs proven unraised surface Through conversions in v%s history and current design", schemaVersion => {
  const base = parseProjectDoc(VALID)!;
  const original = base.cutouts[0];
  const frozen = rigidPocket(original, base.shapes[0], base.spec);
  const through = { ...frozen, depth: { mode: "through" as const, sourceDepthMm: frozen.depth.mode === "mm" ? frozen.depth.value : frozen.depth.sourceDepthMm } };
  const snapshot = (cutout: typeof original) => ({ spec: base.spec, cutouts: [cutout], fingerHoles: [] });
  const legacy = { ...base, ...snapshot(through), schemaVersion,
    transformOrigins: { pockets: [{ cutout: original, spec: base.spec }], fingerHoles: [] },
    history: { index: 1, stack: [{ label: "Draw", doc: snapshot(original) }, { label: "Through", doc: snapshot(through) },
      { label: "Raise", doc: snapshot({ ...through, elevationMm: through.elevationMm! + 3 }) }] } };
  const text = JSON.stringify(legacy);
  const migrated = parseProjectDoc(legacy)!;
  expect(migrated.cutouts[0].depth).toEqual({ mode: "through" });
  expect(migrated.cutouts[0].elevationMm).toBeUndefined();
  expect(migrated.history!.stack[0].doc.cutouts[0]).toEqual(original);
  expect(migrated.history!.stack[1].doc.cutouts).toEqual(migrated.cutouts);
  expect(migrated.history!.stack[2].doc.cutouts[0]).toEqual(legacy.history.stack[2].doc.cutouts[0]);
  expect(migrated.transformOrigins).toEqual(legacy.transformOrigins);
  expect(JSON.stringify(legacy)).toBe(text);
  expect(parseProjectDoc(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
});

it("preserves tilted, raised, and unproven finite Through pockets on upgrade", () => {
  const base = parseProjectDoc(VALID)!;
  const original = base.cutouts[0];
  const frozen = rigidPocket(original, base.shapes[0], base.spec);
  const through = { ...frozen, depth: { mode: "through" as const, sourceDepthMm: 16 } };
  for (const cutout of [through, { ...through, elevationMm: 20 }, { ...through, tilt: { xDeg: 20, yDeg: 0 } }]) {
    expect(parseProjectDoc({ ...base, schemaVersion: 36, cutouts: [cutout] })!.cutouts[0]).toEqual(cutout);
  }
});
