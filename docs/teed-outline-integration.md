# Photo outlines

**Automatic · match background** is the default for new traces. Draw a region
around one tool, leaving paper visible around it. Automatic checks that rim:
light neutral paper uses **Tool edges · white sheet**; dark, colored or uncertain
surroundings use **Color contrast**. Either method can be selected manually.
Existing saved method choices are preserved, including older color-only drafts.

[Ten before/after photo comparisons](../client/public/reports/outline-comparison/index.html)
and two additional wood-background checks are included as a portable HTML report. In a running build, open
`/reports/outline-comparison/`. The report compares the original detector with
Automatic at default detection settings, including a case where mixed surroundings
keep the color result. It contains one selected driver from the five-driver photo.

## What we tried and kept

- **Color and GrabCut:** bounded, mask-seeded CPU/WASM refinement can reduce
  shadows, but cannot reliably recover reflective material missing from the
  original color mask. It remains the color-path refinement and fallback.
- **Learned edges:** TEED follows outer silhouettes more reliably on the reviewed
  white-sheet photos. Its tiny model runs through the existing OpenCV worker,
  without another inference runtime or GPU requirement. Unsupported/clipped or
  fragmented results retain color detection; alpha silhouettes stay authoritative.
- **Boundary cleanup:** class-preserving edge interpolation avoids artificial
  slits. Auto sensitivity checks a bounded set of thresholds on one inference,
  recovering supported fragments while protecting paper gaps and independent
  tools. Recognized reference strips are handled locally; short hidden edges
  are estimated and highlighted amber for review.
- **Lines and curves:** explicit Auto-simplify reconstructs supported straight
  runs and approximates rounded spans with points. Editable curves opts into
  native Bézier handles. Symmetry, straightening, calibration, recovery and Undo
  preserve the chosen representation.

## Editing

Detection finds a boundary; **Auto-simplify outline** is a separate preview.
Editable curves is off by default. Enabling it on an existing detection asks
whether to keep the current outline or re-detect and replace edits; Undo can
restore the previous source. It does not silently fit curves.

**Add manual contour** starts a four-point contour. Click an edge to add a point;
right-click a point to delete it. Shift-click or box-select multiple points;
**Select points** also works without a keyboard. **Repair section** replaces a
selected run with a previewed line or curve. See [curve editing](contour-curves-prototype.md).

The simplification allowance measures movement from the dense detected outline,
not from the physical tool and not pocket clearance. Review tool tips, recesses,
shadows and amber estimated edges. Interior-hole detection requires Color contrast;
Automatic selects that method when holes are enabled. Multiple tools and transparent
parts remain challenging; select one tool at a time.

## Performance and verification

The HTML report gives fresh desktop CPU/WASM detection timings for each of its
ten crops. Earlier broad testing covered 36 tool-on-white-sheet photos / 90 views.
Automatic sensitivity improved the exact corrected no-strip tape control; the
other views were unchanged. This is occasional failure recovery, not a broad
quality improvement attributable to sensitivity alone. TEED supplied the broader
improvement. Phone speed, peak memory and physical fit remain unqualified.

Local checks: `npm run check`, `npm test`, `npm run test:workflows`,
`npm run build`, and `git diff --check`. Focused regressions cover small-tool
merges, line/curve bounds, shared holes, interrupted touch edits, calibrated
recovery and Undo. GitHub CI remains disabled. The PR lists the latest results;
raw experimental records are kept outside the repository.

## Model provenance

The fixed 512×512 TEED ONNX model is **248,782 bytes**, loaded only when needed.
It uses the existing OpenCV CPU/WASM runtime and adds no npm dependency.
Source revision `40fa4b1391dc6424f88989d0ca75d5b592c8681d` includes the BIPED
checkpoint under repository-level MIT terms (Xavier Soria Poma, 2022), without a
separate weights license or model card. No training dataset or Python implementation
is redistributed. Exact source/checkpoint/export hashes, conversion details and
attribution remain in [NOTICE](../NOTICE), with the full served license in
`client/public/models/teed/LICENSE.txt`. The OpenCV change is a worker-compatible
UMD wrapper; its embedded WASM is unchanged. Report crops are maintainer-supplied
photos with EXIF metadata removed.
