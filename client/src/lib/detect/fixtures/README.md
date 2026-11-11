# Reflective driver photos

These are crops of Will Cobb's calibrated Wiha photos used for the Pocketry
examples. They cover a dark handle and its thin reflective shaft on paper.
Each fixture is **161 × 443**, row-major 8-bit RGBA, gzip compressed.

Chrome 154 decoded each 1727 × 2235 PNG into an HTML image, drew it directly
onto a 464 × 600 canvas (the normal Trace working size), then cropped
`x=161, y=81, width=161, height=443`. Drawing through an intermediate full-size
canvas changes resampling, so it does not reproduce this fixture.

| Fixture | Original PNG SHA-256 |
| --- | --- |
| `wiha-40mm.rgba.gz` | `d730dcb8f4708abe3e6ccf5c8107bdf79242ac1fc2078bf388fb24841a76c43c` |
| `wiha-50mm.rgba.gz` | `c158d0b93c36df423b35c55e69804b85794376752fadc40f90337ddb07335e4f` |

The source files are `source/40mm-calibrated.png` and `source/50mm-calibrated.png`
from the local `wiha-40-50mm-2026-10-03-r2-four-pockets` output package.

Tests check shaft inclusion and nearby background exclusion after contour
refinement. The 50 mm case uses stored detector bias 128 (**auto**); the 40 mm
case uses 100 (**+28** sensitivity) because glare still breaks its shaft at the default threshold.
These are regression landmarks, not complete ground-truth boundaries or
physical dimensional measurements.

## Craftsman on-sheet cleanup regression

`craftsman-sheet.rgba.gz` is a 396 × 387 RGBA crop of Will Cobb's
`Craftsman tape measure 25ft - ON Pocketry sheet - 20261017_102135.jpg`.
Source SHA-256: `77fc6c58eb5e04181a580a24da7073e7ee389a771158755e0d35e7986b71ef82`.
Pillow decoded/downsampled the original to 2121 × 2828. Pocketry's automatic
calibration and perspective correction produced a 933 × 1247 working image;
the crop starts at (270, 399), at 0.25 mm/pixel. The JSON records its paper
bounds for the real sheet-print removal step. No EXIF metadata is retained.

This is a different photo from the reference-strip Craftsman case in the
36-case comparison. It reproduces the raw-staircase fallback at sensitivity
**+56** in color detection and also exercises TEED. Tests run actual detection
and app cleanup, replacing only worker transport. They check cleanup, retained
material, and manual simplification; they do not establish physical fit or a
complete ground-truth boundary.

## Gerber refinement regression

`gerber.rgba.gz` is 384 × 600 RGBA (gzip), derived from the maintainer-supplied
`20260927_164649.jpg` using Pillow bilinear downsampling, matching the original
experimental diagnostic. Source SHA-256:
`8aee30736ac6f15f9d2c6f366023a5fe18906a204f2a64030a60ec5ea8334546`.
No EXIF metadata is retained. It tests reflective metal, dark inserts, shadow
rejection and the two open end recesses at unchanged default detail settings.

See [the refinement evaluation](../../../../../docs/photo-refinement-evaluation.md)
for sparse manual boundary annotations, their uncertainty, and before/after
comparisons. These are not full ground-truth masks or physical measurements.
