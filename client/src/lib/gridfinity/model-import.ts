import { MODEL_MAX_FILE_BYTES, MODEL_MAX_TRIANGLES, MODEL_UNIT_MM, importedModelSchema, modelUnitsSchema, type ImportedModel, type ModelUnits } from "@shared/gridfinity/model-pocket";
import { tracedShapeSchema, type TracedShape } from "@shared/gridfinity/cutout";
import { normalizeOutline, outlineBounds, outlinePointCount } from "@/lib/geometry/outline";
import { polygonsToOutline } from "@/lib/geometry/offset";
import type { Kernel } from "@/lib/manifold/runtime";

const COMPLEXITY_ERROR = `Model is too complex. Simplify it to ${MODEL_MAX_TRIANGLES.toLocaleString("en-US")} triangles or fewer and export STL again.`;

/** Bounded binary/ASCII STL parser. File normals are ignored; winding defines the solid. */
export function parseStl(buffer: ArrayBuffer, units: ModelUnits): ImportedModel {
  modelUnitsSchema.parse(units);
  if (!buffer.byteLength || buffer.byteLength > MODEL_MAX_FILE_BYTES) throw new Error("Choose an STL file smaller than 10 MiB.");
  const positions: number[] = [], indices: number[] = [], lookup = new Map<string, number>();
  const factor = MODEL_UNIT_MM[units];
  const vertex = (x: number, y: number, z: number) => {
    const point = [x, y, z].map(n => Math.fround(n * factor));
    if (point.some(n => !Number.isFinite(n) || Math.abs(n) > 1e7)) throw new Error("The STL contains invalid coordinates. Check its units and re-export it.");
    const key = point.join(",");
    let index = lookup.get(key);
    if (index === undefined) { index = positions.length / 3; lookup.set(key, index); positions.push(...point); }
    indices.push(index);
  };
  const view = new DataView(buffer);
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  if (84 + count * 50 === buffer.byteLength) {
    if (count > MODEL_MAX_TRIANGLES) throw new Error(COMPLEXITY_ERROR);
    for (let i = 0; i < count; i++) for (let corner = 0; corner < 3; corner++) {
      const at = 84 + i * 50 + 12 + corner * 12;
      vertex(view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true));
    }
  } else {
    const text = new TextDecoder().decode(buffer);
    const wrapper = /^\s*solid[^\r\n]*\r?\n([\s\S]*?)\bendsolid[^\r\n]*\s*$/i.exec(text);
    if (!wrapper) throw new Error("This is not a complete binary or ASCII STL. Re-export the model as STL.");
    const body = wrapper[1];
    const number = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
    const triple = `(${number})\\s+(${number})\\s+(${number})`;
    const facet = new RegExp(`\\s*facet\\s+normal\\s+${number}\\s+${number}\\s+${number}\\s+outer\\s+loop\\s+vertex\\s+${triple}\\s+vertex\\s+${triple}\\s+vertex\\s+${triple}\\s+endloop\\s+endfacet`, "iy");
    let end = 0;
    while (end < body.trimEnd().length) {
      facet.lastIndex = end;
      const match = facet.exec(body);
      if (!match) throw new Error("The ASCII STL contains an incomplete or invalid triangle. Re-export it.");
      if (indices.length / 3 >= MODEL_MAX_TRIANGLES) throw new Error(COMPLEXITY_ERROR);
      for (let i = 1; i <= 9; i += 3) vertex(Number(match[i]), Number(match[i + 1]), Number(match[i + 2]));
      end = facet.lastIndex;
    }
  }
  if (indices.length < 12) throw new Error("The STL must contain a closed 3D solid.");
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  positions.forEach((n, i) => { min[i % 3] = Math.min(min[i % 3], n); max[i % 3] = Math.max(max[i % 3], n); });
  if (max.some((n, i) => n - min[i] < 0.001 || n - min[i] > 2000)) throw new Error("Model dimensions must be between 0.001 and 2,000 mm on each axis. Check the STL units.");
  const center = min.map((n, i) => (n + max[i]) / 2);
  const model = importedModelSchema.parse({ format: "stl", units, positions: positions.map((n, i) => n - center[i % 3]), indices });
  validateModelTopology(model);
  return model;
}

/** Reject open, degenerate or inconsistently wound meshes, including saved project data. */
export function validateModelTopology(model: ImportedModel): void {
  const edges = new Map<string, { count: number; direction: number }>();
  const p = model.positions, ids = model.indices;
  let volume6 = 0;
  for (let i = 0; i < ids.length; i += 3) {
    const [a, b, c] = ids.slice(i, i + 3);
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
    const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
    const cross = [(by-ay)*(cz-az)-(bz-az)*(cy-ay), (bz-az)*(cx-ax)-(bx-ax)*(cz-az), (bx-ax)*(cy-ay)-(by-ay)*(cx-ax)];
    // CSG can leave very small but nonzero faces. An absolute area cutoff
    // rejects valid watertight exports; the kernel handles numerical tolerance.
    if (a === b || a === c || b === c || Math.hypot(...cross) === 0) throw new Error("The model has collapsed triangles. Repair the mesh and re-export STL.");
    volume6 += ax*(by*cz-bz*cy) + ay*(bz*cx-bx*cz) + az*(bx*cy-by*cx);
    for (const [from, to] of [[a,b],[b,c],[c,a]]) {
      const key = `${Math.min(from,to)}:${Math.max(from,to)}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++; edge.direction += from < to ? 1 : -1; edges.set(key, edge);
    }
  }
  if ([...edges.values()].some(e => e.count !== 2 || e.direction !== 0)) throw new Error("The model is open, non-manifold, or has inconsistent face directions. Repair it into a watertight solid and re-export STL.");
  if (volume6 <= 1e-9) throw new Error("The model has no positive solid volume. Repair its outward face directions and re-export STL.");
}

export function modelSolid(kernel: Kernel, model: ImportedModel) {
  validateModelTopology(model);
  const solid = kernel.arena.track(new kernel.Manifold(new kernel.Mesh({ numProp: 3,
    vertProperties: new Float32Array(model.positions), triVerts: new Uint32Array(model.indices) })));
  if (solid.status() !== "NoError" || solid.isEmpty() || solid.volume() <= 0) throw new Error("The model could not form a valid solid. Repair its mesh and re-export STL.");
  return solid;
}

/** Runs in a dedicated worker; no input file or path is retained. */
export function importModelShape(kernel: Kernel, buffer: ArrayBuffer, units: ModelUnits, name: string, id: string): TracedShape {
  const model = parseStl(buffer, units);
  const solid = modelSolid(kernel, model);
  const outlineMm = normalizeOutline(polygonsToOutline(kernel.arena.track(solid.project()).toPolygons()));
  return tracedShapeSchema.parse({ id, name: name.trim() || "Imported model", source: "model", sourceMmPerPx: null,
    outlineMm, bboxMm: outlineBounds(outlineMm), pointCount: outlinePointCount(outlineMm), model });
}
