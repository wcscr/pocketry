# Object reference strips and measurement aids

Trace can calibrate from a reference resting on a thick object, reducing the
apparent enlargement caused by measuring a raised edge against paper below it.
**Download calibration aids** opens a shared dialog from the upload screen, **Scale**,
or Help. The **Calibration aids** dialog has separate **Paper printable aids**
and **3D printable aids** sections. Paper downloads include experimental A4 /
US Letter corner-marker sheets and one sheet containing all three
**50, 100 and 200 mm** measurement aids in either paper size. The 3D section
offers the same lengths as two-colour
**3MF** downloads. Legacy sheets,
the original paper strip and recessed STL aids are no longer offered in the
app. Previously printed marker families remain recognized. Generation and
detection happen locally in the browser.

## Print and photograph

- The 3D aids are exactly **50 / 100 / 200 × 15 × 2 mm** end to end. Each has its
  length engraved/inlaid, 1 mm graduations on both long edges, and longer ticks
  at 5 and 10 mm. Measure from the left end face; interior numbers identify the
  10 mm ticks. The underside has a 0.3 mm, 45° chamfer, the top edge a 0.25 mm
  round, and the plan corners a 0.8 mm radius. Marker faces stay flat.
- **Paper PDF:** print in landscape at **100% / Actual size**, with Fit to page
  turned off. Verify the marker-centre spacing (**35 / 85 / 185 mm**), then cut
  along the dashed line. The cut border adds **2 mm of white margin** around
  the unchanged **50 / 100 / 200 × 15 mm** artwork. Mount on thin, rigid
  backing if needed. Paper uses the same markers, labels and ruler ticks as
  its corresponding 3MF aid. Cut out one aid per photo; do not photograph the
  complete sheet. Downloading it does not change the selected
  perspective-correction sheet size.
- **3MF:** import as one assembly with two parts. Assign opaque white to the
  carrier and opaque black to the markers, label and graduations. Print flat,
  markers facing up, at 0.2 mm layers. The black inlays occupy the top 0.4 mm
  and finish flush. Keep the parts assembled; do not auto-arrange them.
  Preview colours alone do not prove filament assignment.
- Print at **100%**, never scale to fit. Check the finished end-to-end length
  and ruler ticks against a physical ruler or calipers before using it for scale.
- Choose the longest aid that fits flat on the part furthest from the paper,
  near the dimension that matters for fit. Keep it parallel to the paper and
  inside the tool's silhouette. It must not hide or extend past an edge being
  traced. Use **one aid per photo**, with both markers visible, and photograph
  straight down with the whole object in frame.
- Import the photo and review the detected references. Unique marker pairs
  identify the aid size automatically. Its scale line joins the **marker
  centres**, not the physical ends. See the baseline lengths below.
- When both references are usable, choose **Correct perspective & use aid
  scale** to straighten the image using the paper corners while deriving scale
  from the aid. Alternatively choose aid-only or paper-only scale, or paper
  correction with paper scale under the collapsed **Advanced** section. The
  recommended action and **Set manually instead** are the only initial choices.
  Desktop and mobile use the same choices. If the aid validates only after
  straightening the paper, aid-only acceptance is unavailable; use the combined
  correction instead. **Detect references again** stays under Scale → Advanced.
  Retrying keeps the current ruler, scale, and contour edits while a replacement
  is reviewed. **Dismiss detected scale** keeps that current scale; accepting a
  detected scale replaces it. A completed trace keeps its region and edits.
  **Correct perspective only**, under Advanced, leads to manual scale selection.
- Verify one physical object dimension before printing a pocket. Calibration
  is at the marker surface, including the 3D aid's 2 mm thickness or any paper
  backing. Other object heights, flex, perspective and lens distortion can still produce error. For
  an uneven object, measure the relevant dimension and set scale manually.

Previously printed **100 × 20 mm paper strips** retain their original IDs and
80 mm baseline, including the earlier 1.2 mm 3MF strip. Legacy references are
recognized but are no longer listed in the download dialog.

