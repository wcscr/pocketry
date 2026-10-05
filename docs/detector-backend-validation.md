# Detector backend validation

Local validation, 2026-10-05. Baseline: `origin/main` at
`73a834a812f24ad0b8ea52cdf7a883a5b1a91d39`.

## What changed

Pocketry has one outline-detection pipeline. OpenCV accelerates segmentation;
JavaScript provides a fallback when OpenCV cannot load or segmentation throws,
and a reference implementation for comparison. Both feed the same thresholding,
contour tracing, simplification, and outline normalization code.

OpenCV's 8-bit RGB-to-Lab conversion encodes lightness as 0–255, whereas the
JavaScript implementation uses CIE L* in 0–100. Applying the same lightness weight
to these different units changed background-distance scores. The OpenCV backend
now scales its existing lightness buffer to 0–100 before illumination correction
and background scoring. The a/b channel offsets cancel when computing background
differences. See the [OpenCV color-conversion documentation](https://docs.opencv.org/4.11.0/de/d25/imgproc_color_conversions.html).

Mask cleanup also differed: OpenCV used an elliptical kernel and its default
border handling; JavaScript used a square kernel with clamped edges. OpenCV now
uses a rectangular kernel and replicated borders. These are two corrections to
the existing algorithm, with no new detector mode, dependency, image buffer, or
pixel-budget increase.

## Regression coverage

The six previously expected failures now pass as ordinary tests: a rectangle,
a concave shape with a hole, an object near the image edge, two separate parts,
a cast shadow, and a colored tool on a neutral background. Their score-error
limits remain unchanged: mean absolute error below 0.5 and maximum error at most
3 on the 0–255 score scale.

Four grayscale-contrast cases isolate lightness units against the shared Lab
distance calculation. Five alpha-mask cases isolate cleanup at the center and
each image edge, requiring identical gated score arrays between backends.
The focused OpenCV suite contains 41 passing tests. Run it with Node 22:

```sh
npm test -- client/src/lib/detect/segment-opencv.test.ts
```

The full local gate also passes under Node 22: `npm run check`, `npm test`
(2,554 tests in 141 files), `npm run build`, and `git diff --check`.

## Real-photo comparison

Four existing calibrated Wiha photos were evaluated against JavaScript using
the same 600 × 1,650 px region, starting at (600, 300), within each 1,727 ×
2,235 px image. The photos contain dark/red handles and reflective metal on
paper. The region excludes surrounding calibration markers and can clip part
of the longest tool. This is a comparison of backend outputs, not a labeled
accuracy dataset or a test of complete-tool capture.

Scores below are mean absolute differences from JavaScript on the 0–255
scale. Mask IoU compares the thresholded foreground masks. Each row compares
the baseline OpenCV implementation with the corrected implementation.

| Photo | Segmentation pixels | Score error, before → after | Mask IoU, before → after |
| --- | ---: | ---: | ---: |
| 40 mm | 990,000 | 2.476 → 0.039 | 0.9731 → 0.9936 |
| 50 mm | 990,000 | 3.285 → 0.058 | 0.9816 → 0.9955 |
| 60 mm | 990,000 | 4.139 → 0.056 | 0.9834 → 0.9949 |
| 150 mm | 990,000 | 13.975 → 0.994 | 0.9296 → 0.9354 |
| 40 mm | 250,358 | 2.425 → 0.069 | 0.9628 → 0.9790 |
| 50 mm | 250,358 | 3.276 → 0.102 | 0.9589 → 0.9762 |
| 60 mm | 250,358 | 4.163 → 0.115 | 0.9599 → 0.9756 |
| 150 mm | 250,358 | 14.040 → 0.440 | 0.9380 → 0.9713 |

The smaller budget rounds each sample dimension separately, yielding 250,358
pixels for a requested 250,000-pixel budget. This behavior is unchanged.

Seven warm runs per backend and photo, under local Node 22 with OpenCV 4.11,
produced corrected OpenCV medians of 17.62–19.55 ms at the smaller budget and
30.65–34.33 ms at the larger budget. JavaScript medians were 39.13–41.26 ms
and 132.16–132.95 ms respectively. Corrected OpenCV timings were close to the
baseline's 17.35–19.71 ms and 29.93–33.67 ms. These are desktop measurements;
browser initialization time, peak memory, and phone performance were not measured.

Source PNG SHA-256 values identify the local inputs without distributing photos:

| Photo | File | SHA-256 |
| --- | --- | --- |
| 40 mm | `source/40mm-calibrated.png` | `d730dcb8f4708abe3e6ccf5c8107bdf79242ac1fc2078bf388fb24841a76c43c` |
| 50 mm | `source/50mm-calibrated.png` | `c158d0b93c36df423b35c55e69804b85794376752fadc40f90337ddb07335e4f` |
| 60 mm | `reference/60mm-calibrated.png` | `d6e551da36ef39b364e9eaffe6d415dbcc31847601126011870bd5cedf8a4fa2` |
| 150 mm | `reference/150mm-calibrated.png` | `7207a43c499aefcf255e0efcfdef632ce1c16b3a47742e9a5a5c7d8d6f4cecd3` |

The local evaluation script, decoded RGBA inputs, manifest, and detailed results
are retained under `/private/tmp/pocketry-detector-photos/`. They are temporary
verification artifacts; the source photos and those files are not added to Git.

## Remaining limits

Integer Lab conversion and different image-resampling implementations can still
change low-contrast pixels and threshold decisions. Narrow reflective shafts and
small holes can produce different outline topology, particularly in the longest
tool photo and at reduced resolution. These results establish substantially
closer backend agreement; they do not establish universal equivalence, physical
fit, or millimeter boundary accuracy. Labeled boundaries and physical phone
measurements remain necessary for those claims.

The observed bug was successful OpenCV execution with different results.
The current loader and automatic fallback report failures to the browser console;
this evaluation does not provide a real-user load-failure or crash rate.
