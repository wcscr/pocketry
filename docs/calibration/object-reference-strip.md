# Object reference strips and measurement aids

Trace can calibrate from a reference resting on a thick object, reducing the
apparent enlargement caused by measuring a raised edge against paper below it.
**Printable measurement aids** are available before uploading a photo and inside
**Scale**. Select **50, 100 or 200 mm**, then download a two-colour **3MF** or a
recessed **STL**. The original paper strip remains available as A4 and US Letter
PDFs. Generation and detection happen locally in the browser.

## Print and photograph

- The new aids are exactly **50 / 100 / 200 × 15 × 2 mm** end to end. Each has its
  length engraved/inlaid, 1 mm graduations on both long edges, and longer ticks
  at 5 and 10 mm. Measure from the left end face; interior numbers identify the
  10 mm ticks. The underside has a 0.3 mm, 45° chamfer, the top edge a 0.25 mm
  round, and the plan corners a 0.8 mm radius. Marker faces stay flat.
- **3MF:** import as one assembly with two parts. Assign opaque white to the
  carrier and opaque black to the markers, label and graduations. Print flat,
  markers facing up, at 0.2 mm layers. The black inlays occupy the top 0.4 mm
  and finish flush. Keep the parts assembled; do not auto-arrange them.
  Preview colours alone do not prove filament assignment.
- **STL:** print in opaque white, then fill the 0.4 mm recessed markings with
  matte black paint, keeping the white cells and borders clean. STL has no
  colour information; an unpainted, single-colour print is not an optical marker.
- Print at **100%**, never scale to fit. Check the finished end-to-end length
  and ruler ticks against a physical ruler or calipers before using it for scale.
- Choose the longest aid that fits flat on the part furthest from the paper,
  near the dimension that matters for fit. Keep it parallel to the paper and
  inside the tool's silhouette. It must not hide or extend past an edge being
  traced. Use **one aid per photo**, with both markers visible, and photograph
  straight down with the whole object in frame.
- Import the photo, review **Scale detected from the reference strip**, and
  accept. Unique marker pairs identify the size automatically; no size selection
  is needed during detection. The displayed scale line joins the **marker
  centres**, not the physical ends. See the baseline lengths below.
- Verify one physical object dimension before printing a pocket. Calibration
  is at the marker surface, including the aid's 2 mm thickness. Other object
  heights, flex, perspective and lens distortion can still produce error. For
  an uneven object, measure the relevant dimension and set scale manually.

For the original **100 × 20 mm paper strip**, expand the paper download section.
Print at **100% / Actual size**, with Fit to page disabled. Check the separate
100 mm verification bar, cut out the complete strip, and retain its white
borders. Mount it flat on thin, rigid backing if needed. Its original IDs and
80 mm baseline remain recognized, including previously printed 1.2 mm 3MF strips.

The aids provide a scalar scale, not 3D reconstruction or perspective correction.
A visible aid takes priority over a calibration sheet below it. Paper perspective
controls are hidden while a strip scale is pending or accepted; choose manual
calibration or clear the scale to use other methods. If any strip marker is
recognized but the pair is incomplete, mixed, repeated or geometrically invalid,
Trace rejects it instead of silently substituting paper scale. If neither marker
is recognized, a complete paper sheet can still be detected: check the reference
name in Scale before accepting it.

## Geometry and detection contract

`reference-strip.ts` is the shared physical specification for artwork, mesh and
recognition. Sizes refer to the full body; baseline lengths refer to marker centres.

| Design | Body (mm) | Marker IDs | Marker square | Centre baseline |
| --- | --- | --- | --- | --- |
| 50 mm aid | 50 × 15 × 2 | 22 / 23 | 9 mm | 35 mm |
| 100 mm aid | 100 × 15 × 2 | 24 / 25 | 9 mm | 85 mm |
| 200 mm aid | 200 × 15 × 2 | 26 / 27 | 9 mm | 185 mm |
| Original strip | 100 × 20; 1.2 mm for 3MF | 20 / 21 | 15 mm | 80 mm |

New marker centres lie 7.5 mm from each end and on the 7.5 mm midline. Each 6 × 6
module marker has a 1.5 mm white quiet zone. Ticks and labels remain outside that
zone. The original strip retains 2.5 mm quiet zones and centres at (10, 10) and
(90, 10) mm. Patterns come from OpenCV 4.11.0's deterministic
`extendDictionary(28, 4)`: the earlier 8-, 16- and 22-marker prefixes are unchanged.
IDs 16–19 remain reserved for the separate photo board. Paper detection retains
its original 8- and 16-marker decoding passes.

A dedicated 28-marker pass runs first and retains only strip IDs 20–27. Exactly
one complete pair must occur, with no repeated markers or multiple aids. All eight
corners must fit one orientation-preserving similarity transform anchored at that
pair's physical baseline. RMS residual must be at most 0.45 mm, individual
marker-edge scale disagreement at most 6%, and the baseline at least 40 image
pixels. More than 2% disagreement also warns at review. These tolerances
accommodate sampling noise; they are not an accuracy guarantee.

The 3MF is a Manifold-built white carrier with complementary black inlays. Both
parts are closed indexed meshes, share a flush top plane and form one assembled
build item without overlapping volume. The STL exports the recessed white carrier.
Existing 3MF serialization supplies material colours and Bambu part extruder
metadata. Other slicers may need explicit white/black assignments.

Rebuild all three aids and the original paper/3MF strip without the browser:

```sh
npm run generate:reference-strip
# Optional output directory:
npm run generate:reference-strip -- /tmp/pocketry-measurement-aids
```

The output includes 3MF/STL downloads, SVG top views, mesh data and a dimensions
manifest. Tests exercise the shipped OpenCV detector against independent marker
photos, rotated rasters of the actual exported black mesh triangles, mixed
sheet/strip planes, malformed signatures and the original PDF ink. Mesh checks
cover dimensions, closed/wound surfaces, edge profiles, non-overlap, recessed STL
markings and multipart/material packaging. Real printer shrinkage, flexibility,
opacity and photographic accuracy still require a physical print and measurement.
