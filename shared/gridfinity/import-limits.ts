/** Resource limits apply before schema migration, font expansion, or geometry work.
 * Count all snapshots and placements, including shared objects more than once:
 * each occurrence can cause separate downstream processing. Strings are shared
 * by font references, so identical strings consume their storage budget once.
 */
export const PROJECT_FILE_MAX_BYTES = 64 * 1024 * 1024;
export const LIBRARY_FILE_MAX_BYTES = 128 * 1024 * 1024;
export const PROJECT_MAX_POINTS = 100_000;
export const LIBRARY_MAX_POINTS = 500_000;
export const PROJECT_MAX_VALUES = 400_000;
export const IMPORT_LIMIT_ERROR = "This backup exceeds Pocketry's import limits. Split the library or simplify the design before importing. No designs were imported.";

export function withinImportLimits(input: unknown, library = false): boolean {
  let nodes = 0, points = 0, characters = 0, outlineCharacters = 0;
  const ancestors = new Set<object>();
  const strings = new Set<string>();
  const maxNodes = library ? 2_000_000 : PROJECT_MAX_VALUES;
  const maxPoints = library ? LIBRARY_MAX_POINTS : PROJECT_MAX_POINTS;
  const maxCharacters = library ? LIBRARY_FILE_MAX_BYTES : PROJECT_FILE_MAX_BYTES;
  function visit(value: unknown, depth: number, key: string): boolean {
    if (++nodes > maxNodes || depth > 64) return false;
    if (typeof value === "string") {
      if (key === "o" && (outlineCharacters += value.length) > (library ? 64_000_000 : 16_000_000)) return false;
      if (!strings.has(value)) { strings.add(value); characters += value.length; }
      return characters <= maxCharacters;
    }
    if (!value || typeof value !== "object") return true;
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    if (Array.isArray(value)) {
      const limit = key === "projects" ? 500 : key === "stack" ? 50
        : ["shapes", "cutouts", "fingerHoles", "pockets", "holes"].includes(key) ? 512 : 10_000;
      if (value.length > limit) return false;
      for (const entry of value) if (!visit(entry, depth + 1, "")) return false;
    } else {
      const object = value as Record<string, unknown>;
      if (typeof object.x === "number" && typeof object.y === "number" && ++points > maxPoints) return false;
      for (const property in object) {
        if (!Object.prototype.hasOwnProperty.call(object, property)) continue;
        if ((characters += property.length) > maxCharacters || !visit(object[property], depth + 1, property)) return false;
      }
    }
    ancestors.delete(value);
    return true;
  }
  if (!visit(input, 0, "")) return false;
  // A small file can place one detailed shape hundreds of times. Count its
  // geometry again for each placement, including undo and transform sources.
  let placedPoints = 0;
  const glyphCosts = new Map<string, number>();
  const glyphPoints = (outline: string): number => {
    const cached = glyphCosts.get(outline);
    if (cached !== undefined) return cached;
    let count = 0;
    // FontLoader samples each quadratic/cubic segment with 12 divisions.
    // Count commands without allocating a token array for hostile outlines.
    for (const match of outline.matchAll(/(?:^|\s)([mlqb])(?=\s|$)/g)) count += match[1] === "q" || match[1] === "b" ? 12 : 1;
    glyphCosts.set(outline, count);
    return count;
  };
  const countPoints = (value: unknown): number => {
    if (!value || typeof value !== "object") return 0;
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + countPoints(item), 0);
    const object = value as Record<string, unknown>;
    return typeof object.x === "number" && typeof object.y === "number" ? 1
      : Object.values(object).reduce<number>((sum, item) => sum + countPoints(item), 0);
  };
  function placements(value: unknown, shapes = new Map<string, number>()): boolean {
    if (!value || typeof value !== "object") return true;
    if (Array.isArray(value)) return value.every(item => placements(item, shapes));
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.shapes)) {
      shapes = new Map();
      for (const shape of object.shapes) {
        if (shape && typeof shape === "object" && typeof shape.id === "string") shapes.set(shape.id, countPoints(shape.outlineMm));
      }
    }
    if (typeof object.shapeId === "string") placedPoints += shapes.get(object.shapeId) ?? 0;
    if (typeof object.text === "string" && object.font && typeof object.font === "object") {
      const font = object.font as Record<string, unknown>;
      if (font.kind === "local" && font.glyphs && typeof font.glyphs === "object") {
        const glyphs = font.glyphs as Record<string, unknown>;
        for (const character of object.text) {
          const glyph = Object.prototype.hasOwnProperty.call(glyphs, character) ? glyphs[character] : null;
          if (glyph && typeof glyph === "object" && "o" in glyph && typeof glyph.o === "string") placedPoints += glyphPoints(glyph.o);
          if (placedPoints > (library ? 5_000_000 : 1_000_000)) return false;
        }
      }
    }
    if (placedPoints > (library ? 5_000_000 : 1_000_000)) return false;
    return Object.values(object).every(item => placements(item, shapes));
  }
  return placements(input);
}

/** Check Blob.size before allocating a string or parsing JSON. */
export async function readImportJson(file: Pick<File, "size" | "text">, library = false): Promise<unknown> {
  if (file.size > (library ? LIBRARY_FILE_MAX_BYTES : PROJECT_FILE_MAX_BYTES)) throw new Error(IMPORT_LIMIT_ERROR);
  return JSON.parse(await file.text()) as unknown;
}
