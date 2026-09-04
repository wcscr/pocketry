import { strToU8, zipSync } from "fflate";

/**
 * 3MF writer — the default mesh export format (per the plan: smaller than
 * STL, carries units, preserves topology; manifold's own docs discourage
 * STL). A 3MF file is an OPC zip containing an XML model; this writer emits
 * the core spec plus the standard Materials extension for display colors,
 * which current slicers (PrusaSlicer, Bambu, Orca, Cura) read.
 *
 * The writer accepts **multiple objects** and emits one `<object>` plus one
 * `<build>` item each. That is the multicolor hook from the plan: when the
 * bin's tagged parts (base / wall / lip / infill) are exported separately, a
 * multi-material workflow needs no restructuring here.
 *
 * Coordinates are emitted in millimetres (`unit="millimeter"`) with enough
 * significant digits to round-trip the Float32 geometry. 3MF stores no
 * normals; topology carries the shape.
 */

export interface ThreeMfMesh {
  /** `xyz` triples, millimetres. */
  positions: Float32Array | readonly number[];
  /** Triangle corners indexing into `positions`; CCW seen from outside. */
  indices: Uint32Array | readonly number[];
}

export interface ThreeMfObject {
  name: string;
  mesh: ThreeMfMesh;
  /** Optional printable material assignment and its display color. */
  material?: {
    name: string;
    displayColor: `#${string}`;
  };
}

export interface ThreeMfOptions {
  /** Shown as the model title by most slicers. */
  title?: string;
  /** Wrap multiple meshes into one multi-part build item. */
  assemble?: boolean;
}

const MODEL_PATH = "3D/3dmodel.model";
const BAMBU_MODEL_SETTINGS_PATH = "Metadata/model_settings.config";

interface SerializedMesh {
  vertices: readonly [x: string, y: string, z: string][];
  indices: readonly number[];
}

interface SerializedObject extends Omit<ThreeMfObject, "mesh"> {
  mesh: SerializedMesh;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/${MODEL_PATH}" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

/** Serialises objects into a complete `.3mf` (zip) byte buffer. */
export function writeThreeMf(
  objects: readonly ThreeMfObject[],
  options: ThreeMfOptions = {},
): Uint8Array {
  if (objects.length === 0) {
    throw new Error("writeThreeMf: at least one object is required");
  }
  for (const object of objects) validateMesh(object);

  const serializedObjects = objects.map((object) => ({
    ...object,
    mesh: serializeMesh(object),
  }));
  const model = buildModelXml(serializedObjects, options);
  const bambuModelSettings = buildBambuModelSettings(serializedObjects, options);
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    [MODEL_PATH]: strToU8(model),
  };
  if (bambuModelSettings !== null) {
    entries[BAMBU_MODEL_SETTINGS_PATH] = strToU8(bambuModelSettings);
  }
  return zipSync(
    entries,
    // Deterministic output: fflate stamps "now" into zip entries otherwise,
    // which would make byte-identical exports differ run to run. Zip stores
    // DOS timestamps, whose epoch is 1980 — hence not new Date(0).
    { level: 6, mtime: new Date(2000, 0, 1) },
  );
}

/**
 * Preserve the kernel's vertex identities exactly. Distinct closed components
 * can legitimately touch along an edge or at a point. Welding equal positions
 * across those components turns the shared edge into a four-face,
 * non-manifold edge in slicers. Export callers therefore provide the kernel's
 * topology mesh (without preview-only normal splits), and this boundary only
 * converts coordinates to XML-safe strings.
 */
function serializeMesh({ mesh }: ThreeMfObject): SerializedMesh {
  const vertexCount = mesh.positions.length / 3;
  const vertices: [string, string, string][] = [];

  for (let index = 0; index < vertexCount; index++) {
    const offset = index * 3;
    vertices.push([
      coord(mesh.positions[offset]),
      coord(mesh.positions[offset + 1]),
      coord(mesh.positions[offset + 2]),
    ]);
  }

  return { vertices, indices: Array.from(mesh.indices) };
}

function validateMesh({ name, mesh }: ThreeMfObject): void {
  const positionCount = mesh.positions.length;
  if (positionCount === 0 || positionCount % 3 !== 0) {
    throw new Error(`writeThreeMf: "${name}" positions length ${positionCount} is not xyz triples`);
  }
  if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) {
    throw new Error(`writeThreeMf: "${name}" indices length ${mesh.indices.length} is not triangles`);
  }
  for (const coordinate of mesh.positions) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`writeThreeMf: "${name}" has non-finite coordinate ${coordinate}`);
    }
  }
  const vertexCount = positionCount / 3;
  for (let offset = 0; offset < mesh.indices.length; offset++) {
    const index = mesh.indices[offset];
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new Error(`writeThreeMf: "${name}" triangle index ${index} out of range`);
    }
    if (offset % 3 === 2) {
      const v1 = mesh.indices[offset - 2];
      const v2 = mesh.indices[offset - 1];
      if (v1 === v2 || v2 === index || v1 === index) {
        throw new Error(
          `writeThreeMf: "${name}" triangle has repeated vertex indices`,
        );
      }
    }
  }
}

function validateMaterial(
  object: Pick<ThreeMfObject, "name" | "material">,
): void {
  if (!object.material) return;
  if (!/^#[0-9a-f]{6}$/i.test(object.material.displayColor)) {
    throw new Error(
      `writeThreeMf: "${object.name}" material color ${object.material.displayColor} is not #RRGGBB`,
    );
  }
}

