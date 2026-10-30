import { describe, expect, it, vi } from "vitest";
import { loadCad, type OpenCascadeInstance } from "./runtime";
import { CadContext, type CadShape } from "./adapter";
import { CadArena, type NativeHandle } from "./arena";
import { tessellateCad } from "./mesh";

/** Use fresh native objects, so these checks cannot pass via CadContext reuse. */
function validateFresh(oc: OpenCascadeInstance, shape: CadShape): boolean {
  const analyzer = new oc.BRepCheck_Analyzer(shape, true, false, true);
  try {
    expect(analyzer.IsExactMethod()).toBe(true);
    return analyzer.IsValid();
  } finally { analyzer.delete(); }
}

function measure(oc: OpenCascadeInstance, shape: CadShape, surface = false): number {
  const props = new oc.GProp_GProps();
  try {
    if (surface) oc.BRepGProp.SurfaceProperties(shape, props, false, false);
    else oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
    return props.Mass();
  } finally { props.delete(); }
}

function bounds(oc: OpenCascadeInstance, shape: CadShape): number[] {
  const box = new oc.Bnd_Box();
  try {
    oc.BRepBndLib.AddOptimal(shape, box, false, false);
    box.SetGap(0);
    const min = box.CornerMin(), max = box.CornerMax();
    try { return [min.X(), min.Y(), min.Z(), max.X(), max.Y(), max.Z()]; }
    finally { max.delete(); min.delete(); }
  } finally { box.delete(); }
}

function expectBounds(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
}

/** Encourage reuse of released builder/storage allocations before reading a
 * retained value; a dangling view should not pass just because memory is idle. */
function churnBuilders(oc: OpenCascadeInstance): void {
  for (let i = 0; i < 32; i++) {
    const builder = new oc.BRepPrimAPI_MakeBox(3 + i, 4, 5);
    try {
      const shape = builder.Shape();
      shape.delete();
    } finally { builder.delete(); }
  }
}

function drop(arena: CadArena, handle: NativeHandle): void {
  arena.release(handle).delete();
}

/** Read actual per-face cache handles; release the observations immediately. */
function cachedTriangulations(c: CadContext, shape: CadShape): number {
  return c.scope(() => {
    const location = c.own(new c.oc.TopLoc_Location());
    let count = 0;
    for (const item of c.subshapes(shape, "face")) {
      const face = c.own(c.oc.TopoDS.Face(item));
      // OCCT returns a null handle when no cache exists, although the generated
      // declaration omits null from this return type.
      const triangulation = c.oc.BRep_Tool.Triangulation(face, location, 0);
      if (triangulation) {
        c.own(triangulation);
        expect(triangulation.NbTriangles()).toBeGreaterThan(0);
        count++;
      }
    }
    return count;
  });
}

function exactCurveSignature(c: CadContext, shape: CadShape) {
  return c.scope(() => c.subshapes(shape, "edge").map(item => {
    const edge = c.own(c.oc.TopoDS.Edge(item));
    const curve = c.own(new c.oc.BRepAdaptor_Curve(edge));
    const type = curve.GetType(), first = curve.FirstParameter(), last = curve.LastParameter();
    const points = [first, (first + last) / 2, last].map(parameter => {
      const point = c.own(curve.Value(parameter));
      return [point.X(), point.Y(), point.Z()];
    });
    const radii = type === c.oc.GeomAbs_CurveType.GeomAbs_Circle
      ? [c.own(curve.Circle()).Radius()]
      : type === c.oc.GeomAbs_CurveType.GeomAbs_Ellipse
        ? (() => { const ellipse = c.own(curve.Ellipse()); return [ellipse.MajorRadius(), ellipse.MinorRadius()]; })()
        : [];
    return { type, first, last, points, radii };
  }));
}

