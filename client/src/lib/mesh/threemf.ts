import { strToU8, zipSync } from "fflate";
import { prusaColorProject } from "./prusa-color-project";

/**
 * 3MF writer — the default mesh export format (per the plan: smaller than
 * STL, carries units, preserves topology; manifold's own docs discourage
 * STL). A 3MF file is an OPC zip containing an XML model; this writer emits
 * the core spec plus the standard Materials extension for display colors.
 * Slicer support varies; combineObjects provides a per-face color alternative
 * for Bambu Studio 2.9.1.70, which drops uniform component assignments.
 * prusaPaint adds filament-region assignments for PrusaSlicer 2.9.7 and 3.0 alpha12/13.
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
  /** One mesh with per-face colors, for slicers that lose component colors.
   * Preserves vertex identities and geometry, but not separate named parts.
   * Takes precedence over `assemble`. */
  combineObjects?: boolean;
  /** Add PrusaSlicer 2.9.7/3.0 alpha12/13 painting alongside standard colors (up to 255).
   * Requires combineObjects; filament slots follow the deduplicated palette.
   * On its own, does not embed printer, filament, or process settings. */
  prusaPaint?: boolean;
  /** Set up palette slots/colors using a labeled preview printer project.
   * Requires combineObjects and prusaPaint. Open as a project in PrusaSlicer;
   * select the actual printer and print settings before printing. */
  prusaColorPreview?: boolean;
}

const MODEL_PATH = "3D/3dmodel.model";
const BAMBU_MODEL_SETTINGS_PATH = "Metadata/model_settings.config";
const PRUSA_FACETS_PATH = "Metadata/Slic3r_facets_annotation.json";

interface SerializedMesh {
  vertices: readonly [x: string, y: string, z: string][];
  indices: readonly number[];
}

interface SerializedObject extends Omit<ThreeMfObject, "mesh"> {
  mesh: SerializedMesh;
}

interface MaterialPalette {
  colors: string[];
  objectIndices: (number | null)[];
}

interface PrusaPainting {
  version: 1 | 2;
  objectCodes: (string | null)[];
  annotations: string;
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
  if (options.prusaPaint && !options.combineObjects) {
    throw new Error("writeThreeMf: Prusa painting requires combined objects");
  }
  if (options.prusaColorPreview && (!options.prusaPaint || !options.combineObjects)) {
    throw new Error("writeThreeMf: Prusa color preview requires combined objects and painting");
  }
  for (const object of objects) validateMesh(object);

