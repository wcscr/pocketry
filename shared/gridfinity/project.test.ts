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
  it.each([18, 19])("upgrades main v%s basic pockets and named history alongside lid settings", schemaVersion => {
    // Main's format did not contain any lid or wall-thickness fields.
    const spec = { gridX: 2, gridY: 2, heightUnits: 6 };
    const shapes = [{ ...VALID.shapes[0], source: "basic-shape", sourceMmPerPx: null }];
    const cutouts = VALID.cutouts.map(cutout => ({ ...cutout, name: "Left pocket" }));
    const previous = { ...VALID, schemaVersion, spec, shapes, cutouts,
      history: { index: 1, stack: [
        { label: "Add pocket", doc: { spec, cutouts: VALID.cutouts, fingerHoles: [] } },
        { label: "Rename pocket", doc: { spec, cutouts, fingerHoles: [] } },
        { label: "Remove pocket", doc: { spec, cutouts: [], fingerHoles: [] } },
      ] } };
    const original = JSON.stringify(previous);
    const migrated = parseProjectDoc(previous)!;
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.shapes).toEqual(shapes);
    expect(migrated.cutouts[0].name).toBe("Left pocket");
    expect(migrated.spec).toMatchObject({ magneticLid: false, wallThicknessMm: 0.95 });
    expect(migrated.history!.index).toBe(1);
    expect(migrated.history!.stack.map(entry => entry.doc.cutouts.map(cutout => cutout.name)))
      .toEqual([[undefined], ["Left pocket"], []]);
    expect(migrated.history!.stack.every(entry => entry.doc.spec.wallThicknessMm === 0.95)).toBe(true);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    expect(JSON.stringify(previous)).toBe(original);
    expect(parseProjectDoc({ ...previous, history: { ...previous.history, index: 0 } })).toBeNull();
    expect(parseProjectDoc({ ...previous, shapes: [] })).toBeNull();
  });

  it("preserves v26 lid dimensions and fit while adding named basic pockets", () => {
    const spec = { ...VALID.spec, magneticLid: true, magneticLidStyle: "overlap" as const,
      magneticLidTop: "stacking" as const, lidMagnetHoles: false, lidFit: "friction" as const,
      lidInterface: "angled-fins" as const, wallThicknessMm: 2, lidFitAdjustmentMm: 0.05,
      lidRibSpacingMm: 18, lidGripRecess: true };
    const previous = { ...parseProjectDoc(VALID)!, schemaVersion: 26, spec,
      history: { index: 0, stack: [{ label: "Lid fit", doc: { spec, cutouts: parseProjectDoc(VALID)!.cutouts, fingerHoles: [] } }] } };
    const original = JSON.stringify(previous);
    const migrated = parseProjectDoc(previous)!;
    expect(migrated).toEqual({ ...previous, schemaVersion: PROJECT_SCHEMA_VERSION });
    expect(JSON.stringify(previous)).toBe(original);
    const shapes = [{ ...migrated.shapes[0], source: "basic-shape" as const, sourceMmPerPx: null }];
    const cutouts = migrated.cutouts.map(cutout => ({ ...cutout, name: "Accessory" }));
    const combined = { ...migrated, shapes, cutouts, history: { index: 1, stack: [
      ...migrated.history!.stack, { label: "Name pocket", doc: { spec, cutouts, fingerHoles: [] } },
    ] } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(combined)))).toEqual(combined);
  });

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
    for (const lidInterface of ["ribs", "angled-fins"] as const) {
      const doc = { ...migrated, spec: { ...migrated.spec, lidInterface },
        history: { index: 0, stack: [{ label: "Change interface", doc: { ...migrated.history!.stack[0].doc,
          spec: { ...migrated.spec, lidInterface } } }] } };
      expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    }
    expect(parseProjectDoc({ ...migrated, spec: { ...migrated.spec, lidInterface: "unknown" } })).toBeNull();
  });

  it.each([23, 24, 25, 26, PROJECT_SCHEMA_VERSION])("migrates disabled interfaces in v%s designs and all undo/redo snapshots", schemaVersion => {
    const base = parseProjectDoc(VALID)!;
    for (const lidInterface of ["side-springs", "spring-latch"] as const) {
      const spec = { ...VALID.spec, magneticLid: true, lidMagnetHoles: false, lidFit: "friction" as const,
        lidInterface, lidFitAdjustmentMm: 0.1, lidRibSpacingMm: 18, lidGripRecess: true };
      const stack = [
        { ...spec, lidInterface: "spring-latch" as const, magneticLid: false },
        spec,
        { ...spec, lidInterface: "side-springs" as const, lidMagnetHoles: true },
        { ...spec, lidInterface: "angled-fins" as const },
      ].map((spec, index) => ({ label: `Step ${index}`, doc: { spec, cutouts: base.cutouts, fingerHoles: [] } }));
      const previous = { ...base, schemaVersion, name: "Fit test", keepBinSize: true, spec, history: { stack, index: 1 } };
      const original = JSON.stringify(previous);
      const migrated = parseProjectDoc(previous)!;
      expect(migrated).toEqual({
        ...previous, schemaVersion: PROJECT_SCHEMA_VERSION, spec: { ...spec, lidInterface: "ribs" },
        history: { index: 1, stack: stack.map((entry, index) => ({ ...entry,
          doc: { ...entry.doc, spec: { ...entry.doc.spec, lidInterface: index === 3 ? "angled-fins" : "ribs" } },
        })) },
      });
      expect(JSON.stringify(previous)).toBe(original);
      expect(parseProjectDoc(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
      expect(parseProjectDoc({ ...previous, history: undefined })?.spec.lidInterface).toBe("ribs");
    }
  });

  it("rejects mismatched spring snapshots before migrating them to the same interface", () => {
    const spec = { ...VALID.spec, lidInterface: "side-springs" };
    expect(parseProjectDoc({ ...VALID, schemaVersion: 25, spec,
      history: { index: 0, stack: [{ label: "Saved", doc: {
        spec: { ...spec, lidInterface: "spring-latch" }, cutouts: VALID.cutouts, fingerHoles: [],
      } }] },
    })).toBeNull();
    expect(parseProjectDoc({ ...VALID, spec: { ...spec, lidInterface: "unknown" } })).toBeNull();
    expect(parseProjectDoc({ ...VALID, schemaVersion: PROJECT_SCHEMA_VERSION + 1, spec })).toBeNull();
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

  it("keeps main wall defaults and round-trips custom lid thickness", () => {
    expect(VALID.spec.wallThicknessMm).toBe(0.95);
    const thick = { ...VALID, spec: { ...VALID.spec, magneticLid: true, magneticLidStyle: "overlap", lidSharedWallThicknessMm: 4 } };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(thick)))?.spec.lidSharedWallThicknessMm).toBe(4);
    for (const wallThicknessMm of [0.6, 4.2, Infinity, NaN]) {
      expect(parseProjectDoc({ ...thick, spec: { ...thick.spec, lidSharedWallThicknessMm: wallThicknessMm } })).toBeNull();
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
    expect(doc).toEqual({ ...airdusterV9, spec: { ...spec, flatBottom: false, fillHeightPercent: 100, adjustFixedPocketDepths: true, surfaceTexts: [], textColor: null, wallThicknessMm: 0.95, magneticLid: false, magneticLidStyle: "inset", magneticLidTop: "flat", lidGripRecess: false, lidMagnetHoles: true, lidMagnetCrushRibs: false, lidFit: "lift-off", lidInterface: "ribs", lidRibSpacingMm: 24, lidFitAdjustmentMm: 0, lidSharedWallThicknessMm: 1.2, magnetDiameterMm: 6, magnetThicknessMm: 2 }, schemaVersion: PROJECT_SCHEMA_VERSION });
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


it.each([18, 19, 20, 21, 22, 23, 24, 25, 26, 27])("preserves actual lid-preview v%s wall dimensions and disabled history", schemaVersion => {
  const spec = { gridX: 2, gridY: 2, heightUnits: 6, magneticLid: true,
    magneticLidStyle: "overlap", magneticLidTop: "flat", wallThicknessMm: 4,
    lidMagnetHoles: false, lidFit: "friction", lidInterface: "angled-fins" };
  const before = { spec: { ...spec, magneticLid: false }, cutouts: [], fingerHoles: [] };
  const after = { spec, cutouts: [], fingerHoles: [] };
  const input = { schemaVersion, shapes: [], ...after,
    history: { index: 1, stack: [{ label: "Before", doc: before }, { label: "Lid", doc: after }] } };
  const original = JSON.stringify(input);
  const result = parseProjectDoc(input)!;
  expect(result).not.toBeNull();
  expect(result.spec).toMatchObject({ magneticLid: true, lidSharedWallThicknessMm: 4, lidInterface: "angled-fins" });
  expect(result.history!.stack.map(entry => entry.doc.spec.lidSharedWallThicknessMm)).toEqual([4, 4]);
  expect(result.history!.stack[0].doc.spec.magneticLid).toBe(false);
  expect(parseProjectDoc(JSON.parse(JSON.stringify(result)))).toEqual(result);
  expect(JSON.stringify(input)).toBe(original);
});

it("preserves main v36 wall and color preferences independently from lid fit", () => {
  const spec = { gridX: 2, gridY: 2, heightUnits: 6, fill: "none", wallThicknessMm: 2.4 };
  const main = { schemaVersion: 36, shapes: [], spec, cutouts: [], fingerHoles: [] };
  const result = parseProjectDoc(main)!;
  expect(result.spec).toMatchObject({ magneticLid: false, wallThicknessMm: 2.4, lidSharedWallThicknessMm: 1.2 });
  const lid = { ...result, spec: { ...result.spec, magneticLid: true, lidSharedWallThicknessMm: 4 } };
  expect(parseProjectDoc(JSON.parse(JSON.stringify(lid)))!.spec).toEqual(lid.spec);
  expect(parseProjectDoc({ ...lid, spec: { ...lid.spec, magneticLid: false } })!.spec.wallThicknessMm).toBe(2.4);
});