describe("exact CAD validation memory", () => {
  it("validates alternating solids repeatedly without allocating a new analyzer for every check", async () => {
    const oc = await loadCad(), c = new CadContext(oc);
    try {
      const a = c.extrude({kind: "rounded-rectangle", width: 10, length: 20, radius: 2}, 0, 12);
      const b = c.extrude({kind: "ellipse", rx: 5, ry: 8}, 0, 7);
      const before = oc.wasmMemory.buffer.byteLength;
      for (let i = 0; i < 2_000; i++) expect(c.valid(i % 2 ? a : b)).toBe(true);
      expect(oc.wasmMemory.buffer.byteLength - before).toBeLessThan(64 * 1024 * 1024);
      expect(c.volume(a)).toBeGreaterThan(0);
      expect(c.volume(b)).toBeCloseTo(Math.PI * 5 * 8 * 7, 6);
      const empty = c.own(new oc.TopoDS_Shape());
      expect(c.valid(empty)).toBe(false);
      expect(c.valid(a)).toBe(true);
    } finally { c.dispose(); }
  }, 30_000);

  it("reclaims fresh exact analyzers after every delete without relying on validator reuse", async () => {
    const oc = await loadCad(), arena = new CadArena();
    try {
      const builder = arena.own(new oc.BRepPrimAPI_MakeBox(10, 20, 30));
      const shape = arena.own(builder.Shape());
      // Warm lazy native caches before measuring allocated linear-memory growth.
      for (let i = 0; i < 32; i++) expect(validateFresh(oc, shape)).toBe(true);
      const before = oc.wasmMemory.buffer.byteLength;
      const growthBudget = 32 * 1024 * 1024;
      let completed = 0;
      for (; completed < 2_000; completed++) {
        expect(validateFresh(oc, shape)).toBe(true);
        // Bound the known-bad binary's negative control instead of allowing its
        // leaking destructor to exhaust memory. The assertion below must fail.
        if (oc.wasmMemory.buffer.byteLength - before >= growthBudget) break;
      }
      expect(oc.wasmMemory.buffer.byteLength - before).toBeLessThan(growthBudget);
      expect(completed).toBe(2_000);
      expect(measure(oc, shape)).toBeCloseTo(6_000, 7);
    } finally { arena.dispose(); }
  }, 30_000);

  it("keeps a constructed shape valid after its builder is deleted", async () => {
    const oc = await loadCad(), arena = new CadArena();
    try {
      const builder = arena.own(new oc.BRepPrimAPI_MakeBox(7, 11, 13));
      const shape = arena.own(builder.Shape());
      drop(arena, builder);
      churnBuilders(oc);
      expect(shape.IsNull()).toBe(false);
      expect(validateFresh(oc, shape)).toBe(true);
      expect(measure(oc, shape)).toBeCloseTo(7 * 11 * 13, 7);
      expectBounds(bounds(oc, shape), [0, 0, 0, 7, 11, 13]);
    } finally { arena.dispose(); }
  });

  it("retains copied subshape and container values after all parent storage is cleared", async () => {
    const oc = await loadCad(), arena = new CadArena();
    try {
      const builder = arena.own(new oc.BRepPrimAPI_MakeBox(7, 11, 13));
      const shape = arena.own(builder.Shape());
      const explorer = arena.own(new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE));
      expect(explorer.More()).toBe(true);
      const current = arena.own(explorer.Current());
      const face = arena.own(oc.TopoDS.Face(current));
      const expectedArea = measure(oc, face, true), expectedBounds = bounds(oc, face);
      const list = arena.own(new oc.NCollection_List_TopoDS_Shape());
      const appended = arena.own(list.Append(face));
      const copiedList = arena.own(new oc.NCollection_List_TopoDS_Shape(list));
      const fromFirst = arena.own(list.First()), fromCopiedLast = arena.own(copiedList.Last());
      expect(fromFirst.IsPartner(face)).toBe(true);
      expect(fromCopiedLast.IsSame(fromFirst)).toBe(true);

      list.Clear(); copiedList.Clear(); explorer.Clear();
      for (const parent of [list, copiedList, explorer, appended, face, current, shape, builder]) drop(arena, parent);
      churnBuilders(oc);
      for (const retained of [fromFirst, fromCopiedLast]) {
        expect(retained.ShapeType()).toBe(oc.TopAbs_ShapeEnum.TopAbs_FACE);
        expect(validateFresh(oc, retained)).toBe(true);
        expect(measure(oc, retained, true)).toBeCloseTo(expectedArea, 7);
        expectBounds(bounds(oc, retained), expectedBounds);
      }
    } finally { arena.dispose(); }
  });

  it("keeps reference-counted geometry alive while independent shape values still own it", async () => {
    const oc = await loadCad(), arena = new CadArena();
    try {
      const builder = arena.own(new oc.BRepPrimAPI_MakeBox(7, 11, 13));
      const original = arena.own(builder.Shape());
      const first = arena.own(original.Oriented(original.Orientation()));
      const location = arena.own(original.Location());
      const survivor = arena.own(first.Located(location, false));
      expect(original.IsPartner(first)).toBe(true);
      expect(first.IsEqual(survivor)).toBe(true);

      // Nullifying one value releases its reference, not its partners' values.
      original.Nullify();
      expect(original.IsNull()).toBe(true);
      expect(first.IsNull()).toBe(false);
      first.Nullify();
      for (const parent of [original, first, location, builder]) drop(arena, parent);
      churnBuilders(oc);
      expect(survivor.IsNull()).toBe(false);
      expect(validateFresh(oc, survivor)).toBe(true);
      expect(measure(oc, survivor)).toBeCloseTo(7 * 11 * 13, 7);
      expectBounds(bounds(oc, survivor), [0, 0, 0, 7, 11, 13]);
    } finally { arena.dispose(); }
  });
});

