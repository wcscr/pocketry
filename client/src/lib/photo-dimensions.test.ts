import { describe, expect, it } from "vitest";
import { inspectPhotoDataUrl, inspectPhotoDimensions, PHOTO_DIMENSION_ERROR } from "./photo-dimensions";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const png = () => Uint8Array.from(atob(PNG), c => c.charCodeAt(0));
function jpeg(width: number, height: number) {
  return Uint8Array.from([255,216,255,224,0,4,0,0,255,192,0,11,8,height>>8,height&255,width>>8,width&255,1,1,17,0,255,218]);
}
function webp(width: number, height: number, lossless = false, canvas?: [number, number]) {
  const bytes = new Uint8Array(12 + (canvas ? 18 : 0) + (lossless ? 14 : 18));
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => bytes.set([...value].map(c => c.charCodeAt(0)), at);
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WEBP");
  let at = 12;
  if (canvas) {
    text(at, "VP8X"); view.setUint32(at + 4, 10, true);
    for (let n = 0; n < 3; n++) { bytes[at + 12 + n] = (canvas[0] - 1) >>> (n * 8); bytes[at + 15 + n] = (canvas[1] - 1) >>> (n * 8); }
    at += 18;
  }
  text(at, lossless ? "VP8L" : "VP8 "); view.setUint32(at + 4, lossless ? 5 : 10, true);
  if (lossless) { bytes[at + 8] = 0x2f; view.setUint32(at + 9, (width - 1) | ((height - 1) << 14), true); }
  else { bytes.set([0x9d,1,0x2a], at + 11); view.setUint16(at + 14, width, true); view.setUint16(at + 16, height, true); }
  return bytes;
}
describe("photo header resource gate", () => {
  it("accepts real still PNG and bounded JPEG, VP8, VP8L and VP8X headers", () => {
    expect(inspectPhotoDataUrl(`data:image/png;base64,${PNG}`, 1024)).toEqual({ width: 1, height: 1 });
    for (const bytes of [jpeg(8000,6000), webp(8000,6000), webp(8000,6000,true), webp(8000,6000,false,[8000,6000])]) {
      expect(inspectPhotoDimensions(bytes)).toEqual({ width: 8000, height: 6000 });
    }
  });
  it("rejects compressed pixel bombs across every format", () => {
    const hugePng = png(); new DataView(hugePng.buffer).setUint32(16, 65535);
    for (const bytes of [hugePng, jpeg(10000,10000), webp(10000,10000), webp(10000,10000,true), webp(10000,10000,false,[1,1])]) {
      expect(() => inspectPhotoDimensions(bytes)).toThrow(PHOTO_DIMENSION_ERROR);
    }
  });
  it("rejects conflicting WebP dimensions, animation and truncated chunks", () => {
    expect(() => inspectPhotoDimensions(webp(20,30,false,[1,1]))).toThrow();
    const animated = webp(20,30,false,[20,30]); animated[20] = 2;
    expect(() => inspectPhotoDimensions(animated)).toThrow();
    const apng = png(); apng.set([..."acTL"].map(c => c.charCodeAt(0)), 37);
    expect(() => inspectPhotoDimensions(apng)).toThrow();
    for (const bytes of [png(),jpeg(30,20),webp(30,20),webp(30,20,true)]) {
      for (let size = 0; size < bytes.length; size++) expect(() => inspectPhotoDimensions(bytes.slice(0,size))).toThrow();
    }
  });
  it("rejects deferred JPEG height, foreign types and excessive encoded bytes", () => {
    expect(() => inspectPhotoDimensions(jpeg(100,0))).toThrow();
    expect(() => inspectPhotoDataUrl(`data:image/svg+xml;base64,${PNG}`, 1024)).toThrow();
    expect(() => inspectPhotoDataUrl(`data:image/png;base64,${PNG}`, 10)).toThrow();
  });
});
