# Reference-strip photograph regression

`100mm-ruler-photo.rgba.gz` contains a lossless, unscaled **70 × 188 pixel**
crop of the user's September 19, 2026 failure report: the printed 100 mm aid
(IDs 24/25) on the yellow tool. The surrounding room, packaging and person
are excluded. Pixels are row-major 8-bit RGBA, gzip compressed; the fixture
requires no image-decoder dependency in Node tests.

The original JPEG is 880 × 1174 pixels. After decoding to RGBA, the crop uses
the rectangle **(382, 486)–(452, 674)** with exclusive upper bounds. Tests paste
it back at its original location on a blank frame and can add synthetic paper
markers at a different scale.

Both IDs already decoded before the fix. The 85 mm baseline measured about
134.52 pixels, making each 9 mm marker about 14.24 pixels wide. One measured
edge was 12.97 pixels: an 8.9% difference that exceeded the old fixed 6% gate,
although the eight-corner RMS residual was only 0.345 mm. This fixture proves
photo detection and rejection behavior; it is not a measured physical-accuracy
ground truth for the tool's dimensions.
