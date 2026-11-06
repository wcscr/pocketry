# Editable outline curves

Tracks [#156](https://github.com/wcscr/pocketry/issues/156).

## Controls

**Editable curves** is off by default. Auto-simplify normally produces points,
including point approximations of rounded edges. Enabling the switch on an
existing detection asks whether to keep that outline or re-detect from the photo
and replace edits. Undo restores the previous outline. The switch enables native
curves for later simplification; it does not silently fit or re-detect.

Use **Auto-simplify outline** after detection to preview supported straight lines
and rounded sections. More detail / Balanced / Smoother choose an allowance;
**Maximum change from detected outline** bounds movement from the dense detected
polygon in mm after calibration, or px otherwise. It is not distance from the
physical tool or pocket clearance. Compare original/preview, then Apply or Cancel.
Apply makes one Undo step. Manual edits must be undone before reconstructing again.

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
