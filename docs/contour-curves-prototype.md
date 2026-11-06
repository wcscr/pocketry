# Editable contour curves prototype

Tracks [enhancement #156](https://github.com/wcscr/pocketry/issues/156).

## Trying it

In Trace, **Editable curves** is a visible opt-in switch, off for new point
traces. **Auto-simplify outline** is directly in Outline settings after fresh
detection; it normally produces points, or native curves when the switch is on. For manual work, choose **Edit outline**, then **Bend edges** to shape
curves. In Bin, select an upright pocket in Layout and choose **Edit contour →
Bend edges**. Transferred curves open directly in curve editing. Tilted/profile
pockets retain the existing contour editing restriction.

- Click an edge to add a point on the existing line or exact curve. Right-click
  an anchor to delete that point, in both polygon and curve editing.
- Drag an edge in Bend edges to curve it; drag an anchor to move it with its
  handles. **Add handles**, **Straighten**, and **Add midpoint** provide explicit
  alternatives. Smooth/Corner controls and coordinates apply to a selected anchor.
- Shift-click toggles nodes; empty-space dragging selects a box, and Shift adds
  to a selection. The visible **Select points** toggle allows tap-to-toggle on
  phones. Drag a selected node to move the group; Delete removes selected points
  atomically, keeping at least three in each ring. **Simplify section** accepts
  one adjacent run, including one across the closed ring's seam. Disjoint nodes
  can still be moved/deleted but cannot be fitted as a single section.
- **Repair section** accepts two endpoints or one continuous selected run.
  Preview **Line** or **Smooth curve**; **Other side** switches the directed
  section. Smooth curve starts from neighboring tangents when supported, with
  **Bend** adjusting its signed midpoint distance from the endpoint chord.
  Endpoints and outside handles remain fixed. This intentional replacement has
  no fitting-deviation claim; topology checks still reject crossings, collapse
  and changed hole containment. Apply is one Undo step, Cancel makes no edit.
  Trace defaults to adaptive points; Editable curves retains native controls.
- Selection and navigation do not create history. Each completed geometry gesture
  commits once. Escape clears selection/cancels a draft, and pointer cancellation,
  focus loss or a second finger cancels a draft. Space/middle-drag and the hand tool
  pan; pinch zooms without editing points. Done leaves manual editing.
- Trace recovery and portable Pocketry projects preserve handles. Add to bin
  retains separate pockets/holes and photo positions. The contour list counts
  editable anchors, rather than the denser samples used for solid exports.

## Reconstructing a detected photo outline

Trace offers **Outline → Auto-simplify outline** after a fresh detection, with margin zero and no manual contour edits. This explicitly reconstructs all detected contours from their dense source. It does not run automatically on detection, load or save. The existing selected-point and coarse-contour fitting actions remain available separately.

The reconstruction first finds persistent corners using arc-length neighborhoods at two scales. It prefers supported finite straight runs and fits Bézier spans elsewhere, then refits curved spans using shared tangents and the neighboring straight-line directions. Smooth joins are accepted only when the adjusted spans still satisfy the selected allowance. Fitting can retain small corners/spurs when removing them would exceed that allowance; it does not infer perfect circular arcs or hidden tool geometry.

Preview shows the green candidate and straight/cubic counts; **Show original outline** switches to the dense detected reference. Detail presets select half the default allowance (More detail), the default (Balanced), or twice the default (Smoother), rounded upward to the displayed precision. Advanced **Maximum change from detected outline** is in mm after calibration and px otherwise. It bounds distance from the dense detected outline before simplification. For example, 0.2 mm permits up to 0.2 mm of boundary movement, not 0.2 mm of pocket clearance. The default allowance is at least 0.1 mm (1 px uncalibrated), or the typical dense sampling step if coarser. It can be edited; the algorithm never silently increases a selected bound. The bound is against the dense detected polygon, not the photograph. Cubic error is checked continuously along every source edge; line checks include finite endpoints and reverse progress. Winding, intersections, hole relationships and budgets are also checked. Topology checks use adaptive samples and are not an exact proof for arbitrarily tiny features.

Reconstruction runs in a cancellable worker without loading a new ML runtime. Cancel, Escape, changing the source/scale/ring or changing the allowance discards a pending preview. Apply commits the entire result as one undoable edit; any rejected contour keeps the entire previous source. Handles use the existing recovery, project, handoff and export representation. Undo to the original detected outline before reconstructing again after manual edits.

## Fitting existing points

Both editors offer two explicit actions after entering curve editing:

- **Select a section**: tap the first and last anchor or choose them from the
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

**Maximum change from current outline** defaults to 0.1 mm after calibration (1 px without calibration).
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
`curvesMm`; project schema 61 migrates version 60 and earlier supported files.
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
- Polygon-only simplification and margin reshaping remain disabled while curves
  are present. Symmetry and straightening now operate on native curves. Left/Right
  split axis crossings and reflect the chosen controls exactly; Average constructs
  a width profile and rebuilds curves at the existing curve precision. Disconnected
  halves, crossings and holes unsupported by symmetry retain the original.
  Straightening preserves all components and holes. Bin clearance offsets derived geometry
  while retaining the source. Ordinary re-detection replaces the authored trace;
  its previous edit can be recovered with Undo.
- Native cubic output is implemented for Trace SVG when no hole/material boolean is needed. Trace DXF/STL and Bin
  SVG/DXF/STL/3MF continue through sampled polygon geometry. DXF does not emit
  splines, and mesh formats do not retain editable handles. Use a Pocketry
  project backup for later editing.
- Existing topology/solid validation still applies. Sampling alone does not
  guarantee valid holes, non-intersection, a printable solid, or physical fit.

## Verification

Focused tests cover exact cubic subdivision (including the closing segment),
finite-chord sampling of loops/overshoot, winding and affine transforms, gesture
commit/cancel/pinch behavior, Trace canvas undo, draft recovery, project migration,
queue recovery, separate pocket/hole handoff and photo placement, Bin revisions, and native Trace SVG.
Fitting tests cover selected/wrapped runs, automatic corner protection, continuous
deviation, holes, stretched placements, opt-in preview/cancel, one-step undo in
both editors, saved fitted sources, and watertight STL output of fitted rings.
Run `npm run check`, `npm test`, `npm run build`, and `git diff --check` with Node 22.
Browser workflow checks are separate from these automated gates; slicer and
physical-fit qualification remain outside this prototype.

UI review build: targeted geometry/state/component tests, typecheck, build and a single Wolfbox compiled-browser workflow passed. Full photo/report qualification is deferred until the revised interaction is reviewed.
