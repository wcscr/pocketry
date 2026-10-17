# Editable contour curves prototype

Tracks [enhancement #156](https://github.com/wcscr/pocketry/issues/156).

## Trying it

In Trace, detect and simplify an outline, keep trace margin at zero, and choose
**Edit contours → Edit curves (prototype)**. In Bin, select an upright pocket in
Layout and choose **Edit contour → Edit curves (prototype)**. Transferred curves
open directly in curve mode. Tilted/profile pockets retain the existing contour
editing restriction.

- Drag an edge to bend it; drag an anchor to move it with its handles.
- Select an edge to see its two handles. **Curve** adds handles to a straight
  edge, **Straight** removes them, and **Split edge** subdivides the exact curve.
- Select an anchor for **Smooth**, **Corner**, **Delete point**, or coordinates.
  The contour and selection menus also make these controls keyboard accessible.
  Coordinates use image pixels in Trace and shape-local millimetres in Bin.
- Each completed gesture is one undo step. Clicking/selecting makes no edit.
  Escape, pointer cancellation, focus loss, and a second finger cancel a draft.
  Blank-space dragging pans; Shift/Space/middle-drag and pinch remain available.
- Trace recovery and portable Pocketry projects preserve handles. Add to bin
  preserves them whether tools are separated or combined. Existing polygon
  projects keep their original vertices until an explicit curve edit.

## Fitting existing points

Both editors offer two explicit actions after entering curve editing:

- **Fit selected points**: tap the first and last anchor or choose them from the
  First/Last menus. The amber section follows increasing point numbers, including
  the closing edge. **Swap ends** selects the complementary path. Select at least
  three adjacent points on one ring, then **Preview fit**.
- **Auto-fit contour**: preview a fit of the ring chosen in **Curve contour**.
  Outer contours and holes are fitted separately. Other contours and previously
  authored curved edges stay unchanged. Sharp turns of 45 degrees or more and
  explicitly marked Corner anchors remain fixed.

The dashed original and green preview can be compared before **Apply fit**.
Changing the deviation or selection discards the pending result; preview it again
to apply. Cancel/Escape discards it without changing save data or history. Apply
creates one undo entry and, in Bin, one immutable shape revision. Undo/Redo also
survives project/draft recovery. Source changes, contour switches, and calibration
or placement scale changes invalidate a pending preview.

**Max deviation** defaults to 0.1 mm after calibration (1 px without calibration).
It measures fitting error against the current edited polygon, not the photo or
the earlier unsimplified detection. It is separate from the downstream 0.025 mm
sampling tolerance. Bin converts the requested bound using the largest placement
scale, so stretching a pocket does not weaken the physical fitting bound.

The dependency-free fitter solves endpoint-constrained cubic least squares with
chord-length parameters. It checks the continuous difference between each cubic
subsegment and its original straight edge using recursive control-hull bounds.
Failed spans split in half and retry; exact straight edges are the fallback.
This supplies a conservative bound in both directions, including between input
vertices. Endpoints and unselected edges are retained. Closed rings retain at
least three anchors. Existing curves are protected from automatic refitting;
selected sections that already contain curves are rejected.

Fine adaptive samples additionally check winding, edge crossings/touching, and
containment relationships with holes and other contours. This topology check is
sampled, not a proof about arbitrarily small features. Oversized or excessively
complex fits fail without committing. Fitting does not run on load, detection,
save, transfer, or export. Its preview settings are not persistent automation.

## Representation and compatibility

`CurveOutline` has the same outer/hole hierarchy as `Outline`. Each anchor stores
its point and optional absolute incoming/outgoing Bézier handles. An edge with
no outgoing handle at its start and no incoming handle at its end is a line.
Rings are implicitly closed. Smooth points constrain handle directions, with
independent lengths.

Trace stores the authoritative source as `curves` in image coordinates and in
every affected undo entry. Draft version 2 accepts version 1. Bin shapes store
`curvesMm`; project schema 38 migrates version 37 and earlier supported files.
The scale/Y-flip boundary transforms anchors and handles together once, then
centres the shape. Reversing winding swaps incoming/outgoing handles. Pocket
placement, mirroring and scale stay separate from the immutable shape source.
Bin contour edits create fresh shape IDs, retaining prior revisions for undo.

`outline`/`outlineMm` are derived samples used by existing geometry consumers.
Import and queued-tool recovery rebuild curved-shape samples and metadata from
the source, so an obsolete cache cannot replace the authored geometry. The
adaptive subdivision criterion bounds each control hull against a finite chord
at 0.025 mm in shape-local coordinates (0.25 px for uncalibrated Trace display).
It fails explicitly if subdivision exceeds its depth or vertex budget.
This is a sampling bound, not an end-to-end manufacturing tolerance: placement
scale, offsets, kernel simplification and mesh serialization are separate steps.

## Current limits

- Cubic fitting approximates the selected polygon; it does not infer hidden photo
  details or produce exact circular arcs.
- Trace simplification, symmetry/upright alignment and margin reshaping are
  disabled while curves are present. Bin clearance offsets derived geometry
  while retaining the source. Ordinary re-detection replaces the authored trace;
  its previous edit can be recovered with Undo.
- Native cubic output is implemented for Trace SVG. Trace DXF/STL and Bin
  SVG/DXF/STL/3MF continue through sampled polygon geometry. DXF does not emit
  splines, and mesh formats do not retain editable handles. Use a Pocketry
  project backup for later editing.
- Existing topology/solid validation still applies. Sampling alone does not
  guarantee valid holes, non-intersection, a printable solid, or physical fit.

## Verification

Focused tests cover exact cubic subdivision (including the closing segment),
finite-chord sampling of loops/overshoot, winding and affine transforms, gesture
commit/cancel/pinch behavior, Trace canvas undo, draft recovery, project migration,
queue recovery, both handoff grouping modes, Bin revisions, and native Trace SVG.
Fitting tests cover selected/wrapped runs, automatic corner protection, continuous
deviation, holes, stretched placements, opt-in preview/cancel, one-step undo in
both editors, saved fitted sources, and watertight STL output of fitted rings.
Run `npm run check`, `npm test`, `npm run build`, and `git diff --check` with Node 22.
Browser workflow checks are separate from these automated gates; slicer and
physical-fit qualification remain outside this prototype.
