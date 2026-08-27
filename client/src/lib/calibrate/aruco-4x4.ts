/**
 * ArUco DICT_4X4 marker patterns — the eight markers Pocketry's A4 and US
 * Letter calibration sheets use, ported as data from OpenCV.
 *
 * Upstream: https://github.com/opencv/opencv
 * File:     modules/objdetect/src/aruco/predefined_dictionaries.hpp
 * Tag:      4.11.0 (matches the bundled opencv.js build)
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

/** Canonical (rotation 0) bit patterns of DICT_4X4 markers 0–7. */
export const ARUCO_4X4_BITS: readonly number[] = [
  0xb532, // id 0
  0x0f9a, // id 1
  0x332d, // id 2
  0x9946, // id 3
  0x549e, // id 4
  0x79cd, // id 5
  0x9e2e, // id 6
  0xc4f2, // id 7
];

/** Marker side length in modules: 4 data cells plus the black border ring. */
export const ARUCO_4X4_MODULES = 6;

/**
 * The 4×4 data grid of a marker, `1` for white cells, row-major from the
 * top-left — the orientation OpenCV's detector reports as rotation 0.
 */
export function markerBits(id: number): number[][] {
  const bits = ARUCO_4X4_BITS[id];
  if (bits === undefined) {
    throw new Error(`markerBits: no ported pattern for marker id ${id}`);
  }
  return Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, col) => (bits >> (15 - (row * 4 + col))) & 1),
  );
}