function buildModelXml(
  objects: readonly SerializedObject[],
  options: ThreeMfOptions,
): string {
  const materialColors: string[] = [];
  const materialIndexByColor = new Map<string, number>();
  const objectMaterialIndices = objects.map((object) => {
    validateMaterial(object);
    if (!object.material) return null;
    const color = object.material.displayColor.toUpperCase();
    const existing = materialIndexByColor.get(color);
    if (existing !== undefined) return existing;
    const index = materialColors.length;
    materialColors.push(color);
    materialIndexByColor.set(color, index);
    return index;
  });
  const materialResourceId = materialColors.length > 0 ? 1 : null;
  const firstObjectId = materialResourceId === null ? 1 : 2;

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  parts.push(
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${
      materialResourceId === null
        ? ""
        : ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"'
    }>\n`,
  );
  if (options.title) {
    parts.push(` <metadata name="Title">${escapeXml(options.title)}</metadata>\n`);
  }
  parts.push(' <metadata name="Application">Pocketry</metadata>\n');
  parts.push(" <resources>\n");

  if (materialResourceId !== null) {
    parts.push(`  <m:colorgroup id="${materialResourceId}">\n`);
    for (const color of materialColors) {
      parts.push(`   <m:color color="${color}FF"/>\n`);
    }
    parts.push("  </m:colorgroup>\n");
  }

  objects.forEach((object, index) => {
    const id = firstObjectId + index;
    const materialIndex = objectMaterialIndices[index];
    const materialAttributes =
      materialResourceId !== null && materialIndex !== null
        ? ` pid="${materialResourceId}" pindex="${materialIndex}"`
        : "";
    parts.push(
      `  <object id="${id}" type="model" name="${escapeXml(object.name)}"${materialAttributes}>\n   <mesh>\n    <vertices>\n`,
    );
    const { vertices, indices } = object.mesh;
    for (const [x, y, z] of vertices) {
      parts.push(
        `     <vertex x="${x}" y="${y}" z="${z}"/>\n`,
      );
    }
    parts.push("    </vertices>\n    <triangles>\n");
    for (let i = 0; i < indices.length; i += 3) {
      parts.push(
        `     <triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}"/>\n`,
      );
    }
    parts.push("    </triangles>\n   </mesh>\n  </object>\n");
  });

  const shouldAssemble = options.assemble === true && objects.length > 1;
  const assemblyId = firstObjectId + objects.length;
  if (shouldAssemble) {
    parts.push(
      `  <object id="${assemblyId}" type="model" name="${escapeXml(options.title ?? "Pocketry multi-material model")}">\n   <components>\n`,
    );
    objects.forEach((_, index) => {
      parts.push(`    <component objectid="${firstObjectId + index}"/>\n`);
    });
    parts.push("   </components>\n  </object>\n");
  }

  parts.push(" </resources>\n <build>\n");
  if (shouldAssemble) {
    parts.push(`  <item objectid="${assemblyId}"/>\n`);
  } else {
    objects.forEach((_, index) => {
      parts.push(`  <item objectid="${firstObjectId + index}"/>\n`);
    });
  }
  parts.push(" </build>\n</model>\n");
  return parts.join("");
}

/**
 * Bambu Studio currently detects standard 3MF colors but does not reliably
 * retain a uniform color attached to component objects. Its vendor model-
 * settings entry gives each assembled volume an explicit extruder while other
 * slicers safely ignore the metadata and use the standard color group.
 */
function buildBambuModelSettings(
  objects: readonly SerializedObject[],
  options: ThreeMfOptions,
): string | null {
  if (options.assemble !== true || objects.length < 2) return null;
  if (!objects.some((object) => object.material)) return null;

  const materialIndices = new Map<string, number>();
  for (const object of objects) {
    if (!object.material) continue;
    const color = object.material.displayColor.toUpperCase();
    if (!materialIndices.has(color)) {
      materialIndices.set(color, materialIndices.size);
    }
  }

  const firstObjectId = 2;
  const assemblyId = firstObjectId + objects.length;
  const title = options.title ?? "Pocketry multi-material model";
  const firstExtruder = objects[0].material
    ? (materialIndices.get(objects[0].material.displayColor.toUpperCase()) ?? 0) +
      1
    : 1;
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    "<config>\n",
    ` <object id="${assemblyId}">\n`,
    `  <metadata key="name" value="${escapeXml(title)}"/>\n`,
    `  <metadata key="extruder" value="${firstExtruder}"/>\n`,
  ];

  objects.forEach((object, index) => {
    const extruder = object.material
      ? (materialIndices.get(object.material.displayColor.toUpperCase()) ?? 0) + 1
      : firstExtruder;
    parts.push(
      `  <part id="${firstObjectId + index}" subtype="normal_part">\n`,
      `   <metadata key="name" value="${escapeXml(object.name)}"/>\n`,
      `   <metadata key="extruder" value="${extruder}"/>\n`,
      `   <mesh_stat face_count="${object.mesh.indices.length / 3}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n`,
      "  </part>\n",
    );
  });
  parts.push(" </object>\n</config>\n");
  return parts.join("");
}

/** Nine significant digits round-trip every finite Float32 coordinate. */
function coord(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`writeThreeMf: non-finite coordinate ${value}`);
  }
  const text = Number(value.toPrecision(9)).toString();
  return text === "-0" ? "0" : text;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
