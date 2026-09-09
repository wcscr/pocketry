# H2D photo-board validation — 2026-09-08

## Completed

- OpenSCAD 2026.04.26 with Manifold rendered the base, marker-color parts, and
  fit coupon without geometry errors.
- The exported base bounds, including the adhesion pads, are 323 × 318 × 6 mm.
- Every mesh in the base, white tiles, black patterns, and combined marker 3MF
  has zero non-manifold edges. The combined marker file has one build item
  containing two material parts, retaining the black layer's 0.8 mm Z offset.
- Bambu Studio 02.08.02.61 successfully sliced both the large base and combined
  markers for the H2D 0.4 mm profile. Both report `outside=false`, no supports,
  and no mesh repairs. The large base used one nozzle; the marker assembly used
  both nozzles with separate white/black filament assignments.
- Pocketry's actual bundled OpenCV detector read IDs 16, 17, 18, and 19 from a
  top-down render of the complete OpenSCAD model. It recognized the H2D layout
  and produced a sixteen-corner fit residual of approximately 0.127 mm.
- Automated calibration tests also cover a green board photographed through
  perspective, correction and re-detection, incorrect tile placement, and
  incorrect marker size. Existing A4/Letter layouts retain their marker bits
  and original eight- and sixteen-marker decoding paths.
- The required type check and full test suite pass: 1,033 tests across 74 files.
  The production build also passes. Two localhost-dependent tests initially
  hit the sandbox's network restriction and passed with localhost access.

## Physical work still required

No board has been printed or photographed in this task. Slicing and rendered
marker detection do not prove adhesion, surface flatness, opacity, shrinkage,
or the physical fit of a marker tile. Print the coupon first, then follow the
flatness and dimensional checks in README.md. Marker IDs encode a nominal
layout; they cannot expose uniform shrinkage or bowing between the corners.

The Pocketry changes are in this local checkout and have not been published to
the hosted site. Older versions do not recognize these new markers.
