# Object reference strip

Trace can calibrate from a strip resting on a thick object, reducing the enlargement
caused by measuring a raised edge against a paper reference below it. Downloads are
available before uploading a photo and inside **Scale**: A4 or US Letter PDF and a
two-colour 3MF. All generation and detection happen locally in the browser.

## Print and photograph

- Print the PDF at **100% / Actual size**, with Fit to page disabled. Check the
  separate 100 mm verification bar, cut out the complete 100 × 20 mm strip, and
  keep the white borders intact. Use thin, rigid backing if needed; keep it flat.
- The 3MF is **100 × 20 × 1.2 mm**. Import as one assembly with two parts. Assign
  opaque white to **White carrier** and opaque black to **Black markers**. Preview
  colours alone do not prove filament assignment. Print flat, markers facing up,
  at 0.2 mm layers; the black inlays occupy the top 0.4 mm and finish flush.
  Do not separate, rescale or auto-arrange the parts. Check the finished length.
- Place the strip on the part furthest from the paper, near the dimension that
  matters for fit. Keep it parallel to the paper, with both markers visible.
  Keep it inside the tool's silhouette; it must not hide or extend past an edge
  being traced. Photograph straight down, keeping the whole object in frame.
- Import the photo, review **Scale detected from the reference strip**, and accept.
  The displayed ruler joins the **80 mm marker centres**. The strip itself is
  100 mm long. A visible strip takes priority over a calibration sheet below it.
- Verify one physical object dimension before printing a pocket. Calibration is
  at the marker surface, including the strip/backing thickness. Other heights,
  strip flex, perspective and lens distortion can still produce error. For an
  uneven object, measure the relevant dimension directly and set scale manually.

The strip provides a scalar scale, not a 3D reconstruction or perspective
correction. Paper perspective controls are hidden while a strip scale is pending
or accepted. Clear the scale or choose manual calibration to use other methods.
If one strip marker is recognized but its mate is hidden or its geometry fails,
Trace rejects the strip instead of silently substituting paper scale. If neither
strip marker is recognized, a complete paper sheet can still be detected: check
the reference name in Scale before accepting it.

## Geometry and detection contract

`reference-strip.ts` is the shared physical specification for paper, mesh and
recognition. The two 15 mm markers have centres at (10, 10) and (90, 10) mm. Each
6 × 6 module marker has a 2.5 mm white quiet zone. Canonical IDs 20 and 21 come
from OpenCV 4.11.0's deterministic `extendDictionary(22, 4)`. Existing sheet
patterns 0–15 are unchanged; 16–19 remain reserved for the separate photo board.
Paper detection retains its original 8- and 16-marker decoding passes.

A dedicated 22-marker pass runs first and retains only strip IDs. Both must occur
exactly once. All eight decoded corners must fit one orientation-preserving
similarity transform anchored at the 80 mm centre baseline. RMS residual must be
at most 0.45 mm, individual marker-edge scale disagreement at most 6%, and the
baseline at least 40 image pixels. More than 2% disagreement also warns at review.
These tolerances accommodate sampling noise; they are not an accuracy guarantee.

The 3MF is a Manifold-built white carrier with complementary black inlays. Both
parts are closed indexed meshes, share a flush top plane and form one assembled
build item. Existing 3MF serialization supplies material colours and Bambu part
extruder metadata. Other slicers may need explicit white/black assignments.

Rebuild the artifacts without the browser:

```sh
npm run generate:reference-strip
# Optional output directory:
npm run generate:reference-strip -- /tmp/pocketry-reference-strip
```

Tests exercise the shipped OpenCV detector against independent marker photos,
rotations, mixed sheet/strip planes, malformed signatures, the actual PDF ink,
and a raster of the exported mesh triangles. Mesh checks cover dimensions,
closed/wound surfaces, non-overlap and multipart/material packaging. Real printer
shrinkage, flexibility, opacity and photographic accuracy still require a physical
print and measurement.
