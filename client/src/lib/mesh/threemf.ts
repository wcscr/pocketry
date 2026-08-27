import { strToU8, zipSync } from "fflate";

/**
 * 3MF writer — the default mesh export format (per the plan: smaller than
 * STL, carries units, preserves topology; manifold's own docs discourage
 * STL). A 3MF file is an OPC zip containing an XML model; this writer emits
 * the core spec only, which every current slicer (PrusaSlicer, Bambu, Orca,
 * Cura) reads.
 *
 * The writer accepts **multiple objects** and emits one `<object>` plus one
 * `<build>` item each. That is the multicolor hook from the plan: when the
 * bin's tagged parts (base / wall / lip / infill) are exported separately, a
 * multi-material workflow needs no restructuring here.
 *
 * Coordinates are emitted in millimetres (`unit="millimeter"`), rounded to
 * 1e-4 mm — an order below any FDM printer's resolution, and it keeps files
 * compact. 3MF stores no normals; topology carries the shape.
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

  const model = buildModelXml(objects, options);
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(RELS),
      [MODEL_PATH]: strToU8(model),
    },
    // Deterministic output: fflate stamps "now" into zip entries otherwise,
    // which would make byte-identical exports differ run to run. Zip stores
    // DOS timestamps, whose epoch is 1980 — hence not new Date(0).
    { level: 6, mtime: new Date(2000, 0, 1) },
  );
}

function validateMesh({ name, mesh }: ThreeMfObject): void {
  const positionCount = mesh.positions.length;
  if (positionCount === 0 || positionCount % 3 !== 0) {
    throw new Error(`writeThreeMf: "${name}" positions length ${positionCount} is not xyz triples`);
  }
  if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) {
    throw new Error(`writeThreeMf: "${name}" indices length ${mesh.indices.length} is not triangles`);
  }
  const vertexCount = positionCount / 3;
  for (const index of mesh.indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new Error(`writeThreeMf: "${name}" triangle index ${index} out of range`);
    }
  }
}

function validateMaterial(object: ThreeMfObject): void {
  if (!object.material) return;
  if (!/^#[0-9a-f]{6}$/i.test(object.material.displayColor)) {
    throw new Error(
      `writeThreeMf: "${object.name}" material color ${object.material.displayColor} is not #RRGGBB`,
    );
  }
}

function buildModelXml(
  objects: readonly ThreeMfObject[],
  options: ThreeMfOptions,
): string {
  const materials: NonNullable<ThreeMfObject["material"]>[] = [];
  const materialIndexByKey = new Map<string, number>();
  const objectMaterialIndices = objects.map((object) => {
    validateMaterial(object);
    if (!object.material) return null;
    const key = `${object.material.name}\0${object.material.displayColor.toUpperCase()}`;
    const existing = materialIndexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = materials.length;
    materials.push(object.material);
    materialIndexByKey.set(key, index);
    return index;
  });
  const materialResourceId = materials.length > 0 ? 1 : null;
  const firstObjectId = materialResourceId === null ? 1 : 2;

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  parts.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
  );
  if (options.title) {
    parts.push(` <metadata name="Title">${escapeXml(options.title)}</metadata>\n`);
  }
  parts.push(' <metadata name="Application">Pocketry</metadata>\n');
  parts.push(" <resources>\n");

  if (materialResourceId !== null) {
    parts.push(`  <basematerials id="${materialResourceId}">\n`);
    for (const material of materials) {
      parts.push(
        `   <base name="${escapeXml(material.name)}" displaycolor="${material.displayColor.toUpperCase()}"/>\n`,
      );
    }
    parts.push("  </basematerials>\n");
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
    const { positions, indices } = object.mesh;
    for (let i = 0; i < positions.length; i += 3) {
      parts.push(
        `     <vertex x="${coord(positions[i])}" y="${coord(positions[i + 1])}" z="${coord(positions[i + 2])}"/>\n`,
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

/** 1e-4 mm resolution, trailing zeros trimmed, "-0" normalised. */
function coord(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`writeThreeMf: non-finite coordinate ${value}`);
  }
  const text = value.toFixed(4).replace(/\.?0+$/, "");
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
