import { gzipSync, gunzipSync } from "fflate";
import type { Font } from "three/examples/jsm/libs/opentype.module.js";
import { localFontSchema, type LocalFont } from "@shared/gridfinity/local-font";

export interface SystemFont {
  family: string;
  fullName: string;
  style: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}
type LocalFontWindow = Window & { queryLocalFonts?: () => Promise<SystemFont[]> };

export function supportsSystemFonts(): boolean {
  return typeof window !== "undefined" && typeof (window as LocalFontWindow).queryLocalFonts === "function";
}

/** Call directly from the user's button click so the browser owns the permission prompt. */
export async function listSystemFonts(): Promise<SystemFont[]> {
  if (!supportsSystemFonts()) throw new Error("This browser cannot access system fonts. Choose a built-in font.");
  try {
    const fonts = await (window as LocalFontWindow).queryLocalFonts!();
    return [...new Map(fonts.map(font => [font.postscriptName, font])).values()]
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "name" in cause && cause.name === "NotAllowedError") {
      throw new Error("Font access was not allowed. Allow local font access in your browser's site settings, or choose a built-in font.");
    }
    throw new Error("Could not access system fonts. Try again or choose a built-in font.");
  }
}

// Bound retained parser data even after trying many fonts. Geometry uses saved outlines.
const parsedFonts = new Map<string, Font>();
function remember(source: string, font: Font): Font {
  parsedFonts.delete(source);
  parsedFonts.set(source, font);
  if (parsedFonts.size > 2) parsedFonts.delete(parsedFonts.keys().next().value!);
  return font;
}
function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
async function parse(bytes: ArrayBuffer): Promise<Font> {
  const { default: opentype } = await import("three/examples/jsm/libs/opentype.module.js");
  try { return opentype.parse(bytes, { lowMemory: true }); }
  catch { throw new Error("This font's format has no supported vector outlines for 3D text. Choose another system font or a built-in font."); }
}
function glyphsFor(font: Font, text: string, name: string): LocalFont["glyphs"] {
  const characters = [...new Set(text)];
  const missing = characters.filter(char => !font.charToGlyphIndex(char));
  if (missing.length) throw new Error(`“${name}” does not include ${missing.map(char => `“${char}”`).join(", ")}. Choose a font that contains these characters or change the wording.`);
  return Object.fromEntries(characters.map(char => {
    const glyph = font.charToGlyph(char);
    const o = glyph.path.commands.map(command => {
      const type = command.type.toLowerCase();
      const coordinates = [command.x, command.y, command.x1, command.y1, command.x2, command.y2]
        .filter((value): value is number => value !== undefined).map(value => Math.round(value * 1000) / 1000);
      return [type === "c" ? "b" : type, ...coordinates].join(" ");
    }).join(" ");
    return [char, { ha: glyph.advanceWidth, o }];
  }));
}

/** Preflight visible choices before enabling them in the font dropdown. */
export async function inspectSystemFont(blob: Blob, name: string, text: string): Promise<void> {
  if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error("Too large to save with this project");
  const font = await parse(await blob.arrayBuffer());
  const glyphs = glyphsFor(font, text, name);
  if (!Object.values(glyphs).some(glyph => glyph.o.includes("m"))) throw new Error("No printable outlines for this wording");
}

/** Store the compact source and only used glyph outlines, not an entire expanded character set. */
export async function importLocalFont(blob: Blob, name: string, text: string): Promise<LocalFont> {
  if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error("This system font is too large to save with the project. Choose another system font or a built-in font.");
  const bytes = await blob.arrayBuffer();
  const font = await parse(bytes);
  const glyphs = glyphsFor(font, text, name);
  if (!Object.values(glyphs).some(glyph => glyph.o.includes("m"))) throw new Error(`“${name}” has no printable outlines for this wording. Choose another font.`);
  const data = encode(gzipSync(new Uint8Array(bytes)));
  const result = localFontSchema.parse({ kind: "local", name, resolution: font.unitsPerEm,
    source: { data, byteLength: bytes.byteLength }, glyphs });
  remember(data, font);
  return result;
}

/** Called only when an edit needs additional glyphs; saved text never needs the parser. */
export async function extendLocalFont(font: LocalFont, text: string): Promise<LocalFont> {
  if ([...text].every(char => Object.prototype.hasOwnProperty.call(font.glyphs, char)) || !font.source) return font;
  const { source } = font;
  let parsed = parsedFonts.get(source.data);
  if (!parsed) {
    const compressed = Uint8Array.from(atob(source.data), char => char.charCodeAt(0));
    // Use a bounded output buffer for untrusted project data and validate the gzip length.
    const expectedLength = new DataView(compressed.buffer).getUint32(compressed.length - 4, true);
    if (expectedLength !== source.byteLength) throw new Error("The saved font data is damaged. Choose the system font again.");
    const bytes = gunzipSync(compressed, { out: new Uint8Array(source.byteLength) });
    parsed = remember(source.data, await parse(bytes.buffer as ArrayBuffer));
  }
  return localFontSchema.parse({ ...font, glyphs: { ...font.glyphs, ...glyphsFor(parsed, text, font.name) } });
}
