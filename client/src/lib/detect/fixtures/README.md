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
