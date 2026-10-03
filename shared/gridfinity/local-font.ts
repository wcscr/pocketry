import { z } from "zod";

// Cache only successful validation of immutable strings. The length and all
// other fields are still checked on every parse; retained data is bounded.
const validatedSources = new Map<string, true>();
let validatedSourceCharacters = 0;
const sourceData = z.string().max(28_000_000).refine(data => {
  if (validatedSources.has(data)) return true;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  validatedSources.set(data, true);
  validatedSourceCharacters += data.length;
  while (validatedSources.size > 8 || validatedSourceCharacters > 32_000_000) {
    const oldest = validatedSources.keys().next().value!;
    validatedSources.delete(oldest);
    validatedSourceCharacters -= oldest.length;
  }
  return true;
}, "Invalid saved font data.");

export const localFontSourceSchema = z.object({
  data: sourceData,
  byteLength: z.number().int().positive().max(20 * 1024 * 1024),
}).strict();
export type LocalFontSource = z.infer<typeof localFontSourceSchema>;

/** Portable outline data, not a path to a font installed on one computer. */
const outlineCommand = z.string().max(200_000).refine(value => {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const arity: Record<string, number> = { m: 2, l: 2, q: 4, b: 6, z: 0 };
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    if (!Object.prototype.hasOwnProperty.call(arity, command)) return false;
    const count = arity[command];
    for (let n = 0; n < count; n++) {
      const token = tokens[i++];
      if (!token || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) return false;
      const value = Number(token);
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) return false;
    }
  }
  return true;
}, "Invalid font outline.");

export const localFontSchema = z.object({
  kind: z.literal("local"),
  name: z.string().trim().min(1).max(200),
  /** Compressed source permits new wording without renewed system-font permission. */
  source: localFontSourceSchema.optional(),
  resolution: z.number().finite().positive().max(1_000_000),
  glyphs: z.record(z.string().refine(key => Array.from(key).length === 1), z.object({
    ha: z.number().finite().min(-1_000_000).max(1_000_000),
    o: outlineCommand,
  }).strict()).refine(glyphs => Object.keys(glyphs).length > 0 && Object.keys(glyphs).length <= 65_536 &&
    Object.values(glyphs).reduce((size, glyph) => size + glyph.o.length, 0) <= 4_000_000, "This font has too much outline data. Choose a smaller font."),
}).strict();

export type LocalFont = z.infer<typeof localFontSchema>;