describe("CAD tessellation cache lifetime", () => {
  it.each([
    { name: "circular preview", rx: 5, ry: 5, printable: false },
    { name: "circular printable", rx: 5, ry: 5, printable: true },
    { name: "elliptical preview", rx: 5, ry: 8, printable: false },
    { name: "elliptical printable", rx: 5, ry: 8, printable: true },
  ])("repeats $name identically after releasing every triangulation cache", async ({ rx, ry, printable }) => {
    const oc = await loadCad(), c = new CadContext(oc);
    try {
      const shape = c.extrude({ kind: "ellipse", rx, ry }, 0, 7);
      const originalVolume = c.volume(shape), originalCurves = exactCurveSignature(c, shape);
      expect(originalVolume).toBeCloseTo(Math.PI * rx * ry * 7, 6);
      expect(originalCurves.some(curve => curve.type === (rx === ry
        ? oc.GeomAbs_CurveType.GeomAbs_Circle : oc.GeomAbs_CurveType.GeomAbs_Ellipse))).toBe(true);
      expect(cachedTriangulations(c, shape)).toBe(0);
      const native = oc.ReplicadMeshExtractor.extract(shape, printable ? 0.02 : 0.12, Math.PI * 2 / 64, printable);
      try { expect(cachedTriangulations(c, shape)).toBeGreaterThan(0); }
      finally { native.delete(); }
      // Deleting the extracted arrays alone does not clear the B-rep's cache.
      expect(cachedTriangulations(c, shape)).toBeGreaterThan(0);
      const reference = tessellateCad(c, shape, printable, 64);
      expect(reference.indices.length).toBeGreaterThan(0);
      expect(cachedTriangulations(c, shape)).toBe(0);
      for (let i = 0; i < 4; i++) {
        const repeated = tessellateCad(c, shape, printable, 64);
        expect(repeated.positions).toEqual(reference.positions);
        expect(repeated.indices).toEqual(reference.indices);
        expect(repeated.normals).toEqual(reference.normals);
        expect(cachedTriangulations(c, shape)).toBe(0);
        expect(c.volume(shape)).toBe(originalVolume);
        expect(exactCurveSignature(c, shape)).toEqual(originalCurves);
        expect(c.valid(shape)).toBe(true);
      }
    } finally { c.dispose(); }
  });

  it.each(["extraction", "copy"] as const)("cleans native caches and permits retry after %s failure", async failurePhase => {
    const oc = await loadCad(), c = new CadContext(oc);
    const originalExtract = oc.ReplicadMeshExtractor.extract;
    const failure = new Error(`Simulated ${failurePhase} failure`);
    let nativeDataDeletes = 0;
    const spy = vi.spyOn(oc.ReplicadMeshExtractor, "extract");
    try {
      const shape = c.extrude({ kind: "ellipse", rx: 5, ry: 8 }, 0, 7);
      const originalVolume = c.volume(shape), originalCurves = exactCurveSignature(c, shape);
      spy.mockImplementation((...args) => {
        const data = originalExtract(...args);
        expect(cachedTriangulations(c, shape)).toBeGreaterThan(0);
        if (failurePhase === "extraction") {
          // Simulate an extractor throwing after meshing, before it returns a
          // data handle. The extractor owns that unreturned handle.
          data.delete(); nativeDataDeletes++;
          throw failure;
        }
        // All pointers remain real. Throw before constructing the JS array,
        // and observe the production finally block deleting the returned data.
        return new Proxy(data, {
          get(target, key) {
            if (key === "getVerticesSize") return () => { throw failure; };
            if (key === "delete") return () => { target.delete(); nativeDataDeletes++; };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      });
      expect(() => tessellateCad(c, shape, false, 64)).toThrow(failure);
      expect(nativeDataDeletes).toBe(1);
      expect(cachedTriangulations(c, shape)).toBe(0);
      expect(c.volume(shape)).toBe(originalVolume);
      expect(exactCurveSignature(c, shape)).toEqual(originalCurves);
      expect(c.valid(shape)).toBe(true);
      spy.mockRestore();
      expect(tessellateCad(c, shape, false, 64).indices.length).toBeGreaterThan(0);
      expect(cachedTriangulations(c, shape)).toBe(0);
    } finally { spy.mockRestore(); c.dispose(); }
  });
});
