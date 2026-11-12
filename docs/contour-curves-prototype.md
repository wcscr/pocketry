# Editable outline curves

Tracks [#156](https://github.com/wcscr/pocketry/issues/156).

## Controls

**Editable curves**, below the main outline actions, is off by default. Detection automatically reconstructs
lines and rounded sections, producing points sampled from the fitted curves. Enabling the switch on an
existing detection asks whether to keep that outline or re-detect from the photo
and replace edits. Undo restores the previous outline. The switch enables native
curves for re-detection or the next adjustment; it does not discard current edits
without that choice. Detection and cleanup form one Undo step.

Default detection includes bounded smoothing after line and curve reconstruction.
Under **Manual detection settings**, **Smooth outline** prepares an optional
preview of the current outline, including manual edits. **Original / Preview**
compares it with the accepted outline. Apply saves one Undo step; Cancel or Escape
keeps the outline. Sensitivity and the point simplification slider share this section.

Smoothing uses the accepted outline, never the raw segmentation boundary. The
search permits at most 0.2 mm of movement (2 px without calibration), and compares
progressively wider smoothing along the boundary. Sharp corners stop the filter.
A bounded curve fit retains fine sampling. The search retains a weaker safe
result if a new fit would cross an edge or increase measured alternating bumps.
Automatic detection additionally checks the combined result against the original
material boundary and rejects broader ripple increases. A rejection keeps the
previous reconstruction. Already smooth or constrained features can plateau.
Point counts can increase to describe a smoother edge; fewer points is not the
quality criterion. These bounds describe changes to detected geometry, not
physical accuracy or pocket clearance.

Manual edits establish a new accepted source. Opening a preview already applied
by detection or a previous Apply shows a checkmark and disables Apply; a dash
marks a result that would make no change. Hover or keyboard focus explains either
indicator. See the [default-smoothing UI comparison](outline-default-smoothing-validation-2026-11-11.md).

**Detected outline**, in Manual detection settings (or the compact Adjust tray),
compares the earlier contour before geometric smoothing and fitting. The green
preview leaves your outline untouched. **Use detected outline** replaces it with
detected points, retains the current margin and creates one Undo step. Undo also
restores any native curve handles. An already-used contour shows a checkmark and
disables replacement. Hover/focus hints explain the controls without extra copy.
Escape dismisses the preview. It cannot restore material segmentation missed.

Use **Edit outline → Bend edges** in Trace, or **Edit contour → Bend edges** on an
upright Bin pocket. Tilted/profile pockets retain their editing restriction.

- Drag an edge to bend it, an anchor to move it with its handles, or a handle to
  shape the curve. Click an edge to add a point; right-click an anchor to delete.
- Shift-click toggles points; drag empty space for a box selection. **Select
  points** enables tap selection. Move/delete a group together; at least three
  points remain per ring. **Add manual contour** starts a separate four-point trace.
- **Repair section** accepts two endpoints or a continuous run. Preview a Line
  or Smooth curve, choose Other side or adjust Bend, then Apply/Cancel. Repair
  intentionally replaces that section; it has no fitting-deviation claim.
- Selection and navigation do not make history. Completed geometry gestures
  commit once. Escape, focus loss, a second finger or source changes cancel a
  draft. Space/middle-drag pans; pinch zooms. Done leaves editing.

Turning Editable curves off converts native curves to their displayed points in
one undoable edit. Existing saved curves load intact. Symmetry and straightening
preserve native curves, calibration and Undo. Left/Right symmetry mirrors the
chosen controls; Average reconstructs a width profile. Unsupported topology keeps
the original. Margin reshaping is disabled while curves are authoritative; use
Bin clearance for fit.

## Geometry and persistence

`CurveOutline` retains the same outer/hole hierarchy as `Outline`. Anchors have
optional absolute incoming/outgoing Bézier handles; an edge with no handles is
a line. Reversing winding swaps handles. Rings are implicitly closed.

Reconstruction detects persistent corners, prefers supported finite straight
runs and fits cubic spans elsewhere. Bounds apply continuously along source
edges, including between vertices; failed fits retain the previous source.
Adaptive topology checks reject crossings and changed hole relationships, but
are not a proof for arbitrarily tiny features. Fitting approximates detected
geometry; it does not infer exact arcs or concealed tool shapes.

Curve sources survive Trace recovery, one-step Undo/Redo, separate pocket/hole
handoff, Bin revisions and project backups. Project schema 61 migrates supported
older projects, including the two version-60 representations. Trace draft schema
2 accepts schema 1. Scale/Y-flip conversion transforms points and handles together
once. Derived samples use a 0.025 mm finite-chord bound; that is a sampling bound,
not a manufacturing tolerance.

Trace SVG can retain native cubics when no hole/material boolean is required.
DXF, mesh and Bin exports use adaptive polygon samples. Save a Pocketry project
backup to retain editable handles. Software checks, exported geometry, slicer
checks and physical fit are separate forms of validation.
