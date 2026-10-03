/** The font parser already distributed with Three.js; only the APIs we use. */
declare module "three/examples/jsm/libs/opentype.module.js" {
  export interface Font {
    unitsPerEm: number;
    charToGlyphIndex(character: string): number;
    charToGlyph(character: string): {
      advanceWidth: number;
      path: { commands: { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[] };
    };
    getEnglishName(name: string): string;
  }
  const opentype: { parse(buffer: ArrayBuffer, options?: { lowMemory?: boolean }): Font };
  export default opentype;
}
