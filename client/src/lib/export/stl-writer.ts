/**
 * Binary STL serialisation, split from `./stl` so mesh producers that never
 * touch the tracing pipeline (the Gridfinity bin exporter, Node scripts) can
 * write STL without importing the manifold runtime loader — whose
 * `manifold.wasm?url` import only resolves under Vite. This module is pure:
 * typed arrays in, ArrayBuffer out.
 */

/** Positions are `xyz` triples; `indices` are triangle corners into them. */
export interface StlMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Default 80-byte header.
 *
 * It must not begin with `solid`: that word starts an *ASCII* STL, and several
 * readers sniff the first five bytes rather than checking the file length.
 */
const DEFAULT_HEADER = "Pocketry binary STL";

export const STL_HEADER_BYTES = 80;
export const STL_TRIANGLE_BYTES = 50;

/**
 * Serialises an indexed mesh as a binary STL: an 80-byte header, a `uint32`
 * triangle count, then 50 bytes per facet — normal, three vertices, and a
 * 2-byte attribute count — all little-endian `Float32`.
 */
export function writeBinarySTL(mesh: StlMesh, header?: string): ArrayBuffer {
  const { positions, indices } = mesh;
  if (indices.length % 3 !== 0) {
    throw new Error(
      `writeBinarySTL: indices must be a multiple of 3, got ${indices.length}`,
    );
  }

  const triangles = indices.length / 3;
  const buffer = new ArrayBuffer(
    STL_HEADER_BYTES + 4 + STL_TRIANGLE_BYTES * triangles,
  );
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  bytes.set(encodeHeader(header ?? DEFAULT_HEADER));
  view.setUint32(STL_HEADER_BYTES, triangles, true);

  let offset = STL_HEADER_BYTES + 4;
  for (let tri = 0; tri < triangles; tri++) {
    const a = indices[tri * 3] * 3;
    const b = indices[tri * 3 + 1] * 3;
    const c = indices[tri * 3 + 2] * 3;
    if (
      a + 2 >= positions.length ||
      b + 2 >= positions.length ||
      c + 2 >= positions.length
    ) {
      throw new Error(`writeBinarySTL: triangle ${tri} indexes past the vertex list`);
    }

    // Doubles throughout the normal maths: normalising in Float32 loses two
    // decimal digits before the value is ever rounded down for storage.
    const normal = facetNormal(positions, a, b, c);
    view.setFloat32(offset, normal[0], true);
    view.setFloat32(offset + 4, normal[1], true);
    view.setFloat32(offset + 8, normal[2], true);
    offset += 12;

    for (const base of [a, b, c]) {
      view.setFloat32(offset, positions[base], true);
      view.setFloat32(offset + 4, positions[base + 1], true);
      view.setFloat32(offset + 8, positions[base + 2], true);
      offset += 12;
    }

    // Attribute byte count. Zero: the colour extensions are not interoperable.
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return buffer;
}

/**
 * `normalize(cross(v1 − v0, v2 − v0))`.
 *
 * A degenerate triangle has no normal; the spec allows `(0, 0, 0)` there and
 * readers recompute it from the winding, which is what the fallback returns.
 */
function facetNormal(
  positions: Float32Array,
  a: number,
  b: number,
  c: number,
): [number, number, number] {
  const ux = positions[b] - positions[a];
  const uy = positions[b + 1] - positions[a + 1];
  const uz = positions[b + 2] - positions[a + 2];
  const vx = positions[c] - positions[a];
  const vy = positions[c + 1] - positions[a + 1];
  const vz = positions[c + 2] - positions[a + 2];

  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;

  const length = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(length) || length === 0) return [0, 0, 0];
  return [nx / length, ny / length, nz / length];
}

/**
 * Packs the header into exactly 80 bytes.
 *
 * ASCII only and space-substituted: the field has no declared encoding, and a
 * multi-byte character truncated at byte 80 leaves a mangled sequence.
 */
function encodeHeader(text: string): Uint8Array {
  const source = /^\s*solid/i.test(text) ? `binary ${text}` : text;
  const bytes = new Uint8Array(STL_HEADER_BYTES);
  const limit = Math.min(STL_HEADER_BYTES, source.length);
  for (let i = 0; i < limit; i++) {
    const code = source.charCodeAt(i);
    bytes[i] = code >= 32 && code < 127 ? code : 32;
  }
  return bytes;
}
