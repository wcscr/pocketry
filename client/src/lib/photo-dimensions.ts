/** Header-only inspection: never ask a native decoder to allocate an unbounded
 * raster. This is a resource gate, not a replacement image-format decoder.
 */
export const PHOTO_MAX_PIXELS = 50_000_000;
export const PHOTO_MAX_SIDE = 16_384;
export const PHOTO_DIMENSION_ERROR = "This photo is too large to decode safely. Resize it to at most 50 megapixels and 16,384 pixels per side.";
const INVALID = "Choose a valid, still PNG, JPG, or WebP photo.";
type Size = { width: number; height: number };

export function checkPhotoDimensions(size: Size): Size {
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0) throw new Error(INVALID);
  if (size.width > PHOTO_MAX_SIDE || size.height > PHOTO_MAX_SIDE || size.width * size.height > PHOTO_MAX_PIXELS) throw new Error(PHOTO_DIMENSION_ERROR);
  return size;
}

export function inspectPhotoDimensions(bytes: Uint8Array): Size {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (): never => { throw new Error(INVALID); };
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const u24 = (offset: number) => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
  // PNG: the first IHDR is authoritative. Reject animation and conflicting
  // headers, including chunks appearing after IDAT.
  if (bytes.length >= 8 && bytes[0] === 137 && text(1, 7) === "PNG\r\n\x1a\n") {
    let size: Size | undefined, ended = false;
    for (let at = 8; at < bytes.length;) {
      if (at + 12 > bytes.length) fail();
      const length = view.getUint32(at), kind = text(at + 4, 4);
      if (length > bytes.length - at - 12) fail();
      if (at === 8 && kind !== "IHDR") fail();
      if (kind === "IHDR") {
        if (size || length !== 13) fail();
        size = checkPhotoDimensions({ width: view.getUint32(at + 8), height: view.getUint32(at + 12) });
      }
      if (kind === "acTL" || kind === "fcTL" || kind === "fdAT") fail();
      at += length + 12;
      if (kind === "IEND") { if (length !== 0 || at !== bytes.length) fail(); ended = true; break; }
    }
    return size && ended ? size : fail();
  }
  // JPEG: scan bounded metadata segments to the first scan. Dimensions from
  // SOF must be nonzero (DNL deferred-height images are deliberately rejected).
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let size: Size | undefined;
    for (let at = 2; at < bytes.length;) {
      if (bytes[at++] !== 255) fail();
      while (at < bytes.length && bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 0xda) return size ?? fail();
      if (marker === 0xd9 || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) fail();
      if (marker === 1) continue;
      if (at + 2 > bytes.length) fail();
      const length = view.getUint16(at);
      if (length < 2 || length > bytes.length - at) fail();
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (size || length < 8) fail();
        size = checkPhotoDimensions({ width: view.getUint16(at + 5), height: view.getUint16(at + 3) });
      }
      at += length;
    }
    return fail();
  }
  // WebP: compare the optional VP8X canvas with the actual VP8/VP8L frame;
  // trusting only VP8X permits a tiny canvas to mask a huge decoded frame.
  if (bytes.length >= 12 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== bytes.length) fail();
    let canvas: Size | undefined, frame: Size | undefined;
    for (let at = 12; at < bytes.length;) {
      if (at + 8 > bytes.length) fail();
      const kind = text(at, 4), length = view.getUint32(at + 4, true), start = at + 8;
      if (length > bytes.length - start) fail();
      if (kind === "ANIM" || kind === "ANMF") fail();
      if (kind === "VP8X") {
        if (canvas || at !== 12 || length !== 10 || (bytes[start] & 2)) fail();
        canvas = checkPhotoDimensions({ width: u24(start + 4) + 1, height: u24(start + 7) + 1 });
      }
      if (kind === "VP8 " || kind === "VP8L") {
        if (frame) fail();
        if (kind === "VP8 ") {
          if (length < 10 || (bytes[start] & 1) || text(start + 3, 3) !== "\x9d\x01\x2a") fail();
          frame = checkPhotoDimensions({ width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff });
        } else {
          if (length < 5 || bytes[start] !== 0x2f || (bytes[start + 4] & 0xe0)) fail();
          const bits = view.getUint32(start + 1, true);
          frame = checkPhotoDimensions({ width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 });
        }
      }
      at = start + length + (length % 2);
      if (at > bytes.length) fail();
    }
    if (!frame || (canvas && (canvas.width !== frame.width || canvas.height !== frame.height))) fail();
    return frame!;
  }
  return fail();
}

/** Decode only bounded base64 strings; inspect headers before any native sink. */
function photoDataUrlBytes(url: string, maxBytes: number, allowUnspecifiedMime = false): Uint8Array {
  const comma = url.indexOf(",");
  const prefix = url.slice(0, comma);
  const supported = /^data:image\/(?:png|jpeg|webp);base64$/i.test(prefix);
  const unspecified = allowUnspecifiedMime && /^data:(?:application\/octet-stream)?;base64$/i.test(prefix);
  if (comma < 0 || (!supported && !unspecified) || url.length - comma - 1 > Math.ceil(maxBytes / 3) * 4) throw new Error(INVALID);
  let binary: string;
  try { binary = atob(url.slice(comma + 1)); } catch { throw new Error(INVALID); }
  if (binary.length > maxBytes) throw new Error(INVALID);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/** Validate recovered photos before they can reach SVG <image> or Image. */
export function inspectPhotoDataUrl(url: string, maxBytes: number): Size {
  return inspectPhotoDimensions(photoDataUrlBytes(url, maxBytes));
}

/** File pickers may omit MIME. Publish a supported MIME from validated bytes,
 * so that subsequent draft recovery follows exactly the same strict boundary. */
export function normalizePhotoDataUrl(url: string, maxBytes: number, allowUnspecifiedMime: boolean): string {
  const bytes = photoDataUrlBytes(url, maxBytes, allowUnspecifiedMime);
  inspectPhotoDimensions(bytes);
  const mime = bytes[0] === 137 ? "png" : bytes[0] === 255 ? "jpeg" : "webp";
  return `data:image/${mime};base64,${url.slice(url.indexOf(",") + 1)}`;
}