  const palette = collectMaterials(objects);
  const painting = options.prusaPaint ? buildPrusaPainting(objects, palette) : null;
  const serializedObjects = objects.map((object) => ({
    ...object,
    mesh: serializeMesh(object),
  }));
  const model = buildModelXml(serializedObjects, options, palette, painting);
  const bambuModelSettings = buildBambuModelSettings(serializedObjects, options);
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(painting === null ? CONTENT_TYPES : CONTENT_TYPES.replace(
      "</Types>", ' <Default Extension="json" ContentType="application/json"/>\n</Types>',
    )),
    "_rels/.rels": strToU8(RELS),
    [MODEL_PATH]: strToU8(model),
  };
  if (bambuModelSettings !== null) {
    entries[BAMBU_MODEL_SETTINGS_PATH] = strToU8(bambuModelSettings);
  }
  if (painting !== null) {
    entries[PRUSA_FACETS_PATH] = strToU8(painting.annotations);
  }
  if (options.prusaColorPreview && painting !== null) {
    // Fit the preview bed around existing coordinates without moving the model.
    let extent = 100;
    for (const object of objects) {
      for (let i = 0; i < object.mesh.positions.length; i++) {
        if (i % 3 !== 2) extent = Math.max(extent, Math.abs(object.mesh.positions[i]) + 20);
      }
    }
    for (const [path, content] of Object.entries(prusaColorProject(palette.colors, Math.ceil(extent)))) {
      entries[path] = strToU8(content);
    }
    entries["[Content_Types].xml"] = strToU8(CONTENT_TYPES.replace("</Types>",
      ' <Default Extension="json" ContentType="application/json"/>\n <Default Extension="config" ContentType="text/plain"/>\n</Types>'));
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

function collectMaterials(objects: readonly ThreeMfObject[]): MaterialPalette {
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
  return { colors: materialColors, objectIndices: objectMaterialIndices };
}

/** Whole-face Prusa paint codes, independently encoded from the file format.
 * Low bits describe an unsplit triangle; the remaining bits select a filament.
 * See docs/bambu-3mf-compatibility.md for format references and round-trip proof. */
function prusaPaintCode(slot: number): string {
  if (slot <= 2) return (slot * 4).toString(16).toUpperCase();
  if (slot <= 16) return ((slot - 3) * 16 + 0x0c).toString(16).toUpperCase().padStart(2, "0");
  return ((slot - 17) * 256 + 0xec).toString(16).toUpperCase().padStart(4, "0");
}

function buildPrusaPainting(objects: readonly ThreeMfObject[], palette: MaterialPalette): PrusaPainting | null {
  if (palette.colors.length === 0) return null;
  if (palette.colors.length > 255) {
    throw new Error("Prusa painting supports at most 255 distinct colors. Reduce the colors or use regular Multi-color 3MF.");
  }
  const version = palette.colors.length <= 16 ? 1 : 2;
  const objectCodes = palette.objectIndices.map(index => index === null ? null : prusaPaintCode(index + 1));
  const facets: string[] = [];
  let triangleOffset = 0;
  objects.forEach((object, index) => {
    const count = object.mesh.indices.length / 3;
    const code = objectCodes[index];
    // Uncolored faces retain the slicer's default filament; still advance the
    // triangle offset so later painted objects reference the correct faces.
    if (code !== null) {
      for (let triangle = 0; triangle < count; triangle++) {
        facets.push(`{"triangle":${triangleOffset + triangle},"dividing":"${code}"}`);
      }
    }
    triangleOffset += count;
  });
  return {
    version,
    objectCodes,
    // The standard color resource occupies id 1; the combined mesh is id 2.
    annotations: `[{"id":2,"mmSegmentationFacetsVersion":${version},"mmSegmentationFacets":[${facets.join(",")}]}]`,
  };
}

function buildModelXml(
  objects: readonly SerializedObject[],
  options: ThreeMfOptions,
  palette: MaterialPalette,
  painting: PrusaPainting | null,
): string {
  const { colors: materialColors, objectIndices: objectMaterialIndices } = palette;
  const materialResourceId = materialColors.length > 0 ? 1 : null;
  const firstObjectId = materialResourceId === null ? 1 : 2;

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  parts.push(
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${
      materialResourceId === null
        ? ""
        : ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"'
    }${painting === null ? "" : ' xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"'}>\n`,
  );
  if (options.title) {
    parts.push(` <metadata name="Title">${escapeXml(options.title)}</metadata>\n`);
  }
  parts.push(' <metadata name="Application">Pocketry</metadata>\n');
  if (painting !== null) {
    parts.push(` <metadata name="slic3rpe:MmPaintingVersion">${painting.version}</metadata>\n`);
  }
  parts.push(" <resources>\n");

  if (materialResourceId !== null) {
    parts.push(`  <m:colorgroup id="${materialResourceId}">\n`);
    for (const color of materialColors) {
      parts.push(`   <m:color color="${color}FF"/>\n`);
    }
    parts.push("  </m:colorgroup>\n");
  }

  if (options.combineObjects) {
    parts.push(`  <object id="${firstObjectId}" type="model" name="${escapeXml(options.title ?? "Pocketry multi-color model")}">\n   <mesh>\n    <vertices>\n`);
    for (const object of objects) {
      for (const [x, y, z] of object.mesh.vertices) {
        parts.push(`     <vertex x="${x}" y="${y}" z="${z}"/>\n`);
      }
    }
    parts.push("    </vertices>\n    <triangles>\n");
    let vertexOffset = 0;
    objects.forEach((object, index) => {
      const materialIndex = objectMaterialIndices[index];
      // No object-level default: an uncolored input must remain uncolored.
      const materialAttributes = materialIndex === null ? "" : ` pid="${materialResourceId}" p1="${materialIndex}"`;
      const paintCode = painting?.objectCodes[index];
      const paintAttribute = paintCode == null ? "" : ` slic3rpe:mmu_segmentation="${paintCode}"`;
      const { indices, vertices } = object.mesh;
      for (let i = 0; i < indices.length; i += 3) {
        parts.push(`     <triangle v1="${indices[i] + vertexOffset}" v2="${indices[i + 1] + vertexOffset}" v3="${indices[i + 2] + vertexOffset}"${materialAttributes}${paintAttribute}/>\n`);
      }
      vertexOffset += vertices.length;
    });
    parts.push("    </triangles>\n   </mesh>\n  </object>\n");
  } else objects.forEach((object, index) => {
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

  const shouldAssemble = !options.combineObjects && options.assemble === true && objects.length > 1;
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
  if (options.combineObjects) {
    parts.push(`  <item objectid="${firstObjectId}"/>\n`);
  } else if (shouldAssemble) {
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
 * Legacy Bambu part assignments for the regular assembled export. Recent
 * Bambu Studio versions no longer reliably honor these for third-party files;
 * combineObjects bypasses this metadata and uses standard per-face colors.
 */
function buildBambuModelSettings(
  objects: readonly SerializedObject[],
  options: ThreeMfOptions,
): string | null {
  if (options.combineObjects) return null;
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

/** Preserve the exact stored value when a slicer parses XML as doubles. */
function coord(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`writeThreeMf: non-finite coordinate ${value}`);
  }
  const text = value.toString();
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