The aids provide a scalar scale, not 3D reconstruction. Detection checks both
the aid and the paper. When both pass validation, Scale prompts for the reference
or combined operation; neither scale is applied until the user chooses. Combined
correction transforms the validated aid endpoints with the exact same homography
as the image, preserving their physical length. It does not re-detect resampled
marker pixels or substitute the paper scale. The aid must lie within the corrected
paper area. When raw aid geometry is skewed, detection also checks the original
corners after the validated paper homography. This recovery preserves source
resolution checks and requires correction before accepting aid scale.
**Restore original photo** reverses the correction. If a scale, region, ruler or
contours exist, a confirmation explains that restoring clears that trace and its
edit history. **Keep working** preserves everything; **Restore and clear trace**
performs the reset. Perspective-only correction returns mobile users to the
canvas for manual ruler placement after it succeeds.

If the aid is incomplete, mixed, duplicated or geometrically invalid, Trace tries
the paper markers and offers their scale and perspective correction when valid.
A notice identifies this paper fallback, and the Scale panel names the sheet.
Paper scaling can still enlarge thick tools. Hover over the amber exclamation
mark or **Accuracy with thick objects** below the automatic options for the
detected-reference details and guidance on reference height and manual scaling.
This single hint applies to the whole group. Focus alone does not open it;
click, tap, Enter or Space opens it deliberately, and Escape closes it.
Its **Download measurement aids** link opens the same download dialog. Choose perspective-only correction
to continue with manual scaling. Guided steps keep the active controls and their
instructions together in view, including **Placing ruler** after correction.
If neither reference validates, no automatic scale is proposed.

On the first mobile visit, a dismissible welcome explains that the interface is
in early development. It recommends opening a GitHub issue for feedback;
the welcome's email link is temporarily removed. Dismissal is remembered in the browser, with a session
fallback if persistent storage is blocked.

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
pair's physical baseline. RMS residual must be at most 0.45 mm and the baseline
at least 40 image pixels. Individual marker-edge disagreement is limited to 6%
of its expected image size plus 0.5 image pixels of edge-localization allowance.
The pixel allowance matters for small markers: a one-pixel difference on a
14-pixel edge exceeds 7%, even when the long centre baseline is stable. It does
not change the scale derived from the baseline or bypass the corner-fit checks.
The raw measured disagreement is still shown above 2% at review. For clearer
markers, fill more of the photo with the tool while retaining both end markers.
These tolerances accommodate sampling noise; they are not an accuracy guarantee.

Marker detection normally reads the photo at a maximum of 1600 pixels per
side. If an aid is detected but rejected, Pocketry retries once using the
original photo at up to 2400 pixels per side, without upscaling smaller
originals or relaxing the geometry checks. A successful retry maps its
references into the same working-image coordinates. A failed retry preserves
the first pass's paper fallback. Existing usable paper references remain
available alongside a recovered aid, and replacement photos discard stale
results. The working canvas and export scale are unchanged.

The 3MF is a Manifold-built white carrier with complementary black inlays. Both
parts are closed indexed meshes, share a flush top plane and form one assembled
build item without overlapping volume. Recessed STL downloads were withdrawn
because recognition of manually coloured prints has not been physically validated.
Existing 3MF serialization supplies material colours and Bambu part extruder
metadata. Other slicers may need explicit white/black assignments.

Rebuild all three aids and the original paper/3MF strip without the browser:

```sh
npm run generate:reference-strip
# Optional output directory:
npm run generate:reference-strip -- /tmp/pocketry-measurement-aids
```

The output includes A4 / US Letter measurement-aid PDFs, 3MF downloads, SVG top
views, mesh data and a dimensions manifest. Tests exercise the shipped OpenCV
detector against independent marker
photos, rotated rasters of the actual exported black mesh triangles, mixed
sheet/strip planes, malformed signatures, and the original and new PDF ink. Mesh checks
cover dimensions, closed/wound surfaces, edge profiles, non-overlap and
multipart/material packaging. Real printer shrinkage, flexibility, opacity and
photographic accuracy still require a physical print and measurement.
