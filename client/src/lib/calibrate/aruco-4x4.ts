/**
 * Pocketry's sixteen-marker custom 4x4 dictionary for calibration-sheet v2,
 * ported as data from OpenCV's deterministic `extendDictionary(16, 4)` output.
 *
 * Generator: OpenCV `extendDictionary(16, 4)`
 * Upstream:  https://github.com/opencv/opencv at tag 4.11.0
 * Licence:  Apache-2.0 © OpenCV team — attribution in /NOTICE.
 *
 * Licensing bright line (recorded in docs/gridfinity-plan.md): ArUco *data*
 * and OpenCV's Apache-2.0 detector are fine to use and port; the original
 * standalone ArUco library from the University of Córdoba is GPLv3 and must
 * never be ported or bundled.
 *
 * Encoding, per OpenCV's `Dictionary::getBitsFromByteList`: 16 bits per 4×4
 * marker, row-major from the top-left cell, most significant bit first. A set
 * bit is a **white** cell; the marker is surrounded by a one-module black
 * border when rendered. Only generation lives here — detection uses the
 * dictionary compiled into opencv.js itself.
 */

/** Existing sheets retain the first eight ids and their exact marker patterns. */
export const STABLE_TEMPLATE_MARKER_COUNT = 8;

/** Canonical (rotation 0) patterns of Pocketry custom marker ids 0–15. */
export const POCKETRY_ARUCO_BITS: readonly number[] = [
  0x532c, // id 0
  0xaf8f, // id 1
  0x203f, // id 2
  0x1296, // id 3
  0x03f9, // id 4
  0x9a2f, // id 5
  0x4754, // id 6
  0xd870, // id 7
  0xbcd7, // id 8
  0x7de6, // id 9
  0x5b8b, // id 10
  0xf346, // id 11
  0x50cc, // id 12
  0xa729, // id 13
  0x10a0, // id 14
  0x0c82, // id 15
];

/** Marker side length in modules: 4 data cells plus the black border ring. */
export const ARUCO_4X4_MODULES = 6;

/**
 * The 4×4 data grid of a marker, `1` for white cells, row-major from the
 * top-left — the orientation OpenCV's detector reports as rotation 0.
 */
export function markerBits(id: number): number[][] {
  const bits = POCKETRY_ARUCO_BITS[id];
  if (bits === undefined) {
    throw new Error(`markerBits: no ported pattern for marker id ${id}`);
  }
  return Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, col) => (bits >> (15 - (row * 4 + col))) & 1),
  );
}
